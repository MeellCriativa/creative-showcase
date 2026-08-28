import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Correios official API for prices & deadlines (API Preço)
// https://api.correios.com.br/preco/v1
const CORREIOS_PRECO_TOKEN_URL = "https://api.correios.com.br/token/v1/autentica/cartaopostagem";
const CORREIOS_PRECO_URL =
  Deno.env.get("CORREIOS_PRECO_URL") || "https://api.correios.com.br/preco/v1";

// Códigos de serviço Correios (à vista / varejo)
const SERVICOS = [
  { code: "04014", name: "SEDEX" },
  { code: "04510", name: "PAC" },
  { code: "40215", name: "SEDEX 10" },
] as const;

interface CartItem {
  weight_grams: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  quantity: number;
}

function digits(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "");
}

async function getCorreiosToken(): Promise<string> {
  const user = Deno.env.get("CORREIOS_USER") || "";
  const pass = Deno.env.get("CORREIOS_PASSWORD") || "";
  const res = await fetch(CORREIOS_PRECO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (!res.ok) throw new Error(`Falha na autenticação com os Correios (${res.status})`);
  const data = await res.json();
  return (data?.token || data?.access_token || "").toString();
}

// Conta contrato (opcional) para tarifas de contrato
async function getContrato(): Promise<{ nCdEmpresa: string; sDsSenha: string; token: string }> {
  const nCdEmpresa = Deno.env.get("CORREIOS_CONTRATO") || "";
  const sDsSenha = Deno.env.get("CORREIOS_CONTRATO_SENHA") || "";
  let token = "";
  try {
    token = await getCorreiosToken();
  } catch {
    token = "";
  }
  return { nCdEmpresa, sDsSenha, token };
}

async function calcPreco(nCdServico: string, params: Record<string, string>): Promise<{ value: number; delivery: number | null }> {
  const { nCdEmpresa, sDsSenha, token } = await getContrato();
  if (!token) {
    return { value: -1, delivery: null };
  }

  const url = new URL(`${CORREIOS_PRECO_URL}/${nCdServico}/calcular`);
  url.searchParams.set("nCdServico", nCdServico);
  url.searchParams.set("sCepOrigem", params.sCepOrigem);
  url.searchParams.set("sCepDestino", params.sCepDestino);
  url.searchParams.set("nVlPeso", params.nVlPeso);
  url.searchParams.set("nCdFormato", "1");
  url.searchParams.set("nVlComprimento", params.nVlComprimento);
  url.searchParams.set("nVlAltura", params.nVlAltura);
  url.searchParams.set("nVlLargura", params.nVlLargura);
  url.searchParams.set("nVlDiametro", params.nVlDiametro);
  if (nCdEmpresa) {
    url.searchParams.set("nCdEmpresa", nCdEmpresa);
    url.searchParams.set("sDsSenha", sDsSenha);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json();

  if (!res.ok) {
    const msg = data?.erros?.[0]?.msg || data?.mensagem || `Erro Correios (${res.status})`;
    throw new Error(msg);
  }

  const co = data?.coProduto || data?.servico || data?.[0];
  const price = parseFloat(co?.pcFinal || data?.pco?.pcFinal || "0");
  const delivery = co?.prazoEntrega != null ? parseInt(co.prazoEntrega, 10) : null;
  return { value: price, delivery };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { originZip, destinationZip, items } = body as {
      originZip: string;
      destinationZip: string;
      items: CartItem[];
    };

    if (!originZip || !destinationZip) {
      return new Response(
        JSON.stringify({ success: false, error: "Informe o CEP de origem e destino." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (!/^\d{8}$/.test(digits(originZip)) || !/^\d{8}$/.test(digits(destinationZip))) {
      return new Response(
        JSON.stringify({ success: false, error: "CEP inválido." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const configured =
      !!Deno.env.get("CORREIOS_USER") && !!Deno.env.get("CORREIOS_PASSWORD");

    if (!configured) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "not_configured",
          message:
            "O cálculo de frete dos Correios ainda não foi ativado para esta loja. Configure a integração com os Correios para consultar preços e prazos.",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const validItems = items || [];
    if (validItems.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Carrinho vazio." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Agrega peso e dimensões (maior dimensão entre os itens, soma do peso)
    let totalGrams = 0;
    let maxLength = 0;
    let maxWidth = 0;
    let maxHeight = 0;
    for (const it of validItems) {
      const qty = it.quantity || 1;
      totalGrams += (it.weight_grams || 0) * qty;
      maxLength = Math.max(maxLength, it.length_cm || 0);
      maxWidth = Math.max(maxWidth, it.width_cm || 0);
      maxHeight = Math.max(maxHeight, it.height_cm || 0);
    }

    if (totalGrams <= 0 || maxLength <= 0 || maxWidth <= 0 || maxHeight <= 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Alguns produtos do carrinho ainda não têm peso e dimensões cadastrados. A loja precisa preencher esses dados para calcular o frete.",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const kg = Math.max(0.3, totalGrams / 1000).toFixed(3).replace(".", ",");
    const params = {
      sCepOrigem: digits(originZip),
      sCepDestino: digits(destinationZip),
      nVlPeso: kg,
      nVlComprimento: String(maxLength),
      nVlAltura: String(maxHeight),
      nVlLargura: String(maxWidth),
      nVlDiametro: "0",
    };

    const quotes: unknown[] = [];
    for (const svc of SERVICOS) {
      try {
        const result = await calcPreco(svc.code, params);
        if (result.value > 0) {
          quotes.push({
            service: svc.code,
            name: svc.name,
            price: result.value,
            delivery_days: result.delivery,
            delivery_text:
              result.delivery != null && result.delivery > 0
                ? `${result.delivery} dia${result.delivery > 1 ? "s" : ""} útil${result.delivery > 1 ? "eis" : ""}`
                : null,
          });
        }
      } catch (e) {
        console.error(`[quote-shipping] serviço ${svc.name}`, e);
      }
    }

    if (quotes.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Não foi possível obter opções de entrega dos Correios para este endereço. Verifique o CEP e tente novamente.",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({ success: true, quotes }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[quote-shipping]", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Erro ao calcular frete",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
