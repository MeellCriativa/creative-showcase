import { useEffect } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { BarChart3, ClipboardList, CreditCard, LayoutGrid, Loader2, MessageCircle, Package, Palette, Store, Truck } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { LanguageSelector, useI18n } from "@/i18n";
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
  { to: "/painel", labelKey: "panel.nav.home", icon: LayoutGrid, exact: true },
  { to: "/painel/produtos", labelKey: "panel.nav.products", icon: Package, exact: false },
  { to: "/painel/categorias", labelKey: "panel.nav.categories", icon: Store, exact: false },
  { to: "/painel/pedidos", labelKey: "panel.nav.orders", icon: ClipboardList, exact: false },
  { to: "/painel/personalizar", labelKey: "panel.nav.customize", icon: Palette, exact: false },
  { to: "/painel/whatsapp", labelKey: "panel.nav.whatsapp", icon: MessageCircle, exact: false },
  { to: "/painel/envio", labelKey: "panel.nav.shipping", icon: Truck, exact: false },
  { to: "/painel/pagamentos", labelKey: "panel.nav.payments", icon: CreditCard, exact: false },
  { to: "/painel/estatisticas", labelKey: "panel.nav.stats", icon: BarChart3, exact: false },
] as const;

function PainelLayout() {
  const { session, loading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="app-shell grid place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-label={t("common.loading")} />
      </div>
    );
  }

  return (
    <div className="app-shell pb-20">
      {/* Primeira linha do painel: seletor de idioma sempre visível, no topo à direita. */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-card/95 px-4 py-2 backdrop-blur">
        <span className="truncate text-sm font-semibold text-foreground">{t("common.panel")}</span>
        <LanguageSelector />
      </header>

      <Outlet />

      <nav
        aria-label={t("panel.nav.mainNavigation")}
        className="fixed bottom-0 left-1/2 z-40 w-full max-w-[30rem] -translate-x-1/2 border-t border-border bg-card/95 backdrop-blur"
      >
        <ul className="flex flex-nowrap px-0.5 py-1.5">
          {tabs.map((tab) => {
            const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
            return (
              <li key={tab.to} className="flex min-w-0 flex-1 justify-center">
                <Link
                  to={tab.to}
                  className={cn(
                    "flex min-w-0 flex-col items-center gap-0.5 py-1 text-[clamp(6px,1.9vw,9px)] font-medium leading-tight tracking-[-0.03em]",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <tab.icon className="size-4" aria-hidden />
                  <span className="whitespace-nowrap">{t(tab.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
