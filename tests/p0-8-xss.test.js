const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FRONTEND = path.resolve(__dirname, '..');
const PRODUCT_FILES = [
    'admin-panel.html', 'login.html', 'register.html', 'reset-password.html', 'verify-email.html', 'sw.js',
    'js/catalogo.js', 'js/configuracion.js', 'js/cuidador.js', 'js/dashboard.js', 'js/familiar.js',
    'js/onboarding.js', 'js/paciente.js', 'js/pacientes.js', 'js/reportes.js', 'js/staff.js', 'js/utils-b2b.js'
];

class FakeElement {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.style = {};
        this.className = '';
        this.id = '';
        this.textContent = '';
        this.classList = { add() {}, remove() {}, contains() { return false; }, toggle() {} };
    }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    remove() {}
    focus() {}
}

function loadSafeHelpers() {
    const body = new FakeElement('body');
    const byId = new Map();
    body.appendChild = node => { body.children.push(node); if (node.id) byId.set(node.id, node); return node; };
    const context = {
        console,
        URL,
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        navigator: { onLine: true },
        window: {
            location: { href: 'https://app.example/pages/dashboard.html', origin: 'https://app.example', pathname: '/pages/dashboard.html' },
            addEventListener() {}, history: { back() {} }
        },
        document: {
            body, head: new FakeElement('head'),
            createElement(tag) { return new FakeElement(tag); },
            createTextNode(text) { return { nodeType: 3, textContent: String(text) }; },
            getElementById(id) { return byId.get(id) || null; },
            querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}
        },
        API_B2B: { isAuth() { return true; }, getUser() { return null; }, removeToken() {} },
        setTimeout() { return 1; }, clearTimeout() {}
    };
    vm.createContext(context);
    const source = fs.readFileSync(path.join(FRONTEND, 'js', 'utils-b2b.js'), 'utf8');
    vm.runInContext(`${source}\nglobalThis.__safe = { escapeHtml, safeRecordId, safeFiniteNumber, _safeSameOriginHref, safeExternalHttpsHref, safeContactHref, formatDate, formatDateTime, calcEdad, rolBadge, showToast };`, context);
    return { helpers: context.__safe, body };
}

