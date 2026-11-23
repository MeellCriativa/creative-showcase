import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isValidShortCode, normalizeShortCode, shortLinkUrl } from "../src/lib/shortLink.ts";
import { normalizeWhatsappNumber, whatsappLink } from "../src/lib/whatsapp.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("código curto é normalizado e editável pelo lojista", () => {
  assert.equal(normalizeShortCode(" Ana Maria "), "ana-maria");
  assert.equal(normalizeShortCode("Loja@2026!"), "loja-2026");
  assert.equal(normalizeShortCode("  "), "");
  assert.ok(isValidShortCode("ana-maria"));
  assert.ok(!isValidShortCode("ab"));
  assert.ok(!isValidShortCode("painel"));
  assert.ok(!isValidShortCode("loja com espaço"));
});

test("link curto usa o prefixo /s/", () => {
  assert.equal(shortLinkUrl("ana", "https://vitrine.test"), "https://vitrine.test/s/ana");
  assert.equal(shortLinkUrl("ana", "https://vitrine.test/"), "https://vitrine.test/s/ana");
});

test("WhatsApp usa o número da loja com DDD e a mensagem opcional", () => {
  assert.equal(normalizeWhatsappNumber("(11) 99999-9999"), "5511999999999");
  assert.equal(normalizeWhatsappNumber("5511999999999"), "5511999999999");
  const link = whatsappLink("(11) 99999-9999", "Olá! Bem-vinda 💜");
  assert.match(link, /^https:\/\/wa\.me\/5511999999999\?text=/);
  assert.match(link, /Bem-vinda/);
});

test("rota pública, SQL e cards do painel estão ligados", () => {
  const route = read("src/routes/s.$code.tsx");
  const sql = read("supabase/migrations/20261122170000_store_short_links_and_whatsapp.sql");
  const panel = read("src/routes/painel.index.tsx");

  assert.match(route, /store_short_links_public/);
  assert.match(route, /redirect\(/);
  assert.match(sql, /add column if not exists short_code/);
  assert.match(sql, /whatsapp_welcome_message/);
  assert.match(sql, /create or replace view public\.store_short_links_public/);
  // O card do link curto foi removido do painel a pedido do lojista; a rota
  // pública continua funcionando para links já compartilhados.
  assert.doesNotMatch(panel, /shortLinkTitle/);
  assert.doesNotMatch(panel, /shortLinkUrl/);
  assert.match(panel, /whatsappLinkTitle/);
  // Cards permanentes do painel não podem ter sido removidos.
  assert.match(panel, /panel\.dashboard\.editStoreLink/);
  assert.match(panel, /customize\.fields\.currency/);
});

test("card Link da minha loja tem botão de abrir o link salvo", () => {
  const panel = read("src/routes/painel.index.tsx");
  assert.match(panel, /panel\.dashboard\.openLink/);
  assert.match(panel, /href=\{savedLink\}/);
  assert.match(panel, /target="_blank"/);
  // O link aberto é o salvo no catálogo, não o rascunho do campo de edição.
  assert.match(panel, /const savedLink[\s\S]{0,220}catalog\.slug/);

  const i18n = read("src/i18n/namespaces/panel.ts");
  assert.match(i18n, /openLink: "Abrir link"/);
  assert.match(i18n, /openLink: "Open link"/);
  assert.match(i18n, /openLink: "Abrir enlace"/);
});

test("botões Compartilhar e Salvar mostram o texto acima do ícone", () => {
  const panel = read("src/routes/painel.index.tsx");
  const shareButton = panel.match(/onClick=\{shareLink\}[\s\S]{0,500}?<\/button>/)?.[0] ?? "";
  const saveButton = panel.match(/onClick=\{saveStore\}[\s\S]{0,600}?<\/button>/)?.[0] ?? "";
  assert.ok(shareButton, "botão de compartilhar deve existir");
  assert.ok(saveButton, "botão de salvar deve existir");

  for (const button of [shareButton, saveButton]) {
    assert.match(button, /min-w-0/);
    assert.match(button, /flex-col/);
    assert.match(button, /text-xs[^"]*sm:text-sm/);
    assert.match(button, /text-center/);
    assert.match(button, /break-words/);
    assert.match(button, /shrink-0/);
  }
  // A palavra vem primeiro no markup; o ícone fica embaixo.
  assert.ok(shareButton.indexOf("break-words") < shareButton.indexOf("<Share2"));
  assert.ok(saveButton.indexOf("break-words") < saveButton.indexOf("<Loader2"));
});
