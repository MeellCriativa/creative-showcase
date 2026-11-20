/**
 * URLs derivadas do ambiente do runtime — isolamento homologação/produção.
 *
 * Nenhum domínio ou project ref fica fixo no código: callback OAuth, webhook e
 * retorno ao painel são sempre derivados das variáveis do projeto em execução.
 * Se a variável faltar, falhamos rápido em vez de redirecionar para outro
 * ambiente (os antigos fallbacks apontavam para o projeto/worker de produção).
 */
import { readEnv } from "./crypto.ts";

/** Configuração de ambiente ausente; o chamador decide como respondê-la. */
export class EnvironmentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentConfigError";
  }
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Base do Supabase do projeto em execução. `SUPABASE_URL` é auto-injetada pelo
 * runtime — nunca deve ser criada como Secret manual.
 */
export function supabaseBaseUrl(): string {
  const base = readEnv("SUPABASE_URL");
  if (!base) throw new EnvironmentConfigError("SUPABASE_URL não configurada no runtime.");
  return trimTrailingSlashes(base);
}

/** Callback OAuth de pagamentos, sempre no projeto atual. */
export function paymentsCallbackUrl(): string {
  return `${supabaseBaseUrl()}/functions/v1/payments-callback`;
}

/** Caminho exato da Edge Function que recebe notificações do Mercado Pago. */
export const MP_WEBHOOK_PATH = "/functions/v1/webhooks-mercadopago";

/** Webhook de pagamentos, sempre no projeto atual. */
export function paymentsWebhookUrl(): string {
  return `${supabaseBaseUrl()}${MP_WEBHOOK_PATH}`;
}

/**
 * P5 — validação da Notification URL antes de criar uma preferência.
 *
 * A URL precisa ser HTTPS, apontar exatamente para a Edge Function de webhook
 * e pertencer ao projeto em execução. Como a origem é comparada com o
 * `SUPABASE_URL` do runtime, uma URL de outro ambiente (por exemplo,
 * produção durante um teste Sandbox) é sempre recusada — sem literais de
 * projeto fixos no código.
 */
export function assertNotificationUrlForCurrentEnvironment(candidate: string): void {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new EnvironmentConfigError("Notification URL inválida: não é uma URL absoluta.");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) {
    throw new EnvironmentConfigError("Notification URL inválida: é obrigatório usar HTTPS.");
  }
  if (parsed.pathname !== MP_WEBHOOK_PATH || parsed.search || parsed.hash) {
    throw new EnvironmentConfigError(
      `Notification URL inválida: o caminho deve ser exatamente ${MP_WEBHOOK_PATH}.`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new EnvironmentConfigError("Notification URL inválida: credenciais não são permitidas.");
  }
  if (parsed.href !== paymentsWebhookUrl()) {
    throw new EnvironmentConfigError(
      "Notification URL de outro ambiente recusada: use a Edge Function do projeto atual.",
    );
  }
}

/** Retorna a Notification URL já validada, ou falha rápido. */
export function validatedPaymentsWebhookUrl(): string {
  const url = paymentsWebhookUrl();
  assertNotificationUrlForCurrentEnvironment(url);
  return url;
}

/**
 * Base do frontend/painel do ambiente atual. Pode conter path (Cloudflare
 * Workers, por exemplo), por isso NÃO deve ser usada para comparar origens.
 */
export function panelBaseUrl(): string {
  const base = readEnv("VITRINE_URL") ?? readEnv("PAYMENTS_RETURN_ORIGIN");
  if (!base) {
    throw new EnvironmentConfigError("VITRINE_URL não configurada no runtime.");
  }
  return trimTrailingSlashes(base);
}

/** Origem estrita (scheme + host + porta) para validação de return_url. */
export function panelOrigin(): string {
  return new URL(panelBaseUrl()).origin;
}

/** URL do painel de pagamentos no ambiente atual. */
export function panelUrl(): string {
  return `${panelBaseUrl()}/painel/pagamentos`;
}
