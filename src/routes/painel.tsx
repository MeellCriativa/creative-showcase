import { useEffect } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2, LayoutGrid, Package, Palette, Store } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/painel")({
  head: () => ({
    meta: [
      { title: "Painel da loja — Vitrine Criativa" },
      { name: "description", content: "Gerencie seu catálogo, produtos, categorias e personalização." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PainelLayout,
});

const tabs = [
  { to: "/painel", label: "Início", icon: LayoutGrid, exact: true },
  { to: "/painel/produtos", label: "Produtos", icon: Package },
  { to: "/painel/categorias", label: "Categorias", icon: Store },
  { to: "/painel/personalizar", label: "Vitrine", icon: Palette },
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
        <ul className="grid grid-cols-4">
          {tabs.map((tab) => {
            const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  className={cn(
                    "flex flex-col items-center gap-1 py-3 text-[11px] font-medium",
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
