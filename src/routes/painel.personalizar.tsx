import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { slugify } from "@/lib/catalog";
import { EmptyCatalog } from "./painel.categorias";

export const Route = createFileRoute("/painel/personalizar")({
  component: PersonalizarPage,
});

const palettes = [
  { primary: "#d1477a", accent: "#fdf2f6", label: "Rosa" },
  { primary: "#b45309", accent: "#fef3c7", label: "Âmbar" },
  { primary: "#0f766e", accent: "#ccfbf1", label: "Verde" },
  { primary: "#4338ca", accent: "#e0e7ff", label: "Índigo" },
  { primary: "#1f2937", accent: "#f3f4f6", label: "Grafite" },
  { primary: "#be123c", accent: "#ffe4e6", label: "Vermelho" },
];

function PersonalizarPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: catalog } = useMyCatalog(user?.id);

  const [storeName, setStoreName] = useState("");
  const [slug, setSlug] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [logo, setLogo] = useState<string[]>([]);
  const [cover, setCover] = useState<string[]>([]);
  const [primary, setPrimary] = useState("#d1477a");
  const [accent, setAccent] = useState("#fdf2f6");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!catalog) return;
    setStoreName(catalog.store_name);
    setSlug(catalog.slug);
    setWhatsapp(catalog.whatsapp ?? "");
    setLogo(catalog.logo_url ? [catalog.logo_url] : []);
    setCover(catalog.cover_url ? [catalog.cover_url] : []);
    setPrimary(catalog.primary_color);
    setAccent(catalog.accent_color);
  }, [catalog]);

  if (!catalog || !user) return <EmptyCatalog />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase
      .from("catalogs")
      .update({
        store_name: storeName.trim(),
        slug: slugify(slug) || catalog!.slug,
        whatsapp: whatsapp.trim() || null,
        logo_url: logo[0] ?? null,
        cover_url: cover[0] ?? null,
        primary_color: primary,
        accent_color: accent,
      })
      .eq("id", catalog!.id);
    setSaving(false);
    if (error) {
      toast.error(
        error.code === "23505" ? "Esse endereço de link já está em uso." : "Erro ao salvar.",
      );
      return;
    }
    toast.success("Vitrine atualizada!");
    void queryClient.invalidateQueries({ queryKey: ["my-catalog"] });
  }

  return (
    <form onSubmit={save} className="px-5 pb-10 pt-10">
      <h1 className="text-2xl font-bold text-foreground">Personalizar vitrine</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Deixe o catálogo com a cara da sua marca.
      </p>

      <Field label="Nome da loja">
        <input
          required
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          className="input-base"
        />
      </Field>

      <Field label="Endereço do link" hint={`/c/${slugify(slug) || catalog.slug}`}>
        <input value={slug} onChange={(e) => setSlug(e.target.value)} className="input-base" />
      </Field>

      <Field label="WhatsApp para receber pedidos" hint="Ex.: 11988887777 (com DDD)">
        <input
          inputMode="numeric"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="11988887777"
          className="input-base"
        />
      </Field>

      <Field label="Logotipo">
        <ImageUploader
          userId={user.id}
          value={logo}
          onChange={setLogo}
          max={1}
          shape="circle"
          label="Logo"
        />
      </Field>

      <Field label="Foto de capa">
        <ImageUploader
          userId={user.id}
          value={cover}
          onChange={setCover}
          max={1}
          shape="wide"
          label="Capa"
        />
      </Field>

      <Field label="Cores do catálogo">
        <div className="grid grid-cols-3 gap-2">
          {palettes.map((p) => {
            const active = p.primary === primary;
            return (
              <button
                type="button"
                key={p.primary}
                onClick={() => {
                  setPrimary(p.primary);
                  setAccent(p.accent);
                }}
                className={`rounded-2xl border p-3 text-xs font-semibold ${
                  active ? "border-primary" : "border-border"
                }`}
              >
                <span
                  className="mb-2 block h-6 w-full rounded-lg"
                  style={{ background: p.primary }}
                />
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
          <label className="flex items-center gap-2">
            Principal
            <input
              type="color"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              className="size-8 rounded-lg border border-border bg-card"
            />
          </label>
          <label className="flex items-center gap-2">
            Fundo
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="size-8 rounded-lg border border-border bg-card"
            />
          </label>
        </div>
      </Field>

      <button
        type="submit"
        disabled={saving}
        className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground shadow-lg shadow-primary/25 disabled:opacity-60"
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        Salvar alterações
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </div>
  );
}
