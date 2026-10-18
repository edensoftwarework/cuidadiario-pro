'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const SW_PATH = path.join(FRONTEND_ROOT, 'sw.js');
const API_PATH = path.join(FRONTEND_ROOT, 'js', 'api-b2b.js');
const SEED_PATH = '/p1-upgrade-seed.html';
const FIXTURE_PATH = '/p1-upgrade-fixture.html';
const P1_SW_SOURCE = fs.readFileSync(SW_PATH, 'utf8');
const P0_SW_SOURCE = P1_SW_SOURCE.replace("const CACHE_NAME = 'cuidadiario-pro-v10';", "const CACHE_NAME = 'cuidadiario-pro-v9';");
const P1_API_SOURCE = fs.readFileSync(API_PATH, 'utf8');

function makeP0EquivalentApi(source) {
    let result = source.replace(
        /    async post\(path, body, options = \{\}\) \{\r?\n        const headers = \{ \.\.\.this\.headers\(\), \.\.\.\(options\.headers \|\| \{\}\) \};\r?\n        return this\.handle\(await this\._fetch\(`\$\{this\.BASE_URL\}\$\{path\}`, \{ method: 'POST', headers, body: JSON\.stringify\(body\) \}\)\);\r?\n    \},\r?\n/,
        "    async post(path, body) {\n        return this.handle(await this._fetch(`${this.BASE_URL}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) }));\n    },\n"
    );
    const idempotencyStart = result.indexOf('    createIdempotencyKey() {');
    const patchStart = result.indexOf('    async patch(path, body) {');
    if (idempotencyStart < 0 || patchStart <= idempotencyStart) throw new Error('No se pudo construir fixture P0: helpers P1 no encontrados');
    result = result.slice(0, idempotencyStart) + result.slice(patchStart);
    result = result.replace(
        /    async registrarToma\(id, notas, cantidad, idempotencyKey\) \{[\s\S]*?\r?\n    \},/,
        "    async registrarToma(id, notas, quien, cantidad) {\n        return this.post(`/api/b2b/medicamentos/${id}/toma`, { notas, _quien: quien || '', cantidad: cantidad || 1 });\n    },"
    );
    result = result.replace(
        /    async completarTarea\(id, notas, idempotencyKey\) \{[\s\S]*?\r?\n    \},/,
        "    async completarTarea(id, notas, quien) {\n        return this.post(`/api/b2b/tareas/${id}/completar`, { notas, _quien: quien || '' });\n    },"
    );
    result = result.replace(
        /    async uploadDocumento\(data, idempotencyKey\) \{[\s\S]*?\r?\n    \},/,
        "    async uploadDocumento(data) { return this.post('/api/b2b/documentos', data); },"
    );
    // Paquete 2 agrega una operación idempotente de medicación; tampoco existía
    // en el baseline P0 usado por este gate histórico de upgrade.
    result = result.replace(
        /    async getMedicationSchemes\(id\)[\s\S]*?\r?\n    \},\r?\n/,
        ''
    );
    // LA1 es posterior al baseline P0 y reutiliza idempotencia P1. La fixture P0
    // debe omitir todo el bloque, no neutralizar sus aserciones de upgrade.
    result = result.replace(
        /    \/\/ ============================================\r?\n    \/\/ NÚCLEO AMPLIADO DEL RESIDENTE \(Los Aromos, paquete 1\)[\s\S]*?(?=    \/\/ ============================================\r?\n    \/\/ NOTAS INTERNAS)/,
        ''
    );
    // P1-D3 reutiliza los helpers P1 de idempotencia; no formaban parte del baseline P0.
    result = result.replace(
        /    async getOffboardingStatus\(\)[\s\S]*?(?=    logout\(\) \{)/,
        ''
    );
    if (result.includes('Idempotency-Key') || result.includes('idempotencyOptions')) {
        throw new Error('La fixture P0 conserva lógica de idempotencia P1');
    }
    return result;
}

const P0_API_SOURCE = makeP0EquivalentApi(P1_API_SOURCE);

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8'
};

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ].filter(Boolean);
    const browser = candidates.find(candidate => fs.existsSync(candidate));
    if (!browser) throw new Error('No se encontró Chrome/Edge instalado');
    return browser;
}

