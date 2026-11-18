/**
 * Seletor global de idiomas.
 *
 * - mostra bandeira + nome do idioma;
 * - dropdown acessível (Radix): teclado, foco visível, `aria-label`;
 * - responsivo: no mobile fica compacto (bandeira), com o nome a partir de `sm`;
 * - troca instantânea, sem reload e sem perder estado da página.
 */
import { ChevronDown, Languages } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { DEFAULT_LOCALE, LOCALES, LOCALE_META, normalizeLocale } from "./config.ts";
import { useI18n } from "./context.tsx";

type LanguageSelectorProps = {
  className?: string;
  align?: "start" | "center" | "end";
  /** Esconde o nome do idioma em telas pequenas (padrão: mostra a partir de `sm`). */
  compactOnMobile?: boolean;
  /** Variante visual para cabeçalhos claros/escuros. */
  tone?: "default" | "onPrimary";
};

export function LanguageSelector({
  className,
  align = "end",
  compactOnMobile = true,
  tone = "default",
}: LanguageSelectorProps) {
  const { t, locale, setLocale } = useI18n();
  const meta = LOCALE_META[locale] ?? LOCALE_META[DEFAULT_LOCALE];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${t("common.changeLanguage")} (${meta.nativeName})`}
          title={t("common.changeLanguage")}
          data-testid="language-selector"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1",
            tone === "onPrimary"
              ? "border-white/40 bg-white/15 text-white hover:bg-white/25"
              : "border-border bg-card text-foreground hover:bg-accent",
            className,
          )}
        >
          <span aria-hidden className="text-base leading-none">
            {meta.flag}
          </span>
          <span className={cn("truncate", compactOnMobile && "sr-only sm:not-sr-only")}>
            {meta.nativeName}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-48">
        <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Languages className="size-3.5" aria-hidden />
          {t("common.language")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => setLocale(normalizeLocale(value) ?? DEFAULT_LOCALE)}
          aria-label={t("common.language")}
        >
          {LOCALES.map((code) => (
            <DropdownMenuRadioItem key={code} value={code} className="gap-2">
              <span aria-hidden className="text-base leading-none">
                {LOCALE_META[code].flag}
              </span>
              <span className="flex-1">{LOCALE_META[code].nativeName}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {t("common.languageDescription")}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
