/**
 * Contratos da camada de pagamentos — independente de provedor.
 *
 * Adicionar um provedor novo significa implementar `PaymentProvider` e
 * registrá-lo em `index.ts`. O checkout e o painel consomem apenas estes tipos,
 * portanto não precisam ser reconstruídos.
 */
import type { PaymentProviderKey } from "./currencies.ts";

export type { PaymentProviderKey };

/** Estados financeiros mínimos exigidos na Etapa 2. */
export type PaymentStatus =
  | "pending"
  | "approved"
  | "authorized"
  | "captured"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded"
  | "disputed";

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "pending",
  "approved",
  "authorized",
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
  "disputed",
];

export type ConnectionStatus = "pending" | "connected" | "expired" | "revoked" | "error";

/** Credenciais devolvidas pelo fluxo OAuth/onboarding do provedor. */
export type ProviderCredentials = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
  externalAccountId: string;
  externalAccountLabel: string;
  merchantId: string | null;
  capabilities: Record<string, unknown>;
};

export type ProviderConnectionView = {
  provider: PaymentProviderKey;
  label: string;
  configured: boolean;
  connected: boolean;
  enabled: boolean;
  status: ConnectionStatus;
  environment: string;
  accountIdMasked: string | null;
  accountLabel: string | null;
  currency: string | null;
  currencySupported: boolean;
  currencyMessage: string | null;
  capabilities: Record<string, unknown>;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  needsReconnect: boolean;
  setupMessage: string | null;
};

export type CreatePaymentInput = {
  catalogId: string;
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  returnUrl: string;
  cancelUrl: string;
  externalReference: string;
  buyerEmail?: string | null;
};

export type CreatePaymentResult = {
  providerPaymentId: string | null;
  providerOrderId: string | null;
  status: PaymentStatus;
  providerStatus: string | null;
  checkoutUrl: string | null;
  raw: Record<string, unknown>;
};

export type ProviderPaymentSnapshot = {
  providerPaymentId: string;
  providerOrderId: string | null;
  status: PaymentStatus;
  providerStatus: string | null;
  amount: number;
  currency: string;
  capturedAmount: number;
  refundedAmount: number;
  payerReference: string | null;
  raw: Record<string, unknown>;
};

export type RefundInput = {
  providerPaymentId: string;
  amount: number;
  currency: string;
  reason?: string | null;
};

export type RefundResult = {
  providerRefundId: string | null;
  status: "pending" | "approved" | "failed" | "cancelled";
  amount: number;
  raw: Record<string, unknown>;
};

export type WebhookVerification = {
  valid: boolean;
  eventId: string;
  eventType: string;
  /** Id do pagamento no provedor (quando o evento se refere a um). */
  providerPaymentId: string | null;
  /** `true` quando o evento é apenas uma notificação de teste/verificação. */
  isTestEvent: boolean;
  payload: Record<string, unknown>;
  reason?: string;
};

export type WebhookRequest = {
  headers: Record<string, string>;
  rawBody: string;
  query: Record<string, string>;
};

export interface PaymentProvider {
  readonly key: PaymentProviderKey;
  readonly label: string;

  /** Credenciais de plataforma presentes? (nunca expõe os valores) */
  isConfigured(): boolean;

  /** Motivo legível quando `isConfigured()` é falso. */
  setupMessage(): string | null;

  /** URL de autorização/onboarding do vendedor (state assinado). */
  buildAuthorizeUrl(input: {
    state: string;
    redirectUri: string;
    trackingId?: string;
  }): Promise<string>;

  /** Troca o retorno do OAuth/onboarding por credenciais da conta do vendedor. */
  completeAuthorization(input: {
    query: Record<string, string>;
    redirectUri: string;
  }): Promise<ProviderCredentials>;

  /** Renova o token de acesso da conta do vendedor. */
  refreshCredentials(input: {
    refreshToken: string;
    current: ProviderCredentials;
  }): Promise<ProviderCredentials>;

  /** Revoga o acesso na origem (best effort, nunca lança). */
  revoke(credentials: ProviderCredentials): Promise<void>;

  /** Consulta a conta conectada e confirma que o token funciona. */
  verifyConnection(credentials: ProviderCredentials): Promise<{
    ok: boolean;
    externalAccountId: string | null;
    externalAccountLabel: string | null;
    merchantId: string | null;
    capabilities: Record<string, unknown>;
    reason?: string;
  }>;

  createPayment(
    credentials: ProviderCredentials,
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult>;

  getPayment(
    credentials: ProviderCredentials,
    providerPaymentId: string,
  ): Promise<ProviderPaymentSnapshot | null>;

  capture(
    credentials: ProviderCredentials,
    providerPaymentId: string,
  ): Promise<ProviderPaymentSnapshot | null>;

  refund(
    credentials: ProviderCredentials,
    input: RefundInput,
  ): Promise<RefundResult>;

  verifyWebhook(request: WebhookRequest): Promise<WebhookVerification>;
}