async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

function seedHtml() {
    return '<!doctype html><html><head><meta charset="utf-8"><title>P1 upgrade seed</title></head><body>P1 upgrade seed</body></html>';
}

function fixtureHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>P1 upgrade fixture</title></head>
<body><main id="fixture">P1 upgrade fixture</main>
<script>
window.__nativeFetch = window.fetch.bind(window);
window.__mutationCalls = [];
window.fetch = async (url, options = {}) => {
    window.__mutationCalls.push({ url: String(url), options: {
        method: options.method, headers: Object.fromEntries(new Headers(options.headers || {}).entries()), body: options.body
    }});
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
</script>
<script src="/js/api-b2b.js"></script></body></html>`;
}

function createLocalServer(state) {
    return http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        state.requests.push({ phase: state.phase, pathname: url.pathname });
        const send = (status, type, body) => {
            res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            res.end(body);
        };
        const json = value => send(200, 'application/json; charset=utf-8', JSON.stringify(value));

        if (url.pathname === '/sw.js') {
            return send(200, 'text/javascript; charset=utf-8', state.phase === 'p0' ? P0_SW_SOURCE : P1_SW_SOURCE);
        }
        if (url.pathname === '/js/api-b2b.js') {
            return send(200, 'text/javascript; charset=utf-8', state.phase === 'p0' ? P0_API_SOURCE : P1_API_SOURCE);
        }
        if (url.pathname === SEED_PATH) return send(200, 'text/html; charset=utf-8', seedHtml());
        if (url.pathname === FIXTURE_PATH) return send(200, 'text/html; charset=utf-8', fixtureHtml());
        if (url.pathname === '/api/b2b/fixture') return json({ source: 'network-b2b-p1' });
        if (url.pathname === '/api/b2b-other') return json({ source: 'network-lookalike-p1' });
        if (url.pathname === '/api/non-b2b') return json({ source: 'network-non-b2b-p1' });

        let relative = decodeURIComponent(url.pathname);
        if (relative === '/') relative = '/index.html';
        const target = path.resolve(FRONTEND_ROOT, `.${relative}`);
        if (!target.startsWith(`${FRONTEND_ROOT}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
            return send(404, 'text/plain; charset=utf-8', 'Not found');
        }
        res.writeHead(200, {
            'Content-Type': mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        fs.createReadStream(target).pipe(res);
    });
}

class CdpClient {
    constructor(webSocketUrl) {
        this.ws = new WebSocket(webSocketUrl);
        this.nextId = 1;
        this.pending = new Map();
        this.eventWaiters = new Map();
    }

    async connect() {
        this.ws.addEventListener('message', async event => {
            const raw = typeof event.data === 'string'
                ? event.data
                : event.data instanceof ArrayBuffer
                    ? new TextDecoder().decode(event.data)
                    : typeof event.data?.text === 'function'
                        ? await event.data.text()
                        : event.data.toString();
            const message = JSON.parse(raw);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                clearTimeout(pending.timer);
                if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
                else pending.resolve(message.result);
                return;
            }
            const waiters = this.eventWaiters.get(message.method);
            if (waiters?.length) waiters.shift()(message.params);
        });
        this.ws.addEventListener('close', event => {
            const error = new Error(`DevTools cerró WebSocket (${event.code} ${event.reason || ''})`);
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer);
                pending.reject(error);
            }
            this.pending.clear();
        });
        if (this.ws.readyState !== WebSocket.OPEN) {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Timeout conectando a DevTools')), 10000);
                this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
                this.ws.addEventListener('error', error => { clearTimeout(timer); reject(error); }, { once: true });
            });
        }
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Timeout ejecutando DevTools ${method}`));
            }, 15000);
            this.pending.set(id, { resolve, reject, timer });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    waitForEvent(method, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const waiters = this.eventWaiters.get(method) || [];
            const timer = setTimeout(() => reject(new Error(`Timeout esperando ${method}`)), timeoutMs);
            waiters.push(params => { clearTimeout(timer); resolve(params); });
            this.eventWaiters.set(method, waiters);
        });
    }

    async navigate(url) {
        const loaded = this.waitForEvent('Page.loadEventFired');
        await this.send('Page.navigate', { url });
        await loaded;
    }

    async reload() {
        const loaded = this.waitForEvent('Page.loadEventFired');
        await this.send('Page.reload', { ignoreCache: false });
        await loaded;
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    }

    close() { this.ws.close(); }
}

async function waitForDebuggingEndpoint(port) {
    const endpoint = `http://127.0.0.1:${port}/json/version`;
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            const response = await fetch(endpoint);
            if (response.ok) return response.json();
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Chrome no expuso el endpoint DevTools');
}

