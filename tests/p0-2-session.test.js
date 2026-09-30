const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class MemoryStorage {
    constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
    get length() { return this.values.size; }
    key(index) { return Array.from(this.values.keys())[index] ?? null; }
    getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
    snapshot() { return Object.fromEntries(this.values); }
}

function makeToken(overrides = {}) {
    const payload = {
        b2b: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...overrides
    };
    return [
        Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify(payload)).toString('base64url'),
        'synthetic-signature'
    ].join('.');
}

function loadApi({ initialLocal = {}, initialSession = {}, online = true, pathname = '/pages/dashboard.html' } = {}) {
    const localStorage = new MemoryStorage(initialLocal);
    const sessionStorage = new MemoryStorage(initialSession);
    const windowListeners = new Map();
    const timers = [];
    const location = { pathname, href: '' };
    const context = {
        console,
        localStorage,
        sessionStorage,
        navigator: { onLine: online },
        window: {
            location,
            addEventListener(type, listener) {
                const list = windowListeners.get(type) || [];
                list.push(listener);
                windowListeners.set(type, list);
            },
            dispatchEvent() {}
        },
        location,
        fetch: async () => { throw new Error('fetch no configurado'); },
        Response,
        URLSearchParams,
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
        setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
        clearTimeout() {}
    };
    vm.createContext(context);
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'api-b2b.js'), 'utf8');
    vm.runInContext(`${source}\nglobalThis.__API_B2B = API_B2B;`, context, { filename: 'api-b2b.js' });
    return { api: context.__API_B2B, context, localStorage, sessionStorage, windowListeners, timers };
}

function loadUtils(harness) {
    const documentListeners = new Map();
    const element = () => ({
        style: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        appendChild() {}, remove() {}, focus() {}, reset() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, setAttribute() {}
    });
    harness.context.document = {
        body: element(),
        getElementById() { return null; },
        createElement: element,
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener(type, listener) {
            const list = documentListeners.get(type) || [];
            list.push(listener);
            documentListeners.set(type, list);
        }
    };
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils-b2b.js'), 'utf8');
    vm.runInContext(`${source}\nglobalThis.__requireAuth = requireAuth;`, harness.context, { filename: 'utils-b2b.js' });
    return { requireAuth: harness.context.__requireAuth, documentListeners };
}

function seedState(token = makeToken()) {
    return {
        cd_pro_token: token,
        cd_pro_user: '{"id":"A","nombre":"Usuario A"}',
        cd_pro_last_user: '{"id":"LEGACY","nombre":"Usuario heredado"}',
        cd_offline_queue: '[  {"method":"POST","body":{"nota":"áéí"}}  ]',
        'cd_api_/api/b2b/pacientes': '[{"owner":"A"}]',
        'cd_api_/api/admin/status': '{"scope":"non-b2b"}',
        stock_modelo: 'institucional',
        cd_shared_mode: '1',
        b2c_token: 'preservar-b2c'
    };
}

