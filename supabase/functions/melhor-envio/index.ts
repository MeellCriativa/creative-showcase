import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  verifyUser,
  getSupabaseAdmin,
  getBase,
  getPlatformEnv,
  hasPlatformCredentials,
  getAccount,
  ensureValidAccessToken,
  meApi,
  jsonRes,
} from "../_shared/melhor-envio.ts";

function digits(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "");
}

function formatCep(s: string): string {
  return digits(s).slice(0, 8);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "status";

    const user = await verifyUser(req);

    // Public actions (used by the buyer during checkout): quote
    const publicActions = ["quote"];
    if (publicActions.includes(action) && !user) {
      return await handle(action, { req, user: null, url, body: await req.json().catch(() => ({})) });
    }
    if (!user) {
      return jsonRes({ error: "Unauthorized" }, 401);
    }
    return await handle(action, { req, user, url, body: await req.json().catch(() => ({})) });
  } catch (err) {
    console.error("[melhor-envio]", err);
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Internal error";
    return jsonRes(
      status >= 500 ? { success: false, error: "Internal error" } : { success: false, error: msg },
      status,
    );
  }
});

type Ctx = {
  req: Request;
  user: { id: string } | null;
  url: URL;
  body: Record<string, unknown>;
};

async function handle(action: string, ctx: Ctx): Promise<Response> {
  switch (action) {
    case "status":
      return statusAction(ctx);
    case "connect":
      return connectAction(ctx);
    case "disconnect":
      return disconnectAction(ctx);
    case "save_sender":
      return saveSenderAction(ctx);
    case "quote":
      return quoteAction(ctx);
    case "cart":
      return cartAction(ctx);
    case "checkout":
      return checkoutAction(ctx);
    case "generate":
      return generateAction(ctx);
    case "print":
      return printAction(ctx);
    case "tracking":
      return trackingAction(ctx);
    case "agencies":
      return agenciesAction(ctx);
    default:
      return jsonRes({ error: "Ação desconhecida" }, 400);
  }
}

async function getOwnedCatalog(ctx: Ctx, catalogId: string) {
  if (!catalogId) throw new HttpError(400, "catalog_id é obrigatório.");
  const admin = getSupabaseAdmin();
  const { data: catalog, error } = await admin
    .from("catalogs")
    .select("id, slug, delivery_methods, shipping_origin_zip")
    .eq("id", catalogId)
    .eq("user_id", ctx.user!.id)
    .maybeSingle();
  if (error || !catalog) throw new HttpError(404, "Catálogo não encontrado.");
  return catalog;
}

/* ── status ─────────────────────────────────────────────────────── */
async function statusAction(ctx: Ctx) {
  const catalogId = ctx.url.searchParams.get("catalog_id") || (ctx.body.catalog_id as string) || "";
  if (!catalogId) throw new HttpError(400, "catalog_id é obrigatório.");
  await getOwnedCatalog(ctx, catalogId);

  const account = await getAccount(catalogId);
  const env = getPlatformEnv();
  const connected = !!(account?.connected && account?.access_token);

  return jsonRes({
    success: true,
    connected,
    environment: env,
    configured: hasPlatformCredentials(),
    connectUrl: hasPlatformCredentials()
      ? await buildAuthorizeUrl(ctx, catalogId)
      : null,
    sender: account
      ? {
          name: account.sender_name,
          document: account.sender_document,
          phone: account.sender_phone,
          email: account.sender_email,
          street: account.sender_street,
          number: account.sender_number,
          complement: account.sender_complement,
          district: account.sender_district,
          city: account.sender_city,
          state: account.sender_state,
          zip: account.sender_zip,
          complete: !!(
            account.sender_name &&
            account.sender_document &&
            account.sender_street &&
            account.sender_number &&
            account.sender_city &&
            account.sender_state &&
            account.sender_zip
          ),
        }
      : null,
  });
}

