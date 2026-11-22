import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeftRight, Check, Copy, Info, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { CurrencyPicker } from "@/components/CurrencyPicker";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { useCurrencyRates, useRefreshCurrencyRates } from "@/hooks/useRates";
import { useI18n } from "@/i18n";
import {
  CURRENCIES,
  convertAmount,
  formatMoney,
  formatRate,
  getCurrency,
  parseAmount,
  resolveStoreCurrency,
} from "@/lib/currency";

import { writeToClipboard } from "@/lib/clipboard";

export const Route = createFileRoute("/painel/conversor")({
  head: () => ({
    meta: [
      { title: "Conversor de moedas — Vitrine Criativa" },
      {
        name: "description",
        content: "Converta valores entre moedas internacionais com cotação de referência.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConversorPage,
});

function ConversorPage() {
  const { t, tp, formatDate } = useI18n();
  const { user } = useAuth();
  const { data: catalog } = useMyCatalog(user?.id);
  const storeCurrency = resolveStoreCurrency(catalog?.currency);

  const [amountInput, setAmountInput] = useState("202,40");
  const [from, setFrom] = useState("BRL");
  const [to, setTo] = useState("CHF");
  const [copied, setCopied] = useState(false);

  const ratesQuery = useCurrencyRates();
  const refresh = useRefreshCurrencyRates();

  const rates = ratesQuery.data?.ok ? ratesQuery.data.rates : null;
  const unavailableCodes = useMemo(() => {
    if (!rates) return [];
    return CURRENCIES.filter((c) => !(c.code in rates)).map((c) => c.code);
  }, [rates]);

  const amount = parseAmount(amountInput);
  const conversion = amount != null && rates ? convertAmount(amount, from, to, rates) : null;

  const fromDef = getCurrency(from);
  const toDef = getCurrency(to);

  const updatedAt = ratesQuery.data?.updatedAt ?? null;
  const fetchedAt = ratesQuery.data?.fetchedAt ?? null;
  const stale = ratesQuery.data?.stale ?? false;
  const providerLabel = ratesQuery.data?.providerLabel ?? null;
  const apiError = ratesQuery.data && !ratesQuery.data.ok ? ratesQuery.data.error : null;

  /**
   * Data/hora da cotação no idioma atual, no mesmo fuso da fonte (o instante
   * recebido não muda). O fuso fixo mantém o texto igual no servidor e no
   * navegador, sem diferença na hidratação.
   */
  function formatRateDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    const formatted = formatDate(iso, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
    return formatted || "—";
  }

  function swap() {
    setFrom(to);
    setTo(from);
  }

  function useStoreCurrencyAsOrigin() {
    setFrom(storeCurrency);
    if (to === storeCurrency) {
      setTo(storeCurrency === "BRL" ? "USD" : "BRL");
    }
  }

  async function copyResult() {
    if (!conversion) return;
    const lines = [`${formatMoney(conversion.value, conversion.to)} (${conversion.to})`];
    lines.push(`1 ${conversion.from} = ${formatRate(conversion.rate, conversion.to)}`);
    if (updatedAt) lines.push(t("converter.copyReference", { date: formatRateDate(updatedAt) }));
    lines.push(t("converter.disclaimer"));
    const ok = await writeToClipboard(lines.join("\n"));
    if (ok) {
      setCopied(true);
      toast.success(t("converter.copySuccess"));
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t("converter.copyError"));
    }
  }

  async function refreshRates() {
    try {
      const result = await refresh.mutateAsync();
      if (result.stale) {
        toast.warning(t("converter.offlineWarning"));
      } else if (result.ok) {
        toast.success(t("converter.refreshSuccess"));
      } else {
        toast.error(t("converter.refreshError"));
      }
    } catch {
      toast.error(t("converter.refreshError"));
    }
  }

  return (
    <div className="px-5 pb-10 pt-10">
      <h1 className="text-2xl font-bold text-foreground">{t("converter.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("converter.subtitle")}</p>

      {catalog && (
        <button
          type="button"
          onClick={useStoreCurrencyAsOrigin}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-primary"
        >
          <Info className="size-3.5" />
          {t("converter.storeCurrency", {
            code: storeCurrency,
            name: getCurrency(storeCurrency).name,
          })}
        </button>
      )}

      {/* ── Valor ── */}
      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        <label htmlFor="conversor-valor" className="text-sm font-medium text-foreground">
          {t("converter.amountLabel")}
        </label>
        <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-input bg-background px-3">
          <span className="shrink-0 text-sm font-semibold text-muted-foreground">
            {fromDef.symbol}
          </span>
          <input
            id="conversor-valor"
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder={t("converter.amountPlaceholder")}
            className="w-full bg-transparent py-3.5 text-2xl font-bold text-foreground outline-none"
          />
        </div>
        {amountInput.trim() !== "" && amount == null && (
          <p className="mt-1.5 text-xs text-red-500">{t("converter.invalidAmount")}</p>
        )}
        {amount != null && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {formatMoney(amount, from)} ·{" "}
            {fromDef.decimals === 0
              ? t("converter.noDecimals")
              : tp("converter.decimals", fromDef.decimals)}
          </p>
        )}
      </div>

      {/* ── Moedas ── */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        {/* O painel vive em uma coluna de 30rem, então "De → Para" fica sempre
            empilhado (mesmo layout do celular) para os nomes das moedas
            aparecerem inteiros, sem corte nem sobreposição. */}
        <div className="grid gap-4">
          <CurrencyPicker
            id="conversor-origem"
            label={t("converter.sourceLabel")}
            value={from}
            onChange={setFrom}
            unavailableCodes={unavailableCodes}
            className="min-w-0"
          />
          <button
            type="button"
            onClick={swap}
            aria-label={t("converter.swap")}
            className="mx-auto grid size-11 place-items-center rounded-full border border-border bg-background text-primary transition active:scale-95"
          >
            <ArrowLeftRight className="size-5" />
          </button>
          <CurrencyPicker
            id="conversor-destino"
            label={t("converter.targetLabel")}
            value={to}
            onChange={setTo}
            disabledCodes={[from]}
            unavailableCodes={unavailableCodes}
            className="min-w-0"
          />
        </div>
      </div>

      {/* ── Resultado ── */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/12 via-accent to-background p-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
          {t("converter.result")}
        </p>

        {ratesQuery.isLoading ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("converter.loadingRates")}
          </div>
        ) : apiError ? (
          <div className="mt-3 space-y-2">
            <p className="flex items-start gap-2 text-sm font-semibold text-red-600">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {t("converter.ratesUnavailable")}
            </p>
            <p className="text-xs text-muted-foreground">{t("converter.ratesUnavailableHint")}</p>
            <button
              type="button"
              onClick={refreshRates}
              disabled={refresh.isPending}
              className="mt-1 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {refresh.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {t("common.tryAgain")}
            </button>
          </div>
        ) : conversion ? (
          <>
            <p className="mt-1 break-words text-3xl font-bold text-foreground">
              {formatMoney(conversion.value, to)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatMoney(amount ?? 0, from)} ({from}) = {formatMoney(conversion.value, to)} ({to})
            </p>
            {toDef.decimals === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("converter.noDecimalsNote", { code: toDef.code })}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyResult}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? t("converter.copied") : t("converter.copyResult")}
              </button>
              <button
                type="button"
                onClick={refreshRates}
                disabled={refresh.isPending}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-xs font-semibold text-foreground disabled:opacity-60"
              >
                {refresh.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {t("converter.refreshRates")}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {amount == null
              ? t("converter.enterAmount")
              : t("converter.noRateForPair", { from, to })}
          </p>
        )}
      </div>

      {/* ── Cotação utilizada ── */}
      {conversion && rates && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-semibold text-foreground">{t("converter.rateUsed")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("converter.rateLine", {
              from: conversion.from,
              rate: formatRate(conversion.rate, conversion.to),
            })}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("converter.rateLine", {
              from: conversion.to,
              rate: formatRate(1 / conversion.rate, conversion.from),
            })}
          </p>
          <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
            <p>
              {t("converter.referenceRate", { date: formatRateDate(updatedAt) })}
              {providerLabel ? ` · ${providerLabel}` : ""}
            </p>
            <p>{t("converter.checkedAt", { date: formatRateDate(fetchedAt) })}</p>
            {ratesQuery.data?.cached && <p>{t("converter.fromCache")}</p>}
          </div>
          {stale && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {t("converter.staleWarning")}
            </p>
          )}
        </div>
      )}

      <p className="mt-4 rounded-2xl bg-muted px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        {t("converter.disclaimer")}
      </p>
    </div>
  );
}