async function createTarget(port, url) {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!response.ok) throw new Error(`No se pudo crear target: ${response.status}`);
    return response.json();
}

async function cacheSnapshot(cdp) {
    return cdp.evaluate(`(async () => {
        const out = {};
        for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            out[name] = (await cache.keys()).map(request => request.url).sort();
        }
        return out;
    })()`);
}

async function storageSnapshot(cdp) {
    return cdp.evaluate(`Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => {
        const key = localStorage.key(i);
        return [key, localStorage.getItem(key)];
    }).sort(([a], [b]) => a.localeCompare(b)))`);
}

function allCachedUrls(snapshot) { return Object.values(snapshot).flat(); }

async function closeServer(server) {
    if (!server.listening) return;
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections?.();
    await closed;
}

async function stopProcess(child) {
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32' && child.pid) {
        await new Promise(resolve => {
            const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            const timer = setTimeout(() => { killer.kill(); resolve(); }, 10000);
            killer.once('exit', () => { clearTimeout(timer); resolve(); });
            killer.once('error', resolve);
        });
        return;
    }
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
}

async function removeTemporaryProfile(profileDir) {
    let lastError;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
            if (!fs.existsSync(profileDir)) return;
        } catch (error) {
            if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw lastError || new Error(`El perfil temporal no fue eliminado: ${profileDir}`);
}

