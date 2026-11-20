/**
 * Registro de provedores. Adicionar um provedor novo = implementar
 * `PaymentProvider` + adicionar aqui. O checkout e o painel não mudam.
 */
import { paypalProvider, paypalEnvironment } from "./paypal.ts";
import { mercadopagoProvider, mpEnvironment } from "./mercadopago.ts";
import type { PaymentProvider, PaymentProviderKey } from "./types.ts";

export const PROVIDER_KEYS: readonly PaymentProviderKey[] = ["paypal", "mercadopago"];

export const PROVIDERS: Record<PaymentProviderKey, PaymentProvider> = {
  paypal: paypalProvider,
  mercadopago: mercadopagoProvider,
};

export function isProviderKey(value: unknown): value is PaymentProviderKey {
  return value === "paypal" || value === "mercadopago";
}

export function getProvider(key: string | null | undefined): PaymentProvider | null {
  if (!isProviderKey(key)) return null;
  return PROVIDERS[key];
}

export function providerEnvironment(key: PaymentProviderKey): "sandbox" | "production" {
  return key === "paypal" ? paypalEnvironment() : mpEnvironment();
}

export function providerLabel(key: PaymentProviderKey): string {
  return PROVIDERS[key].label;
}

export * from "./types.ts";
export * from "./currencies.ts";