async function buildAuthorizeUrl(ctx: Ctx, catalogId: string) {
  const env = getPlatformEnv();
  const base = getBase(env);
  const clientId = Deno.env.get("ME_CLIENT_ID") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://wdcufpvlbisnqtvmbyso.supabase.co";
  const redirectUri = `${supabaseUrl}/functions/v1/melhor-envio-callback`;
  const scopes = "shipping:read,shipping:write,checkout:read,checkout:write";
  const state = `${catalogId}`;
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  });
  return `${base}/oauth/authorize?${query.toString()}`;
}

async function connectAction(ctx: Ctx) {
  const catalogId = ctx.url.searchParams.get("catalog_id") || (ctx.body.catalog_id as string) || "";
  await getOwnedCatalog(ctx, catalogId);
  if (!hasPlatformCredentials()) {
    throw new HttpError(
      503,
      "A integração com a Melhor Envio ainda não foi configurada na plataforma.",
    );
  }
  const authorizeUrl = await buildAuthorizeUrl(ctx, catalogId);
  return jsonRes({ success: true, url: authorizeUrl });
}

async function disconnectAction(ctx: Ctx) {
  const catalogId = ctx.url.searchParams.get("catalog_id") || (ctx.body.catalog_id as string) || "";
  await getOwnedCatalog(ctx, catalogId);
  const admin = getSupabaseAdmin();
  await admin.from("melhor_envio_accounts").delete().eq("catalog_id", catalogId);
  return jsonRes({ success: true });
}

async function saveSenderAction(ctx: Ctx) {
  const catalogId = ctx.url.searchParams.get("catalog_id") || (ctx.body.catalog_id as string) || "";
  await getOwnedCatalog(ctx, catalogId);
  const b = ctx.body;
  const admin = getSupabaseAdmin();
  await admin.from("melhor_envio_accounts").upsert(
    {
      catalog_id: catalogId,
      environment: getPlatformEnv(),
      sender_name: (b.name as string) || null,
      sender_document: digits(b.document as string) || null,
      sender_phone: (b.phone as string) || null,
      sender_email: (b.email as string) || null,
      sender_street: (b.street as string) || null,
      sender_number: (b.number as string) || null,
      sender_complement: (b.complement as string) || null,
      sender_district: (b.district as string) || null,
      sender_city: (b.city as string) || null,
      sender_state: (b.state as string) || null,
      sender_zip: formatCep((b.zip as string) || "") || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "catalog_id" },
  );
  const account = await getAccount(catalogId);
  return jsonRes({ success: true, account });
}

