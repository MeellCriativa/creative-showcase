/**
 * Ciclo de vida das conexões financeiras (por catálogo + provedor).
 *
 * Nenhum token sai daqui em texto puro: o frontend recebe apenas identificadores
 * mascarados, status e capacidades.
 */
import {
  credentialsFromConnection,
  getConnection,
  markConnectionState,
  updateConnectionTokens,
  type ConnectionRow,
} from "./db.ts";
import { maskAccountId, maskEmail } from "./crypto.ts";
import { checkCurrencySupport } from "./currencies.ts";
import { getProvider, providerEnvironment } from "./index.ts";
import type {
  PaymentProviderKey,
  ProviderConnectionView,
  ProviderCredentials,
} from "./types.ts";

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export type CredentialsResult = {
  connection: ConnectionRow | null;
  credentials: ProviderCredentials | null;
  needsReconnect: boolean;
  reason?: string;
};

/**
 * Carrega credenciais utilizáveis, renovando o token quando estiver perto de
 * expirar. Se a renovação falhar, a conexão é marcada como `expired` e o
 * vendedor precisa reconectar (o painel mostra "Conexão expirada").
 */
export async function loadCredentials(
  catalogId: string,
  provider: PaymentProviderKey,
): Promise<CredentialsResult> {
  const connection = await getConnection(catalogId, provider);
  if (!connection || !connection.connected) {
    return { connection, credentials: null, needsReconnect: false };
  }
  const providerImpl = getProvider(provider);
  if (!providerImpl) {
    return { connection, credentials: null, needsReconnect: true, reason: "Provedor desconhecido." };
  }

  let credentials = await credentialsFromConnection(connection);
  if (!credentials) {
    await markConnectionState({ catalogId, provider, status: "expired", connected: false, enabled: false });
    return {
      connection,
      credentials: null,
      needsReconnect: true,
      reason: "Não foi possível ler as credenciais salvas.",
    };
  }

  const expiresAt = credentials.expiresAt ? new Date(credentials.expiresAt).getTime() : 0;
  const shouldRefresh = expiresAt > 0 && Date.now() > expiresAt - REFRESH_WINDOW_MS;

  if (shouldRefresh) {
    try {
      const refreshed = await providerImpl.refreshCredentials({
        refreshToken: credentials.refreshToken ?? "",
        current: credentials,
      });
      await updateConnectionTokens({ catalogId, provider, credentials: refreshed });
      credentials = refreshed;
    } catch (error) {
      console.error("[payments] refresh falhou", provider, (error as Error).message);
      await markConnectionState({
        catalogId,
        provider,
        status: "expired",
        connected: false,
        enabled: false,
      });
      return {
        connection,
        credentials: null,
        needsReconnect: true,
        reason: "Autorização expirada. Conecte novamente.",
      };
    }
  }

  return { connection, credentials, needsReconnect: false };
}

export async function buildConnectionView(
  catalogId: string,
  provider: PaymentProviderKey,
  catalogCurrency: string,
): Promise<ProviderConnectionView> {
  const providerImpl = getProvider(provider)!;
  const connection = await getConnection(catalogId, provider);
  const configured = providerImpl.isConfigured();
  const environment = connection?.environment ?? providerEnvironment(provider);

  const capabilities = (connection?.capabilities ?? {}) as Record<string, unknown>;
  const accountSiteId =
    provider === "mercadopago" ? (capabilities.site_id as string | null | undefined) : null;
  const accountPrimaryCurrency =
    provider === "paypal" ? (capabilities.primary_currency as string | null | undefined) : null;

  const support = checkCurrencySupport(provider, {
    currency: catalogCurrency,
    accountSiteId: accountSiteId ?? null,
    accountPrimaryCurrency: accountPrimaryCurrency ?? null,
  });

  const connected = !!(
    connection?.connected &&
    connection?.status === "connected" &&
    connection.environment === providerEnvironment(provider)
  );
  const rawLabel = connection?.external_account_label ?? null;
  const maskedLabel = rawLabel
    ? rawLabel.includes("@")
      ? maskEmail(rawLabel)
      : maskAccountId(rawLabel)
    : null;

  return {
    provider,
    label: providerImpl.label,
    configured,
    connected,
    enabled: !!(connected && connection?.enabled && support.supported),
    status: (connection?.status as ProviderConnectionView["status"]) ?? "pending",
    environment,
    accountIdMasked: maskAccountId(connection?.external_account_id ?? null),
    accountLabel: maskedLabel,
    currency: catalogCurrency,
    currencySupported: support.supported,
    currencyMessage: support.supported ? null : support.reason,
    capabilities,
    connectedAt: connection?.connected_at ?? null,
    lastVerifiedAt: connection?.last_verified_at ?? null,
    needsReconnect: connection?.status === "expired" || connection?.status === "revoked",
    setupMessage: configured ? null : providerImpl.setupMessage(),
  };
}

/** Lista os métodos realmente disponíveis no checkout (público, sem segredos). */
export async function listPublicPaymentMethods(
  catalogId: string,
  catalogCurrency: string,
): Promise<Array<{ provider: PaymentProviderKey; label: string; currency: string }>> {
  const available: Array<{ provider: PaymentProviderKey; label: string; currency: string }> = [];
  for (const provider of ["paypal", "mercadopago"] as const) {
    const providerImpl = getProvider(provider)!;
    if (!providerImpl.isConfigured()) continue;
    const connection = await getConnection(catalogId, provider);
    if (!connection?.connected || connection.status !== "connected" || !connection.enabled) continue;
    // Conexões sandbox não podem cobrar se o runtime estiver em produção (e vice-versa).
    if (connection.environment !== providerEnvironment(provider)) continue;
    const capabilities = (connection.capabilities ?? {}) as Record<string, unknown>;
    const support = checkCurrencySupport(provider, {
      currency: catalogCurrency,
      accountSiteId: (capabilities.site_id as string | null) ?? null,
      accountPrimaryCurrency: (capabilities.primary_currency as string | null) ?? null,
    });
    if (!support.supported) continue;
    available.push({ provider, label: providerImpl.label, currency: catalogCurrency });
  }
  return available;
}
