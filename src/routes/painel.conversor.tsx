import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeftRight, Check, Copy, Info, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { CurrencyPicker } from "@/components/CurrencyPicker";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { useCurrencyRates, useRefreshCurrencyRates } from "@/hooks/useRates";
import {
  buildConversionCopyText,
  CURRENCIES,
  convertAmount,
  formatMoney,
  formatRate,
  formatUpdatedAt,
  getCurrency,
  parseAmount,
  RATE_DISCLAIMER,
  resolveStoreCurrency,
} from "@/lib/currency";

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
    const text = buildConversionCopyText(conversion, updatedAt);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Resultado copiado!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o valor manualmente.");
    }
  }

  async function refreshRates() {
    try {
      const result = await refresh.mutateAsync();
      if (result.stale) {
        toast.warning("Sem conexão com a fonte de cotações. Mostrando a última cotação conhecida.");
      } else if (result.ok) {
        toast.success("Cotação atualizada!");
      } else {
        toast.error("Não foi possível atualizar a cotação agora.");
      }
    } catch {
      toast.error("Não foi possível atualizar a cotação agora.");
    }
  }

  return (
    <div className="px-5 pb-10 pt-10">
      <h1 className="text-2xl font-bold text-foreground">Conversor de moedas</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Converta valores para decidir quanto cobrar em outra moeda.
      </p>

      {catalog && (
        <button
          type="button"
          onClick={useStoreCurrencyAsOrigin}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-primary"
        >
          <Info className="size-3.5" />
          Sua loja vende em {storeCurrency} ({getCurrency(storeCurrency).name})
        </button>
      )}

      {/* ── Valor ── */}
      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        <label htmlFor="conversor-valor" className="text-sm font-medium text-foreground">
          Valor
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
            placeholder="0,00"
            className="w-full bg-transparent py-3.5 text-2xl font-bold text-foreground outline-none"
          />
        </div>
        {amountInput.trim() !== "" && amount == null && (
          <p className="mt-1.5 text-xs text-red-500">Digite um valor numérico válido.</p>
        )}
        {amount != null && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {formatMoney(amount, from)} ·{" "}
            {fromDef.decimals === 0 ? "sem casas decimais" : `${fromDef.decimals} casas decimais`}
          </p>
        )}
      </div>

      {/* ── Moedas ── */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <CurrencyPicker
            id="conversor-origem"
            label="De"
            value={from}
            onChange={setFrom}
            unavailableCodes={unavailableCodes}
          />
          <button
            type="button"
            onClick={swap}
            aria-label="Inverter moedas"
            className="mx-auto grid size-11 place-items-center rounded-full border border-border bg-background text-primary transition active:scale-95 sm:mb-1"
          >
            <ArrowLeftRight className="size-5" />
          </button>
          <CurrencyPicker
            id="conversor-destino"
            label="Para"
            value={to}
            onChange={setTo}
            disabledCodes={[from]}
            unavailableCodes={unavailableCodes}
          />
        </div>
      </div>

      {/* ── Resultado ── */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/12 via-accent to-background p-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
          Resultado
        </p>

        {ratesQuery.isLoading ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando cotação...
          </div>
        ) : apiError ? (
          <div className="mt-3 space-y-2">
            <p className="flex items-start gap-2 text-sm font-semibold text-red-600">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Cotação indisponível agora.
            </p>
            <p className="text-xs text-muted-foreground">
              Tente novamente em alguns instantes. Nenhum valor aproximado é exibido para não
              induzir a erro.
            </p>
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
              Tentar novamente
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
                {toDef.code} não usa casas decimais — o resultado foi arredondado.
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyResult}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copiado!" : "Copiar resultado"}
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
                Atualizar cotação
              </button>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {amount == null
              ? "Digite um valor para converter."
              : `Sem cotação disponível para ${from} → ${to} no momento.`}
          </p>
        )}
      </div>

      {/* ── Cotação utilizada ── */}
      {conversion && rates && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-semibold text-foreground">Cotação utilizada</p>
          <p className="mt-1 text-sm text-muted-foreground">
            1 {conversion.from} = {formatRate(conversion.rate, conversion.to)}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            1 {conversion.to} = {formatRate(1 / conversion.rate, conversion.from)}
          </p>
          <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
            <p>
              Cotação de referência: {formatUpdatedAt(updatedAt)}
              {providerLabel ? ` · ${providerLabel}` : ""}
            </p>
            <p>Verificada em: {formatUpdatedAt(fetchedAt)}</p>
            {ratesQuery.data?.cached && <p>Valor servido do cache do backend.</p>}
          </div>
          {stale && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Esta cotação é antiga: a fonte de dados está indisponível no momento.
            </p>
          )}
        </div>
      )}

      <p className="mt-4 rounded-2xl bg-muted px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        {RATE_DISCLAIMER}
      </p>
    </div>
  );
}
