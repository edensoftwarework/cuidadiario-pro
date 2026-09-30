const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = '/p0-1-browser-fixture.html';
const SEED_PATH = '/p0-1-browser-seed.html';

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

function fixtureHtml() {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>P0-1 controlled fixture</title></head>
<body><main id="fixture">P0-1 controlled fixture</main>
<script src="/js/api-b2b.js"></script></body></html>`;
}

function seedHtml() {
    return '<!doctype html><html><head><meta charset="utf-8"><title>P0-1 seed</title></head><body>seed</body></html>';
}

function createLocalServer() {
    return http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const json = value => {
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(JSON.stringify(value));
        };

        if (url.pathname === '/api/b2b/fixture') return json({ source: 'network-b2b-local' });
        if (url.pathname === '/api/b2b-other') return json({ source: 'network-lookalike-local' });
        if (url.pathname === '/api/non-b2b') return json({ source: 'network-non-b2b-local' });
        if (url.pathname === FIXTURE_PATH) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(fixtureHtml());
        }
        if (url.pathname === SEED_PATH) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(seedHtml());
        }

        let relative = decodeURIComponent(url.pathname);
        if (relative === '/') relative = '/index.html';
        const target = path.resolve(FRONTEND_ROOT, `.${relative}`);
        if (!target.startsWith(`${FRONTEND_ROOT}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Not found');
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
                if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
                else pending.resolve(message.result);
                return;
            }
            const waiters = this.eventWaiters.get(message.method);
            if (waiters?.length) waiters.shift()(message.params);
        });
        this.ws.addEventListener('close', event => {
            const error = new Error(`DevTools cerró WebSocket (${event.code} ${event.reason || ''})`);
            for (const pending of this.pending.values()) pending.reject(error);
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
            this.pending.set(id, { resolve, reject });
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
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
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

function allCachedUrls(snapshot) {
    return Object.values(snapshot).flat();
}

async function closeServer(server) {
    if (!server.listening) return;
    const closed = new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
    server.closeAllConnections?.();
    await closed;
}

async function stopProcess(child) {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await Promise.race([
        exited,
        new Promise(resolve => setTimeout(resolve, 3000))
    ]);
}

async function run() {
    const chromePath = findChrome();
    const httpPort = await getFreePort();
    const debugPort = await getFreePort();
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuidadiario-p0-1-'));
    const server = createLocalServer();
    const baseUrl = `http://127.0.0.1:${httpPort}`;
    let chrome;
    let cdp;
    let assertionCount = 0;
    const check = (actual, expected, message) => {
        assert.deepEqual(actual, expected, message);
        assertionCount++;
    };
    const step = message => console.error(`[p0-1-browser] ${message}`);

    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(httpPort, '127.0.0.1', resolve);
        });
        step('servidor local iniciado');

        chrome = spawn(chromePath, [
            '--headless=new',
            '--disable-background-networking',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-gpu',
            '--disable-sync',
            '--metrics-recording-only',
            '--no-default-browser-check',
            '--no-first-run',
            '--remote-allow-origins=*',
            `--remote-debugging-port=${debugPort}`,
            '--remote-debugging-address=127.0.0.1',
            `--user-data-dir=${profileDir}`,
            'about:blank'
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
        await cdp.send('Runtime.enable');
        step('dominios Page/Runtime habilitados');
        await cdp.navigate(`${baseUrl}${SEED_PATH}`);
        step('página de siembra cargada');

        const before = await cdp.evaluate(`(async () => {
            localStorage.clear();
            const payload = btoa(JSON.stringify({ b2b: true, exp: Math.floor(Date.now() / 1000) + 3600 }))
                .replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
            localStorage.setItem('cd_api_/api/b2b/fixture', JSON.stringify({ owner: 'fixture-a' }));
            localStorage.setItem('cd_api_/api/admin/status', JSON.stringify({ scope: 'non-b2b' }));
            localStorage.setItem('cd_offline_queue', JSON.stringify([{ method: 'POST', fixture: true }]));
            localStorage.setItem('cd_pro_token', 'e30.' + payload + '.fixture-signature');
            localStorage.setItem('cd_pro_user', JSON.stringify({ id: 'A', nombre: 'Fixture A' }));
            localStorage.setItem('stock_modelo', 'institucional');
            localStorage.setItem('b2c_preference', 'preservar');
            sessionStorage.setItem('cd_active_worker', 'Fixture Worker A');
            sessionStorage.setItem('unrelated_session', 'preservar');
            const legacy = await caches.open('legacy-shared-cache');
            await legacy.put('/api/b2b/fixture', new Response(JSON.stringify({ owner: 'fixture-a' }), {
                headers: { 'Content-Type': 'application/json' }
            }));
            await legacy.put('/api/non-b2b', new Response(JSON.stringify({ source: 'legacy-non-b2b' }), {
                headers: { 'Content-Type': 'application/json' }
            }));
            const previousStatic = await caches.open('cuidadiario-pro-v6');
            await previousStatic.put('/js/api-b2b.js', new Response('stale-api-b2b'));
            await previousStatic.put('/unrelated-static.js', new Response('preservar-no-b2b'));
            return { localStorage: Object.fromEntries(Object.entries(localStorage)), seeded: true };
        })()`);
        check(before.seeded, true, 'debe preparar fixture heredado');
        step('estado heredado sembrado');

        const cacheBefore = await cacheSnapshot(cdp);
        check(allCachedUrls(cacheBefore).some(url => new URL(url).pathname === '/api/b2b/fixture'), true,
            'precondición: debe existir una entrada B2B heredada');

        await cdp.navigate(`${baseUrl}${FIXTURE_PATH}`);
        step('fixture con api-b2b.js cargado');
        const worker = await cdp.evaluate(`(async () => {
            const registration = await navigator.serviceWorker.ready;
            const active = registration.active;
            if (active && active.state !== 'activated') {
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('statechange timeout')), 10000);
                    active.addEventListener('statechange', () => {
                        if (active.state === 'activated') {
                            clearTimeout(timer);
                            resolve();
                        } else if (active.state === 'redundant') {
                            clearTimeout(timer);
                            reject(new Error('service worker redundant'));
                        }
                    });
                });
            }
            if (!navigator.serviceWorker.controller) {
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('controllerchange timeout')), 10000);
                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        clearTimeout(timer);
                        resolve();
                    }, { once: true });
                });
            }
            return {
                active: active?.state,
                scriptURL: active?.scriptURL,
                controlled: !!navigator.serviceWorker.controller
            };
        })()`);
        check(worker.active, 'activated', 'service worker debe quedar activado');
        check(worker.controlled, true, 'la página debe quedar controlada');
        check(new URL(worker.scriptURL).pathname, '/sw.js', 'debe activar el sw.js local aprobado');
        step('service worker activado y controlador');

        const storageAfterActivation = await storageSnapshot(cdp);
        const cacheAfterActivation = await cacheSnapshot(cdp);
        check('cd_api_/api/b2b/fixture' in storageAfterActivation, false,
            'debe purgar localStorage B2B heredado');
        check(storageAfterActivation['cd_api_/api/admin/status'], JSON.stringify({ scope: 'non-b2b' }),
            'debe preservar cd_api_ no-B2B');
        check(storageAfterActivation.cd_offline_queue, JSON.stringify([{ method: 'POST', fixture: true }]),
            'debe preservar cola offline');
        check(storageAfterActivation.cd_pro_token.startsWith('e30.'), true, 'debe preservar token B2B vigente');
        check(JSON.parse(storageAfterActivation.cd_pro_user).id, 'A', 'debe preservar usuario A en P0-1');
        check(storageAfterActivation.stock_modelo, 'institucional', 'debe preservar preferencia B2B');
        check(storageAfterActivation.b2c_preference, 'preservar', 'debe preservar clave no-B2B');
        check(allCachedUrls(cacheAfterActivation).some(url => new URL(url).pathname.startsWith('/api/b2b/')), false,
            'debe purgar entradas B2B heredadas de Cache Storage');
        check(allCachedUrls(cacheAfterActivation).some(url => new URL(url).pathname === '/api/non-b2b'), true,
            'debe preservar entrada Cache Storage no-B2B heredada');
        check('cuidadiario-pro-v6' in cacheAfterActivation, true,
            'actualización P0-2 debe conservar el caché estático compartido v6');
        check(cacheAfterActivation['cuidadiario-pro-v6'].some(url => new URL(url).pathname === '/unrelated-static.js'), true,
            'actualización P0-2 debe preservar la entrada estática no-B2B heredada');
        check(cacheAfterActivation['cuidadiario-pro-v6'].some(url => new URL(url).pathname === '/login.html'), true,
            'el paquete debe instalar login.html para navegación offline controlada');
        check(cacheAfterActivation['cuidadiario-pro-v6'].some(url => new URL(url).pathname === '/admin-panel.html'), true,
            'el paquete debe instalar admin-panel.html actualizado');
        check(await cdp.evaluate(`(async () => (await (await caches.open('cuidadiario-pro-v6')).match('/js/api-b2b.js')).text())()`)
            .then(text => text.includes('_enforceAuthenticatedSession')), true,
            'install P0-2 debe reemplazar api-b2b.js heredado por el asset actual');
        step('purga selectiva verificada');

        const onlineB2B = await cdp.evaluate(`(async () => {
            const response = await fetch('/api/b2b/fixture?phase=online');
            return { status: response.status, body: await response.json() };
        })()`);
        check(onlineB2B.status, 200, 'GET B2B online debe funcionar');
        check(onlineB2B.body.source, 'network-b2b-local', 'GET B2B debe venir del fixture local');
        const cacheAfterB2B = await cacheSnapshot(cdp);
        check(allCachedUrls(cacheAfterB2B).some(url => new URL(url).pathname.startsWith('/api/b2b/')), false,
            'GET B2B exitoso no debe crear Cache Storage');
        step('GET B2B online verificado');

        const onlineNonB2B = await cdp.evaluate(`(async () => {
            const lookalike = await fetch('/api/b2b-other');
            const generic = await fetch('/api/non-b2b?phase=online');
            const shell = await fetch(location.href);
            return {
                lookalike: { status: lookalike.status, body: await lookalike.json() },
                generic: { status: generic.status, body: await generic.json() },
                shell: { status: shell.status, text: await shell.text() }
            };
        })()`);
        check(onlineNonB2B.lookalike.body.source, 'network-lookalike-local', '/api/b2b-other debe seguir online');
        check(onlineNonB2B.generic.body.source, 'network-non-b2b-local', 'API no-B2B debe seguir online');
        check(onlineNonB2B.shell.text.includes('P0-1 controlled fixture'), true, 'shell local debe responder');
        const cacheAfterNonB2B = await cacheSnapshot(cdp);
        check(allCachedUrls(cacheAfterNonB2B).some(url => new URL(url).pathname === '/api/b2b-other'), true,
            '/api/b2b-other debe conservar network-first con Cache Storage');
        check(allCachedUrls(cacheAfterNonB2B).some(url => new URL(url).pathname === '/api/non-b2b'), true,
            'API no-B2B debe conservar Cache Storage');
        check(allCachedUrls(cacheAfterNonB2B).some(url => new URL(url).pathname === FIXTURE_PATH), true,
            'shell debe quedar disponible para stale-while-revalidate');
        step('regresión no-B2B y shell online verificada');

        await cdp.evaluate(`localStorage.setItem('cd_pro_user', JSON.stringify({ id: 'B', nombre: 'Fixture B' }))`);
        await closeServer(server);
        step('servidor local detenido; navegador sin red al origen');

        const offline = await cdp.evaluate(`(async () => {
            const b2b = await fetch('/api/b2b/fixture?phase=offline');
            const lookalike = await fetch('/api/b2b-other');
            const generic = await fetch('/api/non-b2b?phase=online');
            const shell = await fetch(location.href);
            return {
                b2b: { status: b2b.status, body: await b2b.json() },
                lookalike: { status: lookalike.status, body: await lookalike.json() },
                generic: { status: generic.status, body: await generic.json() },
                shell: { status: shell.status, text: await shell.text() }
            };
        })()`);
        check(offline.b2b.status, 503, 'sin servidor GET B2B debe fallar con 503');
        check(offline.b2b.body.error, 'Sin conexión', 'GET B2B offline debe devolver error, no fixture A');
        check(offline.lookalike.body.source, 'network-lookalike-local', '/api/b2b-other debe usar fallback previo');
        check(offline.generic.body.source, 'network-non-b2b-local', 'API no-B2B debe usar fallback previo');
        check(offline.shell.text.includes('P0-1 controlled fixture'), true, 'shell debe funcionar sin servidor');
        step('comportamiento offline verificado');

        await cdp.reload();
        step('shell reabierto offline');
        const reopened = await cdp.evaluate(`(async () => {
            const b2b = await fetch('/api/b2b/fixture?phase=reopened-offline');
            return {
                fixtureVisible: document.getElementById('fixture')?.textContent,
                user: JSON.parse(localStorage.getItem('cd_pro_user')),
                lastUser: JSON.parse(localStorage.getItem('cd_pro_last_user')),
                queue: localStorage.getItem('cd_offline_queue'),
                preference: localStorage.getItem('stock_modelo'),
                nonB2B: localStorage.getItem('b2c_preference'),
                activeWorker: sessionStorage.getItem('cd_active_worker'),
                b2b: { status: b2b.status, body: await b2b.json() },
                hasLegacyLocalB2B: localStorage.getItem('cd_api_/api/b2b/fixture') !== null
            };
        })()`);
        check(reopened.fixtureVisible, 'P0-1 controlled fixture', 'el shell debe reabrir sin servidor');
        check(reopened.user.id, 'B', 'debe conservar el cambio local a usuario B');
        check(reopened.lastUser, null, 'P0-2 no debe recrear la identidad heredada');
        check(reopened.queue, JSON.stringify([{ method: 'POST', fixture: true }]), 'reapertura debe preservar cola');
        check(reopened.preference, 'institucional', 'reapertura debe preservar preferencia');
        check(reopened.nonB2B, 'preservar', 'reapertura debe preservar clave no-B2B');
        check(reopened.activeWorker, 'Fixture Worker A', 'sesión válida debe conservar trabajador activo');
        check(reopened.b2b.status, 503, 'usuario B reabierto offline no debe recuperar B2B anterior');
        check(reopened.b2b.body.error, 'Sin conexión', 'respuesta offline reabierta debe ser error controlado');
        check(reopened.hasLegacyLocalB2B, false, 'la copia local A debe seguir ausente');
        const finalCache = await cacheSnapshot(cdp);
        check(allCachedUrls(finalCache).some(url => new URL(url).pathname.startsWith('/api/b2b/')), false,
            'ningún cache final debe contener respuestas B2B');

        const logoutLoaded = cdp.waitForEvent('Page.loadEventFired');
        await cdp.evaluate(`API_B2B.logout(); true`);
        await logoutLoaded;
        const afterOfflineLogout = await cdp.evaluate(`({
            pathname: location.pathname,
            token: localStorage.getItem('cd_pro_token'),
            user: localStorage.getItem('cd_pro_user'),
            lastUser: localStorage.getItem('cd_pro_last_user'),
            queue: localStorage.getItem('cd_offline_queue'),
            preference: localStorage.getItem('stock_modelo'),
            nonB2B: localStorage.getItem('b2c_preference'),
            worker: sessionStorage.getItem('cd_active_worker'),
            unrelatedSession: sessionStorage.getItem('unrelated_session')
        })`);
        check(afterOfflineLogout.pathname, '/login.html', 'logout offline debe llegar al login cacheado');
        check(afterOfflineLogout.token, null, 'logout offline elimina token');
        check(afterOfflineLogout.user, null, 'logout offline elimina usuario');
        check(afterOfflineLogout.lastUser, null, 'logout offline elimina último usuario heredado');
        check(afterOfflineLogout.worker, null, 'logout offline elimina trabajador activo');
        check(afterOfflineLogout.queue, JSON.stringify([{ method: 'POST', fixture: true }]), 'logout offline preserva cola exacta');
        check(afterOfflineLogout.preference, 'institucional', 'logout offline preserva preferencia B2B');
        check(afterOfflineLogout.nonB2B, 'preservar', 'logout offline preserva clave no-B2B');
        check(afterOfflineLogout.unrelatedSession, 'preservar', 'logout offline preserva sessionStorage ajeno');
        step('logout offline P0-2 verificado');

        await cdp.send('Page.navigate', { url: `${baseUrl}/pages/dashboard.html` });
        let protectedPath = '';
        for (let attempt = 0; attempt < 50; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            try {
                protectedPath = await cdp.evaluate('location.pathname');
                if (protectedPath === '/login.html') break;
            } catch {}
        }
        check(protectedPath, '/login.html', 'página protegida offline sin token debe volver al login');
        const afterProtectedGuard = await cdp.evaluate(`({
            token: localStorage.getItem('cd_pro_token'),
            user: localStorage.getItem('cd_pro_user'),
            lastUser: localStorage.getItem('cd_pro_last_user'),
            queue: localStorage.getItem('cd_offline_queue'),
            worker: sessionStorage.getItem('cd_active_worker')
        })`);
        check(afterProtectedGuard.token, null, 'guardia protegida mantiene token ausente');
        check(afterProtectedGuard.user, null, 'guardia protegida no restaura usuario');
        check(afterProtectedGuard.lastUser, null, 'guardia protegida no restaura último usuario');
        check(afterProtectedGuard.worker, null, 'guardia protegida no restaura trabajador');
        check(afterProtectedGuard.queue, JSON.stringify([{ method: 'POST', fixture: true }]), 'guardia protegida preserva cola');
        step('guardia protegida offline P0-2 verificada');

        await cdp.evaluate(`(() => {
            const payload = btoa(JSON.stringify({ b2b: true, exp: Math.floor(Date.now() / 1000) + 3600 }))
                .replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
            localStorage.setItem('cd_pro_token', 'e30.' + payload + '.fixture-signature');
            localStorage.setItem('cd_pro_user', JSON.stringify({ id: 'C', nombre: 'Fixture C' }));
            localStorage.setItem('cd_pro_last_user', JSON.stringify({ id: 'LEGACY' }));
            sessionStorage.setItem('cd_active_worker', 'Fixture Worker C');
        })()`);
        await cdp.navigate(`${baseUrl}${FIXTURE_PATH}`);
        check(await cdp.evaluate(`localStorage.getItem('cd_pro_last_user')`), null,
            'sesión válida retira copia heredada al reabrir');
        const response401Loaded = cdp.waitForEvent('Page.loadEventFired');
        await cdp.evaluate(`(() => {
            API_B2B.handle(new Response('{"error":"fixture-expired"}', {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            })).catch(() => {});
            return true;
        })()`);
        await response401Loaded;
        const after401 = await cdp.evaluate(`({
            pathname: location.pathname,
            search: location.search,
            alertText: document.getElementById('alertMsg')?.textContent || '',
            token: localStorage.getItem('cd_pro_token'),
            user: localStorage.getItem('cd_pro_user'),
            lastUser: localStorage.getItem('cd_pro_last_user'),
            queue: localStorage.getItem('cd_offline_queue'),
            worker: sessionStorage.getItem('cd_active_worker'),
            nonB2B: localStorage.getItem('b2c_preference')
        })`);
        check(after401.pathname, '/login.html', '401 controlado debe redirigir al login');
        check(after401.search, '', 'login debe consumir y retirar el indicador de expiración de la URL');
        check(after401.alertText.includes('Tu sesión expiró'), true, 'login debe mostrar el aviso de expiración');
        check(after401.token, null, '401 elimina token');
        check(after401.user, null, '401 elimina usuario');
        check(after401.lastUser, null, '401 elimina último usuario');
        check(after401.worker, null, '401 elimina trabajador activo');
        check(after401.queue, JSON.stringify([{ method: 'POST', fixture: true }]), '401 preserva cola exacta');
        check(after401.nonB2B, 'preservar', '401 preserva clave no-B2B');
        step('401 controlado P0-2 verificado');

        const browserVersion = await cdp.send('Browser.getVersion');
        console.log(JSON.stringify({
            result: 'PASS',
            assertions: assertionCount,
            environment: {
                browser: browserVersion.product,
                protocolVersion: browserVersion.protocolVersion,
                node: process.version,
                origin: baseUrl,
                profile: 'temporary-isolated'
            },
            evidence: {
                serviceWorker: worker,
                cacheBefore,
                cacheAfterActivation,
                cacheAfterOnlineB2B: cacheAfterB2B,
                cacheAfterNonB2B,
                finalCache,
                localStorageBeforeKeys: Object.keys(before.localStorage || {}).sort(),
                localStorageAfterActivation: storageAfterActivation,
                offline,
                reopened,
                afterOfflineLogout,
                afterProtectedGuard,
                after401
            }
        }, null, 2));
    } finally {
        if (cdp) cdp.close();
        await closeServer(server).catch(() => {});
        await stopProcess(chrome);
        const tempRoot = path.resolve(os.tmpdir());
        const resolvedProfile = path.resolve(profileDir);
        if (!resolvedProfile.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolvedProfile).startsWith('cuidadiario-p0-1-')) {
            throw new Error(`Perfil temporal fuera del alcance esperado: ${resolvedProfile}`);
        }
        fs.rmSync(resolvedProfile, { recursive: true, force: true });
    }
}

run().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
