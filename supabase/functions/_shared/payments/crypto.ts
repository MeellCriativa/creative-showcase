/**
 * Criptografia e assinatura para a Etapa 2.
 *
 * - Tokens de provedores (access/refresh) são gravados com AES-256-GCM.
 *   Formato: `v1:<iv_b64url>:<ciphertext_b64url>`.
 * - O `state` do OAuth é assinado com HMAC-SHA256 (proteção CSRF).
 * - Tokens de checkout são aleatórios e só o SHA-256 é persistido.
 *
 * Usa apenas WebCrypto (disponível no Deno e no Node 20+), sem dependências.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Lê uma variável de ambiente sem quebrar quando `Deno` não existe (testes). */
export function readEnv(name: string): string | null {
  try {
    const deno = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
    const value = deno?.env?.get(name);
    return value ? value.trim() : null;
  } catch {
    return null;
  }
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  let keyBytes: Uint8Array | null = null;
  try {
    const raw = fromBase64Url(secret.replace(/\s/g, ""));
    if (raw.length === 16 || raw.length === 24 || raw.length === 32) {
      keyBytes = raw;
    }
  } catch {
    // Segredo em texto livre com caracteres fora de base64url: cai no SHA-256.
    keyBytes = null;
  }
  if (!keyBytes) {
    // Segredo em texto livre: deriva 32 bytes com SHA-256.
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
    keyBytes = new Uint8Array(digest);
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export function encryptionConfigured(): boolean {
  return !!readEnv("PAYMENT_TOKEN_ENCRYPTION_KEY");
}

/** Criptografa um segredo. Retorna `null` se não houver chave configurada. */
export async function encryptSecret(
  plaintext: string,
  secret: string | null = readEnv("PAYMENT_TOKEN_ENCRYPTION_KEY"),
): Promise<string | null> {
  if (!secret) return null;
  const key = await importAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  return `v1:${toBase64Url(iv)}:${toBase64Url(new Uint8Array(cipher))}`;
}

/** Descriptografa um segredo. Retorna `null` se falhar (chave errada/corrompido). */
export async function decryptSecret(
  payload: string | null | undefined,
  secret: string | null = readEnv("PAYMENT_TOKEN_ENCRYPTION_KEY"),
): Promise<string | null> {
  if (!payload || !secret) return null;
  const parts = payload.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const key = await importAesKey(secret);
    const iv = fromBase64Url(parts[1]!);
    const data = fromBase64Url(parts[2]!);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return decoder.decode(plain);
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function stateSecret(): string | null {
  return readEnv("PAYMENT_STATE_SECRET") ?? readEnv("PAYMENT_TOKEN_ENCRYPTION_KEY");
}

/** Assina o payload do `state` do OAuth: `<b64url(json)>.<b64url(hmac)>`. */
export async function signState(
  payload: Record<string, unknown>,
  secret: string | null = stateSecret(),
): Promise<string | null> {
  if (!secret) return null;
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/**
 * Valida assinatura e expiração do `state`. Retorna `null` para qualquer
 * state inválido, adulterado, expirado ou sem assinatura.
 */
export async function verifyState(
  state: string | null | undefined,
  secret: string | null = stateSecret(),
  now: number = Date.now(),
): Promise<Record<string, unknown> | null> {
  if (!state || !secret) return null;
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      encoder.encode(body),
    );
    if (!ok) return null;
    const parsed = JSON.parse(decoder.decode(fromBase64Url(body)));
    if (!parsed || typeof parsed !== "object") return null;
    const exp = Number((parsed as Record<string, unknown>).exp ?? 0);
    if (!Number.isFinite(exp) || exp < now) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Token aleatório em hex (usado no checkout do comprador). */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  let out = "";
  for (const b of new Uint8Array(digest)) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Comparação em tempo constante para segredos curtos. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mascara identificadores de conta antes de enviá-los ao frontend. */
export function maskAccountId(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = String(value);
  if (clean.length <= 4) return `${"*".repeat(Math.max(0, clean.length - 1))}${clean.slice(-1)}`;
  const visible = clean.slice(-4);
  return `${"*".repeat(Math.min(12, Math.max(4, clean.length - 4)))}${visible}`;
}

/** Mascara e-mail mantendo domínio (ex.: `jo***@gmail.com`). */
export function maskEmail(value: string | null | undefined): string | null {
  if (!value || !value.includes("@")) return maskAccountId(value);
  const [user, domain] = value.split("@") as [string, string];
  const head = user.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, user.length - 2))}@${domain}`;
}