function run() {
    let assertions = 0;
    const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };

    const sources = Object.fromEntries(PRODUCT_FILES.map(file => [file, fs.readFileSync(path.join(FRONTEND, file), 'utf8')]));
    const combined = Object.values(sources).join('\n');
    check(/\beval\s*\(/.test(combined), false, 'runtime B2B no usa eval');
    check(/new\s+Function\s*\(/.test(combined), false, 'runtime B2B no usa Function dinámico');
    check(/\.outerHTML\s*=/.test(combined), false, 'runtime B2B no escribe outerHTML');
    check(/insertAdjacentHTML\s*\(/.test(combined), false, 'runtime B2B no usa insertAdjacentHTML');
    check(/\bsrcdoc\b/.test(combined), false, 'runtime B2B no usa srcdoc');
    check(/javascript\s*:/i.test(combined), false, 'runtime B2B no conserva URLs javascript:');
    check((combined.match(/document\.write\s*\(/g) || []).length, 1, 'único document.write es la exportación aislada');
    check(sources['js/configuracion.js'].includes('const html = buildExportHTML(d);'), true, 'exportación construye documento mediante función dedicada');
    check(sources['js/configuracion.js'].includes('safeExternalHttpsHref(res.init_point'), true, 'redirección de pago valida protocolo y host');
    check(sources['js/utils-b2b.js'].includes('message.textContent ='), true, 'toast trata mensajes externos como texto');
    check(sources['js/utils-b2b.js'].includes('link.href = _safeSameOriginHref'), true, 'notificaciones restringen URLs a mismo origen');
    check(sources['js/utils-b2b.js'].includes('title.textContent ='), true, 'títulos de notificación se renderizan como texto');
    check(sources['login.html'].includes('document.createTextNode(msg'), true, 'login renderiza errores como texto');
    check(sources['register.html'].includes('registeredEmail.textContent = email'), true, 'registro renderiza email como texto');
    check(sources['reset-password.html'].includes('alert.textContent ='), true, 'reset renderiza error como texto');
    check(sources['verify-email.html'].includes("getElementById('verifyErrorMessage').textContent"), true, 'verificación renderiza error como texto');
    check(/onclick="[^"\n]*'\$\{/.test(combined), false, 'ningún handler inline recibe texto dinámico entre comillas');
    check(/onclick="[^"]*(?:registrarToma|completarTarea|desactivarStaff)\([^)]*,/.test(combined), false,
        'acciones sensibles ya no interpolan nombres almacenados en JavaScript inline');

    const dynamicHandlers = combined.split(/\r?\n/).filter(line => /onclick="[^"]*\$\{/.test(line));
    check(dynamicHandlers.length > 0, true, 'inventario detecta handlers dinámicos residuales controlados');
    check(dynamicHandlers.every(line => /safeRecordId\(|\$\{id\}|_currentPage/.test(line)), true,
        'handlers dinámicos residuales sólo reciben IDs numéricos normalizados o paginación local');

    for (const file of PRODUCT_FILES.filter(file => file.endsWith('.js'))) {
        if (file === 'sw.js') continue;
        new vm.Script(sources[file], { filename: file });
        check(true, true, `${file} compila`);
    }

    const { helpers, body } = loadSafeHelpers();
    const payloads = [
        '<script>window.__xssSentinel++</script>',
        '<img src=x onerror="window.__xssSentinel++">',
        '<svg onload="window.__xssSentinel++"></svg>',
        "' comilla simple", '" comilla doble', 'x" onmouseover="window.__xssSentinel++',
        '</div><script>window.__xssSentinel++</script>', 'javascript:window.__xssSentinel++',
        '<b>HTML benigno</b>', 'Clínica Ñandú 🩺', 'A & B < C > D', 'línea 1\nlínea 2',
        'María Pérez', 'Dolor leve 3/10; presión 120/80'
    ];
    for (const payload of payloads) {
        const escaped = helpers.escapeHtml(payload);
        check(escaped.includes('<'), false, `escapeHtml neutraliza apertura: ${payload.slice(0, 20)}`);
        check(escaped.includes('>'), false, `escapeHtml neutraliza cierre: ${payload.slice(0, 20)}`);
    }
    check(helpers.escapeHtml(0), '0', 'escapeHtml conserva cero legítimo');
    check(helpers.safeRecordId('7'), 7, 'ID numérico legítimo se conserva');
    check(helpers.safeRecordId('1);window.__xssSentinel++//'), 0, 'ID ejecutable se rechaza');
    check(helpers.safeFiniteNumber('<img onerror=x>'), 0, 'valor numérico no confiable se normaliza');
    check(helpers._safeSameOriginHref('paciente.html?id=7'), '/pages/paciente.html?id=7', 'URL relativa legítima se conserva');
    check(helpers._safeSameOriginHref('javascript:alert(1)'), '#', 'URL javascript se rechaza');
    check(helpers._safeSameOriginHref('javascript:alert(1)', 'pages/'), '#', 'un esquema peligroso no se oculta detrás del prefijo interno');
    check(helpers._safeSameOriginHref('https://evil.example/x'), '#', 'URL de otro origen se rechaza');
    check(helpers.safeExternalHttpsHref('https://www.mercadopago.com.ar/checkout', ['mercadopago.com.ar']).startsWith('https://'), true,
        'checkout HTTPS permitido se acepta');
    check(helpers.safeExternalHttpsHref('javascript:alert(1)', ['mercadopago.com.ar']), null, 'checkout javascript se rechaza');
    check(helpers.safeExternalHttpsHref('https://evil.example/', ['mercadopago.com.ar']), null, 'checkout de host ajeno se rechaza');
    check(helpers.safeContactHref('tel', '+54 11 5555-1234'), 'tel:+54 11 5555-1234', 'teléfono legítimo conserva enlace');
    check(helpers.safeContactHref('tel', 'javascript:alert(1)'), null, 'teléfono con esquema inyectado queda sin enlace');
    check(helpers.safeContactHref('mailto', 'familiar@example.com'), 'mailto:familiar@example.com', 'email legítimo conserva enlace');
    check(helpers.safeContactHref('mailto', 'a@example.com?body=<svg>'), null, 'email con parámetros inyectados queda sin enlace');
    check(helpers.formatDate('<img src=x onerror=alert(1)>'), '—', 'fecha inválida no se refleja como HTML');
    check(helpers.formatDateTime('<svg onload=alert(1)>'), '—', 'fecha/hora inválida no se refleja como HTML');
    check(helpers.calcEdad('<img src=x onerror=alert(1)>'), null, 'edad inválida no se convierte en NaN visible');
    const badge = helpers.rolBadge('<img src=x onerror=alert(1)>');
    check(badge.includes('<img'), false, 'rol desconocido se escapa antes de innerHTML');
    check(badge.includes('&lt;img'), true, 'rol desconocido queda visible como texto');

    helpers.showToast('<img src=x onerror="globalThis.__xssSentinel++">', 'error', 1);
    const toastContainer = body.children.find(node => node.id === 'toastContainer');
    const toast = toastContainer.children[0];
    check(toast.children.length, 2, 'toast crea estructura DOM fija');
    check(toast.children[1].textContent, '<img src=x onerror="globalThis.__xssSentinel++">', 'toast conserva payload como texto literal');
    check(toast.children.some(node => node.tagName === 'IMG'), false, 'toast no crea nodos ejecutables desde el mensaje');

    console.log(`P0-8 XSS deterministic tests: ${assertions} assertions passed`);
}

try { run(); } catch (error) { console.error(error); process.exitCode = 1; }
