import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("carrinho tem uma única área de rolagem ampla para produtos e opções", () => {
  const checkout = read("src/routes/c.$slug.tsx");
  const sheet = checkout.slice(checkout.indexOf("function CartSheet("));

  assert.match(
    sheet,
    /className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pt-4 pb-4"/,
  );
  // A antiga área comprimida das opções não existe mais como contêiner separado.
  assert.doesNotMatch(sheet, /min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5/);
  assert.doesNotMatch(sheet, /space-y-3 px-5 pt-5 pb-0/);

  const bodyStart = sheet.indexOf("min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain");
  const optionsStart = sheet.indexOf("{items.length > 0 && (", bodyStart);
  assert.ok(optionsStart > bodyStart, "as opções devem vir depois dos produtos, no mesmo scroll");
});

test("seletor de moeda do checkout é compacto e fica em uma linha", () => {
  const checkout = read("src/routes/c.$slug.tsx");
  const picker = read("src/components/CurrencyPicker.tsx");
  const sheet = checkout.slice(checkout.indexOf("function CartSheet("));

  assert.match(
    sheet,
    /className="flex items-center gap-2" title=\{t\("catalog\.cart\.currencyHint"\)\}/,
  );
  assert.match(sheet, /compact\s+className="min-w-0 flex-1"/);
  assert.doesNotMatch(sheet, /rounded-xl border border-border bg-card px-3 py-2\.5/);
  assert.match(sheet, /className="shrink-0 space-y-2 border-t border-border px-4 py-2\.5"/);

  assert.match(picker, /compact\?: boolean/);
  assert.match(picker, /compact = false/);
  assert.match(picker, /compact\s*\n\s*\? "flex w-full items-center justify-between/);

  // As demais telas continuam com o seletor completo (padrão inalterado).
  for (const path of [
    "src/routes/painel.index.tsx",
    "src/routes/painel.personalizar.tsx",
    "src/routes/painel.conversor.tsx",
  ]) {
    const screen = read(path);
    assert.doesNotMatch(screen, /<CurrencyPicker[^>]*\bcompact\b/s);
  }
});

test("layout compacto preserva moeda, valores e formas de recebimento/pagamento", () => {
  const checkout = read("src/routes/c.$slug.tsx");
  const sheet = checkout.slice(checkout.indexOf("function CartSheet("));

  assert.match(sheet, /catalog\.cart\.currencyChargedIn/);
  assert.match(sheet, /catalog\.cart\.currencyNoRate/);
  assert.match(sheet, /money\(subtotal\)/);
  assert.match(sheet, /money\(grandTotal\)/);
  assert.match(sheet, /deliveryMethods\.map/);
  assert.match(sheet, /paymentMethods\.map/);
  assert.match(sheet, /pix_manual/);
  assert.match(sheet, /handleFinish/);
});
