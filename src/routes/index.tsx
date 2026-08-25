import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Heart, MessageCircle, Palette, ShoppingBag, Sparkles } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vitrine Criativa — seu catálogo digital com pedidos no WhatsApp" },
      {
        name: "description",
        content:
          "Monte seu catálogo de produtos pelo celular, personalize a vitrine e receba pedidos prontos no WhatsApp. Seu cliente compra sem criar conta.",
      },
      { property: "og:title", content: "Vitrine Criativa — catálogo digital no WhatsApp" },
      {
        property: "og:description",
        content: "Crie, personalize e compartilhe seu catálogo. Pedidos chegam prontinhos no WhatsApp.",
      },
    ],
  }),
  component: Home,
});

const features = [
  { icon: ShoppingBag, title: "Catálogo próprio", text: "Produtos, fotos, preços e variações." },
  { icon: Palette, title: "Sua identidade", text: "Logo, capa e cores da sua marca." },
  { icon: MessageCircle, title: "Pedido no zap", text: "Mensagem pronta, é só enviar." },
];

function Home() {
  const { session } = useAuth();

  return (
    <main className="app-shell relative overflow-hidden px-5 pb-14 pt-12">
      <div className="pointer-events-none absolute -left-24 -top-24 size-64 rounded-full bg-accent blur-3xl" />

      <div className="relative">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
          <Sparkles className="size-3.5" /> feito para vender pelo celular
        </span>

        <h1 className="mt-5 text-[2.6rem] leading-[1.05] font-bold text-foreground">
          Vitrine
          <br />
          <span className="text-primary">Criativa</span>
        </h1>

        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          Crie seu catálogo digital, personalize sua vitrine e compartilhe um único link. Seus
          clientes escolhem os produtos e o pedido chega prontinho no seu WhatsApp.
        </p>

        <Link
          to={session ? "/painel" : "/auth"}
          className="btn-float mt-7 flex w-full items-center justify-center gap-2 bg-primary px-5 py-4 text-base font-semibold text-primary-foreground"
        >
          {session ? "Ir para o meu painel" : "Começar agora"}
          <ArrowRight className="size-5" />
        </Link>

        <div className="mt-10 space-y-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                <f.icon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {f.title}
                  <Heart
                    aria-hidden
                    className="ml-1 inline size-3 translate-y-px fill-primary/45 text-primary/45"
                  />
                </p>
                <p className="text-sm text-muted-foreground">{f.text}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Seu cliente não precisa criar conta para comprar.
        </p>
      </div>
    </main>
  );
}
