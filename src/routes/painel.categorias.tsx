import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCategories, useMyCatalog } from "@/hooks/useCatalog";
import type { Category } from "@/lib/catalog";

export const Route = createFileRoute("/painel/categorias")({
  component: CategoriasPage,
});

function CategoriasPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: catalog } = useMyCatalog(user?.id);
  const { data: categories, isLoading } = useCategories(catalog?.id);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["categories", catalog?.id] });

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catalog || !name.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("categories").insert({
      catalog_id: catalog.id,
      name: name.trim(),
      position: categories?.length ?? 0,
    });
    setBusy(false);
    if (error) {
      toast.error("Não foi possível criar a categoria.");
      return;
    }
    setName("");
    void refresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir.");
    else void refresh();
  }

  async function move(list: Category[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const a = list[index]!;
    const b = list[target]!;
    await Promise.all([
      supabase.from("categories").update({ position: target }).eq("id", a.id),
      supabase.from("categories").update({ position: index }).eq("id", b.id),
    ]);
    void refresh();
  }

  if (!catalog) {
    return <EmptyCatalog />;
  }

  return (
    <div className="px-5 pb-10 pt-10">
      <h1 className="text-2xl font-bold text-foreground">Categorias</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Organize seus produtos em grupos, como “Agendas” ou “Papelaria”.
      </p>

      <form onSubmit={addCategory} className="mt-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome da categoria"
          className="min-w-0 flex-1 rounded-2xl border border-input bg-card px-4 py-3 text-base outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={busy}
          className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground disabled:opacity-60"
          aria-label="Adicionar categoria"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
        </button>
      </form>

      <div className="mt-6 space-y-2">
        {isLoading && <Loader2 className="mx-auto size-5 animate-spin text-primary" />}
        {categories?.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nenhuma categoria ainda.
          </p>
        )}
        {categories?.map((cat, index) => (
          <div
            key={cat.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-border bg-card p-3"
          >
            <p className="truncate font-medium text-foreground">{cat.name}</p>
            <div className="flex shrink-0 items-center gap-1">
              <IconBtn label="Subir" onClick={() => move(categories, index, -1)}>
                <ArrowUp className="size-4" />
              </IconBtn>
              <IconBtn label="Descer" onClick={() => move(categories, index, 1)}>
                <ArrowDown className="size-4" />
              </IconBtn>
              <IconBtn label="Excluir" onClick={() => remove(cat.id)} danger>
                <Trash2 className="size-4" />
              </IconBtn>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid size-9 place-items-center rounded-xl border border-border ${
        danger ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function EmptyCatalog() {
  return (
    <div className="px-5 pt-16 text-center">
      <p className="text-sm text-muted-foreground">
        Crie seu catálogo na aba Início antes de continuar.
      </p>
    </div>
  );
}