/* ── quote (buyer + admin) ──────────────────────────────────────── */
async function quoteAction(ctx: Ctx) {
  const b = ctx.body;
  const catalogId = (b.catalog_id as string) || ctx.url.searchParams.get("catalog_id") || "";
  const destinationZip = formatCep((b.destination_zip as string) || "");
  const items = (b.items as Array<Record<string, unknown>>) || [];

  if (!catalogId) throw new HttpError(400, "catalog_id é obrigatório.");

  const account = await getAccount(catalogId);
  const senderZip = account?.sender_zip || (b.origin_zip as string) || null;
  if (!account?.connected) {
    return jsonRes({
      success: false,
      error: "not_connected",
      message: "A loja ainda não ativou o envio por Correios e transportadoras.",
    });
  }
  if (!senderZip) {
    return jsonRes({
      success: false,
      error: "no_origin",
      message: "A loja ainda não definiu o CEP de origem. Peça para a loja configurar a entrega.",
    });
  }
  if (!/^\d{8}$/.test(destinationZip)) {
    return jsonRes({ success: false, error: "Informe um CEP de destino válido." });
  }

  const products = items.map((it, idx) => ({
    id: String(it.id ?? idx),
    width: Number(it.width_cm ?? 0),
    height: Number(it.height_cm ?? 0),
    length: Number(it.length_cm ?? 0),
    weight: Number(it.weight_grams ?? 0) / 1000,
    insurance_value: Number(it.unit_price ?? 0) * Number(it.quantity ?? 1),
    quantity: Number(it.quantity ?? 1),
  }));

  if (
    products.length === 0 ||
    products.some((p) => p.weight <= 0 || p.width <= 0 || p.height <= 0 || p.length <= 0)
  ) {
    return jsonRes({
      success: false,
      error:
        "Alguns produtos do carrinho ainda não têm peso e dimensões cadastrados. A loja precisa preencher esses dados para calcular o frete.",
    });
  }

  const { res, data } = await meApi({
    catalogId,
    method: "POST",
    path: "/api/v2/me/shipment/calculate",
    body: {
      from: { postal_code: digits(senderZip) },
      to: { postal_code: destinationZip },
      products,
    },
  });

  const raw = data as {
    error?: { message?: string; errors?: unknown };
    message?: string;
  };

  if (!res.ok || raw.error) {
    return jsonRes({
      success: false,
      error: (raw.error?.message as string) || raw.message || "Não foi possível calcular o frete.",
    });
  }

  const list = Array.isArray(data) ? data : ((data as { services?: unknown[] })?.services || []);
  const quotes = (list as Array<Record<string, unknown>>)
    .filter((s) => Number(s.price) > 0)
    .map((s) => {
      const name =
        (s.company && typeof s.company === "object"
          ? ((s.company as Record<string, unknown>).name as string)
          : "") || (s.name as string) || "Envio";
      const range = (s.delivery_range as Record<string, unknown>) || {};
      const min = Number(range.min ?? s.delivery_time ?? null) || null;
      const max = Number(range.max ?? s.delivery_time ?? null) || null;
      return {
        serviceId: String(s.id),
        name,
        price: Number(s.price),
        delivery_min: min,
        delivery_max: max,
        delivery_text:
          min != null ? (min === max ? `${min} dia${min > 1 ? "s" : ""}` : `${min} a ${max} dias`) : null,
        agencyRequired: !!s.agency,
        agency: s.agency || null,
        company: s.company || null,
        collect: !!(s.additional_services as Record<string, unknown> | undefined)?.collect,
      };
    });

  if (quotes.length === 0) {
    return jsonRes({
      success: false,
      error:
        "Não foi possível obter opções de entrega para este endereço. Verifique o CEP e tente novamente.",
    });
  }

  return jsonRes({ success: true, quotes });
}

