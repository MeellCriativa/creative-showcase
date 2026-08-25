import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { EmptyCatalog } from "./painel.categorias";

export const Route = createFileRoute("/painel/estatisticas")({
  component: EstatisticasPage,
});

function startOfDay(d: Date) {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t;
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

type VisitRow = { visited_at: string };

function EstatisticasPage() {
  const { user } = useAuth();
  const { data: catalog } = useMyCatalog(user?.id);

  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }, []);

  const { data: visits, isLoading } = useQuery<VisitRow[]>({
    queryKey: ["visits", catalog?.id],
    enabled: !!catalog,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_visits")
        .select("visited_at")
        .eq("catalog_id", catalog!.id)
        .gte("visited_at", thirtyDaysAgo);
      if (error) throw error;
      return (data ?? []) as VisitRow[];
    },
  });

  const now = useMemo(() => new Date(), []);

  const todayCount = useMemo(() => {
    if (!visits) return 0;
    const todayStr = toISODate(now);
    return visits.filter((v) => v.visited_at.slice(0, 10) === todayStr).length;
  }, [visits, now]);

  const sevenDaysCount = useMemo(() => {
    if (!visits) return 0;
    const cutoff = startOfDay(now);
    cutoff.setDate(cutoff.getDate() - 6);
    const cutoffStr = toISODate(cutoff);
    return visits.filter((v) => v.visited_at.slice(0, 10) >= cutoffStr).length;
  }, [visits, now]);

  const last14Days = useMemo(() => {
    const days: { date: string; label: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = toISODate(d);
      const label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const count = (visits ?? []).filter((v) => v.visited_at.slice(0, 10) === iso).length;
      days.push({ date: iso, label, count });
    }
    return days;
  }, [visits, now]);

  const maxBar = Math.max(...last14Days.map((d) => d.count), 1);

  if (!catalog) return <EmptyCatalog />;

  return (
    <div className="px-5 pb-10 pt-10">
      <h1 className="text-2xl font-bold text-foreground">Estatísticas</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Veja quantas pessoas visitaram seu catálogo nos últimos dias.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={String(visits?.length ?? 0)} />
        <StatCard label="Hoje" value={String(todayCount)} />
        <StatCard label="Últimos 7 dias" value={String(sevenDaysCount)} />
        <StatCard label="Últimos 30 dias" value={String(visits?.length ?? 0)} />
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Visitas — últimos 14 dias</h2>
        {isLoading && <Loader2 className="mx-auto size-5 animate-spin text-primary" />}
        {!isLoading && (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1.5" style={{ minHeight: 100 }}>
              {last14Days.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center" style={{ minWidth: 32 }}>
                  <span className="mb-1 text-[10px] text-muted-foreground">{d.count}</span>
                  <div
                    className="w-full rounded-t-md bg-primary"
                    style={{ height: `${(d.count / maxBar) * 80}px`, minHeight: d.count > 0 ? 4 : 0 }}
                  />
                  <span className="mt-1 text-[10px] text-muted-foreground">{d.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
