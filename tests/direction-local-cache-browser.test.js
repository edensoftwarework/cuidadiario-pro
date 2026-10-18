'use strict';

const fs = require('fs');
const path = require('path');
const playwrightCandidates = [
    process.env.CUIDADIARIO_BACKEND_ROOT && path.join(process.env.CUIDADIARIO_BACKEND_ROOT, 'node_modules', 'playwright'),
    path.resolve(__dirname, '../../backend/node_modules/playwright'),
    path.resolve(__dirname, '../../cuidadiario-backend/node_modules/playwright'),
].filter(Boolean);
const playwrightPath = playwrightCandidates.find(candidate => fs.existsSync(candidate));
if (!playwrightPath) throw new Error('Playwright no disponible; defina CUIDADIARIO_BACKEND_ROOT con un runtime local validado');
const { chromium } = require(playwrightPath);

const ORIGIN = process.env.TEST_ORIGIN || 'http://127.0.0.1:5500';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PASSWORD = 'Demo-Paquete1-2026!';
let assertions = 0;

function check(condition, message) {
    assertions += 1;
    if (!condition) throw new Error(`Assertion ${assertions}: ${message}`);
}

async function login(page, email) {
    await page.goto(`${ORIGIN}/login.html`, { waitUntil:'networkidle' });
    await page.evaluate(() => { localStorage.removeItem('cd_pro_token'); localStorage.removeItem('cd_pro_user'); sessionStorage.clear(); });
    await page.reload({ waitUntil:'networkidle' });
    await page.locator('#loginForm input[name="email"]').fill(email);
    await page.locator('#loginForm input[name="password"]').fill(PASSWORD);
    await page.locator('#loginForm').evaluate(form => form.requestSubmit());
    await page.waitForURL(url => !url.pathname.endsWith('/login.html'));
}

async function ensureControlled(page) {
    await page.evaluate(async () => { await globalThis.B2B_SW_READY; await navigator.serviceWorker.ready; });
    if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
        await page.reload({ waitUntil:'networkidle' });
    }
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

(async () => {
    const external = [];
    const dashboardRequests = [];
    const browser = await chromium.launch({ executablePath:CHROME, headless:true, args:['--disable-gpu'] });
    try {
        const context = await browser.newContext({ viewport:{ width:1366, height:768 }, serviceWorkers:'allow' });
        const admin = await context.newPage();
        admin.on('request', request => {
            if (!request.url().startsWith('http://127.0.0.1:')) external.push(request.url());
            if (request.url().includes('/api/b2b/dashboard/direccion')) dashboardRequests.push(request.url());
        });

        await login(admin, 'admin.a@example.invalid');
        await ensureControlled(admin);
        await admin.goto(`${ORIGIN}/pages/reportes.html`, { waitUntil:'networkidle' });
        check(await admin.locator('#direccionDashboard').isVisible(), 'administrador ve Dirección');
        check(await admin.locator('#direccionGranularidad').count() === 0, 'selector Semana/Mes ausente');
        check(await admin.locator('#direccionKpis .direction-kpi').count() === 9, 'renderiza nueve indicadores respaldados');
        const directionText = await admin.locator('#direccionDashboard').innerText();
        check(!directionText.includes('Tareas vencidas históricas') && !directionText.includes('Stock crítico histórico'), 'tarjetas históricas sin evidencia ausentes');
        check(!directionText.includes('canónica') && directionText.includes('capacidad total no está configurada'), 'descripción de ocupación es clara');
        check(directionText.includes('Omisiones de medicación') && directionText.includes('No se infieren omisiones'), 'definición de omisiones es precisa');
        check(dashboardRequests.length > 0 && dashboardRequests.every(url => !url.includes('granularidad=')), 'frontend no envía granularidad sin consumidor visual');

        const adminAccess = await admin.evaluate(async () => {
            const result = await API_B2B.getDashboardDireccion({ desde:'2026-01-01', hasta:'2027-01-01' });
            return { ok:Boolean(result?.estado_actual), principal:API_B2B.getPrincipalUser()?.rol };
        });
        check(adminAccess.ok && adminAccess.principal === 'admin_institucion', 'titular administrador conserva acceso efectivo a Dirección');

        await admin.goto(`${ORIGIN}/pages/dashboard.html`, { waitUntil:'networkidle' });
        const attentionText = await admin.locator('#requiereAtencion').innerText();
        check(/Tareas vencidas/i.test(attentionText), 'Dashboard conserva tareas actualmente vencidas');

        await admin.evaluate(async () => {
            localStorage.setItem('cd_cache_probe_preference', 'preservar');
            localStorage.setItem('cd_offline_queue', '[{"fixture":"preservar-byte-a-byte"}]');
            const foreign = await caches.open('fixture-non-b2b-cache');
            await foreign.put('/b2c-fixture', new Response('preservar-no-b2b'));
            const own = await caches.open('cuidadiario-pro-v10');
            await own.put('/js/reportes.js', new Response('throw new Error("STALE_REPORTES_JS");', { headers:{ 'Content-Type':'application/javascript' } }));
        });
        await admin.goto(`${ORIGIN}/pages/reportes.html`, { waitUntil:'networkidle' });
        await admin.reload({ waitUntil:'networkidle' });
        check(await admin.locator('#direccionKpis .direction-kpi').count() === 9, 'recarga normal obtiene reportes.js actual pese a copia estática obsoleta');
        const preserved = await admin.evaluate(async () => ({
            preference:localStorage.getItem('cd_cache_probe_preference'),
            queue:localStorage.getItem('cd_offline_queue'),
            foreign:await (await (await caches.open('fixture-non-b2b-cache')).match('/b2c-fixture')).text(),
            apiCached:(await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat().some(path => path === '/api/b2b' || path.startsWith('/api/b2b/')),
        }));
        check(preserved.preference === 'preservar', 'preferencia local preservada');
        check(preserved.queue === '[{"fixture":"preservar-byte-a-byte"}]', 'cd_offline_queue preservada byte a byte');
        check(preserved.foreign === 'preservar-no-b2b', 'Cache Storage no-B2B preservado');
        check(preserved.apiCached === false, 'ninguna respuesta API B2B queda en Cache Storage');
        await admin.evaluate(async () => {
            localStorage.removeItem('cd_cache_probe_preference');
            localStorage.removeItem('cd_offline_queue');
            await (await caches.open('cuidadiario-pro-v10')).delete('/js/reportes.js');
            await caches.delete('fixture-non-b2b-cache');
        });

        check(external.length === 0, `cero tráfico externo (${external.join(',')})`);
        console.log('DIRECTION + LOCAL CACHE BROWSER: PASS');
        console.log(`TOTAL_ASSERTIONS=${assertions}`);
        console.log('BROWSER=Google Chrome real headless');
        console.log('NETWORK=loopback only');
        console.log('DATA=synthetic local demo only');
    } finally { await browser.close(); }
})().catch(error => {
    console.error('DIRECTION + LOCAL CACHE BROWSER: FAIL');
    console.error(error.stack || error);
    process.exitCode = 1;
});
