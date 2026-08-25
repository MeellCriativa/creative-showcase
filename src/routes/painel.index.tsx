import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ClipboardList,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  LogOut,
  Package,
  Palette,
  Share2,
  Store,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog, useProducts } from "@/hooks/useCatalog";
import { slugify } from "@/lib/catalog";

export const Route = createFileRoute("/painel/")({
  component: PainelHome,
});

function PainelHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: catalog, isLoading } = useMyCatalog(user?.id);
  const { data: products } = useProducts(catalog?.id);

  const [storeName, setStoreName] = useState("");
  const [creating, setCreating] = useState(false);

  async function createCatalog(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setCreating(true);
    try {
      const base = slugify(storeName) || "minha-loja";
      const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
      const { error } = await supabase
        .from("catalogs")
        .insert({ user_id: user.id, slug, store_name: storeName.trim() });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["my-catalog"] });
      toast.success("Catálogo criado! Agora adicione seus produtos.");
    } catch {
      toast.error("Não foi possível criar o catálogo.");
    } finally {
      setCreating(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  if (isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="px-5 pb-10 pt-12">
        <h1 className="text-3xl font-bold text-foreground">Criar catálogo</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Vamos começar pelo nome da sua loja. Você pode mudar depois.
        </p>
        <form onSubmit={createCatalog} className="mt-8 space-y-4">
          <input
            required
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="Ex.: Ateliê da Ana"
            className="w-full rounded-2xl border border-input bg-card px-4 py-3.5 text-base outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={creating}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground shadow-lg shadow-primary/25 disabled:opacity-60"
          >
            {creating && <Loader2 className="size-4 animate-spin" />}
            Criar minha vitrine
          </button>
        </form>
      </div>
    );
  }

  const link =
    typeof window !== "undefined" ? `${window.location.origin}/c/${catalog.slug}` : `/c/${catalog.slug}`;
  const message = `\u{1F49C} Venha ver meu catálogo\n${link}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copiado!");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  async function shareLink() {
    if (navigator.share) {
      try {
        await navigator.share({ title: catalog!.store_name, text: message, url: link });
        return;
      } catch {
        /* cancelado */
      }
    }
    void copyLink();
  }

  return (
    <div className="px-5 pb-10 pt-10">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Painel da loja
          </p>
          <h1 className="truncate text-2xl font-bold text-foreground">{catalog.store_name}</h1>
        </div>
        <button
          onClick={logout}
          aria-label="Sair"
          className="grid size-10 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </header>

      <section className="mt-6 rounded-3xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">Link da minha loja</p>
        <p className="mt-1 truncate rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          {link}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={copyLink}
            className="flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-semibold text-foreground"
          >
            <Copy className="size-4" /> Copiar
          </button>
          <button
            onClick={shareLink}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            <Share2 className="size-4" /> Compartilhar
          </button>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-[11px] font-medium text-muted-foreground">
          <a
            className="rounded-xl border border-border py-2 text-center"
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
          <a
            className="rounded-xl border border-border py-2 text-center"
            href={`https://t.me/share/url?url=${encodeURIComponent(link)}`}
            target="_blank"
            rel="noreferrer"
          >
            Telegram
          </a>
          <a
            className="rounded-xl border border-border py-2 text-center"
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`}
            target="_blank"
            rel="noreferrer"
          >
            Facebook
          </a>
          <button onClick={copyLink} className="rounded-xl border border-border py-2 text-center">
            Instagram
          </button>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-2xl font-bold text-foreground">{products?.length ?? 0}</p>
          <p className="text-xs text-muted-foreground">produtos cadastrados</p>
        </div>
        <a
          href={`/c/${catalog.slug}`}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col justify-center rounded-2xl bg-accent p-4 text-accent-foreground"
        >
          <Eye className="size-5" />
          <p className="mt-1 text-sm font-semibold">Visualizar catálogo</p>
        </a>
      </div>

      <nav className="mt-4 space-y-3">
        <ShortcutLink to="/painel/produtos" icon={Package} title="Produtos" text="Adicionar, editar e ordenar" />
        <ShortcutLink to="/painel/categorias" icon={Store} title="Categorias" text="Organize sua vitrine" />
        <ShortcutLink to="/painel/pedidos" icon={ClipboardList} title="Pedidos" text="Acompanhe os pedidos" />
        <ShortcutLink
          to="/painel/personalizar"
          icon={Palette}
          title="Personalizar"
          text="Logo, fonte, cores, carrinho e banners"
        />
        <ShortcutLink to="/painel/estatisticas" icon={BarChart3} title="Estatísticas" text="Visitas ao catálogo" />
      </nav>
    </div>
  );
}

function ShortcutLink({
  to,
  icon: Icon,
  title,
  text,
}: {
  to: string;
  icon: typeof Package;
  title: string;
  text: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
      <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
