/* ============================================================
   sw.js — Service Worker para CuidaDiario PRO
   Estrategia:
   - Cache-first para assets estáticos (CSS, JS, fuentes)
   - Network-only para GET /api/b2b/ (nunca Cache Storage)
   - Network-first para las demás llamadas API (fallback a cache si hay)
   - Stale-while-revalidate para páginas HTML
   ============================================================ */

// Paquete P0-2/P0-3/P0-8: este cambio de script dispara un install que recarga STATIC_ASSETS
// dentro del mismo cache, sin eliminar entradas estáticas ajenas/no-B2B.
const CACHE_NAME = 'cuidadiario-pro-v6';
const CACHE_NAME_API = 'cuidadiario-pro-api-v6';

// Interruptor operativo temporal para ventanas coordinadas. Debe publicarse en
// `true` sólo durante la ventana y volver a `false` mediante un nuevo deploy.
// La barrera técnica de escrituras continúa siendo B2B_P1_BRIDGE_MODE=1.
const B2B_MAINTENANCE_MODE = true;

// Allowlist exacta: no usar prefijos amplios porque este service worker comparte
// origen/caches con superficies que no pertenecen a la aplicación PRO B2B.
const B2B_APP_PATHS = new Set([
    '/',
    '/index.html',
    '/login.html',
    '/register.html',
    '/verify-email.html',
    '/reset-password.html',
    '/admin-panel.html',
    '/pages/dashboard.html',
    '/pages/pacientes.html',
    '/pages/paciente.html',
    '/pages/staff.html',
    '/pages/cuidador.html',
    '/pages/familiar.html',
    '/pages/onboarding.html',
    '/pages/reportes.html',
    '/pages/catalogo.html',
    '/pages/configuracion.html'
]);

const STATIC_ASSETS = [
    './',
    './index.html',
    './landing.html',
    './login.html',
    './register.html',
    './verify-email.html',
    './reset-password.html',
    './admin-panel.html',
    './maintenance-b2b.html',
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
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
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

function isB2BApiUrl(url) {
    return url.pathname === '/api/b2b' || url.pathname.startsWith('/api/b2b/');
}

function getScopeRelativePath(url) {
    if (url.origin !== self.location.origin) return null;
    const scopePath = new URL(self.registration.scope).pathname;
    if (scopePath === '/') return url.pathname;
    if (!url.pathname.startsWith(scopePath)) return null;
    return `/${url.pathname.slice(scopePath.length)}`;
}

function isB2BAppNavigation(request, url) {
    if (request.mode !== 'navigate') return false;
    const relativePath = getScopeRelativePath(url);
    return relativePath !== null && B2B_APP_PATHS.has(relativePath);
}

function maintenanceResponse() {
    return new Response(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mantenimiento — CuidaDiario PRO</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f3f6fb;color:#14213d;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.card{width:min(100%,560px);padding:40px 32px;border:1px solid #dbe4f0;border-radius:18px;background:#fff;box-shadow:0 18px 50px rgba(20,33,61,.12);text-align:center}.icon{font-size:46px;line-height:1;margin-bottom:20px}h1{margin:0 0 14px;font-size:clamp(1.45rem,4vw,2rem)}p{margin:8px 0;color:#53627a;line-height:1.6}.note{font-weight:650;color:#33445f}
</style></head><body><main class="card" role="status" aria-live="polite"><div class="icon" aria-hidden="true">🛠️</div><h1>CuidaDiario PRO se encuentra temporalmente en mantenimiento.</h1><p>El servicio estará disponible nuevamente en unos minutos.</p><p class="note">Por favor, no cierre ni repita operaciones pendientes.</p></main><script>(function(){if(!('serviceWorker' in navigator))return;let reopened=false;const reopen=function(){if(reopened)return;reopened=true;navigator.serviceWorker.getRegistration().then(function(registration){window.location.replace(new URL('login.html',registration?registration.scope:location.origin+'/').href);});};navigator.serviceWorker.addEventListener('controllerchange',reopen);const update=function(){navigator.serviceWorker.getRegistration().then(function(registration){return registration&&registration.update();}).catch(function(){});};update();setInterval(update,30000);})();</script></body></html>`, {
        status: 503,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
            'Retry-After': '300'
        }
    });
}

async function maintenancePageResponse() {
    const cache = await caches.open(CACHE_NAME);
    const maintenanceUrl = new URL('maintenance-b2b.html', self.registration.scope).href;
    const cached = await cache.match(maintenanceUrl);
    return cached || maintenanceResponse();
}

async function showMaintenanceToOpenB2BClients() {
    if (!B2B_MAINTENANCE_MODE) return;
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const maintenanceUrl = new URL('maintenance-b2b.html', self.registration.scope).href;
    windowClients
        .filter(client => {
            const url = new URL(client.url);
            return B2B_APP_PATHS.has(getScopeRelativePath(url));
        })
        .forEach(client => {
            // No esperar la navegación dentro de `activate`: iniciarla y dejar
            // que el nuevo worker termine de activarse evita un ciclo de espera.
            client.navigate(maintenanceUrl).catch(() => {});
        });
}

async function purgeB2BApiResponsesFromCaches() {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(async cacheName => {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        await Promise.all(
            requests
                .filter(request => isB2BApiUrl(new URL(request.url)))
                .map(request => cache.delete(request))
        );
    }));
}

// Activación — limpiar caches estáticas propias viejas y purgar únicamente
// respuestas B2B de cualquier Cache Storage. Caches API/no-B2B y caches ajenas
// se conservan para no alterar consumidores compartidos.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => /^cuidadiario-pro-v\d+$/.test(k) && k !== CACHE_NAME)
                    .map(k => caches.delete(k))
            )
        )
        .then(() => purgeB2BApiResponsesFromCaches())
        .then(() => self.clients.claim())
        .then(() => showMaintenanceToOpenB2BClients())
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

    // Ventana humana B2B → reemplazar sólo navegaciones PRO allowlisteadas.
    // No se escribe en caches ni se toca almacenamiento del navegador.
    if (B2B_MAINTENANCE_MODE && isB2BAppNavigation(request, url)) {
        event.respondWith(maintenancePageResponse());
        return;
    }

    // B2B API → sólo red: nunca escribir ni recuperar desde Cache Storage.
    if (isB2BApiUrl(url)) {
        event.respondWith(networkOnly(request));
        return;
    }

    // Demás API calls → Network-first con fallback a cache (sin cambios)
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

async function networkOnly(request) {
    try {
        return await fetch(request);
    } catch {
        return new Response(JSON.stringify({ error: 'Sin conexión' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

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

    // For HTML pages with query strings (e.g. paciente.html?id=14),
    // also try to match the URL without the query part so the cached shell is found.
    let cached = await cache.match(request);
    if (!cached && request.url.includes('?')) {
        try {
            const plainUrl = new URL(request.url);
            plainUrl.search = '';
            cached = await cache.match(plainUrl.toString());
        } catch { /* ignore */ }
    }

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
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sin conexión</title></head><body style="font-family:system-ui;text-align:center;padding:60px 20px;color:#374151"><div style="font-size:3rem">📡</div><h2>Sin conexión</h2><p>Verificá tu internet e intentá nuevamente.<br>Si ya usaste la app antes, <a href="">recargá la página</a>.</p></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
}

// Escuchar mensajes del cliente (para forzar update)
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
