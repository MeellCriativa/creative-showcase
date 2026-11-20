import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptSecret,
  encryptSecret,
  encryptionConfigured,
  maskAccountId,
  maskEmail,
  randomToken,
  readEnv,
  sha256Hex,
  signState,
  stateSecret,
  timingSafeEqual,
  verifyState,
} from "../supabase/functions/_shared/payments/crypto.ts";

/**
 * Criptografia, assinatura de state OAuth e mascaramento (Etapa 2).
 *
 * Regras verificadas:
 *   - tokens de provedor NUNCA em texto puro (AES-256-GCM, IV aleatório);
 *   - state OAuth assinado (HMAC-SHA256) e com expiração (CSRF);
 *   - token de checkout só é persistido como SHA-256;
 *   - identificadores exibidos no painel são sempre mascarados.
 */

const KEY = "chave-de-teste-com-32-bytes-ok!!";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Ambiente (sem Deno nos testes → nada é "configurado" por acidente)
// ─────────────────────────────────────────────────────────────────────────────

test("sem Deno, readEnv retorna null", () => {
  assert.equal(readEnv("PAYMENT_TOKEN_ENCRYPTION_KEY"), null);
});

test("sem chave configurada, encryptionConfigured é false", () => {
  assert.equal(encryptionConfigured(), false);
});