async function run() {
    assert.notEqual(P0_SW_SOURCE, P1_SW_SOURCE, 'la fixture debe representar dos versiones distintas del SW');
    const state = { phase: 'p0', requests: [] };
    const chromePath = findChrome();
    const httpPort = await getFreePort();
    const debugPort = await getFreePort();
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuidadiario-p1-upgrade-'));
    const server = createLocalServer(state);
    const baseUrl = `http://127.0.0.1:${httpPort}`;
    let chrome;
    let cdp;
    let assertions = 1;
    const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
    const step = message => console.error(`[p1-sw-upgrade] ${message}`);

    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(httpPort, '127.0.0.1', resolve);
        });
        step('servidor local iniciado');
        const renderingArgs = process.env.P1_BROWSER_HEADFUL === '1'
            ? ['--start-minimized', '--window-position=-32000,-32000']
            : [
                '--headless=new',
                '--disable-gpu-shader-disk-cache',
                '--disable-features=SkiaGraphite,WebGPU',
                '--use-gl=angle',
                '--use-angle=swiftshader'
            ];
        chrome = spawn(chromePath, [
            ...renderingArgs, '--disable-background-networking', '--disable-component-update',
            '--disable-default-apps', '--disable-breakpad', '--disable-crash-reporter',
            '--disable-sync', '--metrics-recording-only', '--noerrdialogs',
            '--no-default-browser-check', '--no-first-run', '--no-sandbox', '--remote-allow-origins=*',
            `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1',
            `--user-data-dir=${profileDir}`, 'about:blank'
        ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        chrome.stderr.on('data', chunk => step(`Chrome: ${chunk.toString().trim()}`));
        await waitForDebuggingEndpoint(debugPort);
        step('Chrome y DevTools disponibles');
        const target = await createTarget(debugPort, `${baseUrl}${SEED_PATH}`);
        step('target DevTools creado');
        cdp = new CdpClient(target.webSocketDebuggerUrl);
        await cdp.connect();
        step('WebSocket DevTools conectado');
        await cdp.send('Page.enable');
        step('Page habilitado');
        await cdp.send('Runtime.enable');
        step('Runtime habilitado');
        await cdp.navigate(`${baseUrl}${SEED_PATH}`);
        step('página seed navegada');

        step('instalando baseline P0');
        const p0Worker = await cdp.evaluate(`(async () => {
            const registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;
            for (let attempt = 0; attempt < 300 && registration.active?.state !== 'activated'; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (!navigator.serviceWorker.controller) {
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('controllerchange P0 timeout')), 15000);
                    navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
                });
            }
            return { state: registration.active?.state, controlled: !!navigator.serviceWorker.controller };
        })()`);
        check(p0Worker.state, 'activated', 'SW equivalente a P0 debe activarse');
        check(p0Worker.controlled, true, 'SW P0 debe controlar la página');
        step('baseline P0 instalado, activado y controlando');
        const p0CachedApi = await cdp.evaluate(`(async () => (await (await caches.open('cuidadiario-pro-v9')).match('/js/api-b2b.js')).text())()`);
        check(sha256(p0CachedApi), sha256(P0_API_SOURCE), 'P0 debe dejar el cliente anterior en caché');

        await cdp.evaluate(`(async () => {
            const payload = btoa(JSON.stringify({ b2b: true, exp: Math.floor(Date.now() / 1000) + 3600 }))
                .replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
            localStorage.setItem('cd_api_/api/b2b/residentes', '{"owner":"A"}');
            localStorage.setItem('cd_api_/api/admin/status', '{"scope":"non-b2b"}');
            localStorage.setItem('cd_offline_queue', '[{"fixture":"preserve"}]');
            localStorage.setItem('cd_pro_token', 'e30.' + payload + '.fixture-signature');
            localStorage.setItem('cd_pro_user', '{"id":"A"}');
            localStorage.setItem('stock_modelo', 'institucional');
            localStorage.setItem('b2c_preference', 'preservar');
            const legacy = await caches.open('legacy-shared-cache');
            await legacy.put('/api/b2b/fixture', new Response('{"owner":"A"}', { headers: { 'Content-Type':'application/json' } }));
            await legacy.put('/api/non-b2b', new Response('{"source":"legacy-non-b2b"}', { headers: { 'Content-Type':'application/json' } }));
            const current = await caches.open('cuidadiario-pro-v9');
            await current.put('/unrelated-static.js', new Response('preservar-no-b2b'));
        })()`);
        const before = { cache: await cacheSnapshot(cdp), storage: await storageSnapshot(cdp) };
        check(allCachedUrls(before.cache).some(url => new URL(url).pathname === '/api/b2b/fixture'), true,
            'precondición: existe respuesta B2B heredada');

        state.phase = 'p1';
        step('solicitando actualización P1');
        const upgrade = await cdp.evaluate(`(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            const previous = registration.active;
            let updateFound = 0;
            registration.addEventListener('updatefound', () => { updateFound++; });
            await registration.update();
            for (let attempt = 0; attempt < 300; attempt++) {
                if (registration.active && registration.active !== previous && registration.active.state === 'activated') {
                    return { updateFound, state: registration.active.state, changed: true, controlled: !!navigator.serviceWorker.controller };
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            return { updateFound, state: registration.active?.state, changed: registration.active !== previous, controlled: !!navigator.serviceWorker.controller };
        })()`);
        check(upgrade.updateFound, 1, 'el navegador debe detectar la nueva versión del SW');
        check(upgrade.changed, true, 'el SW activo debe cambiar de versión');
        check(upgrade.state, 'activated', 'el SW P1 debe completar activación');
        check(upgrade.controlled, true, 'la página debe continuar controlada');
        step('service worker P1 actualizado, activado y controlando');

        const afterActivation = { cache: await cacheSnapshot(cdp), storage: await storageSnapshot(cdp) };
        const cachedP1Api = await cdp.evaluate(`(async () => (await (await caches.open('cuidadiario-pro-v10')).match('/js/api-b2b.js')).text())()`);
        check(sha256(cachedP1Api), sha256(P1_API_SOURCE), 'install P1 debe sustituir el cliente P0 por bytes P1');
        check(sha256(cachedP1Api) === sha256(P0_API_SOURCE), false, 'el cliente P0 no debe seguir servido');
        check(allCachedUrls(afterActivation.cache).some(url => new URL(url).pathname.startsWith('/api/b2b/')), false,
            'activate P1 debe purgar respuestas B2B heredadas');
        check(allCachedUrls(afterActivation.cache).some(url => new URL(url).pathname === '/api/non-b2b'), true,
            'activate P1 debe preservar Cache Storage no-B2B');
        check(afterActivation.cache['cuidadiario-pro-v9'].some(url => new URL(url).pathname === '/unrelated-static.js'), true,
            'actualización debe preservar el asset no-B2B ajeno');
        check(afterActivation.storage['cd_api_/api/b2b/residentes'], '{"owner":"A"}',
            'el SW no debe borrar localStorage fuera del cliente B2B');

        await cdp.navigate(`${baseUrl}${FIXTURE_PATH}`);
        step('fixture P1 navegada');
        const runtime = await cdp.evaluate(`(async () => {
            const source = await (await window.__nativeFetch('/js/api-b2b.js')).text();
            await API_B2B.registrarToma(1, 'fixture', 1);
            await API_B2B.completarTarea(2, 'fixture');
            await API_B2B.uploadDocumento({ paciente_id: 3, nombre_archivo: 'fixture.txt', datos: 'QUJDRA==' });
            return {
                source,
                calls: window.__mutationCalls,
                storage: Object.fromEntries(Object.entries(localStorage))
            };
        })()`);
        check(sha256(runtime.source), sha256(P1_API_SOURCE), 'el navegador debe servir efectivamente api-b2b.js P1');
        check(runtime.source.includes("'Idempotency-Key': key || this.createIdempotencyKey()"), true, 'el contenido efectivo debe incluir P1-B');
        const keys = runtime.calls.map(call => call.options.headers['idempotency-key']);
        check(keys.length, 3, 'las tres mutaciones críticas deben ejecutarse sólo contra el mock local');
        check(keys.every(key => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)), true,
            'las mutaciones deben emitir Idempotency-Key UUID v4');
        check(new Set(keys).size, 3, 'cada intento lógico nuevo debe usar una key distinta');
        check('cd_api_/api/b2b/residentes' in runtime.storage, false, 'P1 debe purgar localStorage B2B heredado');
        check(runtime.storage['cd_api_/api/admin/status'], '{"scope":"non-b2b"}', 'P1 debe preservar cd_api_ no-B2B');
        check(runtime.storage.cd_offline_queue, '[{"fixture":"preserve"}]', 'P1 debe preservar cola offline byte a byte');
        check(runtime.storage.cd_pro_token.startsWith('e30.'), true, 'P1 no debe modificar token válido en este bloque');
        check(runtime.storage.cd_pro_user, '{"id":"A"}', 'P1 no debe modificar identidad en este bloque');
        check(runtime.storage.stock_modelo, 'institucional', 'P1 debe preservar preferencias');
        check(runtime.storage.b2c_preference, 'preservar', 'P1 debe preservar claves no-B2B/B2C sintéticas');
        step('cliente P1 e idempotencia verificados');

        const online = await cdp.evaluate(`(async () => {
            const b2b = await window.__nativeFetch('/api/b2b/fixture');
            const lookalike = await window.__nativeFetch('/api/b2b-other');
            const generic = await window.__nativeFetch('/api/non-b2b');
            const shell = await window.__nativeFetch(location.href);
            return {
                b2b: await b2b.json(), lookalike: await lookalike.json(), generic: await generic.json(),
                shell: await shell.text()
            };
        })()`);
        check(online.b2b.source, 'network-b2b-p1', 'GET B2B online debe ir a red local');
        check(online.lookalike.source, 'network-lookalike-p1', '/api/b2b-other debe conservar su estrategia');
        check(online.generic.source, 'network-non-b2b-p1', 'API no-B2B debe conservar su estrategia');
        check(online.shell.includes('P1 upgrade fixture'), true, 'shell PWA debe responder online');
        const afterOnline = await cacheSnapshot(cdp);
        check(allCachedUrls(afterOnline).some(url => new URL(url).pathname === '/api/b2b/fixture'), false,
            'GET B2B no debe almacenarse en Cache Storage');
        check(allCachedUrls(afterOnline).some(url => new URL(url).pathname === '/api/b2b-other'), true,
            '/api/b2b-other debe seguir cacheándose como API no-B2B');
        check(allCachedUrls(afterOnline).some(url => new URL(url).pathname === '/api/non-b2b'), true,
            'API no-B2B debe seguir cacheándose');
        step('estrategias online verificadas');

        await cdp.evaluate(`localStorage.setItem('cd_pro_user', '{"id":"B"}')`);
        await closeServer(server);
        const offline = await cdp.evaluate(`(async () => {
            const b2b = await window.__nativeFetch('/api/b2b/fixture');
            const lookalike = await window.__nativeFetch('/api/b2b-other');
            const generic = await window.__nativeFetch('/api/non-b2b');
            const shell = await window.__nativeFetch(location.href);
            return {
                b2b: { status: b2b.status, body: await b2b.json() },
                lookalike: await lookalike.json(), generic: await generic.json(), shell: await shell.text()
            };
        })()`);
        check(offline.b2b.status, 503, 'offline GET B2B debe fallar explícitamente');
        check(offline.b2b.body.error, 'Sin conexión', 'offline GET B2B no debe devolver respuesta anterior de A');
        check(offline.lookalike.source, 'network-lookalike-p1', '/api/b2b-other debe conservar fallback');
        check(offline.generic.source, 'legacy-non-b2b', 'API no-B2B debe conservar el fallback heredado existente');
        check(offline.shell.includes('P1 upgrade fixture'), true, 'shell PWA debe conservar fallback');
        await cdp.reload();
        check(await cdp.evaluate(`document.getElementById('fixture')?.textContent`), 'P1 upgrade fixture',
            'el shell debe reabrir offline bajo usuario B sintético');
        check((await cdp.evaluate(`window.__nativeFetch('/api/b2b/fixture').then(async r => ({ status:r.status, body:await r.json() }))`)).status,
            503, 'reapertura offline tampoco debe recuperar datos B2B de A');
        step('estrategias offline y reapertura verificadas');

        const browserVersion = await cdp.send('Browser.getVersion');
        const p0SwRequests = state.requests.filter(request => request.phase === 'p0' && request.pathname === '/sw.js').length;
        const p1SwRequests = state.requests.filter(request => request.phase === 'p1' && request.pathname === '/sw.js').length;
        check(p0SwRequests > 0, true, 'Chrome debe haber solicitado el SW P0');
        check(p1SwRequests > 0, true, 'Chrome debe haber solicitado el SW P1');
        console.log(JSON.stringify({
            result: 'PASS', assertions,
            environment: { browser: browserVersion.product, protocolVersion: browserVersion.protocolVersion, node: process.version, profile: 'temporary-isolated', origin: baseUrl },
            hashes: { p0Sw: sha256(P0_SW_SOURCE), p1Sw: sha256(P1_SW_SOURCE), p0Api: sha256(P0_API_SOURCE), p1Api: sha256(P1_API_SOURCE), browserEffectiveApi: sha256(runtime.source) },
            evidence: { p0Worker, upgrade, before, afterActivation, runtimeMutationHeaders: runtime.calls.map(call => call.options.headers), afterOnline, offline, swRequests: { p0: p0SwRequests, p1: p1SwRequests } }
        }, null, 2));
    } finally {
        if (cdp) {
            await Promise.race([
                cdp.send('Browser.close').catch(() => {}),
                new Promise(resolve => setTimeout(resolve, 5000))
            ]);
            cdp.close();
        }
        await closeServer(server).catch(() => {});
        await stopProcess(chrome);
        await new Promise(resolve => setTimeout(resolve, 1000));
        const tempRoot = path.resolve(os.tmpdir());
        const resolvedProfile = path.resolve(profileDir);
        if (!resolvedProfile.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolvedProfile).startsWith('cuidadiario-p1-upgrade-')) {
            throw new Error(`Perfil temporal fuera del alcance esperado: ${resolvedProfile}`);
        }
        await removeTemporaryProfile(resolvedProfile);
        if (fs.existsSync(resolvedProfile)) throw new Error(`El perfil temporal no fue eliminado: ${resolvedProfile}`);
        step('navegador y perfil temporal cerrados');
    }
}

run()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('P1 SERVICE WORKER UPGRADE TEST: FAIL');
        console.error(error.stack || error);
        process.exit(1);
    });
