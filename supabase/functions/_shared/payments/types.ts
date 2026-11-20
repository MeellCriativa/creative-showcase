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
  /**
   * Frete oficial do pedido (re-cotado no backend).
   *
   * Correção da auditoria (C3): o Checkout Pro cobrava apenas `sum(items)`,
   * então todo pedido com frete era cobrado a menos. O valor agora vai para o
   * provedor (`shipments.cost` no Mercado Pago, `amount.breakdown.shipping` no
   * PayPal) e precisa fechar exatamente com `amount`.
   */
  shippingAmount: number;
  shippingLabel?: string | null;
  returnUrl: string;
  cancelUrl: string;
  externalReference: string;
  buyerEmail?: string | null;
  /** Nome exibido na fatura do comprador (sanitizado pelo provedor). */
  statementDescriptor?: string | null;
  /** Chave de idempotência por tentativa de checkout (P4). */
  idempotencyKey?: string | null;
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
  /**
   * Id do PAGAMENTO/captura no provedor (é ele que o reembolso usa).
   * `null` quando o provedor ainda não gerou captura (PayPal autorizado).
   */
  providerPaymentId: string | null;
  /** Id da ORDEM/preferência — no PayPal é o id consultável. */
  providerOrderId: string | null;
  status: PaymentStatus;
  providerStatus: string | null;
  amount: number;
  currency: string;
  capturedAmount: number;
  refundedAmount: number;
  /**
   * `false` quando `refundedAmount` NÃO é um total oficial confiável.
   *
   * F-06B: o PayPal responde `PARTIALLY_REFUNDED` na captura sem informar o
   * valor reembolsado. Nesse caso `refundedAmount` não pode ser tratado como 0
   * confirmado nem usado para aprovar pendências.
   */
  refundedAmountKnown?: boolean;
  /**
   * Referência externa devolvida pela API oficial (o UUID do pedido no MP).
   * Usada para recusar um pagamento confirmado para OUTRO pedido (correção P2).
   */
  externalReference?: string | null;
  /**
   * Conta do vendedor que recebe o pagamento, conforme a API oficial
   * (`collector_id` no Mercado Pago). Usada para recusar pagamentos de OUTRO
   * vendedor (correção P2).
   */
  sellerAccountId?: string | null;
  payerReference: string | null;
  raw: Record<string, unknown>;
};

export type RefundInput = {
  providerPaymentId: string;
  amount: number;
  currency: string;
  reason?: string | null;
  /**
   * Chave de idempotência da OPERAÇÃO de reembolso.
   *
   * Correção da auditoria (R-01): antes cada provedor derivava a chave do
   * VALOR, então dois reembolsos legítimos de mesmo valor colidiam. A chave
   * agora vem de fora (uma por operação), estável em retries e distinta entre
   * operações.
   */
  idempotencyKey: string;
};

export type RefundResult = {
  providerRefundId: string | null;
  status: "pending" | "approved" | "failed" | "cancelled";
  amount: number;
  raw: Record<string, unknown>;
};

/**
 * Consulta oficial de um reembolso já criado (F-01).
 *
 * Usada APENAS na reconciliação: nunca cria um novo reembolso.
 */
export type RefundQueryResult = {
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

/** Recurso notificado por um webhook (o que o provedor mandou, sem confirmação). */
export type NotificationResource = {
  type: string;
  id: string;
  /**
   * `true` quando o id notificado já é um id de pagamento (e não de
   * preferência/ordem). Define se a consulta oficial pode usar o id direto.
   */
  isPaymentResource: boolean;
};

/**
 * Resultado da consulta oficial de uma notificação.
 *
 * Correção da auditoria (C1): o Mercado Pago manda apenas `{ type, data: { id } }`
 * — sem `external_reference`. A referência do pedido só aparece consultando a
 * API oficial, e é isso que este método faz.
 */
export type NotificationResolution = {
  externalReference: string | null;
  providerPaymentId: string | null;
  providerStatus: string | null;
  /** Conta vendedora devolvida pela API oficial (MP: `collector_id`). */
  sellerAccountId?: string | null;
};

/**
 * Resultado da desconexão (correção M3).
 *
 * A remoção LOCAL sempre acontece. `remoteRevoked` só é `true` quando o
 * provedor confirma a revogação; quando não há endpoint oficial confirmado,
 * `manualRequired` orienta o vendedor a desautorizar o aplicativo na conta dele.
 */
export type RevokeResult = {
  remoteRevoked: boolean;
  manualRequired: boolean;
  reason?: string;
};

export interface PaymentProvider {
  readonly key: PaymentProviderKey;
  readonly label: string;

  /** Credenciais de plataforma presentes? (nunca expõe os valores) */
  isConfigured(): boolean;

  /** Motivo legível quando `isConfigured()` é falso. */
  setupMessage(): string | null;

  /**
   * URL de autorização/onboarding do vendedor (state assinado).
   *
   * M1 (decisão registrada): PKCE permanece FORA desta etapa. O OAuth do MP
   * usado aqui é authorization code com `state` HMAC + nonce; o aplicativo deve
   * manter PKCE desabilitado. `siteId` só informa o país da conta na URL.
   */
  buildAuthorizeUrl(input: {
    state: string;
    redirectUri: string;
    trackingId?: string;
    siteId?: string | null;
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

  /**
   * Tenta revogar o acesso na origem (best effort, nunca lança).
   * O chamador SEMPRE remove a conexão local, independente do resultado.
   */
  revoke(credentials: ProviderCredentials): Promise<RevokeResult>;

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

  /**
   * Consulta oficial de uma notificação de webhook para descobrir a referência
   * do pedido (quando o payload não traz `external_reference`).
   */
  resolveNotification(
    credentials: ProviderCredentials,
    resource: NotificationResource,
  ): Promise<NotificationResolution | null>;

  capture(
    credentials: ProviderCredentials,
    providerPaymentId: string,
  ): Promise<ProviderPaymentSnapshot | null>;

  refund(
    credentials: ProviderCredentials,
    input: RefundInput,
  ): Promise<RefundResult>;

  /**
   * Consulta oficial de um reembolso já criado (F-01).
   *
   * Opcional: quando o provedor não expõe a consulta, a reconciliação usa o
   * total oficial da transação. NUNCA executa um novo reembolso.
   */
  getRefund?(
    credentials: ProviderCredentials,
    providerRefundId: string,
  ): Promise<RefundQueryResult | null>;

  verifyWebhook(request: WebhookRequest): Promise<WebhookVerification>;
}
