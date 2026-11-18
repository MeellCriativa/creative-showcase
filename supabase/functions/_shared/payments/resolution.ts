/**
 * Resolução de notificações → transação (puro, com dependências injetadas).
 *
 * Correção da auditoria (C1/C2): o webhook do Mercado Pago traz apenas
 * `{ type, data: { id } }` — o `id` é o **payment id**, enquanto a transação
 * guardava a **preference id**. A referência do pedido só aparece consultando
 * a API oficial (`/v1/payments/{id}` ou `/v1/merchant_orders/{id}`).
 *
 * Este módulo descreve a ordem de resolução sem tocar em rede/banco, para que
 * o fluxo real (webhooks.ts) e os testes usem exatamente o mesmo algoritmo.
 */

import type { NotificationResource } from "./types.ts";

export type { NotificationResource };

export type ResolutionTransaction = {
  id: string;
  order_id: string;
  provider_payment_id: string | null;
  provider_order_id: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extrai o id do pedido a partir da referência externa do provedor. */
export function orderIdFromReference(value: string | null | undefined): string | null {
  const ref = String(value ?? "").trim();
  if (!ref) return null;
  return UUID_RE.test(ref) ? ref : null;
}

/** Referência externa presente no próprio corpo do evento (quando existe). */
export function extractReference(
  provider: "paypal" | "mercadopago",
  payload: Record<string, unknown>,
): string | null {
  const resource = (payload["resource"] ?? {}) as Record<string, unknown>;
  if (provider === "paypal") {
    const purchaseUnits = resource["purchase_units"];
    if (Array.isArray(purchaseUnits) && purchaseUnits.length > 0) {
      const unit = purchaseUnits[0] as Record<string, unknown>;
      const custom = unit["custom_id"] ?? unit["reference_id"] ?? unit["invoice_id"];
      if (custom) return String(custom);
    }
    const supplementary = resource["supplementary_data"] as Record<string, unknown> | undefined;
    const related = supplementary?.["related_ids"] as Record<string, unknown> | undefined;
    if (related?.["order_id"]) return String(related["order_id"]);
    return null;
  }
  const data = (payload["data"] ?? {}) as Record<string, unknown>;
  for (const candidate of [payload["external_reference"], data["external_reference"]]) {
    if (candidate) return String(candidate);
  }
  return null;
}

/** Normaliza o recurso notificado (tipo + id) para os dois provedores. */
export function notificationResource(
  provider: "paypal" | "mercadopago",
  payload: Record<string, unknown>,
  query: Record<string, string> = {},
): NotificationResource {
  if (provider === "paypal") {
    const eventType = String(payload["event_type"] ?? "");
    const resource = (payload["resource"] ?? {}) as Record<string, unknown>;
    const supplementary = resource["supplementary_data"] as Record<string, unknown> | undefined;
    const related = supplementary?.["related_ids"] as Record<string, unknown> | undefined;
    const id = String(related?.["order_id"] ?? resource["id"] ?? "");
    const type = eventType.toLowerCase() || "unknown";
    return {
      type,
      id,
      // No PayPal o id da ordem É o id que guardamos como pagamento.
      isPaymentResource: type.startsWith("checkout.order") || type.startsWith("payment.capture"),
    };
  }

  const type = String(payload["type"] ?? payload["topic"] ?? query["topic"] ?? "");
  const data = (payload["data"] ?? {}) as Record<string, unknown>;
  const id = String(data["id"] ?? query["data.id"] ?? query["id"] ?? "");
  return { type, id, isPaymentResource: type === "payment" };
}

/**
 * Escolhe o pagamento relevante de um `merchant_order`.
 * Prefere o aprovado; se não houver, o último que não foi recusado/cancelado.
 */
export function selectPaymentFromMerchantOrder(
  merchantOrder: Record<string, unknown> | null | undefined,
): { paymentId: string; status: string } | null {
  const payments = merchantOrder?.["payments"];
  if (!Array.isArray(payments) || payments.length === 0) return null;

  const normalized = payments
    .map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        paymentId: String(item["id"] ?? ""),
        status: String(item["status"] ?? "").toLowerCase(),
      };
    })
    .filter((item) => item.paymentId);

  if (normalized.length === 0) return null;

  const approved = normalized.find((item) => item.status === "approved");
  if (approved) return approved;

  const usable = [...normalized]
    .reverse()
    .find((item) => item.status !== "rejected" && item.status !== "cancelled");
  return usable ?? null;
}

export type ResolutionDeps<T extends ResolutionTransaction> = {
  byProviderPayment(providerPaymentId: string): Promise<T | null>;
  byOrder(orderId: string): Promise<T | null>;
  byProviderOrder(providerOrderId: string): Promise<T | null>;
  /** Consulta a API oficial para descobrir a referência do pedido. */
  resolveNotification?(
    resource: NotificationResource,
  ): Promise<{ externalReference: string | null; providerPaymentId: string | null } | null>;
};

export type ResolutionResult<T extends ResolutionTransaction> = {
  transaction: T;
  /** Id que deve ser consultado em `getPayment` (payment id quando possível). */
  providerPaymentId: string;
  via: "provider_payment" | "payload_reference" | "official_lookup" | "provider_order";
};

/**
 * Ordem de resolução (a mesma usada pelo webhook real):
 *   1. id de pagamento já conhecido;
 *   2. referência externa presente no payload;
 *   3. consulta oficial (Mercado Pago: pagamento ou merchant_order);
 *   4. fallback pelo id de preferência/ordem.
 */
export async function resolveTransaction<T extends ResolutionTransaction>(input: {
  provider: "paypal" | "mercadopago";
  resource: NotificationResource;
  payload: Record<string, unknown>;
  providerPaymentId: string | null;
  deps: ResolutionDeps<T>;
}): Promise<ResolutionResult<T> | null> {
  const { deps, provider, resource } = input;

  if (input.providerPaymentId) {
    const direct = await deps.byProviderPayment(input.providerPaymentId);
    if (direct) {
      return {
        transaction: direct,
        providerPaymentId: input.providerPaymentId,
        via: "provider_payment",
      };
    }
  }

  const reference = extractReference(provider, input.payload);
  const referenceOrderId = orderIdFromReference(reference);
  if (referenceOrderId) {
    const byOrder = await deps.byOrder(referenceOrderId);
    if (byOrder) {
      return {
        transaction: byOrder,
        providerPaymentId: input.providerPaymentId ?? referenceOrderId,
        via: "payload_reference",
      };
    }
  }

  if (deps.resolveNotification && resource.id) {
    const looked = await deps.resolveNotification(resource);
    const orderId = orderIdFromReference(looked?.externalReference ?? null);
    if (orderId) {
      const byOrder = await deps.byOrder(orderId);
      if (byOrder) {
        return {
          transaction: byOrder,
          providerPaymentId:
            looked?.providerPaymentId ?? input.providerPaymentId ?? resource.id,
          via: "official_lookup",
        };
      }
    }
  }

  const fallbackId = input.providerPaymentId ?? resource.id;
  if (fallbackId) {
    const byProviderOrder = await deps.byProviderOrder(fallbackId);
    if (byProviderOrder) {
      return {
        transaction: byProviderOrder,
        providerPaymentId: input.providerPaymentId ?? fallbackId,
        via: "provider_order",
      };
    }
  }

  return null;
}