async function run() {
    let assertions = 0;
    const check = (actual, expected, message) => {
        assert.deepEqual(actual, expected, message);
        assertions++;
    };
    const queueBytes = seedState().cd_offline_queue;

    for (const online of [true, false]) {
        const harness = loadApi({
            initialLocal: seedState(),
            initialSession: { cd_active_worker: 'Trabajador A', unrelated_session: 'keep' },
            online
        });
        check(harness.api.isAuth(), true, `precondición logout ${online ? 'online' : 'offline'}: token vigente`);
        check(harness.localStorage.getItem('cd_pro_last_user'), null, 'la carga retira la copia heredada aun con sesión válida');
        harness.localStorage.setItem('cd_pro_last_user', '{"id":"legacy-again"}');
        let syncCalls = 0;
        harness.api._syncOfflineQueue = async () => { syncCalls++; };
        harness.api.logout();
        check(harness.localStorage.getItem('cd_pro_token'), null, 'logout elimina token');
        check(harness.localStorage.getItem('cd_pro_user'), null, 'logout elimina usuario activo');
        check(harness.localStorage.getItem('cd_pro_last_user'), null, 'logout elimina usuario heredado');
        check(harness.sessionStorage.getItem('cd_active_worker'), null, 'logout elimina selección de trabajador de la sesión');
        check(harness.sessionStorage.getItem('unrelated_session'), 'keep', 'logout preserva sessionStorage ajeno');
        check(harness.localStorage.getItem('cd_offline_queue'), queueBytes, 'logout preserva bytes exactos de la cola');
        check(harness.localStorage.getItem('stock_modelo'), 'institucional', 'logout preserva preferencias B2B');
        check(harness.localStorage.getItem('b2c_token'), 'preservar-b2c', 'logout preserva claves B2C/no-B2B');
        check(harness.localStorage.getItem('cd_api_/api/b2b/pacientes'), null, 'logout reutiliza la purga selectiva P0-1');
        check(harness.localStorage.getItem('cd_api_/api/admin/status'), '{"scope":"non-b2b"}', 'logout preserva caché local no-B2B');
        check(syncCalls, 0, 'logout no ejecuta ni sincroniza la cola');
        check(harness.context.window.location.href, '../login.html', 'logout redirige a login');
    }

    const noToken = loadApi({
        initialLocal: { ...seedState(), cd_pro_token: undefined },
        initialSession: { cd_active_worker: 'Trabajador legado' },
        online: false
    });
    noToken.localStorage.removeItem('cd_pro_token');
    // Simular una reapertura: la ejecución inicial ya debió cerrar cualquier identidad sin token.
    check(noToken.api.isAuth(), false, 'sin token no hay autenticación');
    check(noToken.localStorage.getItem('cd_pro_user'), null, 'sin token no se restaura usuario');
    check(noToken.localStorage.getItem('cd_pro_last_user'), null, 'sin token se purga último usuario heredado');
    check(noToken.sessionStorage.getItem('cd_active_worker'), null, 'sin token se purga trabajador activo heredado');
    check(noToken.localStorage.getItem('cd_offline_queue'), queueBytes, 'reapertura sin token preserva cola exacta');

    for (const [label, token] of [
        ['malformado', 'not-a-jwt'],
        ['expirado', makeToken({ exp: Math.floor(Date.now() / 1000) - 1 })],
        ['aún no válido', makeToken({ nbf: Math.floor(Date.now() / 1000) + 3600 })],
        ['no B2B', makeToken({ b2b: false })]
    ]) {
        const harness = loadApi({
            initialLocal: seedState(token),
            initialSession: { cd_active_worker: 'Trabajador A' },
            online: false
        });
        check(harness.api.isAuth(), false, `token ${label} debe rechazarse`);
        check(harness.localStorage.getItem('cd_pro_token'), null, `token ${label} debe eliminarse`);
        check(harness.localStorage.getItem('cd_pro_user'), null, `identidad con token ${label} debe eliminarse`);
        check(harness.localStorage.getItem('cd_pro_last_user'), null, `último usuario con token ${label} debe eliminarse`);
        check(harness.sessionStorage.getItem('cd_active_worker'), null, `trabajador con token ${label} debe eliminarse`);
        check(harness.localStorage.getItem('cd_offline_queue'), queueBytes, `token ${label} no modifica cola`);
    }

    const guardHarness = loadApi({
        initialLocal: {
            cd_pro_user: '{"id":"legacy"}',
            cd_pro_last_user: '{"id":"legacy"}',
            cd_offline_queue: queueBytes,
            b2c_token: 'preservar-b2c'
        },
        initialSession: { cd_active_worker: 'Trabajador legado' },
        online: false
    });
    const { requireAuth, documentListeners } = loadUtils(guardHarness);
    guardHarness.localStorage.setItem('cd_pro_user', '{"id":"legacy-restored"}');
    guardHarness.localStorage.setItem('cd_pro_last_user', '{"id":"legacy-restored"}');
    guardHarness.sessionStorage.setItem('cd_active_worker', 'Trabajador legado');
    check(requireAuth('../login.html'), false, 'guardia protegida debe fallar cerrada sin token');
    check(guardHarness.context.window.location.href, '../login.html', 'guardia protegida redirige al login');
    check(guardHarness.localStorage.getItem('cd_pro_user'), null, 'guardia no restaura identidad heredada');
    check(guardHarness.localStorage.getItem('cd_pro_last_user'), null, 'guardia elimina último usuario heredado');
    check(guardHarness.sessionStorage.getItem('cd_active_worker'), null, 'guardia elimina trabajador de sesión');
    check(guardHarness.localStorage.getItem('cd_offline_queue'), queueBytes, 'guardia preserva cola exacta');
    check(guardHarness.localStorage.getItem('b2c_token'), 'preservar-b2c', 'guardia preserva B2C');

    check(typeof guardHarness.api._syncOfflineQueue, 'undefined', 'P0-3 retira el procesador de cola sin alterar P0-2');
    check(typeof guardHarness.api._offlineQueue, 'undefined', 'P0-3 retira el consumidor de la cola heredada');
    let unauthSyncCalls = 0;
    guardHarness.api._syncOfflineQueue = async () => { unauthSyncCalls++; };
    guardHarness.context.showToast = () => {};
    for (const listener of guardHarness.windowListeners.get('online') || []) listener();
    for (const listener of documentListeners.get('DOMContentLoaded') || []) listener();
    check(guardHarness.timers.length, 0, 'sin autenticación no se programa sincronización automática');
    check(unauthSyncCalls, 0, 'sin autenticación no se ejecuta sincronización automática');
    check(guardHarness.localStorage.getItem('cd_offline_queue'), queueBytes, 'los eventos sin auth preservan cola exacta');

    const response401 = loadApi({
        initialLocal: seedState(),
        initialSession: { cd_active_worker: 'Trabajador A' },
        pathname: '/pages/pacientes.html'
    });
    response401.localStorage.setItem('cd_pro_last_user', '{"id":"legacy-again"}');
    await assert.rejects(
        () => response401.api.handle(new Response('{"error":"expired"}', {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        })),
        /Sesión expirada/
    );
    assertions++;
    check(response401.localStorage.getItem('cd_pro_token'), null, '401 elimina token');
    check(response401.localStorage.getItem('cd_pro_user'), null, '401 elimina usuario');
    check(response401.localStorage.getItem('cd_pro_last_user'), null, '401 elimina último usuario');
    check(response401.sessionStorage.getItem('cd_active_worker'), null, '401 elimina trabajador activo');
    check(response401.localStorage.getItem('cd_offline_queue'), queueBytes, '401 preserva cola byte por byte');
    check(response401.context.window.location.href, '../login.html?expired=1', '401 protegido redirige a login expirado');

    const login401 = loadApi({ initialLocal: seedState(), pathname: '/login.html' });
    await assert.rejects(
        () => login401.api.handle(new Response('{"error":"Credenciales inválidas"}', {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        })),
        /Credenciales inválidas/
    );
    assertions++;
    check(login401.context.window.location.href, '', '401 de login informa error sin bucle de redirección');
    check(login401.localStorage.getItem('cd_offline_queue'), queueBytes, '401 de login preserva cola');

    const afterReload = loadApi({
        initialLocal: response401.localStorage.snapshot(),
        initialSession: response401.sessionStorage.snapshot(),
        online: false
    });
    check(afterReload.api.isAuth(), false, 'reload offline posterior a 401 sigue sin sesión');
    check(afterReload.localStorage.getItem('cd_pro_user'), null, 'reload offline no recupera usuario anterior');
    check(afterReload.localStorage.getItem('cd_offline_queue'), queueBytes, 'reload offline preserva cola exacta');

    const loginSource = fs.readFileSync(path.join(__dirname, '..', 'login.html'), 'utf8');
    check(loginSource.includes('getLastUser'), false, 'login no conserva recuperación por último usuario');
    check(loginSource.includes('Entrar sin internet'), false, 'login no ofrece acceso offline sin token');
    check(loginSource.includes('_tryOfflineAccess'), false, 'login no conserva bypass offline');
    const verifySource = fs.readFileSync(path.join(__dirname, '..', 'verify-email.html'), 'utf8');
    check(verifySource.includes("setItem('cd_pro_last_user'"), false, 'verify-email no recrea identidad heredada');
    const configuracionSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'configuracion.js'), 'utf8');
    const reportesSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'reportes.js'), 'utf8');
    check(configuracionSource.includes('if (!requireAuth()) return;'), true, 'configuración detiene init si falla guardia');
    check(reportesSource.includes('if (!requireAuth()) return;'), true, 'reportes detiene init si falla guardia');

    console.log(JSON.stringify({ result: 'PASS', assertions }, null, 2));
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
