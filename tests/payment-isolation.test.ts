import assert from "node:assert/strict";
import test from "node:test";

import { isCrossCatalogEvent } from "../supabase/functions/_shared/payments/lifecycle.ts";
import {
  extractReference,
  notificationResource,
  orderIdFromReference,
  resolveTransaction,
  selectPaymentFromMerchantOrder,
} from "../supabase/functions/_shared/payments/resolution.ts";

/**
 * Isolamento entre vendedores (auditoria A3).
 *
 * Cada loja tem a própria conta conectada. O webhook chega com a conta que
 * notificou; se a transação atingida pertencer a OUTRA loja, o evento é
 * descartado (200, sem efeito) — ninguém altera o pedido de outra loja apenas
 * citando um id de pagamento.
 */

const ORDER_A = "11111111-1111-4111-8111-111111111111";
const ORDER_B = "22222222-2222-4222-8222-222222222222";

test("evento de uma loja não pode atingir transação de outra", () => {
  assert.equal(isCrossCatalogEvent("catalog-A", "catalog-B"), true);
  assert.equal(isCrossCatalogEvent("catalog-A", "catalog-A"), false);
});

test("sem conta identificada (PayPal) o evento não é bloqueado", () => {
  assert.equal(isCrossCatalogEvent(null, "catalog-A"), false);
  assert.equal(isCrossCatalogEvent("catalog-A", null), false);
  assert.equal(isCrossCatalogEvent(null, null), false);
});

test("notificação da loja B resolve a transação da loja A e é descartada", async () => {
  const transaction = {
    id: "tx-A",
    catalog_id: "catalog-A",
    order_id: ORDER_A,
    provider_payment_id: "MP-PAYMENT-1",
    provider_order_id: "MP-PREFERENCE-1",
  };

  const resolved = await resolveTransaction({
    provider: "mercadopago",
    resource: { type: "payment", id: "MP-PAYMENT-1", isPaymentResource: true },
    payload: { type: "payment", data: { id: "MP-PAYMENT-1" } },
    providerPaymentId: "MP-PAYMENT-1",
    deps: {
      byProviderPayment: async () => transaction,
      byOrder: async () => null,
      byProviderOrder: async () => null,
    },
  });

  assert.ok(resolved);
  // A consulta por id de pagamento é global (não conhece a loja): quem barra o
  // efeito é a checagem de catálogo no pipeline do webhook.
  assert.equal(resolved.transaction.catalog_id, "catalog-A");
  assert.equal(isCrossCatalogEvent("catalog-B", resolved.transaction.catalog_id), true);
});

test("notificação da própria loja é aplicada", async () => {
  const transaction = {
    id: "tx-B",
    catalog_id: "catalog-B",
    order_id: ORDER_B,
    provider_payment_id: "MP-PAYMENT-2",
    provider_order_id: "MP-PREFERENCE-2",
  };

  const resolved = await resolveTransaction({
    provider: "mercadopago",
    resource: { type: "payment", id: "MP-PAYMENT-2", isPaymentResource: true },
    payload: { type: "payment", data: { id: "MP-PAYMENT-2" } },
    providerPaymentId: "MP-PAYMENT-2",
    deps: {
      byProviderPayment: async () => transaction,
      byOrder: async () => null,
      byProviderOrder: async () => null,
    },
  });

  assert.ok(resolved);
  assert.equal(isCrossCatalogEvent("catalog-B", resolved.transaction.catalog_id), false);
});

test("referência externa só aceita UUID de pedido", () => {
  assert.equal(orderIdFromReference(ORDER_A), ORDER_A);
  assert.equal(orderIdFromReference(`  ${ORDER_A}  `), ORDER_A);
  assert.equal(orderIdFromReference("MP-PREFERENCE-1"), null);
  assert.equal(orderIdFromReference(""), null);
  assert.equal(orderIdFromReference(null), null);
  assert.equal(orderIdFromReference("'; drop table orders; --"), null);
});

test("referência do payload do MP é extraída sem confiar no corpo", () => {
  assert.equal(
    extractReference("mercadopago", { external_reference: ORDER_A }),
    ORDER_A,
  );
  assert.equal(
    extractReference("mercadopago", { data: { external_reference: ORDER_B } }),
    ORDER_B,
  );
  assert.equal(extractReference("mercadopago", { type: "payment", data: { id: "1" } }), null);
});

test("referência do PayPal vem do purchase_unit, não do id do evento", () => {
  const payload = {
    event_type: "CHECKOUT.ORDER.APPROVED",
    resource: {
      id: "ORDER-PAYPAL-1",
      purchase_units: [{ custom_id: ORDER_A }],
    },
  };
  assert.equal(extractReference("paypal", payload), ORDER_A);

  const resource = notificationResource("paypal", payload);
  assert.equal(resource.id, "ORDER-PAYPAL-1");
  assert.equal(resource.isPaymentResource, true);
});

test("merchant_order de outra loja escolhe apenas o pagamento aprovado", () => {
  const selected = selectPaymentFromMerchantOrder({
    external_reference: ORDER_B,
    payments: [
      { id: "p-1", status: "rejected" },
      { id: "p-2", status: "approved" },
      { id: "p-3", status: "pending" },
    ],
  });
  assert.deepEqual(selected, { paymentId: "p-2", status: "approved" });

  assert.equal(selectPaymentFromMerchantOrder({ payments: [] }), null);
  assert.equal(selectPaymentFromMerchantOrder(null), null);
});
