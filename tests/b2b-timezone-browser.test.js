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

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const source = fs.readFileSync(path.resolve(__dirname, '../js/utils-b2b.js'), 'utf8');
let assertions = 0;

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`No se encontró ${name}`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Función incompleta: ${name}`);
}

function equal(actual, expected, message) {
    assertions += 1;
    if (actual !== expected) throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

(async () => {
    const browser = await chromium.launch({ executablePath:CHROME, headless:true, args:['--disable-gpu'] });
    try {
        const helpers = `${extractFunction('formatInstitutionDateTime')};${extractFunction('formatDateTime')}`;
        for (const [timezoneId, expectedInstant] of [
            ['America/Argentina/Buenos_Aires', '17/10/2026, 23:45'],
            ['America/New_York', '17/10/2026, 22:45'],
        ]) {
            const context = await browser.newContext({ timezoneId });
            const page = await context.newPage();
            const result = await page.evaluate(({ helpers: code }) => {
                const functions = new Function(`${code}; return { formatInstitutionDateTime, formatDateTime };`)();
                return {
                    institutional: functions.formatInstitutionDateTime('2026-10-17T23:45:00.000Z'),
                    instant: functions.formatDateTime('2026-10-18T02:45:00.000Z'),
                    yearBoundary: functions.formatInstitutionDateTime('2026-12-31T23:59:00.000Z'),
                };
            }, { helpers });
            equal(result.institutional, '17/10/2026, 23:45', `${timezoneId}: hora institucional independiente del navegador`);
            equal(result.instant, expectedInstant, `${timezoneId}: instante real respeta zona del navegador`);
            equal(result.yearBoundary, '31/12/2026, 23:59', `${timezoneId}: hora civil no cruza de año`);
            await context.close();
        }
        console.log(`VERDICT=PASS ASSERTIONS=${assertions} BROWSER_TIMEZONES=2`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(`VERDICT=FAIL ASSERTIONS=${assertions}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
