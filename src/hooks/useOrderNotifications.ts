/** Avisos de novos pedidos: badge no painel + toast em tempo real. */

import { useCallback, useEffect, useId, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { useI18n } from "@/i18n";
import { formatMoney, resolveOrderCurrency } from "@/lib/currency";
import { playNotificationSound } from "@/lib/notificationSound";
import { showOrderSystemNotification } from "@/lib/pushNotifications";

/**
 * Dedupe entre as duas instâncias do hook (layout + tela de pedidos).
 * Com expiração: um recarregamento posterior volta a avisar.
 */
const announcedAt = new Map<string, number>();
const ANNOUNCE_TTL_MS = 60_000;

function shouldAnnounce(orderId: string): boolean {
  const now = Date.now();
  const last = announcedAt.get(orderId) ?? 0;
  if (now - last < ANNOUNCE_TTL_MS) return false;
  announcedAt.set(orderId, now);
  if (announcedAt.size > 200) {
    for (const [id, at] of announcedAt) {
      if (now - at > ANNOUNCE_TTL_MS) announcedAt.delete(id);
    }
  }
  return true;
}

const TOAST_WINDOW_MS = 30 * 60 * 1000;

export type SellerOrderNotification = {
  order_id: string;
  catalog_id: string;
  customer_name: string | null;
  total: number | null;
  currency: string | null;
  created_at: string;
  read_at: string | null;
};

export function useOrderNotifications() {
  const { user } = useAuth();
  const { data: catalog } = useMyCatalog(user?.id);
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const catalogId = catalog?.id;
  // O layout do painel e a tela de pedidos montam esta hook ao mesmo tempo.
  // O cliente Supabase reaproveita canais pelo nome: se as duas instâncias
  // usassem o mesmo tópico, a segunda chamaria `.on()` depois do `subscribe()`
  // da primeira e o Realtime lançaria "cannot add postgres_changes callbacks
  // ... after subscribe()", derrubando a tela. Cada instância tem seu tópico.
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const { data: notifications } = useQuery<SellerOrderNotification[]>({
    queryKey: ["seller-order-notifications", catalogId],
    enabled: !!catalogId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seller_order_notifications")
        .select("order_id,catalog_id,customer_name,total,currency,created_at,read_at")
        .eq("catalog_id", catalogId!)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as SellerOrderNotification[];
    },
  });

  const announce = useCallback(
    (row: Partial<SellerOrderNotification>) => {
      if (row.catalog_id && catalogId && String(row.catalog_id) !== catalogId) return;
      const orderId = String(row.order_id ?? "");
      if (!orderId || !shouldAnnounce(orderId)) return;
      const name = String(row.customer_name ?? t("orders.notification.newBadge"));
      const total = formatMoney(Number(row.total) || 0, resolveOrderCurrency(row.currency ?? null));
      const title = t("orders.notification.toastTitle");
      const body = t("orders.notification.toastBody", { name, total });

      toast(title, {
        description: body,
        duration: 12000,
        closeButton: true,
      });
      playNotificationSound();
      void showOrderSystemNotification({ title, body, orderId });
    },
    [catalogId, t],
  );

  // `t` muda de identidade quando o idioma muda. Sem a ref, o effect do Realtime
  // reinscreveria no mesmo tópico — o Supabase devolve o canal já inscrito e
  // `.on()` estoura "cannot add postgres_changes callbacks after subscribe()".
  const announceRef = useRef(announce);
  useEffect(() => {
    announceRef.current = announce;
  }, [announce]);

  // Também avisa quando o pedido já estava na fila antes da inscrição no Realtime
  // (recarregou a página, ou a aba estava fechada quando o pedido chegou).
  useEffect(() => {
    if (!notifications?.length) return;
    const now = Date.now();
    for (const row of notifications) {
      const age = now - new Date(row.created_at).getTime();
      if (Number.isFinite(age) && age >= 0 && age <= TOAST_WINDOW_MS) announceRef.current(row);
    }
  }, [notifications]);

  useEffect(() => {
    if (!catalogId) return;

    const refresh = () =>
      void queryClient.invalidateQueries({ queryKey: ["seller-order-notifications", catalogId] });

    const channel = supabase
      .channel(`seller-order-notifications:${catalogId}:${instanceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "seller_order_notifications",
          // Sem filtro: o filtro por catalog_id é rejeitado para alguns papéis
          // pelo Realtime; o próprio callback filtra pelo catálogo da loja.
        },
        (payload) => {
          refresh();
          announceRef.current((payload.new ?? {}) as Partial<SellerOrderNotification>);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "seller_order_notifications",
        },
        (payload) => {
          const row = (payload.new ?? {}) as Partial<SellerOrderNotification>;
          if (row.catalog_id && String(row.catalog_id) !== catalogId) return;
          refresh();
        },
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") {
          console.warn("[notificações] status do realtime:", status);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [catalogId, instanceId, queryClient]);

  const unreadCount = notifications?.length ?? 0;

  const markAllAsRead = useCallback(async () => {
    if (!catalogId || unreadCount === 0) return;
    const { error } = await supabase
      .from("seller_order_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("catalog_id", catalogId)
      .is("read_at", null);
    if (error) {
      console.warn("[notificações] falha ao marcar como lidas:", error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["seller-order-notifications", catalogId] });
  }, [catalogId, queryClient, unreadCount]);

  return { notifications: notifications ?? [], unreadCount, markAllAsRead };
}

/**
 * Só a contagem para atalhos/cards do painel. Lê o cache da mesma query da hook
 * principal — não abre outro canal Realtime nem repete o toast de novo pedido.
 */
export function useUnreadOrderCount() {
  const { user } = useAuth();
  const { data: catalog } = useMyCatalog(user?.id);
  const { data } = useQuery<SellerOrderNotification[]>({
    queryKey: ["seller-order-notifications", catalog?.id],
    enabled: false,
  });
  return data?.length ?? 0;
}
