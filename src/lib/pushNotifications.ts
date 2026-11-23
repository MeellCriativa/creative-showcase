/** Web Push + notificação do sistema para novos pedidos do vendedor. */

import { supabase } from "@/integrations/supabase/client";

const VAPID_PUBLIC_KEY = String(
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[
    "VITE_VAPID_PUBLIC_KEY"
  ] ?? "",
);

export type SellerPushState = "loading" | "off" | "on" | "denied" | "unsupported" | "error";

function hasNotificationApi(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isPushSupported(): boolean {
  return (
    hasNotificationApi() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    VAPID_PUBLIC_KEY.length > 0
  );
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return hasNotificationApi() ? Notification.permission : "unsupported";
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/** Registro idempotente do service worker (feito uma vez no root do app). */
export async function registerPushServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.warn("[push] falha ao registrar service worker:", error);
  }
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return (
      (await navigator.serviceWorker.getRegistration("/sw.js")) ??
      (await navigator.serviceWorker.ready)
    );
  } catch {
    return null;
  }
}

export async function isSellerPushEnabled(): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  const registration = await serviceWorkerRegistration();
  if (!registration?.pushManager) return false;
  try {
    return !!(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function enableSellerPush(
  catalogId: string,
  userId: string,
): Promise<SellerPushState> {
  if (!isPushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off";

  const registration = await serviceWorkerRegistration();
  if (!registration?.pushManager) return "unsupported";

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const json = subscription.toJSON();
  const keys = json.keys as Record<string, string> | undefined;
  if (!json.endpoint || !keys?.["p256dh"] || !keys?.["auth"]) return "error";

  const { error } = await supabase.from("seller_push_subscriptions").upsert(
    {
      catalog_id: catalogId,
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: keys["p256dh"],
      auth: keys["auth"],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    console.warn("[push] falha ao salvar inscrição:", error.message);
    return "error";
  }
  return "on";
}

export async function disableSellerPush(): Promise<void> {
  const registration = await serviceWorkerRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.toJSON().endpoint;
  if (endpoint) {
    await supabase.from("seller_push_subscriptions").delete().eq("endpoint", endpoint);
  }
  await subscription.unsubscribe();
}

export async function showOrderSystemNotification(input: {
  title: string;
  body: string;
  orderId: string;
}): Promise<void> {
  if (!hasNotificationApi() || Notification.permission !== "granted") return;

  const url = `/painel/pedidos?order=${encodeURIComponent(input.orderId)}`;
  const options = {
    body: input.body,
    icon: "/icon-192.png",
    badge: "/notification-badge.png",
    tag: `new-order-${input.orderId}`,
    renotify: true,
    data: { url },
  } as NotificationOptions;

  try {
    const registration = await serviceWorkerRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(input.title, options);
      return;
    }
    new Notification(input.title, options);
  } catch {
    try {
      new Notification(input.title, options);
    } catch (error) {
      console.warn("[push] falha ao exibir notificação:", error);
    }
  }
}
