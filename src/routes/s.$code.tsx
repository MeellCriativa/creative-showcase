import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { normalizeShortCode } from "@/lib/shortLink";

export const Route = createFileRoute("/s/$code")({
  head: () => ({
    meta: [
      { title: "Abrindo vitrine — Vitrine Criativa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ params }) => {
    const code = normalizeShortCode(params.code);
    if (!code) return { slug: null };

    try {
      const { data } = await supabase
        .from("store_short_links_public")
        .select("slug")
        .eq("short_code", code)
        .maybeSingle();
      if (data?.slug) {
        throw redirect({ href: `/c/${data.slug}`, replace: true, statusCode: 302 });
      }
    } catch (error) {
      // Um redirect é um throw esperado; qualquer outro erro cai na tela amigável.
      if (error instanceof Response) throw error;
      console.warn("[link-curto] falha ao resolver código:", error);
    }
    return { slug: null };
  },
  component: InvalidShortLinkPage,
});

function InvalidShortLinkPage() {
  const { t } = useI18n();
  return (
    <main className="app-shell grid min-h-[70vh] place-items-center px-6 text-center">
      <div>
        <p className="text-5xl">🔗</p>
        <h1 className="mt-4 text-xl font-bold text-foreground">
          {t("catalog.errors.invalidShortLink")}
        </h1>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
        >
          {t("common.backHome")} <ExternalLink className="size-4" aria-hidden />
        </Link>
      </div>
    </main>
  );
}
