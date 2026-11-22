/** Dispara a notificação de novo pedido ao vendedor (best-effort). */

import { PAYMENTS_FUNCTIONS_URL } from "./payments";

export async function notifySellerAboutOrder(input: {
  orderId?: string;
  catalogId?: string;
  customerName?: string;
}): Promise<void> {
  try {
    await fetch(`${PAYMENTS_FUNCTIONS_URL}/seller-order-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
      },
      body: JSON.stringify({
        orderId: input.orderId || undefined,
        catalog_id: input.catalogId || undefined,
        customer_name: input.customerName || undefined,
      }),
    });
  } catch (error) {
    // Notificação nunca deve impedir/bloquear a conclusão do pedido.
    console.warn("[notificação] falha ao avisar o vendedor:", error);
  }
}
