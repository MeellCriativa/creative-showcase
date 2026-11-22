/* Service worker das notificações de novo pedido da Vitrine Criativa. */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Vitrine Criativa";
  const options = {
    body: payload.body || "Você tem um novo pedido.",
    icon: "/favicon.png",
    badge: "/favicon-32.png",
    tag: payload.tag || "new-order",
    renotify: true,
    data: { url: payload.url || "/painel/pedidos" },
    actions: [{ action: "open", title: "Ver pedidos" }],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url;
  const url = typeof target === "string" ? target : "/painel/pedidos";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const origin = self.location.origin;
      const open = clients.find((client) => {
        try {
          return new URL(client.url).origin === origin;
        } catch {
          return false;
        }
      });
      if (open) {
        await open.focus();
        if (typeof open.navigate === "function") return open.navigate(url);
        return undefined;
      }
      return self.clients.openWindow(url);
    }),
  );
});
