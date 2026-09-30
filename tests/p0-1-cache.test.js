const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class MemoryStorage {
    constructor(initial = {}) {
        this.values = new Map(Object.entries(initial));
    }
    get length() { return this.values.size; }
    key(index) { return Array.from(this.values.keys())[index] ?? null; }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(key); }
}

class MemoryCache {
    constructor() {
        this.entries = new Map();
    }
    _url(request) { return typeof request === 'string' ? request : request.url; }
    async add(request) {
        this.entries.set(this._url(request), new Response('asset', { status: 200 }));
    }
    async put(request, response) {
        this.entries.set(this._url(request), response.clone());
    }
    async match(request) {
        const response = this.entries.get(this._url(request));
        return response ? response.clone() : undefined;
    }
    async keys() {
        return Array.from(this.entries.keys(), url => new Request(url));
    }
    async delete(request) {
        return this.entries.delete(this._url(request));
    }
}

class MemoryCacheStorage {
    constructor() {
        this.stores = new Map();
    }
    async open(name) {
        if (!this.stores.has(name)) this.stores.set(name, new MemoryCache());
        return this.stores.get(name);
    }
    async keys() { return Array.from(this.stores.keys()); }
    async delete(name) { return this.stores.delete(name); }
    async match(request) {
        for (const cache of this.stores.values()) {
            const response = await cache.match(request);
            if (response) return response;
        }
        return undefined;
    }
}

function loadApiClient({ initialStorage, fetchImpl, online = true }) {
    const localStorage = new MemoryStorage(initialStorage);
    const context = {
        console,
        localStorage,
        navigator: { onLine: online },
        window: {
            location: { pathname: '/pages/dashboard.html', href: '' },
            addEventListener() {}
        },
        fetch: fetchImpl,
        URLSearchParams,
        setTimeout() { return 0; },
        clearTimeout() {}
    };
    vm.createContext(context);
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'api-b2b.js'), 'utf8');
    vm.runInContext(`${source}\nglobalThis.__API_B2B = API_B2B;`, context, { filename: 'api-b2b.js' });
    return { api: context.__API_B2B, context, localStorage };
}

function loadServiceWorker() {
    const listeners = new Map();
    const caches = new MemoryCacheStorage();
    let claimed = false;
    const context = {
        console,
        caches,
        Request,
        Response,
        URL,
        fetch: async () => { throw new Error('fetch mock not configured'); },
        self: {
            addEventListener(type, listener) { listeners.set(type, listener); },
            skipWaiting: async () => {},
            clients: { claim: async () => { claimed = true; } }
        }
    };
    vm.createContext(context);
    const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    vm.runInContext(`${source}\nglobalThis.__STATIC_ASSETS = STATIC_ASSETS;`, context, { filename: 'sw.js' });
    return { context, caches, listeners, staticAssets: context.__STATIC_ASSETS, wasClaimed: () => claimed };
}

async function dispatchFetch(listeners, request) {
    let responsePromise;
    listeners.get('fetch')({
        request,
        respondWith(value) { responsePromise = Promise.resolve(value); }
    });
    assert.ok(responsePromise, `El service worker no manejó ${request.url}`);
    return responsePromise;
}

