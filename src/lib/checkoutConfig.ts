/** Configuração visual do checkout por produto (desktop/mobile). */

export type Device = "desktop" | "mobile";

export type CountdownConfig = {
  enabled: boolean;
  /** ISO absoluto — nunca recalculado no cliente. */
  endsAt: string | null;
  numberColor: string;
  backgroundColor: string;
  textColor: string;
  message: string;
};

export type GuaranteeConfig = {
  enabled: boolean;
  model: "shield" | "badge" | "seal";
  color: string;
  text: string;
  days: number;
};

export type TestimonialConfig = {
  id: string;
  customerName: string;
  content: string;
  stars: number;
  truthConfirmed: boolean;
};

export type CheckoutBannerConfig = {
  imageUrl: string | null;
  objectPosition: string;
  href: string;
};

export type CheckoutConfig = {
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  buttonColor: string;
  buttonTextColor: string;
  borderStyle: "none" | "soft" | "strong";
  buttonText: string;
  buttonSize: "sm" | "md" | "lg";
  buttonStyle: "solid" | "outline" | "rounded";
  buttonPosition: "top" | "bottom";
  benefits: string;
  included: string;
  conditions: string;
  countdown: CountdownConfig;
  guarantee: GuaranteeConfig;
  testimonialsEnabled: boolean;
  productInfo: {
    image: string | null;
    name: string;
    description: string;
    price: string;
    additional: string;
  };
  banner: CheckoutBannerConfig;
};

export const BANNER_SIZE: Record<Device, { width: number; height: number }> = {
  desktop: { width: 480, height: 192 },
  mobile: { width: 390, height: 156 },
};

export const BANNER_RATIO = 2.5;

export function defaultCheckoutConfig(overrides: Partial<CheckoutConfig> = {}): CheckoutConfig {
  const base: CheckoutConfig = {
    logoUrl: null,
    primaryColor: "#8b5cf6",
    secondaryColor: "#f3e8ff",
    backgroundColor: "#ffffff",
    textColor: "#1f2937",
    buttonColor: "#8b5cf6",
    buttonTextColor: "#ffffff",
    borderStyle: "soft",
    buttonText: "Comprar agora",
    buttonSize: "md",
    buttonStyle: "solid",
    buttonPosition: "bottom",
    benefits: "",
    included: "",
    conditions: "",
    countdown: {
      enabled: false,
      endsAt: null,
      numberColor: "#8b5cf6",
      backgroundColor: "#1f2937",
      textColor: "#ffffff",
      message: "Oferta por tempo limitado",
    },
    guarantee: {
      enabled: false,
      model: "shield",
      color: "#16a34a",
      text: "Garantia de satisfação",
      days: 7,
    },
    testimonialsEnabled: false,
    productInfo: { image: null, name: "", description: "", price: "", additional: "" },
    banner: { imageUrl: null, objectPosition: "center", href: "" },
  };
  return {
    ...base,
    ...overrides,
    countdown: { ...base.countdown, ...overrides.countdown },
    guarantee: { ...base.guarantee, ...overrides.guarantee },
    productInfo: { ...base.productInfo, ...overrides.productInfo },
    banner: { ...base.banner, ...overrides.banner },
  };
}

export function parseCheckoutConfig(raw: unknown): CheckoutConfig {
  if (!raw || typeof raw !== "object") return defaultCheckoutConfig();
  return defaultCheckoutConfig(raw as Partial<CheckoutConfig>);
}

/**
 * Validação única do link do entregável.
 * Exige `https://` também no começo do texto para casar com a constraint
 * `products_digital_link_requires_https` do banco (regex `^https://`, case-insensitive).
 */
export function isValidExternalUrl(value: string): boolean {
  const candidate = value.trim();
  if (!/^https:\/\/\S+$/i.test(candidate)) return false;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function bannerAspectWarning(width: number, height: number): boolean {
  if (!width || !height) return false;
  return Math.abs(width / height - BANNER_RATIO) > 0.08;
}

export function countdownParts(endsAt: string | null, now = Date.now()) {
  if (!endsAt) return { expired: true, hours: 0, minutes: 0, seconds: 0, total: 0 };
  const total = Math.max(0, new Date(endsAt).getTime() - now);
  return {
    expired: total <= 0,
    hours: Math.floor(total / 3_600_000),
    minutes: Math.floor((total % 3_600_000) / 60_000),
    seconds: Math.floor((total % 60_000) / 1000),
    total,
  };
}
