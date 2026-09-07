import { useEffect } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { BarChart3, ClipboardList, LayoutGrid, Loader2, MessageCircle, Package, Palette, Store, Truck } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/painel")({
  head: () => ({
    meta: [
      { title: "Painel da loja — Vitrine Criativa" },
      { name: "description", content: "Gerencie seu catálogo, produtos, pedidos e personalização." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PainelLayout,
});

const tabs = [
  { to: "/painel", label: "Inicio", icon: LayoutGrid, exact: true },
  { to: "/painel/produtos", label: "Produtos", icon: Package, exact: false },
  { to: "/painel/categorias", label: "Categorias", icon: Store, exact: false },
  { to: "/painel/pedidos", label: "Pedidos", icon: ClipboardList, exact: false },
  { to: "/painel/personalizar", label: "Vitrine", icon: Palette, exact: false },
  { to: "/painel/whatsapp", label: "WhatsApp", icon: MessageCircle, exact: false },
  { to: "/painel/envio", label: "Envio", icon: Truck, exact: false },
  { to: "/painel/estatisticas", label: "Estatisticas", icon: BarChart3, exact: false },
] as const;

function PainelLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="app-shell grid place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="app-shell pb-24">
      <Outlet />

      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-[30rem] -translate-x-1/2 border-t border-border bg-card/95 backdrop-blur">
        <ul className="grid grid-cols-8">
          {tabs.map((tab) => {
            const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  className={cn(
                    "flex flex-col items-center gap-0.5 py-3 text-[10px] font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <tab.icon className="size-5" />
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
