import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchCurrencyRates, type CurrencyRatesPayload } from "@/lib/rates.functions";

const RATES_QUERY_KEY = ["currency-rates"] as const;

/** Cotações vindas do backend (cache de 15 min no cliente). */
export function useCurrencyRates() {
  return useQuery<CurrencyRatesPayload>({
    queryKey: [...RATES_QUERY_KEY],
    queryFn: () => fetchCurrencyRates(),
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/** Força uma atualização (o backend limita a 1 requisição por minuto). */
export function useRefreshCurrencyRates() {
  const queryClient = useQueryClient();
  return useMutation<CurrencyRatesPayload>({
    mutationFn: () => fetchCurrencyRates({ data: { force: true } }),
    onSuccess: (data) => {
      queryClient.setQueryData([...RATES_QUERY_KEY], data);
    },
  });
}
