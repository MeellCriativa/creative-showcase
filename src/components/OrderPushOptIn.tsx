import { useEffect, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { useI18n } from "@/i18n";
import {
  disableSellerPush,
  enableSellerPush,
  isPushSupported,
  isSellerPushEnabled,
  pushPermission,
  showOrderSystemNotification,
  type SellerPushState,
} from "@/lib/pushNotifications";

function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function OrderPushOptIn() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: catalog } = useMyCatalog(user?.id);
  const [state, setState] = useState<SellerPushState>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!isPushSupported()) {
        if (alive) setState("unsupported");
        return;
      }
      if (pushPermission() === "denied") {
        if (alive) setState("denied");
        return;
      }
      const enabled = await isSellerPushEnabled();
      if (alive) setState(enabled ? "on" : "off");
    })();
    return () => {
      alive = false;
    };
  }, []);

  const message =
    state === "on"
      ? t("orders.notification.pushEnabled")
      : state === "denied"
        ? t("orders.notification.pushDenied")
        : state === "unsupported"
          ? t("orders.notification.pushUnsupported")
          : state === "error"
            ? t("orders.notification.pushError")
            : t("orders.notification.pushHint");

  async function turnOn() {
    if (!catalog || !user) return;
    setBusy(true);
    try {
      const result = await enableSellerPush(catalog.id, user.id);
      setState(result);
      if (result === "on") toast.success(t("orders.notification.pushEnabled"));
      else if (result === "error" || result === "unsupported") {
        toast.error(t("orders.notification.pushError"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await disableSellerPush();
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (state !== "on") return;
    await showOrderSystemNotification({
      title: t("orders.notification.toastTitle"),
      body: t("orders.notification.pushTestSent"),
      orderId: `test-${Date.now()}`,
    });
    toast.success(t("orders.notification.pushTestSent"));
  }

  return (
    <section className="mt-4 rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <BellRing className="size-4" aria-hidden /> {t("orders.notification.pushTitle")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      {isIOSDevice() && state !== "on" && (
        <p className="mt-2 text-xs text-muted-foreground">{t("orders.notification.pushIosHint")}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {state === "on" ? (
          <>
            <button
              type="button"
              onClick={() => void sendTest()}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground"
            >
              {t("orders.notification.pushTest")}
            </button>
            <button
              type="button"
              onClick={() => void turnOff()}
              disabled={busy}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground disabled:opacity-60"
            >
              {t("orders.notification.pushDisable")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void turnOn()}
            disabled={busy || state === "loading" || state === "denied" || state === "unsupported"}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy || state === "loading" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <BellRing className="size-4" aria-hidden />
            )}
            {t("orders.notification.pushEnable")}
          </button>
        )}
      </div>
    </section>
  );
}