/* ── cart (create ME order) ─────────────────────────────────────── */
async function cartAction(ctx: Ctx) {
  const b = ctx.body;
  const catalogId = (b.catalog_id as string) || "";
  await getOwnedCatalog(ctx, catalogId);

  const service = Number(b.service_id);
  const sender = b.sender as Record<string, unknown> | undefined;
  const recipient = b.recipient as Record<string, unknown> | undefined;
  const products = (b.products as Array<Record<string, unknown>>) || [];
  const agency = b.agency_id ? Number(b.agency_id) : undefined;

  if (!service) throw new HttpError(400, "Service (modalidade) é obrigatório.");
  if (!sender || !recipient) throw new HttpError(400, "Remetente e destinatário são obrigatórios.");

  const nonCommercial = b.non_commercial !== false;
  const invoiceKey = (b.invoice_key as string) || null;

  const payload: Record<string, unknown> = {
    from: {
      name: (sender.name as string) || "",
      phone: (sender.phone as string) || "",
      email: (sender.email as string) || "",
      document: digits(sender.document as string),
      address: `${(sender.street as string) || ""}, ${(sender.number as string) || ""}`.trim(),
      complement: (sender.complement as string) || "",
      district: (sender.district as string) || "",
      city: (sender.city as string) || "",
      state_abbr: (sender.state as string) || "",
      country_id: "BR",
      postal_code: digits(sender.zip as string),
      ...(nonCommercial ? { state_register: "ISENTO" } : {}),
    },
    to: {
      name: (recipient.name as string) || "",
      phone: (recipient.phone as string) || "",
      email: (recipient.email as string) || "",
      document: digits(recipient.document as string),
      address: `${(recipient.street as string) || ""}, ${(recipient.number as string) || ""}`.trim(),
      complement: (recipient.complement as string) || "",
      district: (recipient.district as string) || "",
      city: (recipient.city as string) || "",
      state_abbr: (recipient.state as string) || "",
      country_id: "BR",
      postal_code: digits(recipient.zip as string),
    },
    products: products.map((p) => ({
      name: (p.name as string) || "Produto",
      quantity: Number(p.quantity ?? 1),
      unitary_value: Number(p.unitary_value ?? 0),
      width: Number(p.width_cm ?? 0),
      height: Number(p.height_cm ?? 0),
      length: Number(p.length_cm ?? 0),
      weight: Number(p.weight_grams ?? 0) / 1000,
    })),
    service,
    options: {
      non_commercial: nonCommercial,
      own_hand: false,
      receipt: false,
      collect: false,
      ...(invoiceKey ? { invoice: { key: invoiceKey } } : {}),
    },
  };

  if (agency) payload.agency = agency;

  const { res, data } = await meApi({
    catalogId,
    method: "POST",
    path: "/api/v2/me/cart",
    body: payload,
  });

  const raw = data as { error?: { message?: string }; message?: string };
  if (!res.ok || raw.error) {
    return jsonRes({
      success: false,
      error: (raw.error?.message as string) || raw.message || "Falha ao criar o envio na Melhor Envio.",
    });
  }

  const orderId = (data as { id?: number })?.id;
  return jsonRes({ success: true, me_order_id: orderId ? String(orderId) : null, data });
}

/* ── checkout (pay) ─────────────────────────────────────────────── */
async function checkoutAction(ctx: Ctx) {
  const b = ctx.body;
  const catalogId = (b.catalog_id as string) || "";
  await getOwnedCatalog(ctx, catalogId);
  const meOrderId = Number(b.me_order_id);
  if (!meOrderId) throw new HttpError(400, "me_order_id é obrigatório.");

  const { res, data } = await meApi({
    catalogId,
    method: "POST",
    path: "/api/v2/me/shipment/checkout",
    body: { orders: [{ id: meOrderId }] },
  });

  const raw = data as { error?: { message?: string }; message?: string };
  if (!res.ok || raw.error) {
    return jsonRes({
      success: false,
      error: (raw.error?.message as string) || raw.message || "Falha no pagamento do envio.",
    });
  }

  const purchase = (data as { purchase?: { id?: number } })?.purchase || (data as { id?: unknown });
  const protocol = (purchase as { id?: unknown })?.id;

  if (meOrderId) {
    const admin = getSupabaseAdmin();
    await admin.from("orders").update({ me_status: "paid" }).eq("me_order_id", String(meOrderId));
  }

  return jsonRes({ success: true, me_protocol: protocol != null ? String(protocol) : null, data });
}

/* ── generate label ─────────────────────────────────────────────── */
async function generateAction(ctx: Ctx) {
  const b = ctx.body;
  const catalogId = (b.catalog_id as string) || "";
  await getOwnedCatalog(ctx, catalogId);
  const meOrderId = Number(b.me_order_id);
  if (!meOrderId) throw new HttpError(400, "me_order_id é obrigatório.");

  const { res, data } = await meApi({
    catalogId,
    method: "POST",
    path: "/api/v2/me/shipment/generate",
    body: { orders: [{ id: meOrderId }] },
  });

  const raw = data as { error?: { message?: string }; message?: string };
  if (!res.ok || raw.error) {
    return jsonRes({
      success: false,
      error: (raw.error?.message as string) || raw.message || "Falha ao gerar a etiqueta.",
    });
  }

  let tracking: string | null = null;
  let protocol: string | null = null;
  const orders = (data as { orders?: Array<Record<string, unknown>> })?.orders;
  if (Array.isArray(orders)) {
    const first = orders[0] || {};
    tracking = (first.tracking as string) || null;
    protocol = (first.protocol as string) || null;
    // update order if we can map
    const admin = getSupabaseAdmin();
    await admin
      .from("orders")
      .update({
        me_status: "generated",
        ...(tracking ? { me_tracking: tracking } : {}),
        ...(protocol ? { me_protocol: protocol } : {}),
      })
      .eq("me_order_id", String(meOrderId));
  }

  return jsonRes({ success: true, me_protocol: protocol, me_tracking: tracking, data });
}