async function run() {
    let apiFetches = 0;
    const apiHarness = loadApiClient({
        initialStorage: {
            'cd_api_/api/b2b/pacientes': JSON.stringify([{ owner: 'usuario-a' }]),
            'cd_api_/api/admin/status': '{"scope":"non-b2b"}',
            'cd_offline_queue': '[{"method":"POST"}]',
            'cd_pro_user': '{"id":2,"nombre":"usuario-b"}',
            'b2c_preference': 'preservar'
        },
        fetchImpl: async () => {
            apiFetches++;
            return new Response(JSON.stringify([{ id: 1 }]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    });

    assert.equal(apiHarness.localStorage.getItem('cd_api_/api/b2b/pacientes'), null,
        'debe purgar la copia GET B2B heredada');
    assert.equal(apiHarness.localStorage.getItem('cd_api_/api/admin/status'), '{"scope":"non-b2b"}',
        'no debe purgar una clave cd_api_ cuya ruta no sea B2B');
    assert.equal(apiHarness.localStorage.getItem('cd_offline_queue'), '[{"method":"POST"}]',
        'no debe modificar la cola offline');
    assert.equal(apiHarness.localStorage.getItem('b2c_preference'), 'preservar',
        'no debe modificar almacenamiento no-B2B');

    const data = await apiHarness.api.get('/api/b2b/pacientes');
    assert.equal(apiFetches, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(data)), [{ id: 1 }]);
    assert.equal(Array.from(apiHarness.localStorage.values.keys()).some(
        key => key === 'cd_api_/api/b2b' || key.startsWith('cd_api_/api/b2b/')
    ), false, 'un GET B2B exitoso no debe crear una clave B2B cd_api_*');

    apiHarness.context.navigator.onLine = false;
    apiHarness.context.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(
        () => apiHarness.api.get('/api/b2b/pacientes'),
        /Sin conexión/,
        'usuario B offline no debe recibir la respuesta heredada de usuario A'
    );

    const sw = loadServiceWorker();
    assert.equal(sw.staticAssets.filter(asset => asset === './login.html').length, 1,
        'login.html debe aparecer exactamente una vez en STATIC_ASSETS');
    assert.equal(sw.staticAssets.filter(asset => asset === './admin-panel.html').length, 1,
        'admin-panel.html debe aparecer exactamente una vez en STATIC_ASSETS');
    assert.equal(sw.context.isB2BApiUrl(new URL('https://app.test/api/b2b')), true);
    assert.equal(sw.context.isB2BApiUrl(new URL('https://app.test/api/b2b/pacientes?x=1')), true);
    assert.equal(sw.context.isB2BApiUrl(new URL('https://app.test/api/b2b-other')), false,
        'la exclusión no debe abarcar rutas no-B2B por prefijo ambiguo');

    const currentApi = await sw.caches.open('cuidadiario-pro-api-v6');
    const oldApi = await sw.caches.open('cuidadiario-pro-api-v5');
    const unrelated = await sw.caches.open('b2c-unrelated-cache');
    const oldStatic = await sw.caches.open('cuidadiario-pro-v5');
    const b2bUrl = 'https://backend.test/api/b2b/pacientes';
    const adminUrl = 'https://backend.test/api/admin/institucion/1';
    const publicUrl = 'https://backend.test/api/public/status';
    await currentApi.put(b2bUrl, new Response('b2b-current'));
    await currentApi.put(adminUrl, new Response('admin-current'));
    await oldApi.put(b2bUrl, new Response('b2b-old'));
    await oldApi.put(publicUrl, new Response('public-old'));
    await unrelated.put(b2bUrl, new Response('b2b-unrelated-cache'));
    await unrelated.put(publicUrl, new Response('public-unrelated-cache'));
    await oldStatic.put('https://app.test/old.js', new Response('old-static'));

    let activation;
    sw.listeners.get('activate')({ waitUntil(value) { activation = Promise.resolve(value); } });
    await activation;
    assert.equal(sw.wasClaimed(), true);
    assert.equal(await currentApi.match(b2bUrl), undefined);
    assert.equal(await oldApi.match(b2bUrl), undefined);
    assert.equal(await unrelated.match(b2bUrl), undefined,
        'debe purgar B2B incluso si quedó en otro cache');
    assert.equal(await currentApi.match(adminUrl) instanceof Response, true,
        'debe conservar entradas API no-B2B');
    assert.equal(await oldApi.match(publicUrl) instanceof Response, true,
        'debe conservar entradas no-B2B de caches API anteriores');
    assert.equal(await unrelated.match(publicUrl) instanceof Response, true,
        'debe conservar caches ajenas/no-B2B');
    assert.equal((await sw.caches.keys()).includes('b2c-unrelated-cache'), true);
    assert.equal((await sw.caches.keys()).includes('cuidadiario-pro-v5'), false,
        'debe conservar la limpieza histórica de caches estáticas propias obsoletas');

    sw.context.fetch = async () => new Response('{"source":"network"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
    const onlineB2B = await dispatchFetch(sw.listeners, new Request(b2bUrl));
    assert.equal((await onlineB2B.json()).source, 'network');
    for (const cacheName of await sw.caches.keys()) {
        const cache = await sw.caches.open(cacheName);
        assert.equal(await cache.match(b2bUrl), undefined,
            `GET B2B no debe quedar en Cache Storage (${cacheName})`);
    }

    await currentApi.put(b2bUrl, new Response('{"owner":"usuario-a"}', {
        headers: { 'Content-Type': 'application/json' }
    }));
    sw.context.fetch = async () => { throw new Error('offline'); };
    const offlineB2B = await dispatchFetch(sw.listeners, new Request(b2bUrl));
    assert.equal(offlineB2B.status, 503);
    assert.deepEqual(await offlineB2B.json(), { error: 'Sin conexión' },
        'sin red no debe devolver la respuesta B2B anterior');
    await currentApi.delete(b2bUrl);

    sw.context.fetch = async () => new Response('{"scope":"admin"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
    const onlineAdmin = await dispatchFetch(sw.listeners, new Request(adminUrl));
    assert.equal((await onlineAdmin.json()).scope, 'admin');
    assert.equal(await currentApi.match(adminUrl) instanceof Response, true,
        'request API no-B2B debe seguir almacenándose con network-first');
    sw.context.fetch = async () => { throw new Error('offline'); };
    const offlineAdmin = await dispatchFetch(sw.listeners, new Request(adminUrl));
    assert.equal((await offlineAdmin.json()).scope, 'admin',
        'request API no-B2B debe conservar fallback de cache');

    const railwayHealthUrl = 'https://shared-service.up.railway.app/health';
    sw.context.fetch = async () => new Response('healthy', { status: 200 });
    const onlineHealth = await dispatchFetch(sw.listeners, new Request(railwayHealthUrl));
    assert.equal(await onlineHealth.text(), 'healthy');
    assert.equal(await currentApi.match(railwayHealthUrl) instanceof Response, true,
        'host Railway no-B2B debe conservar network-first con cache');
    sw.context.fetch = async () => { throw new Error('offline'); };
    const offlineHealth = await dispatchFetch(sw.listeners, new Request(railwayHealthUrl));
    assert.equal(await offlineHealth.text(), 'healthy',
        'host Railway no-B2B debe conservar fallback offline');

    const b2bLookalikeUrl = 'https://app.test/api/b2b-other';
    sw.context.fetch = async () => new Response('lookalike', { status: 200 });
    await dispatchFetch(sw.listeners, new Request(b2bLookalikeUrl));
    assert.equal(await currentApi.match(b2bLookalikeUrl) instanceof Response, true,
        'una ruta parecida pero no-B2B debe conservar la estrategia API genérica');

    const staticCache = await sw.caches.open('cuidadiario-pro-v6');
    const shellUrl = 'https://app.test/pages/dashboard.html';
    await staticCache.put(shellUrl, new Response('<main>shell</main>', {
        headers: { 'Content-Type': 'text/html' }
    }));
    const offlineShell = await dispatchFetch(sw.listeners, new Request(shellUrl));
    assert.equal(await offlineShell.text(), '<main>shell</main>',
        'shell PWA debe conservar stale-while-revalidate');

    console.log('P0-1 cache tests: 35 assertions passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
