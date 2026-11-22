import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { createIsomorphicFn } from "@tanstack/react-start";

import { Toaster } from "@/components/ui/sonner";
import { DEFAULT_LOCALE, I18nProvider, LOCALE_META, useI18n, type Locale } from "@/i18n";
import { readServerLocale } from "@/i18n/server-locale.server";
import { readLocaleCookie } from "@/i18n/storage";

/**
 * Idioma inicial: cookie da requisição no servidor, o mesmo cookie em
 * `document.cookie` no cliente. Assim o HTML do SSR e a hidratação usam o
 * mesmo idioma — sem "flash" em português e sem erro de hidratação.
 * Nunca lê o idioma do navegador.
 */
const resolveInitialLocale = createIsomorphicFn()
  .client((): Locale => readLocaleCookie() ?? DEFAULT_LOCALE)
  .server((): Locale => readServerLocale() ?? DEFAULT_LOCALE);

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SITE_NAME, SITE_OG_IMAGE, SITE_OG_IMAGE_ALT, SITE_URL } from "../lib/site";
import { unlockNotificationAudio } from "@/lib/notificationSound";
import { registerPushServiceWorker } from "@/lib/pushNotifications";

function NotFoundContent() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("common.notFoundTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.notFoundText")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.backHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function NotFoundComponent() {
  // O boundary pode ser renderizado fora do provider do layout: garante idioma
  // e troca instantânea também na 404.
  return (
    <I18nProvider initialLocale={readLocaleCookie() ?? DEFAULT_LOCALE}>
      <NotFoundContent />
    </I18nProvider>
  );
}

function ErrorContent({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  const router = useRouter();

  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("common.errorTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.errorText")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.tryAgain")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("common.backHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);

  return (
    <I18nProvider initialLocale={readLocaleCookie() ?? DEFAULT_LOCALE}>
      <ErrorContent error={error} reset={reset} />
    </I18nProvider>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  /**
   * Idioma inicial resolvido no servidor (cookie da requisição) e no cliente
   * (mesmo cookie em `document.cookie`). Assim o HTML do SSR e a hidratação
   * usam o mesmo idioma: sem "flash" em português e sem erro de hidratação.
   * Nunca lê o idioma do navegador.
   */
  beforeLoad: () => ({ initialLocale: resolveInitialLocale() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Vitrine Criativa — catálogos digitais no WhatsApp" },
      {
        name: "description",
        content:
          "Crie seu catálogo digital, personalize sua vitrine e receba pedidos direto no WhatsApp.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: SITE_OG_IMAGE },
      { property: "og:image:type", content: "image/jpeg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: SITE_OG_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: SITE_OG_IMAGE },
      { name: "twitter:image:alt", content: SITE_OG_IMAGE_ALT },
      { name: "theme-color", content: "#8b5cf6" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&family=Caveat:wght@500;600;700&family=Fredoka:wght@500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500;600;700&family=Lora:wght@500;600;700&family=Playfair+Display:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Quicksand:wght@500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/favicon.png", type: "image/png", sizes: "256x256" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // Mesmo valor do provider (cookie) para o `<html lang>` já sair correto no
  // SSR, sem depender do efeito que roda depois da hidratação.
  const locale = resolveInitialLocale();

  return (
    <html lang={LOCALE_META[locale]?.intl ?? LOCALE_META[DEFAULT_LOCALE].intl}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient, initialLocale } = Route.useRouteContext();

  useEffect(() => {
    unlockNotificationAudio();
    void registerPushServiceWorker();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale={initialLocale}>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster position="top-center" richColors />
      </I18nProvider>
    </QueryClientProvider>
  );
}
