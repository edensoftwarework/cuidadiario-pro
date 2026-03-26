/* ============================================================
   sw.js — Service Worker para CuidaDiario PRO
   Estrategia:
   - Cache-first para assets estáticos (CSS, JS, fuentes)
   - Network-first para llamadas API (fallback a cache si hay)
   - Stale-while-revalidate para páginas HTML
   ============================================================ */

const CACHE_NAME = 'cuidadiario-pro-v3';
const CACHE_NAME_API = 'cuidadiario-pro-api-v3';

const STATIC_ASSETS = [
    './',
    './index.html',
    './landing.html',
    './register.html',
    './verify-email.html',
    './reset-password.html',
    './pages/dashboard.html',
    './pages/pacientes.html',
    './pages/paciente.html',
    './pages/staff.html',
    './pages/cuidador.html',
    './pages/familiar.html',
    './pages/onboarding.html',
    './pages/reportes.html',
    './pages/catalogo.html',
    './pages/configuracion.html',
    './css/styles-b2b.css',
    './js/api-b2b.js',
    './js/utils-b2b.js',
    './js/dashboard.js',
    './js/pacientes.js',
    './js/paciente.js',
    './js/staff.js',
    './js/cuidador.js',
    './js/familiar.js',
    './js/onboarding.js',
    './js/reportes.js',
    './js/catalogo.js',
    './js/configuracion.js',
    './manifest.json'
];

// Instalación — cachear assets estáticos (uno por uno para que un fallo no bloquee el resto)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => Promise.allSettled(
                STATIC_ASSETS.map(url =>
                    cache.add(new Request(url, { cache: 'reload' })).catch(err =>
                        console.warn('[SW] No se pudo cachear:', url, err.message)
                    )
                )
            ))
            .then(() => self.skipWaiting())
            .catch(err => console.warn('[SW] Error en install:', err))
    );
});

// Activación — limpiar caches viejas
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME && k !== CACHE_NAME_API)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch — estrategia por tipo de recurso
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Ignorar requests que no sean GET
    if (request.method !== 'GET') return;

    // Ignorar requests de extensiones de browser
    if (!url.protocol.startsWith('http')) return;

    // API calls → Network-first con fallback a cache
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstWithCache(request, CACHE_NAME_API));
        return;
    }

    // Recursos del Railway backend (mismo dominio que la API)
    if (url.hostname.includes('railway') || url.hostname.includes('render')) {
        event.respondWith(networkFirstWithCache(request, CACHE_NAME_API));
        return;
    }

    // Assets estáticos → Cache-first
    if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)$/)) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // Páginas HTML → Stale-while-revalidate
    event.respondWith(staleWhileRevalidate(request));
});

// === Estrategias de caché ===

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Asset no disponible offline', { status: 503 });
    }
}

async function networkFirstWithCache(request, cacheName) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'Sin conexión' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    const fetchPromise = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
    }).catch(() => null);

    // Si hay caché: devolver inmediatamente y actualizar en segundo plano
    if (cached) {
        fetchPromise.catch(() => {}); // actualizar en background sin bloquear
        return cached;
    }
    // Sin caché: esperar red o devolver offline page
    const response = await fetchPromise;
    if (response) return response;
    return new Response(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sin conexión</title></head><body style="font-family:system-ui;text-align:center;padding:60px 20px;color:#374151"><div style="font-size:3rem">📡</div><h2>Sin conexión</h2><p>Verificá tu internet e intentá nuevamente.<br>Si ya usaste la app antes, <a href="javascript:location.reload()">recargá la página</a>.</p></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
}

// Escuchar mensajes del cliente (para forzar update)
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
