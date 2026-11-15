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
  getCatalog,
  markConnectionState,
  saveConnection,
} from "../_shared/payments/db.ts";
import { verifyState, encryptionConfigured, readEnv } from "../_shared/payments/crypto.ts";
import { getProvider, isProviderKey } from "../_shared/payments/index.ts";
import { checkCurrencySupport } from "../_shared/payments/currencies.ts";
import { resolveStoreCurrency } from "../../../src/lib/currency.ts";

function panelUrl(): string {
  const base = (
    readEnv("VITRINE_URL") ??
    readEnv("PAYMENTS_RETURN_ORIGIN") ??
    "https://vitrine.meellcriativa.workers.dev"
  ).replace(/\/+$/, "");
  return `${base}/painel/pagamentos`;
}

function redirect(params: Record<string, string>): Response {
  const url = new URL(panelUrl());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": "no-store" },
  });
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
    const providerErrorDescription = query["error_description"] ?? "";

    // ── 1. Valida o state (assinatura + expiração) ─────────────────────────
    const payload = await verifyState(state);
    if (!payload) {
      // Sem state válido não é possível saber o provedor — usa o hint da query.
      providerHint = isProviderKey(query["provider"]) ? query["provider"] : "";
      return redirectError(providerHint, providerError || "invalid_state");
    }

    const providerValue = String(payload.provider ?? "");
    if (!isProviderKey(providerValue)) {
      return redirectError("", "invalid_provider");
    }
    providerHint = providerValue;
    const provider = providerValue;

    const catalogId = String(payload.catalog_id ?? "");
    const userId = String(payload.user_id ?? "");
    if (!catalogId || !userId) return redirectError(provider, "invalid_state_payload");

    // ── 2. O vendedor cancelou/negou a autorização na origem ───────────────
    if (providerError) {
      console.warn("[payments-callback] provedor retornou erro:", provider, providerError, providerErrorDescription);
      return redirectError(
        provider,
        `${providerError}${providerErrorDescription ? `: ${providerErrorDescription}` : ""}`,
      );
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
    const supabaseUrl = readEnv("SUPABASE_URL") ?? "";
    const redirectUri = `${supabaseUrl}/functions/v1/payments-callback`;

    let credentials;
    try {
      credentials = await providerImpl.completeAuthorization({ query, redirectUri });
    } catch (error) {
      console.error("[payments-callback] completeAuthorization:", (error as Error).message);
      return redirectError(provider, (error as Error).message);
    }

    // ── 5. Verifica a conta antes de habilitar qualquer coisa ──────────────
    const verified = await providerImpl.verifyConnection(credentials).catch((error) => {
      console.error("[payments-callback] verifyConnection:", (error as Error).message);
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
      environment: String(payload.env ?? "sandbox") === "production" ? "production" : "sandbox",
      credentials: {
        ...credentials,
        externalAccountId: verified?.externalAccountId ?? credentials.externalAccountId,
        externalAccountLabel: verified?.externalAccountLabel ?? credentials.externalAccountLabel,
        merchantId: verified?.merchantId ?? credentials.merchantId,
        capabilities,
      },
      status: verified && !verified.ok ? "pending" : "connected",
    });

    if (!saved.ok) {
      return redirectError(provider, saved.error ?? "db_save_error");
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
      external_account_label: verified?.externalAccountLabel ?? credentials.externalAccountLabel ?? null,
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
      ...(verified?.ok ? {} : { error: verified?.reason ?? "verify_failed" }),
      ...(support.supported ? {} : { currency_warning: "1" }),
    });
  } catch (error) {
    console.error("[payments-callback]", error);
    return redirectError(providerHint, "internal_error");
  }
});
