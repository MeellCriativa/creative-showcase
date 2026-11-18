import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { CURRENCIES, getCurrency, searchCurrencies, type CurrencyDef } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type CurrencyPickerProps = {
  value: string;
  onChange: (code: string) => void;
  /** Códigos que não podem ser escolhidos (ex.: moeda de origem no conversor). */
  disabledCodes?: string[];
  /** Moedas sem cotação disponível no momento. */
  unavailableCodes?: string[];
  label?: string;
  hint?: string;
  id?: string;
  className?: string;
};

function CurrencyRow({
  def,
  selected,
  disabled,
  unavailable,
  onSelect,
}: {
  def: CurrencyDef;
  selected: boolean;
  disabled: boolean;
  unavailable: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
        selected ? "bg-accent" : "hover:bg-muted",
        disabled && "opacity-40",
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
        {def.code}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{def.name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {def.symbol} · {def.countries[0] ?? t("forms.currencyPicker.international")}
          {unavailable ? ` · ${t("forms.currencyPicker.noRate")}` : ""}
        </span>
      </span>
      {selected && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

/** Seletor de moeda com pesquisa por nome, código ISO, símbolo ou país. */
export function CurrencyPicker({
  value,
  onChange,
  disabledCodes = [],
  unavailableCodes = [],
  label,
  hint,
  id,
  className,
}: CurrencyPickerProps) {
  const { t, tp } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const current = getCurrency(value);
  const results = useMemo(() => searchCurrencies(query), [query]);
  const disabledSet = useMemo(
    () => new Set(disabledCodes.map((c) => c.toUpperCase())),
    [disabledCodes],
  );
  const unavailableSet = useMemo(
    () => new Set(unavailableCodes.map((c) => c.toUpperCase())),
    [unavailableCodes],
  );

  function select(code: string) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <button
        type="button"
        id={id}
        onClick={() => setOpen(true)}
        className="input-base mt-1.5 flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">
            {current.code}
          </span>
          <span className="truncate text-sm">{current.name}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={t("forms.currencyPicker.dialogTitle")}
        >
          <div className="flex max-h-[85vh] w-full max-w-[30rem] flex-col overflow-hidden rounded-t-3xl bg-background sm:rounded-3xl">
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <p className="text-base font-bold text-foreground">
                {t("forms.currencyPicker.dialogTitle")}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("forms.currencyPicker.close")}
                className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 rounded-2xl border border-input bg-card px-3">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("forms.currencyPicker.searchPlaceholder")}
                  className="w-full bg-transparent py-3 text-sm outline-none"
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {tp("forms.currencyPicker.results", results.length, {
                  total: CURRENCIES.length,
                })}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-6">
              {results.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t("forms.currencyPicker.empty")}
                </p>
              )}
              {results.map((def) => (
                <CurrencyRow
                  key={def.code}
                  def={def}
                  selected={def.code === current.code}
                  disabled={disabledSet.has(def.code)}
                  unavailable={unavailableSet.has(def.code)}
                  onSelect={() => select(def.code)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
