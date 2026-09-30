const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const QUEUE_KEY = 'cd_offline_queue';
const QUEUE_BYTES = '[  {"method":"POST","path":"/api/b2b/notas","body":{"texto":"á<&>"}}  ]';

class AuditedStorage {
    constructor(initial = {}) {
        this.values = new Map(Object.entries(initial));
        this.queueAccesses = [];
    }
    get length() { return this.values.size; }
    key(index) { return Array.from(this.values.keys())[index] ?? null; }
    getItem(key) {
        key = String(key);
        if (key === QUEUE_KEY) this.queueAccesses.push('get');
        return this.values.has(key) ? this.values.get(key) : null;
    }
    setItem(key, value) {
        key = String(key);
        if (key === QUEUE_KEY) this.queueAccesses.push('set');
        this.values.set(key, String(value));
    }
    removeItem(key) {
        key = String(key);
        if (key === QUEUE_KEY) this.queueAccesses.push('remove');
        this.values.delete(key);
    }
    raw(key) { return this.values.get(key); }
    snapshot() { return Object.fromEntries(this.values); }
}

function makeToken() {
    const payload = Buffer.from(JSON.stringify({ b2b: true, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    return `e30.${payload}.synthetic-signature`;
}

function loadApi({ initial, fetchImpl }) {
    const localStorage = new AuditedStorage(initial);
    const sessionStorage = new AuditedStorage();
    const windowListeners = new Map();
    const timers = [];
    let fetchCalls = 0;
    const context = {
        console,
        localStorage,
        sessionStorage,
        navigator: { onLine: true },
        window: {
            location: { pathname: '/pages/paciente.html', href: '' },
            addEventListener(type, listener) {
                const listeners = windowListeners.get(type) || [];
                listeners.push(listener);
                windowListeners.set(type, listeners);
            }
        },
        location: { pathname: '/pages/paciente.html', href: '' },
        fetch: async (...args) => { fetchCalls++; return fetchImpl(...args); },
        Response,
        URL,
        URLSearchParams,
        atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
        setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
        clearTimeout() {}
    };
    context.window.location = context.location;
    vm.createContext(context);
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'api-b2b.js'), 'utf8');
    vm.runInContext(`${apiSource}\nglobalThis.__api = API_B2B;`, context, { filename: 'api-b2b.js' });
    return { api: context.__api, context, localStorage, sessionStorage, windowListeners, timers, fetchCalls: () => fetchCalls };
}

function loadUtils(harness) {
    const documentListeners = new Map();
    const element = () => ({
        style: {}, className: '', textContent: '',
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        append() {}, appendChild() {}, replaceChildren() {}, remove() {}, focus() {}, reset() {},
        querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, setAttribute() {}
    });
    harness.context.document = {
        body: element(), head: element(),
        getElementById() { return null; }, createElement: element, createTextNode(text) { return { textContent: String(text) }; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener(type, listener) {
            const listeners = documentListeners.get(type) || [];
            listeners.push(listener);
            documentListeners.set(type, listeners);
        }
    };
    const utilsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils-b2b.js'), 'utf8');
    vm.runInContext(`${utilsSource}\nglobalThis.__handleOfflineWrite = handleOfflineWrite;`, harness.context, { filename: 'utils-b2b.js' });
    return { handleOfflineWrite: harness.context.__handleOfflineWrite, documentListeners };
}

async function run() {
    let assertions = 0;
    const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
    const seed = {
        [QUEUE_KEY]: QUEUE_BYTES,
        cd_pro_token: makeToken(),
        cd_pro_user: '{"id":"A","nombre":"Usuario A"}',
        cd_shared_mode: '1',
        b2c_token: 'preservar-b2c',
        unrelated_preference: 'preservar'
    };
    const harness = loadApi({ initial: seed, fetchImpl: async () => { throw new Error('synthetic offline'); } });
    check(harness.localStorage.queueAccesses, [], 'inicialización no debe leer ni tocar la cola heredada');
    check(harness.localStorage.raw(QUEUE_KEY), QUEUE_BYTES, 'inicialización preserva bytes exactos');
    check(typeof harness.api._offlineQueue, 'undefined', 'no existe consumidor _offlineQueue');
    check(typeof harness.api._syncOfflineQueue, 'undefined', 'no existe sincronizador _syncOfflineQueue');

    for (const [method, invoke] of [
        ['POST', () => harness.api.post('/api/b2b/notas', { contenido: 'fixture' })],
        ['PATCH', () => harness.api.patch('/api/b2b/notas/1', { contenido: 'fixture' })],
        ['DELETE', () => harness.api.del('/api/b2b/notas/1')]
    ]) {
        let error;
        try { await invoke(); } catch (caught) { error = caught; }
        check(!!error && typeof error.message === 'string', true, `${method} offline debe rechazar`);
        check(error.message, 'Sin conexión. Verificá tu internet e intentá nuevamente.', `${method} offline informa fallo explícito`);
        check(Object.prototype.hasOwnProperty.call(error, 'queued'), false, `${method} offline no simula éxito queued`);
        check(harness.localStorage.raw(QUEUE_KEY), QUEUE_BYTES, `${method} preserva bytes heredados`);
    }
    check(harness.fetchCalls(), 3, 'cada mutación intenta red una sola vez y nunca reintenta automáticamente');
    check(harness.localStorage.queueAccesses, [], 'mutaciones nuevas no leen ni escriben la cola');
    check(harness.timers.length, 0, 'fallos de red no programan reintentos');

    const { handleOfflineWrite, documentListeners } = loadUtils(harness);
    const fakeModal = { closed: false };
    const fakeForm = { resetCalled: false, reset() { this.resetCalled = true; } };
    check(handleOfflineWrite(Object.assign(new Error('fixture'), { queued: true }), { modal: fakeModal, form: fakeForm }), false,
        'compatibilidad UI nunca trata queued como éxito');
    check(fakeForm.resetCalled, false, 'la UI no reinicia formulario ante fallo offline');

    const beforeEvents = harness.localStorage.raw(QUEUE_KEY);
    for (const listener of harness.windowListeners.get('online') || []) listener();
    for (const listener of documentListeners.get('DOMContentLoaded') || []) listener();
    check(harness.fetchCalls(), 3, 'reconexión e inicialización no transmiten la cola');
    check(harness.localStorage.raw(QUEUE_KEY), beforeEvents, 'reconexión e inicialización preservan bytes');
    check(harness.localStorage.queueAccesses, [], 'eventos no reinterpretan la cola');

    harness.api.setUser({ id: 'B', nombre: 'Usuario B' });
    check(harness.localStorage.raw(QUEUE_KEY), QUEUE_BYTES, 'cambio de usuario no modifica la cola');
    harness.api.logout();
    check(harness.localStorage.raw(QUEUE_KEY), QUEUE_BYTES, 'logout no modifica la cola');
    check(harness.fetchCalls(), 3, 'logout no transmite la cola');
    check(harness.localStorage.raw('b2c_token'), 'preservar-b2c', 'P0-3 preserva clave B2C/no-B2B');
    check(harness.localStorage.raw('unrelated_preference'), 'preservar', 'P0-3 preserva preferencias');

    const reopened = loadApi({ initial: harness.localStorage.snapshot(), fetchImpl: async () => { throw new Error('unexpected fetch'); } });
    check(reopened.localStorage.raw(QUEUE_KEY), QUEUE_BYTES, 'reload/reapertura conserva bytes heredados');
    check(reopened.fetchCalls(), 0, 'reload/reapertura no transmite la cola');
    check(reopened.localStorage.queueAccesses, [], 'reload/reapertura no lee ni reinterpreta la cola');

    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'api-b2b.js'), 'utf8');
    const utilsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils-b2b.js'), 'utf8');
    const landingSource = fs.readFileSync(path.join(__dirname, '..', 'landing.html'), 'utf8');
    const pacienteSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'paciente.js'), 'utf8');
    check(apiSource.includes('_offlineQueue'), false, 'inventario posterior: _offlineQueue eliminado');
    check(apiSource.includes('_syncOfflineQueue'), false, 'inventario posterior: _syncOfflineQueue eliminado');
    check(apiSource.includes('.queued'), false, 'inventario posterior: no se generan errores queued');
    check(/guardad[oa] localmente|se enviar[aá] al reconectarse/i.test(apiSource + utilsSource + landingSource), false,
        'UI/runtime no afirman falso guardado offline');
    check(/offlinesynccomplete|acciones sincronizadas|reintentando en 30s/i.test(apiSource + utilsSource + pacienteSource), false,
        'mecanismos automáticos de sincronización quedaron retirados');

    console.log(`P0-3 offline queue tests: ${assertions} assertions passed`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
