/**
 * Compatibilidade de moeda por provedor de pagamento.
 *
 * Regra da Etapa 2: nunca converter silenciosamente. Se a moeda do catálogo
 * não for aceita pelo provedor (ou pela conta conectada), o método é bloqueado
 * com mensagem clara — tanto no painel quanto no checkout.
 */

export type PaymentProviderKey = "paypal" | "mercadopago";

/**
 * Moedas que o PayPal aceita para recebimento (lista oficial de moedas de
 * saldo/ recebimento do PayPal). A conversão, quando existir, é feita pelo
 * próprio PayPal e exibida ao comprador — nunca pela plataforma.
 */
export const PAYPAL_SUPPORTED_CURRENCIES: readonly string[] = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD",
  "HUF", "ILS", "JPY", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "SEK",
  "SGD", "THB", "TWD", "USD",
];

/** Moeda de liquidação por site do Mercado Pago (conta do vendedor). */
export const MERCADOPAGO_SITE_CURRENCIES: Record<string, string> = {
  MLB: "BRL",
  MLA: "ARS",
  MLC: "CLP",
  MCO: "COP",
  MLM: "MXN",
  MPE: "PEN",
  MLU: "UYU",
};

/** Moedas aceitas pelo Mercado Pago em Checkout Pro. */
export const MERCADOPAGO_SUPPORTED_CURRENCIES: readonly string[] = [
  "BRL", "ARS", "CLP", "COP", "MXN", "PEN", "UYU",
];

export type CurrencySupportInput = {
  currency: string;
  /** `site_id` da conta Mercado Pago (MLB, MLA, ...), quando conhecido. */
  accountSiteId?: string | null;
  /** Moeda primária da conta PayPal, quando conhecida. */
  accountPrimaryCurrency?: string | null;
  /**
   * M4: em operações de ESCRITA (habilitar cobrança) exigimos saber o site da
   * conta MP. Leituras do painel/checkout permanecem fail-open para não fazer
   * uma conexão legada desaparecer subitamente.
   */
  requireKnownSite?: boolean;
};

export type CurrencySupportResult =
  | { supported: true }
  | {
      supported: false;
      reason: string;
      code: "currency_not_supported" | "account_currency_mismatch" | "account_site_unknown";
    };

function normalize(code: string | null | undefined): string {
  return String(code ?? "").trim().toUpperCase();
}

/**
 * Verifica se o provedor aceita a moeda do catálogo.
 *
 * Mercado Pago: além da lista de moedas, a conta tem um site (país) e uma
 * moeda de liquidação. Se a conta é MLB e o pedido é em USD, o dinheiro cairia
 * convertido — isso é bloqueado com mensagem explícita.
 */
export function checkCurrencySupport(
  provider: PaymentProviderKey,
  input: CurrencySupportInput,
): CurrencySupportResult {
  const currency = normalize(input.currency);
  if (!currency) {
    return {
      supported: false,
      code: "currency_not_supported",
      reason: "A loja não possui moeda definida.",
    };
  }

  if (provider === "paypal") {
    if (!PAYPAL_SUPPORTED_CURRENCIES.includes(currency)) {
      return {
        supported: false,
        code: "currency_not_supported",
        reason: `O PayPal não aceita pagamentos em ${currency}. A loja precisa operar em uma moeda aceita pelo PayPal (ex.: BRL, USD, EUR).`,
      };
    }
    const accountCurrency = normalize(input.accountPrimaryCurrency);
    if (accountCurrency && accountCurrency !== currency) {
      return {
        supported: false,
        code: "account_currency_mismatch",
        reason: `Sua conta PayPal recebe em ${accountCurrency}, mas a loja vende em ${currency}. Para evitar conversão automática, use a mesma moeda ou conecte uma conta que receba em ${currency}.`,
      };
    }
    return { supported: true };
  }

  if (!MERCADOPAGO_SUPPORTED_CURRENCIES.includes(currency)) {
    return {
      supported: false,
      code: "currency_not_supported",
      reason: `O Mercado Pago não aceita pagamentos em ${currency}. A loja precisa operar em uma moeda aceita pelo Mercado Pago (ex.: BRL).`,
    };
  }
  const siteId = normalize(input.accountSiteId);
  const siteCurrency = siteId ? MERCADOPAGO_SITE_CURRENCIES[siteId] : undefined;
  if (input.requireKnownSite && !siteCurrency) {
    return {
      supported: false,
      code: "account_site_unknown",
      reason:
        "Não foi possível confirmar o país da conta Mercado Pago. Clique em 'Verificar conexão' antes de habilitar a cobrança.",
    };
  }
  if (siteCurrency && siteCurrency !== currency) {
    return {
      supported: false,
      code: "account_currency_mismatch",
      reason: `Sua conta Mercado Pago (${siteId}) liquida em ${siteCurrency}, mas a loja vende em ${currency}. Para evitar conversão automática, use a mesma moeda.`,
    };
  }
  return { supported: true };
}

/** Mensagem curta usada no checkout quando o método está bloqueado. */
export function currencyBlockMessage(
  provider: PaymentProviderKey,
  currency: string,
): string {
  const label = provider === "paypal" ? "PayPal" : "Mercado Pago";
  return `${label} não está disponível para pagamentos em ${normalize(currency) || "moeda da loja"}.`;
}
