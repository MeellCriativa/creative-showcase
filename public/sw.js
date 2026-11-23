/* Service worker das notificações de novo pedido da Vitrine Criativa. */
/* Também versiona o cache do manifesto e dos ícones para instalações antigas. */

const ICON_CACHE = "vitrine-icons-v2";
const ICON_ASSETS = [
  "/site.webmanifest",
  "/favicon-32.png",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(ICON_CACHE)
      .then((cache) =>
        Promise.all(ICON_ASSETS.map((url) => cache.add(url).catch(() => undefined))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("vitrine-icons-") && key !== ICON_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/* Network-first para manifesto/ícones: troca o asset antigo sem apagar dados,
   login ou configurações do usuário. Funciona offline via cache como fallback. */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin || !ICON_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(ICON_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
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
    icon: "/icon-192.png",
    badge: "/notification-badge.png",
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
