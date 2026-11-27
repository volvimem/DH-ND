// ==========================================================
// PARTE 1: FIREBASE PUSH NOTIFICATIONS
// ==========================================================
importScripts('https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDilUDfyFsebnbQ9pAXyL7ptbSy5CY_cmk",
  authDomain: "fpc-per.firebaseapp.com",
  databaseURL: "https://fpc-per-default-rtdb.firebaseio.com",
  projectId: "fpc-per",
  storageBucket: "fpc-per.firebasestorage.app",
  messagingSenderId: "817616563956",
  appId: "1:817616563956:web:21dbbbcbb69e0cae10f8a1"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {

    console.log(
        "[SW] Push recebido em segundo plano:",
        payload
    );

    // Se a mensagem já possui "notification",
    // o próprio Firebase/Chrome mostra o aviso.
    // Não mostramos novamente para evitar duplicidade.
    if (payload && payload.notification) {

        console.log(
            "[SW] Notificação visual será exibida pelo Firebase/Chrome."
        );

        return;
    }

    // Fallback para mensagens antigas enviadas somente com DATA.
    const titulo =
        payload?.data?.title ||
        "DH-ND";

    const corpo =
        payload?.data?.body ||
        "Você recebeu uma nova notificação.";

    const options = {

        body: corpo,

        icon: "./icons/dh-nordeste-192.png?v=17",
        badge: "./icons/dh-nordeste-192.png?v=17",

        vibrate: [200, 100, 200],

        tag: "dhpe-" + Date.now(),

        renotify: true,

        data: {
            url: "./"
        }
    };

    return self.registration.showNotification(
        titulo,
        options
    );
});

// ==========================================================
// CLIQUE NA NOTIFICAÇÃO
// ==========================================================

self.addEventListener("notificationclick", (event) => {

    console.log(
        "[SW] Usuário clicou na notificação."
    );

    event.notification.close();

    const url =
        event.notification.data &&
        event.notification.data.url
            ? event.notification.data.url
            : "./";

    event.waitUntil(

        clients.matchAll({
            type: "window",
            includeUncontrolled: true
        }).then((clientList) => {

            for (const client of clientList) {

                if ("focus" in client) {

                    client.navigate(url);

                    return client.focus();
                }
            }

            if (clients.openWindow) {

                return clients.openWindow(url);
            }
        })
    );
});

// ==========================================================
// PARTE 2: PWA E CACHE
// ==========================================================
const CACHE_NAME = 'dhnd-nordeste-20261127';
const APP_SCOPE = new URL(self.registration.scope);
const STATIC_CACHE_PREFIX = `dhnd-official-static:${APP_SCOPE.href}:`;
const STATIC_CACHE = STATIC_CACHE_PREFIX + CACHE_NAME;

const PUBLIC_FILES = new Set([
    'script.js', 'style.css', 'direct-timing.js', 'direct-timing.css',
    'season-policy.js', 'ranking-policy.js', 'maintenance.js', 'maintenance-admin.js',
    'roster-policy.js', 'dhclub.js', 'dhclub.css', 'manifest.json', 'logo.png',
    'mobile-navigation.js', 'icons/dh-nordeste-192.png', 'icons/dh-nordeste-512.png'
]);
const PUBLIC_CDN = [
    /^https:\/\/www\.gstatic\.com\/firebasejs\/9\.(?:6\.1|7\.0)\/firebase-(?:app|auth|database|storage|messaging|functions)-compat\.js$/,
    /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.5\.[12]\/(?:css\/all\.min\.css|webfonts\/fa-(?:solid-900|regular-400|brands-400)\.woff2)$/,
    'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js'
];

function isPublicAsset(request) {
    if (request.method !== 'GET' || request.mode === 'navigate' ||
        request.headers.has('authorization') || request.headers.has('range')) return false;

    const url = new URL(request.url);
    if (url.origin === APP_SCOPE.origin) {
        if (!url.pathname.startsWith(APP_SCOPE.pathname) || !/^\?v=\d+$/.test(url.search)) return false;
        return PUBLIC_FILES.has(url.pathname.slice(APP_SCOPE.pathname.length));
    }
    return PUBLIC_CDN.some(pattern => typeof pattern === 'string' ? url.href === pattern : pattern.test(url.href));
}

async function getPublicAsset(request) {
    const cache = await caches.open(STATIC_CACHE).catch(() => null);
    const cached = await cache?.match(request).catch(() => null);
    if (cached) return {response:cached};

    const response = await fetch(request);
    const canStore = cache && !response.redirected && (response.ok || response.type === 'opaque');
    return {response, cache, copy:canStore ? response.clone() : null};
}

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith(STATIC_CACHE_PREFIX) && key !== STATIC_CACHE)
            .map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (!isPublicAsset(request)) return;

    const result = getPublicAsset(request);
    event.respondWith(result.then(value => value.response));
    event.waitUntil(result.then(({cache, copy}) => copy ? cache.put(request, copy) : undefined).catch(() => {}));
});
