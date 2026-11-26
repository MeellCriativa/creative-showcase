/**
 * Segurança do OAuth e dos tokens da Melhor Envio.
 *
 * Módulo puro (sem Deno, sem rede, sem banco) para poder ser testado em Node.
 * Tudo que é segredo fica no servidor: nada disso é importado pelo frontend.
 */
import {
  decryptSecret,
  encryptSecret,
  readEnv,
  sha256Hex,
  signState,
  verifyState,
} from "./payments/crypto.ts";

export const ME_STATE_TTL_MS = 10 * 60 * 1000;

const STATE_DOMAIN = "melhor-envio-oauth-state-v1:";
const TOKEN_DOMAIN = "melhor-envio-tokens-v1:";
const HASH_DOMAIN = "melhor-envio-state-hash-v1:";

export type MeEnvironment = "sandbox" | "production";

export type MeOAuthState = {
  catalogId: string;
  userId: string;
  environment: MeEnvironment;
  nonce: string;
  expiresAt: number;
};

/**
 * Chave de assinatura dedicada ao OAuth da Melhor Envio.
 *
 * Mesmo quando reaproveita um segredo já configurado na plataforma, aplica
 * separação de domínio: o material usado aqui nunca é o material usado pelo
 * payments ou pelo AES dos tokens.
 */
async function stateKey(): Promise<string | null> {
  const base =
    readEnv("PAYMENT_STATE_SECRET") ||
    readEnv("PAYMENT_TOKEN_ENCRYPTION_KEY") ||
    readEnv("ME_CLIENT_SECRET");
  return base ? sha256Hex(`${STATE_DOMAIN}${base}`) : null;
}

/** Chave AES dedicada aos tokens da Melhor Envio. */
async function tokenKey(): Promise<string | null> {
  const base = readEnv("PAYMENT_TOKEN_ENCRYPTION_KEY") || readEnv("ME_CLIENT_SECRET");
  return base ? sha256Hex(`${TOKEN_DOMAIN}${base}`) : null;
}

/**
 * `state` opaco, assinado, com dono, loja, ambiente, nonce e validade curta.
 * Substitui o antigo `state = catalog_id`, que permitia CSRF e escrita
 * cross-tenant no callback.
 */
export async function createOAuthState(
  input: { catalogId: string; userId: string; environment: MeEnvironment },
  now: number = Date.now(),
): Promise<string> {
  const key = await stateKey();
  if (!key) {
    throw new Error("Não há segredo de assinatura configurado para o OAuth da Melhor Envio.");
  }
  const nonce = crypto.randomUUID().replace(/-/g, "") + (await sha256Hex(String(now))).slice(0, 8);
  const state = await signState(
    {
      v: 1,
      provider: "melhor_envio",
      c: input.catalogId,
      u: input.userId,
      e: input.environment,
      n: nonce,
      exp: now + ME_STATE_TTL_MS,
    },
    key,
  );
  if (!state) {
    throw new Error("Não foi possível assinar o state do OAuth da Melhor Envio.");
  }
  return state;
}

/**
 * Valida assinatura, expiração, ambiente e formato do `state`.
 * Retorna `null` para qualquer state inválido (nunca lança para o chamador).
 */
export async function readOAuthState(
  state: string | null | undefined,
  environment?: string,
  now: number = Date.now(),
): Promise<MeOAuthState | null> {
  const key = await stateKey();
  if (!key || !state) return null;
  const payload = await verifyState(state, key, now);
  if (!payload) return null;
  if (payload["v"] !== 1 || payload["provider"] !== "melhor_envio") return null;

  const catalogId = payload["c"];
  const userId = payload["u"];
  const env = payload["e"];
  const nonce = payload["n"];
  const expiresAt = Number(payload["exp"]);
  if (typeof catalogId !== "string" || !catalogId) return null;
  if (typeof userId !== "string" || !userId) return null;
  if (env !== "sandbox" && env !== "production") return null;
  if (typeof nonce !== "string" || nonce.length < 16) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  if (environment && env !== environment) return null;

  return { catalogId, userId, environment: env, nonce, expiresAt };
}

/** Hash persistido para garantir que um `state` só seja consumido uma vez. */
export async function hashOAuthState(state: string): Promise<string> {
  return sha256Hex(`${HASH_DOMAIN}${state}`);
}

/**
 * URL de callback única para autorização e troca de código.
 * `ME_REDIRECT_URI` permite corrigir o cadastro no app sem alterar código;
 * o padrão continua sendo a Edge Function de produção.
 */
export function getRedirectUri(): string {
  const explicit = readEnv("ME_REDIRECT_URI")?.trim();
  const base = (
    explicit ||
    readEnv("SUPABASE_URL") ||
    "https://wdcufpvlbisnqtvmbyso.supabase.co"
  ).replace(/\/+$/, "");
  return `${base}/functions/v1/melhor-envio-callback`;
}

/** Grava tokens cifrados em repouso. Aceita o formato antigo (texto puro). */
export async function encryptMeToken(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("v1:")) return value;
  const key = await tokenKey();
  if (!key) return value;
  return (await encryptSecret(value, key)) ?? value;
}

/**
 * Lê tokens cifrados ou o formato antigo em texto puro (compatibilidade com
 * contas já conectadas antes desta correção).
 */
export async function decryptMeToken(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (!value.startsWith("v1:")) return value;
  const key = await tokenKey();
  if (!key) return null;
  return decryptSecret(value, key);
}

/** Erros do PostgREST que significam "recurso opcional ainda não existe". */
export function isMissingOptionalSchema(error: unknown): boolean {
  const code =
    (error as { code?: string } | null)?.code ||
    (error as { details?: string } | null)?.details ||
    "";
  return code === "42P01" || code === "42883" || code === "42501" || code === "PGRST202";
}
