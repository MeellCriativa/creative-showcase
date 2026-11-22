/** Avisos de novos pedidos: badge no painel + toast em tempo real. */

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { useI18n } from "@/i18n";
import { formatMoney, resolveOrderCurrency } from "@/lib/currency";

/** Evita dois toasts iguais (layout + tela de pedidos assinam o mesmo canal). */
const announcedOrders = new Set<string>();

export type SellerOrderNotification = {
  order_id: string;
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

  const { data: notifications } = useQuery<SellerOrderNotification[]>({
    queryKey: ["seller-order-notifications", catalogId],
    enabled: !!catalogId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seller_order_notifications")
        .select("order_id,customer_name,total,currency,created_at,read_at")
        .eq("catalog_id", catalogId!)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as SellerOrderNotification[];
    },
  });

  useEffect(() => {
    if (!catalogId) return;

    const refresh = () =>
      void queryClient.invalidateQueries({ queryKey: ["seller-order-notifications", catalogId] });

    const channel = supabase
      .channel(`seller-order-notifications:${catalogId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "seller_order_notifications",
          filter: `catalog_id=eq.${catalogId}`,
        },
        (payload) => {
          refresh();
          const row = (payload.new ?? {}) as Partial<SellerOrderNotification>;
          const orderId = String(row.order_id ?? "");
          if (orderId && announcedOrders.has(orderId)) return;
          if (orderId) announcedOrders.add(orderId);
          const name = String(row.customer_name ?? t("orders.notification.newBadge"));
          const total = formatMoney(
            Number(row.total) || 0,
            resolveOrderCurrency(row.currency ?? null),
          );
          toast(t("orders.notification.toastTitle"), {
            description: t("orders.notification.toastBody", { name, total }),
            duration: 12000,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "seller_order_notifications",
          filter: `catalog_id=eq.${catalogId}`,
        },
        refresh,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [catalogId, queryClient, t]);

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
