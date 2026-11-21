import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { useI18n, type MessageKey } from "@/i18n";
import { formatMoney, resolveOrderCurrency, resolveStoreCurrency } from "@/lib/currency";
import {
  listDigitalDeliveries,
  runDeliveryAction,
  type DeliveryAction,
} from "@/lib/digitalDelivery";
import type { DigitalDelivery } from "@/lib/catalog";
import { meApi } from "@/lib/shipping";
import { EmptyCatalog } from "./painel.categorias";

export const Route = createFileRoute("/painel/pedidos")({
  component: PedidosPage,
});

type OrderItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  variation?: string;
  weight_grams?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
};
type OrderRow = {
  id: string;
  catalog_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email?: string | null;
  payment_status?: string | null;
  items: OrderItem[];
  note: string | null;
  total: number;
  subtotal: number | null;
  delivery_method: string | null;
  shipping_zip: string | null;
  customer_street: string | null;
  customer_number: string | null;
  customer_complement: string | null;
  customer_district: string | null;
  customer_city: string | null;
  customer_state: string | null;
  shipping_service: string | null;
  shipping_service_name: string | null;
  shipping_cost: number | null;
  shipping_eta_text: string | null;
  me_order_id: string | null;
  me_status: string | null;
  me_tracking: string | null;
  me_protocol: string | null;
  me_label_url: string | null;
  status: string;
  created_at: string;
  /** Moeda do pedido no momento da compra. NULL = pedido anterior à Etapa 1. */
  currency: string | null;
};

const STATUSES = [
  "novo",
  "confirmado",
  "em_preparacao",
  "pronto",
  "finalizado",
  "cancelado",
] as const;

/** Chave de tradução de cada status; o valor técnico do banco não muda. */
const STATUS_LABEL_KEYS: Record<string, MessageKey> = {
  novo: "orders.status.novo",
  confirmado: "orders.status.confirmado",
  em_preparacao: "orders.status.emPreparacao",
  pronto: "orders.status.pronto",
  finalizado: "orders.status.finalizado",
  cancelado: "orders.status.cancelado",
};

const STATUS_CLASSES: Record<string, string> = {
  novo: "bg-blue-100 text-blue-700",
  confirmado: "bg-amber-100 text-amber-700",
  em_preparacao: "bg-purple-100 text-purple-700",
  pronto: "bg-green-100 text-green-700",
  finalizado: "bg-muted text-muted-foreground",
  cancelado: "bg-red-100 text-destructive",
};

type Filter = "todos" | "hoje" | "pendentes" | "finalizados";