test("sem chave configurada, stateSecret é null", () => {
  assert.equal(stateSecret(), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AES-256-GCM dos tokens
// ─────────────────────────────────────────────────────────────────────────────

test("roundtrip de criptografia preserva o segredo", async () => {
  const plain = "A21AAJ-access-token-do-vendedor";
  const encrypted = await encryptSecret(plain, KEY);
  assert.ok(encrypted, "espera ciphertext");
  assert.notEqual(encrypted, plain);
  assert.match(encrypted!, /^v1:/);
  assert.equal(await decryptSecret(encrypted, KEY), plain);
});

test("texto puro nunca aparece no payload criptografado", async () => {
  const plain = "segredo-super-unico-123";
  const encrypted = (await encryptSecret(plain, KEY))!;
  assert.equal(encrypted.includes(plain), false);
  assert.equal(encrypted.includes("segredo"), false);
});

test("cada cifra usa IV novo (sem reutilização)", async () => {
  const a = await encryptSecret("mesmo-valor", KEY);
  const b = await encryptSecret("mesmo-valor", KEY);
  assert.notEqual(a, b);
  assert.equal(await decryptSecret(a, KEY), "mesmo-valor");
  assert.equal(await decryptSecret(b, KEY), "mesmo-valor");
});

test("chave errada não descriptografa", async () => {
  const encrypted = await encryptSecret("token", KEY);
  assert.equal(await decryptSecret(encrypted, "outra-chave-qualquer"), null);
});

test("ciphertext adulterado é rejeitado", async () => {
  const encrypted = (await encryptSecret("token", KEY))!;
  const parts = encrypted.split(":");
  const tampered = `${parts[0]}:${parts[1]}:${parts[2]!.slice(0, -4)}AAAA`;
  assert.equal(await decryptSecret(tampered, KEY), null);
});

test("payload fora do formato v1 é rejeitado", async () => {
  assert.equal(await decryptSecret("texto-puro", KEY), null);
  assert.equal(await decryptSecret("v2:a:b", KEY), null);
  assert.equal(await decryptSecret("v1:apenas-uma-parte", KEY), null);
});

test("sem segredo/chave, criptografia e descriptografia retornam null", async () => {
  assert.equal(await encryptSecret("token", null), null);
  assert.equal(await decryptSecret("v1:a:b", null), null);
  assert.equal(await decryptSecret(null, KEY), null);
});

test("segredo em texto livre é derivado com SHA-256 (funciona)", async () => {
  const encrypted = await encryptSecret("abc", "senha curta");
  assert.equal(await decryptSecret(encrypted, "senha curta"), "abc");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. State OAuth (HMAC-SHA256 + expiração)
// ─────────────────────────────────────────────────────────────────────────────

const payload = {
  provider: "paypal",
  catalog_id: "c1",
  user_id: "u1",
  exp: Date.now() + 60_000,
};

test("state assinado é verificável e devolve o payload", async () => {
  const state = await signState(payload, KEY);
  assert.ok(state);
  const verified = await verifyState(state, KEY);
  assert.deepEqual(verified, payload);
});

test("state expirado é recusado", async () => {
  const expired = { ...payload, exp: Date.now() - 1 };
  const state = (await signState(expired, KEY))!;
  assert.equal(await verifyState(state, KEY), null);
});

test("state sem expiração é recusado", async () => {
  const { exp: _exp, ...withoutExp } = payload;
  const state = (await signState(withoutExp, KEY))!;
  assert.equal(await verifyState(state, KEY), null);
});

test("state adulterado é recusado", async () => {
  const state = (await signState(payload, KEY))!;
  const [body, signature] = state.split(".") as [string, string];
  const forgedBody = Buffer.from(
    JSON.stringify({ ...payload, catalog_id: "outro-catalogo" }),
    "utf8",
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  assert.equal(await verifyState(`${forgedBody}.${signature}`, KEY), null);
  assert.equal(await verifyState(`${body}.${signature.slice(0, -2)}AA`, KEY), null);
});

test("state assinado com outra chave é recusado", async () => {
  const state = (await signState(payload, "chave-do-atacante"))!;
  assert.equal(await verifyState(state, KEY), null);
});

test("state malformado é recusado sem lançar", async () => {
  assert.equal(await verifyState("", KEY), null);
  assert.equal(await verifyState(null, KEY), null);
  assert.equal(await verifyState("sem-ponto", KEY), null);
  assert.equal(await verifyState("a.b.c", KEY), null);
  assert.equal(await verifyState("@@@.###", KEY), null);
});

test("sem segredo, assinar e verificar falham", async () => {
  assert.equal(await signState(payload, null), null);
  assert.equal(await verifyState("a.b", null), null);
});

test("verifyState aceita um 'agora' explícito (testável)", async () => {
  const future = Date.now() + 10_000;
  const state = (await signState({ ...payload, exp: future + 1_000 }, KEY))!;
  assert.ok(await verifyState(state, KEY, future));
  assert.equal(await verifyState(state, KEY, future + 5_000), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Tokens de checkout
// ─────────────────────────────────────────────────────────────────────────────

test("randomToken gera 32 bytes em hex (64 caracteres)", () => {
  const token = randomToken();
  assert.equal(token.length, 64);
  assert.match(token, /^[0-9a-f]{64}$/);
});

test("randomToken não repete", () => {
  const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
  assert.equal(tokens.size, 200);
});

test("sha256Hex bate com o vetor conhecido", async () => {
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("sha256Hex é determinístico e oculta o token", async () => {
  const token = randomToken();
  const hash = await sha256Hex(token);
  assert.equal(hash, await sha256Hex(token));
  assert.equal(hash.includes(token), false);
  assert.equal(hash.length, 64);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Comparação e mascaramento
// ─────────────────────────────────────────────────────────────────────────────

test("timingSafeEqual compara corretamente", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
});

test("maskAccountId nunca expõe o identificador completo", () => {
  assert.equal(maskAccountId(null), null);
  assert.equal(maskAccountId(""), null);
  assert.equal(maskAccountId("1234"), "***4");
  assert.equal(maskAccountId("123"), "**3");
  const masked = maskAccountId("ABCDEFGHIJKLMNOP")!;
  assert.equal(masked.endsWith("MNOP"), true);
  assert.equal(masked.includes("ABCDEFGHIJKL"), false);
  assert.equal(masked.startsWith("*"), true);
});

test("maskEmail mantém o domínio e esconde o usuário", () => {
  assert.equal(maskEmail("joaosilva@gmail.com"), "jo*******@gmail.com");
  assert.equal(maskEmail("ab@x.com"), "ab*@x.com");
  assert.equal(maskEmail("sem-arroba"), maskAccountId("sem-arroba"));
  assert.equal(maskEmail(null), null);
});

test("mascaramento de e-mail não vaza o usuário completo", () => {
  const masked = maskEmail("vendedor.secreto@paypal.com")!;
  assert.equal(masked.endsWith("@paypal.com"), true);
  assert.equal(masked.includes("vendedor.secreto"), false);
});
