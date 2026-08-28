import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { formatBRL } from "@/lib/catalog";
import { EmptyCatalog } from "./painel.categorias";

export const Route = createFileRoute("/painel/pedidos")({
  component: PedidosPage,
});

type OrderItem = { name: string; quantity: number; unitPrice: number; variation?: string };
type OrderRow = {
  id: string;
  catalog_id: string;
  customer_name: string;
  customer_phone: string | null;
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
  status: string;
  created_at: string;
};

const STATUSES = ["novo", "confirmado", "em_preparacao", "pronto", "finalizado", "cancelado"] as const;

const STATUS_LABELS: Record<string, string> = {
  novo: "Novo",
  confirmado: "Confirmado",
  em_preparacao: "Em preparação",
  pronto: "Pronto",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
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

  const filtered = (orders ?? []).filter((o) => {
    if (filter === "hoje") return isToday(o.created_at);
    if (filter === "pendentes") return PENDING_STATUSES.includes(o.status);
    if (filter === "finalizados") return o.status === "finalizado";
    return true;
  });

  const todayCount = (orders ?? []).filter((o) => isToday(o.created_at)).length;
  const pendingCount = (orders ?? []).filter((o) => PENDING_STATUSES.includes(o.status)).length;
  const finishedCount = (orders ?? []).filter((o) => o.status === "finalizado").length;
  const totalRevenue = (orders ?? [])
    .filter((o) => o.status !== "cancelado")
    .reduce((sum, o) => sum + (o.total ?? 0), 0);

  async function updateStatus(orderId: string, status: string) {
    const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
    if (error) {
      toast.error("Erro ao atualizar status.");
    } else {
      void queryClient.invalidateQueries({ queryKey: ["orders", catalog?.id] });
    }
  }

  if (!catalog) return <EmptyCatalog />;

  return (
    <div className="px-5 pb-10 pt-10">
      <h1 className="text-2xl font-bold text-foreground">Pedidos</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Acompanhe e gerencie os pedidos recebidos pelo seu catálogo.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Hoje" value={String(todayCount)} />
        <StatCard label="Pendentes" value={String(pendingCount)} />
        <StatCard label="Finalizados" value={String(finishedCount)} />
        <StatCard label="Total (R$)" value={formatBRL(totalRevenue)} />
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {(
          [
            { key: "todos", label: "Todos" },
            { key: "hoje", label: "Hoje" },
            { key: "pendentes", label: "Pendentes" },
            { key: "finalizados", label: "Finalizados" },
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
            Nenhum pedido encontrado.
          </p>
        )}
        {filtered.map((order) => (
          <OrderCard key={order.id} order={order} onStatusChange={updateStatus} />
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
  onStatusChange,
}: {
  order: OrderRow;
  onStatusChange: (id: string, status: string) => void;
}) {
  const dt = new Date(order.created_at);
  const formattedDate = dt.toLocaleDateString("pt-BR");
  const formattedTime = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{order.customer_name}</p>
          {order.customer_phone && (
            <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[order.status] ?? "bg-muted text-muted-foreground"}`}>
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      <ul className="mt-3 space-y-1">
        {order.items.map((item, idx) => (
          <li key={idx} className="text-sm text-foreground">
            <span className="font-medium">{item.quantity}x</span> {item.name}
            {item.variation && <span className="text-muted-foreground"> ({item.variation})</span>}
            <span className="ml-1 text-muted-foreground">— {formatBRL(item.unitPrice * item.quantity)}</span>
          </li>
        ))}
      </ul>

      {order.delivery_method && (
        <div className="mt-3 rounded-xl bg-accent/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
          {order.delivery_method === "correios" && (
            <p className="font-semibold text-foreground">📦 Envio pelos Correios</p>
          )}
          {order.delivery_method === "local_pickup" && (
            <p className="font-semibold text-foreground">🏪 Retirada no local</p>
          )}
          {order.delivery_method === "local_delivery" && (
            <p className="font-semibold text-foreground">🛵 Entrega local</p>
          )}
          {order.shipping_service_name && <p>Modalidade: {order.shipping_service_name}</p>}
          {order.shipping_cost != null && order.shipping_cost > 0 && (
            <p>Frete: {formatBRL(order.shipping_cost)}</p>
          )}
          {order.shipping_eta_text && <p>Prazo: {order.shipping_eta_text}</p>}
          {order.shipping_zip && <p>CEP: {order.shipping_zip}</p>}
          {(order.customer_street || order.customer_city) && (
            <p>
              {[order.customer_street, order.customer_number].filter(Boolean).join(", ")}
              {order.customer_complement ? ` - ${order.customer_complement}` : ""}
              {[
                order.customer_district,
                order.customer_city,
                order.customer_state,
              ]
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
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <p className="text-sm font-bold text-foreground">Total: {formatBRL(order.total)}</p>
        <p className="text-xs text-muted-foreground">
          {formattedDate} às {formattedTime}
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
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
