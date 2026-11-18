import { defineNamespace } from "../types.ts";

/** Painel: estatísticas de visitas do catálogo. */
export const stats = defineNamespace({
  ptBR: {
    title: "Estatísticas",
    subtitle: "Veja quantas pessoas visitaram seu catálogo nos últimos dias.",
    total: "Total",
    today: "Hoje",
    last7Days: "Últimos 7 dias",
    last30Days: "Últimos 30 dias",
    chartTitle: "Visitas — últimos 14 dias",
  },
  en: {
    title: "Statistics",
    subtitle: "See how many people visited your catalog over the last few days.",
    total: "Total",
    today: "Today",
    last7Days: "Last 7 days",
    last30Days: "Last 30 days",
    chartTitle: "Visits — last 14 days",
  },
  es: {
    title: "Estadísticas",
    subtitle: "Mira cuántas personas visitaron tu catálogo en los últimos días.",
    total: "Total",
    today: "Hoy",
    last7Days: "Últimos 7 días",
    last30Days: "Últimos 30 días",
    chartTitle: "Visitas — últimos 14 días",
  },
});