const PENDING_STATUSES = ["novo", "confirmado", "em_preparacao", "pronto"];

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function PedidosPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: catalog } = useMyCatalog(user?.id);
  const [filter, setFilter] = useState<Filter>("todos");

  const { data: orders, isLoading } = useQuery<OrderRow[]>({
    queryKey: ["orders", catalog?.id],
    enabled: !!catalog,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("catalog_id", catalog!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

  // O e-mail do comprador e os detalhes das entregas vêm de uma Edge Function
  // autenticada: RLS direta não expõe hash de token nem dados a anônimos.
  const { data: deliveries } = useQuery<DigitalDelivery[]>({
    queryKey: ["digital-deliveries", catalog?.id],
    enabled: !!catalog,
    queryFn: async () => (catalog ? await listDigitalDeliveries(catalog.id) : []),
  });

  const filtered = (orders ?? []).filter((o) => {
    if (filter === "hoje") return isToday(o.created_at);
    if (filter === "pendentes") return PENDING_STATUSES.includes(o.status);
    if (filter === "finalizados") return o.status === "finalizado";
    return true;
  });

  const todayCount = (orders ?? []).filter((o) => isToday(o.created_at)).length;
  const pendingCount = (orders ?? []).filter((o) => PENDING_STATUSES.includes(o.status)).length;
  const finishedCount = (orders ?? []).filter((o) => o.status === "finalizado").length;

  /**
   * Faturamento por moeda: cada pedido entra na moeda em que foi feito.
   * Pedidos históricos (sem `currency`) são BRL e não mudam se a loja trocar
   * de moeda depois.
   */
  const storeCurrency = resolveStoreCurrency(catalog?.currency);
  const revenueByCurrency = new Map<string, number>();
  for (const order of orders ?? []) {
    if (order.status === "cancelado") continue;
    const code = resolveOrderCurrency(order.currency);
    revenueByCurrency.set(code, (revenueByCurrency.get(code) ?? 0) + (order.total ?? 0));
  }
  const revenueEntries = [...revenueByCurrency.entries()].sort((a, b) => b[1] - a[1]);

  async function updateStatus(orderId: string, status: string) {
    const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
    if (error) {
      toast.error(t("orders.updateError"));
    } else {
      void queryClient.invalidateQueries({ queryKey: ["orders", catalog?.id] });
    }
  }

  if (!catalog) return <EmptyCatalog />;

  return (
    <div className="px-5 pb-10 pt-10">
      <h1 className="text-2xl font-bold text-foreground">{t("orders.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("orders.subtitle")}</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("orders.stats.today")} value={String(todayCount)} />
        <StatCard label={t("orders.stats.pending")} value={String(pendingCount)} />
        <StatCard label={t("orders.stats.finished")} value={String(finishedCount)} />
        {revenueEntries.length === 0 ? (
          <StatCard
            label={t("orders.stats.total", { currency: storeCurrency })}
            value={formatMoney(0, storeCurrency)}
          />
        ) : (
          revenueEntries.map(([code, value]) => (
            <StatCard
              key={code}
              label={t("orders.stats.total", { currency: code })}
              value={formatMoney(value, code)}
            />
          ))
        )}
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {(
          [
            { key: "todos", label: t("orders.filters.all") },
            { key: "hoje", label: t("orders.filters.today") },
            { key: "pendentes", label: t("orders.filters.pending") },
            { key: "finalizados", label: t("orders.filters.finished") },
          ] as const satisfies readonly { key: Filter; label: string }[]
        ).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === f.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {isLoading && <Loader2 className="mx-auto size-5 animate-spin text-primary" />}
        {!isLoading && filtered.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("orders.empty")}
          </p>
        )}
        {filtered.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            deliveries={(deliveries ?? []).filter((d) => d.order_id === order.id)}
            onStatusChange={updateStatus}
            onDeliveryChanged={() => {
              void queryClient.invalidateQueries({
                queryKey: ["digital-deliveries", catalog?.id],
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function OrderCard({
  order,
  deliveries,
  onStatusChange,
  onDeliveryChanged,
}: {
  order: OrderRow;
  deliveries: DigitalDelivery[];
  onStatusChange: (id: string, status: string) => void;
  onDeliveryChanged: () => void;
}) {
  const { t, formatDate, formatDateTime } = useI18n();
  const orderCurrency = resolveOrderCurrency(order.currency);
  const money = (value: number) => formatMoney(value, orderCurrency);
  const dt = new Date(order.created_at);
  const formattedDate = formatDate(dt, { day: "2-digit", month: "2-digit", year: "numeric" });
  const formattedTime = formatDateTime(dt, { hour: "2-digit", minute: "2-digit" });
  const [meBusy, setMeBusy] = useState<string | null>(null);
  const [deliveryBusy, setDeliveryBusy] = useState<string | null>(null);

  const isMeShipping = order.delivery_method === "melhor_envio";

  async function runDelivery(action: DeliveryAction, deliveryId: string) {
    setDeliveryBusy(`${action}:${deliveryId}`);
    try {
      const result = await runDeliveryAction(action, deliveryId);
      if (!result.success) {
        toast.error(String(result.error ?? t("orders.digital.actionFailed")));
        return;
      }
      toast.success(t("orders.digital.actionDone"));
      onDeliveryChanged();
    } catch {
      toast.error(t("orders.digital.actionFailed"));
    } finally {
      setDeliveryBusy(null);
    }
  }

  function deliveryStatusLabel(status: string): MessageKey {
    if (status === "sent") return "orders.digital.statusSent";
    if (status === "failed") return "orders.digital.statusFailed";
    if (status === "revoked") return "orders.digital.statusRevoked";
    return "orders.digital.statusPending";
  }
  const statusLabelKey = STATUS_LABEL_KEYS[order.status];

  async function runMe(action: string) {
    if (!order.catalog_id) return;
    setMeBusy(action);
    try {
      let res: {
        success: boolean;
        error?: string;
        url?: string | null;
        me_order_id?: string | null;
        me_protocol?: string | null;
        data?: unknown;
      };
      const opt = order.catalog_id;
      if (action === "cart") {
        const sender = await meApi.status(opt);
        if (!sender.success) {
          toast.error(String(sender.error || t("orders.toast.connectFirst")));
          return;
        }
        const s = sender.sender;
        if (!s || !s.complete) {
          toast.error(t("orders.toast.senderIncomplete"));
          return;
        }
        res = await meApi.cart(opt, {
          service_id: order.shipping_service,
          sender: {
            name: s.name,
            phone: s.phone,
            email: s.email,
            document: s.document,
            street: s.street,
            number: s.number,
            complement: s.complement,
            district: s.district,
            city: s.city,
            state: s.state,
            zip: s.zip,
          },
          recipient: {
            name: order.customer_name,
            phone: order.customer_phone || "",
            email: "",
            document: "",
            street: order.customer_street,
            number: order.customer_number,
            complement: order.customer_complement,
            district: order.customer_district,
            city: order.customer_city,
            state: order.customer_state,
            zip: order.shipping_zip,
          },
          products: (order.items || []).map((it) => ({
            name: it.name,
            quantity: it.quantity,
            unitary_value: it.unitPrice,
            width_cm: it.width_cm ?? 0,
            height_cm: it.height_cm ?? 0,
            length_cm: it.length_cm ?? 0,
            weight_grams: it.weight_grams ?? 0,
          })),
          agency_id: undefined,
          non_commercial: true,
        });
      } else if (order.me_order_id) {
        if (action === "checkout") res = await meApi.checkout(opt, order.me_order_id);
        else if (action === "generate") res = await meApi.generate(opt, order.me_order_id);
        else if (action === "print") res = await meApi.print(opt, order.me_order_id);
        else if (action === "tracking") res = await meApi.tracking(opt, order.me_order_id);
        else res = { success: false };
      } else {
        res = { success: false, error: t("orders.toast.createFirst") };
      }

      if (!res.success) {
        toast.error(String(res.error || t("orders.toast.operationFailed")));
        return;
      }

      if (action === "cart") {
        toast.success(t("orders.toast.created"));
      } else if (action === "checkout") {
        toast.success(t("orders.toast.paid"));
      } else if (action === "generate") {
        toast.success(t("orders.toast.labelGenerated"));
      } else if (action === "print" && res.url) {
        window.open(String(res.url), "_blank");
      } else if (action === "tracking") {
        toast.success(t("orders.toast.trackingInfo"));
      }

      // refetch orders to update ME fields
      await new Promise((r) => setTimeout(r, 400));
      try {
        const { data: updated } = await supabase
          .from("orders")
          .select("me_order_id, me_status, me_tracking, me_protocol, me_label_url")
          .eq("id", order.id)
          .single();
        if (updated) {
          // update local row via callback is complex; just inform user to refresh
        }
      } catch {
        /* ignore */
      }
    } catch {
      toast.error(t("orders.toast.unexpected"));
    } finally {
      setMeBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{order.customer_name}</p>
          {order.customer_phone && (
            <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[order.status] ?? "bg-muted text-muted-foreground"}`}
        >
          {statusLabelKey ? t(statusLabelKey) : order.status}
        </span>
      </div>

      <ul className="mt-3 space-y-1">
        {order.items.map((item, idx) => (
          <li key={idx} className="text-sm text-foreground">
            <span className="font-medium">{item.quantity}x</span> {item.name}
            {item.variation && <span className="text-muted-foreground"> ({item.variation})</span>}
            <span className="ml-1 text-muted-foreground">
              — {money(item.unitPrice * item.quantity)}
            </span>
          </li>
        ))}
      </ul>

      {order.delivery_method && (
        <div className="mt-3 rounded-xl bg-accent/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
          {order.delivery_method === "melhor_envio" && (
            <p className="font-semibold text-foreground">{t("orders.shipping.melhorEnvio")}</p>
          )}
          {order.delivery_method === "local_pickup" && (
            <p className="font-semibold text-foreground">{t("orders.shipping.localPickup")}</p>
          )}
          {order.delivery_method === "local_delivery" && (
            <p className="font-semibold text-foreground">{t("orders.shipping.localDelivery")}</p>
          )}
          {order.shipping_service_name && (
            <p>{t("orders.shipping.service", { name: order.shipping_service_name })}</p>
          )}
          {order.shipping_cost != null && order.shipping_cost > 0 && (
            <p>{t("orders.shipping.cost", { value: money(order.shipping_cost) })}</p>
          )}
          {order.shipping_eta_text && (
            <p>{t("orders.shipping.eta", { eta: order.shipping_eta_text })}</p>
          )}
          {order.shipping_zip && <p>{t("orders.shipping.zip", { zip: order.shipping_zip })}</p>}
          {(order.customer_street || order.customer_city) && (
            <p>
              {[order.customer_street, order.customer_number].filter(Boolean).join(", ")}
              {order.customer_complement ? ` - ${order.customer_complement}` : ""}
              {[order.customer_district, order.customer_city, order.customer_state]
                .filter(Boolean)
                .join(" - ") && (
                <>
                  <br />
                  {[order.customer_district, order.customer_city, order.customer_state]
                    .filter(Boolean)
                    .join(" - ")}
                </>
              )}
            </p>
          )}
          {isMeShipping && order.me_tracking && (
            <p className="pt-1">
              {t("orders.shipping.tracking")}{" "}
              <span className="font-semibold text-foreground">{order.me_tracking}</span>
            </p>
          )}
          {isMeShipping && order.me_protocol && (
            <p>{t("orders.shipping.protocol", { protocol: order.me_protocol })}</p>
          )}
        </div>
      )}

      {isMeShipping && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!order.me_order_id ? (
            <button
              onClick={() => void runMe("cart")}
              disabled={meBusy === "cart"}
              className="flex items-center gap-1 rounded-xl border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {meBusy === "cart" ? <Loader2 className="size-3 animate-spin" /> : null}
              {t("orders.actions.create")}
            </button>
          ) : (
            <>
              <button
                onClick={() => void runMe("checkout")}
                disabled={meBusy === "checkout"}
                className="flex items-center gap-1 rounded-xl border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {meBusy === "checkout" ? <Loader2 className="size-3 animate-spin" /> : null}
                {t("orders.actions.pay")}
              </button>
              <button
                onClick={() => void runMe("generate")}
                disabled={meBusy === "generate"}
                className="flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
              >
                {meBusy === "generate" ? <Loader2 className="size-3 animate-spin" /> : null}
                {t("orders.actions.generateLabel")}
              </button>
              <button
                onClick={() => void runMe("tracking")}
                disabled={meBusy === "tracking"}
                className="flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
              >
                {meBusy === "tracking" ? <Loader2 className="size-3 animate-spin" /> : null}
                {t("orders.actions.track")}
              </button>
              {order.me_label_url ? (
                <a
                  href={order.me_label_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
                >
                  {t("orders.actions.printLabel")}
                </a>
              ) : (
                <button
                  onClick={() => void runMe("print")}
                  disabled={meBusy === "print"}
                  className="flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
                >
                  {meBusy === "print" ? <Loader2 className="size-3 animate-spin" /> : null}
                  {t("orders.actions.printLabel")}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {deliveries.length > 0 && (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-accent/40 px-3 py-3">
          <p className="text-xs font-bold text-foreground">{t("orders.digital.title")}</p>
          {deliveries.map((delivery) => {
            const busy = deliveryBusy;
            return (
              <div
                key={delivery.id}
                className="space-y-1.5 rounded-lg bg-card px-3 py-2.5 text-xs text-muted-foreground"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    {delivery.products?.name ?? t("orders.digital.unknownProduct")}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                    {t(deliveryStatusLabel(delivery.status))}
                  </span>
                </div>
                <p>
                  {t("orders.digital.buyerEmail")}:{" "}
                  <span className="font-medium text-foreground">{delivery.customer_email}</span>
                </p>
                {delivery.approved_at && (
                  <p>
                    {t("orders.digital.approvedAt")}:{" "}
                    {formatDateTime(new Date(delivery.approved_at))}
                  </p>
                )}
                {delivery.sent_at && (
                  <p>
                    {t("orders.digital.sentAt")}: {formatDateTime(new Date(delivery.sent_at))}
                  </p>
                )}
                <p>
                  {t("orders.digital.attempts")}: {delivery.attempts}
                  {delivery.token
                    ? ` · ${t("orders.digital.downloads")}: ${delivery.token.used_count}/${delivery.token.max_uses}`
                    : ""}
                </p>
                {delivery.token?.expires_at && (
                  <p>
                    {t("orders.digital.expiresAt")}:{" "}
                    {formatDateTime(new Date(delivery.token.expires_at))}
                    {delivery.token.revoked_at ? ` · ${t("orders.digital.statusRevoked")}` : ""}
                  </p>
                )}
                {delivery.last_error && (
                  <p className="text-destructive">{t("orders.digital.lastError")}</p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void runDelivery("retry", delivery.id)}
                    className="rounded-lg border border-border bg-card px-2.5 py-1.5 font-semibold text-foreground disabled:opacity-50"
                  >
                    {busy === `retry:${delivery.id}` ? <Loader2 className="size-3 animate-spin" /> : null}
                    {t("orders.digital.resend")}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void runDelivery("regenerate", delivery.id)}
                    className="rounded-lg border border-border bg-card px-2.5 py-1.5 font-semibold text-foreground disabled:opacity-50"
                  >
                    {busy === `regenerate:${delivery.id}` ? <Loader2 className="size-3 animate-spin" /> : null}
                    {t("orders.digital.newLink")}
                  </button>
                  {!delivery.revoked_at && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void runDelivery("revoke", delivery.id)}
                      className="rounded-lg border border-border bg-card px-2.5 py-1.5 font-semibold text-destructive disabled:opacity-50"
                    >
                      {busy === `revoke:${delivery.id}` ? <Loader2 className="size-3 animate-spin" /> : null}
                      {t("orders.digital.revoke")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <p className="text-sm font-bold text-foreground">
          {t("orders.total", { value: money(order.total) })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("orders.dateAt", { date: formattedDate, time: formattedTime })}
        </p>
      </div>

      {order.note && (
        <p className="mt-2 rounded-xl bg-accent/50 px-3 py-2 text-xs text-muted-foreground">
          {order.note}
        </p>
      )}

      <div className="mt-3">
        <select
          value={order.status}
          onChange={(e) => onStatusChange(order.id, e.target.value)}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {STATUSES.map((s) => {
            const labelKey = STATUS_LABEL_KEYS[s];
            return (
              <option key={s} value={s}>
                {labelKey ? t(labelKey) : s}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}