/* ── print label ────────────────────────────────────────────────── */
async function printAction(ctx: Ctx) {
  const b = ctx.body;
  const catalogId = (b.catalog_id as string) || "";
  await getOwnedCatalog(ctx, catalogId);
  const meOrderId = Number(b.me_order_id);
  if (!meOrderId) throw new HttpError(400, "me_order_id é obrigatório.");

  const { res, data } = await meApi({
    catalogId,
    method: "POST",
    path: "/api/v2/me/shipment/print",
    body: { mode: "public", orders: [{ id: meOrderId }] },
  });

  const raw = data as { error?: { message?: string }; message?: string };
  if (!res.ok || raw.error) {
    return jsonRes({
      success: false,
      error: (raw.error?.message as string) || raw.message || "Falha ao imprimir a etiqueta.",
    });
  }

  const printUrl = (data as { url?: string })?.url || null;
  if (meOrderId && printUrl) {
    const admin = getSupabaseAdmin();
    await admin
      .from("orders")
      .update({ me_label_url: printUrl, me_status: "printed" })
      .eq("me_order_id", String(meOrderId));
  }

  return jsonRes({ success: true, url: printUrl, data });
}

/* ── tracking ───────────────────────────────────────────────────── */
async function trackingAction(ctx: Ctx) {
  const b = ctx.body;
  const catalogId = (b.catalog_id as string) || "";
  await getOwnedCatalog(ctx, catalogId);
  const meOrderIds = (b.me_order_ids as Array<string>) || (b.me_order_id ? [b.me_order_id] : []);
  const ids = meOrderIds.map((x) => Number(x)).filter((n) => n > 0);
  if (ids.length === 0) throw new HttpError(400, "me_order_id é obrigatório.");

  const { res, data } = await meApi({
    catalogId,
    method: "POST",
    path: "/api/v2/me/shipment/tracking",
    body: { orders: ids },
  });

  const raw = data as { error?: { message?: string }; message?: string };
  if (!res.ok || raw.error) {
    return jsonRes({
      success: false,
      error: (raw.error?.message as string) || raw.message || "Falha ao consultar o rastreio.",
    });
  }

  return jsonRes({ success: true, tracking: data });
}

/* ── agencies (postagem points) ─────────────────────────────────── */
async function agenciesAction(ctx: Ctx) {
  const b = ctx.body;
  const catalogId = (b.catalog_id as string) || ctx.url.searchParams.get("catalog_id") || "";
  await getOwnedCatalog(ctx, catalogId);

  const company = (b.company as string) || ctx.url.searchParams.get("company") || "";
  const state = (b.state as string) || ctx.url.searchParams.get("state") || "";
  const city = (b.city as string) || ctx.url.searchParams.get("city") || "";

  const { res, data } = await meApi({
    catalogId,
    method: "GET",
    path: "/api/v2/me/shipment/agencies",
    query: {
      country: "BR",
      ...(company ? { company } : {}),
      ...(state ? { state } : {}),
      ...(city ? { city } : {}),
    },
  });

  const raw = data as { error?: { message?: string }; message?: string };
  if (!res.ok || raw.error) {
    return jsonRes({
      success: false,
      error: (raw.error?.message as string) || raw.message || "Falha ao listar pontos de postagem.",
    });
  }

  return jsonRes({ success: true, agencies: data });
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
