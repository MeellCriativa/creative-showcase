import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EnvironmentConfigError,
  panelOrigin,
  panelUrl,
  paymentsCallbackUrl,
  paymentsWebhookUrl,
  supabaseBaseUrl,
} from "../supabase/functions/_shared/payments/urls.ts";

/**
 * Isolamento homologação ↔ produção (correção dos fallbacks hardcoded).
 *
 * Regras verificadas:
 *   - callback/webhook do OAuth e do pagamento saem SEMPRE do SUPABASE_URL do
 *     runtime — nunca de um project ref fixo no código;
 *   - o retorno ao painel sai SEMPRE de VITRINE_URL/PAYMENTS_RETURN_ORIGIN —
 *     nunca do worker de produção;
 *   - sem a variável, falha rápido (não "cai" no outro ambiente);
 *   - nenhum arquivo da integração contém os literais dos dois ambientes.
 */

const HOMOLOGATION = {
  supabase: "https://ardpqimdllzbbdvwamkh.supabase.co",
  vitrine: "https://vitrine-homolog.meellcriativa.workers.dev",
};

const PRODUCTION = {
  supabase: "https://wdcufpvlbisnqtvmbyso.supabase.co",
  vitrine: "https://vitrine.meellcriativa.workers.dev",
};

/** Executa `fn` com um `Deno.env` falso e restaura o global depois. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const global = globalThis as unknown as { Deno?: unknown };
  const had = Object.prototype.hasOwnProperty.call(global, "Deno");
  const previous = global.Deno;
  global.Deno = { env: { get: (key: string) => vars[key] } };
  try {
    return fn();
  } finally {
    if (had) global.Deno = previous;
    else delete global.Deno;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Callback OAuth e webhook: derivados 100% do SUPABASE_URL do runtime
// ─────────────────────────────────────────────────────────────────────────────

test("callback OAuth usa o Supabase de homologação quando o runtime é de homologação", () => {
  withEnv({ SUPABASE_URL: HOMOLOGATION.supabase }, () => {
    assert.equal(
      paymentsCallbackUrl(),
      "https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/payments-callback",
    );
  });
});

test("callback OAuth usa o Supabase de produção quando o runtime é de produção", () => {
  withEnv({ SUPABASE_URL: PRODUCTION.supabase }, () => {
    assert.equal(
      paymentsCallbackUrl(),
      "https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/payments-callback",
    );
  });
});

test("callback OAuth de homologação nunca contém o project ref de produção", () => {
  withEnv({ SUPABASE_URL: HOMOLOGATION.supabase }, () => {
    const url = paymentsCallbackUrl();
    assert.match(url, /^https:\/\/ardpqimdllzbbdvwamkh\.supabase\.co\//);
    assert.equal(url.includes("wdcufpvlbisnqtvmbyso"), false);
  });
});

test("callback OAuth de produção nunca contém o project ref de homologação", () => {
  withEnv({ SUPABASE_URL: PRODUCTION.supabase }, () => {
    const url = paymentsCallbackUrl();
    assert.match(url, /^https:\/\/wdcufpvlbisnqtvmbyso\.supabase\.co\//);
    assert.equal(url.includes("ardpqimdllzbbdvwamkh"), false);
  });
});

test("webhook de pagamentos segue o mesmo projeto do callback", () => {
  for (const env of [HOMOLOGATION, PRODUCTION]) {
    withEnv({ SUPABASE_URL: env.supabase }, () => {
      assert.equal(paymentsWebhookUrl(), `${env.supabase}/functions/v1/webhooks-mercadopago`);
      assert.equal(
        paymentsCallbackUrl().replace("/functions/v1/payments-callback", ""),
        paymentsWebhookUrl().replace("/functions/v1/webhooks-mercadopago", ""),
      );
    });
  }
});

test("SUPABASE_URL com barra final é normalizada sem alterar o projeto", () => {
  withEnv({ SUPABASE_URL: `${HOMOLOGATION.supabase}///` }, () => {
    assert.equal(supabaseBaseUrl(), HOMOLOGATION.supabase);
    assert.equal(paymentsCallbackUrl(), `${HOMOLOGATION.supabase}/functions/v1/payments-callback`);
  });
});

test("sem SUPABASE_URL, a derivação falha rápido (sem fallback de produção)", () => {
  withEnv({}, () => {
    assert.throws(() => supabaseBaseUrl(), EnvironmentConfigError, /SUPABASE_URL/);
    assert.throws(() => paymentsCallbackUrl(), EnvironmentConfigError, /SUPABASE_URL/);
    assert.throws(() => paymentsWebhookUrl(), EnvironmentConfigError, /SUPABASE_URL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Retorno ao painel: derivado 100% de VITRINE_URL/PAYMENTS_RETURN_ORIGIN
// ─────────────────────────────────────────────────────────────────────────────

test("painel de homologação aponta para o frontend de homologação", () => {
  withEnv({ VITRINE_URL: HOMOLOGATION.vitrine }, () => {
    assert.equal(panelOrigin(), HOMOLOGATION.vitrine);
    assert.equal(panelUrl(), `${HOMOLOGATION.vitrine}/painel/pagamentos`);
    assert.equal(panelUrl().includes("vitrine.meellcriativa.workers.dev"), false);
  });
});

test("painel de produção aponta para o frontend de produção", () => {
  withEnv({ VITRINE_URL: PRODUCTION.vitrine }, () => {
    assert.equal(panelOrigin(), PRODUCTION.vitrine);
    assert.equal(panelUrl(), `${PRODUCTION.vitrine}/painel/pagamentos`);
    assert.equal(panelUrl().includes("vitrine-homolog"), false);
  });
});

test("PAYMENTS_RETURN_ORIGIN só é usado quando VITRINE_URL está ausente", () => {
  withEnv(
    {
      VITRINE_URL: HOMOLOGATION.vitrine,
      PAYMENTS_RETURN_ORIGIN: PRODUCTION.vitrine,
    },
    () => {
      assert.equal(panelOrigin(), HOMOLOGATION.vitrine);
    },
  );
  withEnv({ PAYMENTS_RETURN_ORIGIN: HOMOLOGATION.vitrine }, () => {
    assert.equal(panelOrigin(), HOMOLOGATION.vitrine);
  });
});

test("VITRINE_URL com barra final é normalizada sem alterar o ambiente", () => {
  withEnv({ VITRINE_URL: `${HOMOLOGATION.vitrine}//` }, () => {
    assert.equal(panelOrigin(), HOMOLOGATION.vitrine);
  });
});

test("sem VITRINE_URL nem PAYMENTS_RETURN_ORIGIN, a derivação falha rápido", () => {
  withEnv({}, () => {
    assert.throws(() => panelOrigin(), EnvironmentConfigError, /VITRINE_URL/);
    assert.throws(() => panelUrl(), EnvironmentConfigError, /VITRINE_URL/);
  });
});

test("VITRINE_URL vazia não bloqueia o override explícito", () => {
  withEnv({ VITRINE_URL: "", PAYMENTS_RETURN_ORIGIN: HOMOLOGATION.vitrine }, () => {
    assert.equal(panelOrigin(), HOMOLOGATION.vitrine);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Nenhum literal de ambiente no código da integração
// ─────────────────────────────────────────────────────────────────────────────

test("funções de pagamento não contêm project refs nem domínio fixos", () => {
  const files = [
    "supabase/functions/payments/index.ts",
    "supabase/functions/payments-callback/index.ts",
    "supabase/functions/_shared/payments/urls.ts",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("wdcufpvlbisnqtvmbyso"), false, `${file} contém ref de produção`);
    assert.equal(
      source.includes("ardpqimdllzbbdvwamkh"),
      false,
      `${file} contém ref de homologação`,
    );
    assert.equal(
      source.includes("vitrine.meellcriativa.workers.dev"),
      false,
      `${file} contém domínio de produção`,
    );
  }
});
