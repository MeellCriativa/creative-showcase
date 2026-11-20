/**
 * Callback OAuth/onboarding dos provedores de pagamento.
 *
 * PayPal (Seller Onboarding): o retorno traz `merchantIdInPayPal`,
 * `permissionsGranted` e o `state` assinado. Não há troca de código.
 * Mercado Pago (Authorization Code): o retorno traz `code` + `state`; o code é
 * trocado pelo access token do vendedor.
 *
 * Segurança:
 *   - o `state` é verificado por HMAC-SHA256 e expiração (proteção CSRF);
 *   - o `catalog_id` do state precisa pertencer ao usuário do state;
 *   - tokens são gravados SEMPRE criptografados (AES-256-GCM);
 *   - nenhum token é retornado ao navegador — apenas um redirect para o painel.
 */
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import {
  adminClient,
  consumeOAuthState,
  getCatalog,
  markConnectionState,
  saveConnection,
} from "../_shared/payments/db.ts";
import {
  maskAccountId,
  maskEmail,
  verifyState,
  encryptionConfigured,
} from "../_shared/payments/crypto.ts";
import {
  EnvironmentConfigError,
  panelOrigin,
  paymentsCallbackUrl,
} from "../_shared/payments/urls.ts";
import {
  getProvider,
  isProviderKey,
  providerEnvironment,
} from "../_shared/payments/index.ts";
import { connectionEnvironmentMatches } from "../_shared/payments/lifecycle.ts";
import { checkCurrencySupport } from "../_shared/payments/currencies.ts";
import { resolveStoreCurrency } from "../../../src/lib/currency.ts";

/** Painel do ambiente atual; `null` quando a origem não está configurada. */
function panelUrl(): string | null {
  try {
    return `${panelOrigin()}/painel/pagamentos`;
  } catch {
    return null;
  }
}

function redirect(params: Record<string, string>): Response {
  const base = panelUrl();
  if (!base) {
    // Nunca redireciona para outro ambiente quando VITRINE_URL está ausente.
    return new Response("VITRINE_URL não configurada.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": "no-store" },
  });
}

/** Rótulos vindo do provedor nunca são persistidos em claro. */
function maskLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.includes("@") ? maskEmail(value) : maskAccountId(value);
}

/** Texto livre do provedor nunca volta na URL (pode conter dados pessoais). */
function stableError(raw: string): string {
  const value = raw.toLowerCase();
  if (/access_denied|user_denied|cancel|declined/.test(value)) return "authorization_cancelled";
  if (/permission|scope|consent/.test(value)) return "permissions_not_granted";
  if (/merchant.?id/.test(value)) return "missing_merchant_id";
  if (/credential|not configured|indispon/i.test(value)) return "provider_not_configured";
  if (/expired|invalid.*token/.test(value)) return "authorization_expired";
  return "provider_error";
}

function redirectError(provider: string, code: string): Response {
  console.error("[payments-callback] erro:", provider, code);
  return redirect({
    ...(provider ? { provider } : {}),
    connected: "0",
    error: code.slice(0, 300),
  });
}

