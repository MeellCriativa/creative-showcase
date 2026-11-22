/**
 * Dicionários finais (pt-BR, en, es).
 *
 * Módulo puro: pode ser importado por testes no Node. Cada namespace é
 * validado pelo TypeScript — chave faltando em `en`/`es` quebra o build.
 */
import type { Locale } from "./config.ts";
import type { MessagePaths, PluralPaths } from "./types.ts";

import { auth } from "./namespaces/auth.ts";
import { catalog } from "./namespaces/catalog.ts";
import { checkoutEditor } from "./namespaces/checkoutEditor.ts";
import { categories } from "./namespaces/categories.ts";
import { common } from "./namespaces/common.ts";
import { converter } from "./namespaces/converter.ts";
import { customize } from "./namespaces/customize.ts";
import { forms } from "./namespaces/forms.ts";
import { home } from "./namespaces/home.ts";
import { orders } from "./namespaces/orders.ts";
import { panel } from "./namespaces/panel.ts";
import { password } from "./namespaces/password.ts";
import { payments } from "./namespaces/payments.ts";
import { products } from "./namespaces/products.ts";
import { qrCode } from "./namespaces/qrCode.ts";
import { shipping } from "./namespaces/shipping.ts";
import { stats } from "./namespaces/stats.ts";
import { whatsapp } from "./namespaces/whatsapp.ts";

/** Português (padrão e fonte da verdade das chaves). */
export const messages = {
  common: common.ptBR,
  home: home.ptBR,
  auth: auth.ptBR,
  panel: panel.ptBR,
  products: products.ptBR,
  categories: categories.ptBR,
  orders: orders.ptBR,
  stats: stats.ptBR,
  customize: customize.ptBR,
  catalog: catalog.ptBR,
  checkoutEditor: checkoutEditor.ptBR,
  payments: payments.ptBR,
  shipping: shipping.ptBR,
  qrCode: qrCode.ptBR,
  whatsapp: whatsapp.ptBR,
  converter: converter.ptBR,
  password: password.ptBR,
  forms: forms.ptBR,
};

export type Messages = typeof messages;
export type MessageKey = MessagePaths<Messages>;
export type PluralMessageKey = PluralPaths<Messages>;

export const messagesByLocale: Record<Locale, Messages> = {
  "pt-BR": messages,
  en: {
    common: common.en,
    home: home.en,
    auth: auth.en,
    panel: panel.en,
    products: products.en,
    categories: categories.en,
    orders: orders.en,
    stats: stats.en,
    customize: customize.en,
    catalog: catalog.en,
    checkoutEditor: checkoutEditor.en,
    payments: payments.en,
    shipping: shipping.en,
    qrCode: qrCode.en,
    whatsapp: whatsapp.en,
    converter: converter.en,
    password: password.en,
    forms: forms.en,
  },
  es: {
    common: common.es,
    home: home.es,
    auth: auth.es,
    panel: panel.es,
    products: products.es,
    categories: categories.es,
    orders: orders.es,
    stats: stats.es,
    customize: customize.es,
    catalog: catalog.es,
    checkoutEditor: checkoutEditor.es,
    payments: payments.es,
    shipping: shipping.es,
    qrCode: qrCode.es,
    whatsapp: whatsapp.es,
    converter: converter.es,
    password: password.es,
    forms: forms.es,
  },
};
