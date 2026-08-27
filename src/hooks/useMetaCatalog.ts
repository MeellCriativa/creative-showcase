import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchMetaConnection,
  fetchMetaMappings,
  fetchMetaSyncLogs,
  startOAuth,
  completeOAuth,
  syncProductsNow,
  disconnectMeta,
} from "@/lib/meta";

export function useMetaConnection(catalogId: string | undefined) {
  return useQuery({
    queryKey: ["meta-connection", catalogId],
    enabled: !!catalogId,
    queryFn: () => fetchMetaConnection(catalogId!),
    refetchInterval: false,
  });
}

export function useMetaMappings(catalogId: string | undefined) {
  return useQuery({
    queryKey: ["meta-mappings", catalogId],
    enabled: !!catalogId,
    queryFn: () => fetchMetaMappings(catalogId!),
  });
}

export function useMetaSyncLogs(catalogId: string | undefined) {
  return useQuery({
    queryKey: ["meta-sync-logs", catalogId],
    enabled: !!catalogId,
    queryFn: () => fetchMetaSyncLogs(catalogId!),
  });
}

export function useStartOAuth() {
  return useMutation({
    mutationFn: ({
      catalogId,
      phoneNumber,
    }: {
      catalogId: string;
      phoneNumber?: string;
    }) => startOAuth(catalogId, phoneNumber),
  });
}

export function useCompleteOAuth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, state }: { code: string; state: string }) =>
      completeOAuth(code, state),
    onSuccess: (_data, variables) => {
      const stateStr = variables.state;
      if (stateStr) {
        qc.invalidateQueries({ queryKey: ["meta-connection", stateStr] });
        qc.invalidateQueries({ queryKey: ["my-catalog"] });
      }
    },
  });
}

export function useSyncProducts(catalogId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => syncProductsNow(catalogId!),
    enabled: !!catalogId,
    onSuccess: () => {
      if (catalogId) {
        qc.invalidateQueries({ queryKey: ["meta-connection", catalogId] });
        qc.invalidateQueries({ queryKey: ["meta-mappings", catalogId] });
        qc.invalidateQueries({ queryKey: ["meta-sync-logs", catalogId] });
      }
    },
  });
}

export function useDisconnectMeta(catalogId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectMeta(catalogId!),
    enabled: !!catalogId,
    onSuccess: () => {
      if (catalogId) {
        qc.invalidateQueries({ queryKey: ["meta-connection", catalogId] });
        qc.invalidateQueries({ queryKey: ["meta-mappings", catalogId] });
        qc.invalidateQueries({ queryKey: ["meta-sync-logs", catalogId] });
        qc.invalidateQueries({ queryKey: ["my-catalog"] });
      }
    },
  });
}
