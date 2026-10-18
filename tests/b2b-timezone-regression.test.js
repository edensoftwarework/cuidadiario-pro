'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const controlledRoot = path.resolve(__dirname, '..', '..');
const frontendRoot = fs.existsSync(path.join(__dirname, '..', 'js', 'utils-b2b.js'))
    ? path.resolve(__dirname, '..')
    : path.join(controlledRoot, 'frontend');
const backendRoot = fs.existsSync(path.join(controlledRoot, 'backend', 'index.js'))
    ? path.join(controlledRoot, 'backend')
    : path.resolve(__dirname, '..', '..', 'cuidadiario-backend');
const readFrontend = relative => fs.readFileSync(path.join(frontendRoot, relative), 'utf8');
const readBackend = relative => fs.readFileSync(path.join(backendRoot, relative), 'utf8');
let assertions = 0;
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };
const check = (condition, message) => { assert.ok(condition, message); assertions += 1; };

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`No se encontró ${name}`);
    let depth = 0;
    let opened = false;
    for (let i = start; i < source.length; i += 1) {
        if (source[i] === '{') { depth += 1; opened = true; }
        if (source[i] === '}') {
            depth -= 1;
            if (opened && depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`Función incompleta: ${name}`);
}

const utils = readFrontend('js/utils-b2b.js');
const backend = readBackend('index.js');
const context = vm.createContext({ Date, Intl, Number, String });
vm.runInContext(`${extractFunction(utils, 'formatInstitutionDateTime')};${extractFunction(utils, 'formatDateTime')};${extractFunction(backend, 'utcIsoToArgentinaNaive')}`, context);

equal(context.formatInstitutionDateTime('2026-10-17T23:45:00.000Z'), '17/10/2026, 23:45', 'timestamp institucional no pierde tres horas');
equal(context.formatDateTime('2026-10-18T02:45:00.000Z'), '17/10/2026, 23:45', 'instante real UTC se convierte una sola vez a Argentina');
equal(context.formatDateTime('2026-10-17T23:45:00-03:00'), '17/10/2026, 23:45', 'instante con offset explícito no recibe doble conversión');
equal(context.formatInstitutionDateTime('2026-10-17 23:45:00'), '17/10/2026, 23:45', 'acepta representación PostgreSQL sin zona');
equal(context.formatInstitutionDateTime('2026-12-31T23:59:59.999Z'), '31/12/2026, 23:59', 'no cruza año por una conversión espuria');
equal(context.formatInstitutionDateTime('2027-01-01T00:01:00.000Z'), '01/01/2027, 00:01', 'medianoche institucional permanece estable');
equal(context.formatInstitutionDateTime('2026-02-30T10:00:00.000Z'), '—', 'rechaza fecha civil inválida');
equal(context.formatInstitutionDateTime('<invalid>'), '—', 'rechaza entrada no temporal');

equal(context.utcIsoToArgentinaNaive('2026-10-18T02:45:00.000Z'), '2026-10-17 23:45:00', 'offline UTC se persiste como pared institucional');
equal(context.utcIsoToArgentinaNaive('2027-01-01T02:59:00.000Z'), '2026-12-31 23:59:00', 'offline conserva cruce de año argentino');
equal(context.utcIsoToArgentinaNaive('invalid'), null, 'offline inválido falla cerrado hacia NOW institucional');
check(!extractFunction(backend, 'utcIsoToArgentinaNaive').includes('new Date(ar)'), 'no reinterpreta la pared institucional según zona del runtime');

const dashboard = readFrontend('js/dashboard.js');
const patient = readFrontend('js/paciente.js');
const reports = readFrontend('js/reportes.js');
const settings = readFrontend('js/configuracion.js');
const timeline = readBackend('b2b-la2.js');
const attention = readBackend('b2b-la3.js');
const institutionalExport = readBackend('b2b-p1d2.js');
const serviceWorker = readFrontend('sw.js');
check(dashboard.includes('formatInstitutionDateTime(c.fecha)'), 'dashboard usa hora civil en citas');
check(dashboard.includes('formatInstitutionDateTime(s.fecha)'), 'dashboard usa hora civil en signos');
check(patient.includes('formatInstitutionDateTime(t.fecha)'), 'historial de medicación/tareas usa hora civil');
check(patient.includes('formatInstitutionDateTime(c.fecha)'), 'citas usan hora civil');
check(reports.includes('formatInstitutionDateTime(t.fecha)'), 'reportes de administración usan hora civil');
check(reports.includes('formatDateTime(data.actualizado_en)'), 'reportes conservan instantes reales para generación');
check(settings.includes('const exportadoEn = formatDateTime(d.exportado_en)'), 'exportación HTML distingue instante de generación');
check(settings.includes('pTomas.map(t => [fInstitutionDateTime(t.fecha)'), 'exportación HTML conserva hora institucional de administraciones');
check(settings.includes('return formatDate(iso)'), 'exportación HTML conserva fechas civiles sin desplazarlas');
for (const legacyExpression of ['fecha AT TIME ZONE', 'created_at AT TIME ZONE']) {
    check(timeline.includes(legacyExpression), `timeline normaliza ${legacyExpression} a instante real`);
}
check(attention.includes('h.fecha AT TIME ZONE'), 'atención operativa normaliza omisiones antes de mezclar eventos');
check(institutionalExport.includes(`to_char(fecha,'YYYY-MM-DD"T"HH24:MI:SS.US') AS fecha`), 'exportación institucional no rotula hora civil como UTC');
check(serviceWorker.includes("const CACHE_NAME = 'cuidadiario-pro-v10'"), 'nueva generación de caché distribuye los renderizadores corregidos');

console.log(`VERDICT=PASS ASSERTIONS=${assertions}`);