serve(async (req) => {
  let providerHint = "";
  try {
    const url = new URL(req.url);
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) query[key] = value;

    const state = query["state"] ?? "";
    const providerError = query["error"] ?? "";

    // ── 1. Valida o state (assinatura + expiração) ─────────────────────────
    const payload = await verifyState(state);
    if (!payload) {
      // Sem state válido não é possível saber o provedor — usa o hint da query.
      providerHint = isProviderKey(query["provider"]) ? query["provider"] : "";
      return redirectError(providerHint, providerError ? stableError(providerError) : "invalid_state");
    }

    const providerValue = String(payload.provider ?? "");
    if (!isProviderKey(providerValue)) {
      return redirectError("", "invalid_provider");
    }
    providerHint = providerValue;
    const provider = providerValue;

    // Correção P3: se o runtime mudou de ambiente durante o OAuth, o state
    // assinado antideria ser recusado — nunca gravamos credencial de sandbox
    // em produção (nem o contrário).
    if (!connectionEnvironmentMatches(String(payload.env ?? ""), providerEnvironment(provider))) {
      return redirectError(provider, "environment_mismatch");
    }

    const catalogId = String(payload.catalog_id ?? "");
    const userId = String(payload.user_id ?? "");
    if (!catalogId || !userId) return redirectError(provider, "invalid_state_payload");

    // ── 1.1 Nonce de uso único (auditoria M8) ──────────────────────────────
    // Mesmo que o `state` seja reutilizado dentro da validade, só a primeira
    // troca é aceita.
    const nonce = String(payload.nonce ?? "");
    if (!nonce) return redirectError(provider, "missing_nonce");
    if (!(await consumeOAuthState(nonce))) {
      return redirectError(provider, "state_already_used");
    }

    // ── 2. O vendedor cancelou/negou a autorização na origem ───────────────
    if (providerError) {
      // P12: nem o log recebe texto livre do provedor (pode conter PII ou
      // conteúdo controlado pelo visitante). Só o rótulo estável é registrado.
      console.warn("[payments-callback] provedor retornou erro:", provider, stableError(providerError));
      return redirectError(provider, stableError(providerError));
    }

    // ── 3. Confere posse do catálogo e configuração da plataforma ──────────
    const catalog = await getCatalog(catalogId);
    if (!catalog || catalog.user_id !== userId) {
      return redirectError(provider, "catalog_not_owned");
    }
    if (!encryptionConfigured()) {
      return redirectError(provider, "encryption_not_configured");
    }
    const providerImpl = getProvider(provider);
    if (!providerImpl || !providerImpl.isConfigured()) {
      return redirectError(provider, "provider_not_configured");
    }

    // ── 4. Troca o retorno por credenciais da conta do vendedor ────────────
    let redirectUri: string;
    try {
      redirectUri = paymentsCallbackUrl();
    } catch (error) {
      if (error instanceof EnvironmentConfigError) {
        return redirectError(provider, "callback_url_not_configured");
      }
      throw error;
    }

    let credentials;
    try {
      credentials = await providerImpl.completeAuthorization({ query, redirectUri });
    } catch (error) {
      console.error("[payments-callback] completeAuthorization:", stableError((error as Error).message));
      return redirectError(provider, stableError((error as Error).message));
    }

    // ── 5. Verifica a conta antes de habilitar qualquer coisa ──────────────
    const verified = await providerImpl.verifyConnection(credentials).catch((error) => {
      console.error("[payments-callback] verifyConnection:", stableError((error as Error).message));
      return null;
    });

    const currency = resolveStoreCurrency(catalog.currency);
    const capabilities = {
      ...credentials.capabilities,
      ...(verified?.capabilities ?? {}),
    };
    const support = checkCurrencySupport(provider, {
      currency,
      accountSiteId: (capabilities.site_id as string | null | undefined) ?? null,
      accountPrimaryCurrency: (capabilities.primary_currency as string | null | undefined) ?? null,
    });

    // ── 6. Persiste a conexão (tokens criptografados) ──────────────────────
    const saved = await saveConnection({
      catalogId: catalog.id,
      provider,
      // Já validado acima contra o ambiente do runtime; grava a origem da verdade.
      environment: providerEnvironment(provider),
      credentials: {
        ...credentials,
        externalAccountId: verified?.externalAccountId ?? credentials.externalAccountId,
        externalAccountLabel: maskLabel(verified?.externalAccountLabel ?? credentials.externalAccountLabel),
        merchantId: verified?.merchantId ?? credentials.merchantId,
        capabilities,
      },
      status: verified && !verified.ok ? "pending" : "connected",
    });

    if (!saved.ok) {
      return redirectError(provider, "db_save_error");
    }

    // Nunca habilita automaticamente: o vendedor liga o método no painel,
    // depois de ver a identificação mascarada e o aviso de moeda.
    await markConnectionState({
      catalogId: catalog.id,
      provider,
      status: verified && !verified.ok ? "pending" : "connected",
      connected: !!verified?.ok,
      enabled: false,
    });

    const admin = adminClient();
    await admin.from("payment_connections").update({
      external_account_id: verified?.externalAccountId ?? credentials.externalAccountId ?? null,
      external_account_label: maskLabel(
        verified?.externalAccountLabel ?? credentials.externalAccountLabel,
      ),
      merchant_id: verified?.merchantId ?? credentials.merchantId ?? null,
      capabilities,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
      .eq("catalog_id", catalog.id)
      .eq("provider", provider);

    return redirect({
      provider,
      connected: verified?.ok ? "1" : "0",
      ...(verified?.ok
        ? {}
        : { error: verified?.reason ? stableError(verified.reason) : "verify_failed" }),
      ...(support.supported ? {} : { currency_warning: "1" }),
    });
  } catch (error) {
    console.error("[payments-callback]", error);
    return redirectError(providerHint, "internal_error");
  }
});
