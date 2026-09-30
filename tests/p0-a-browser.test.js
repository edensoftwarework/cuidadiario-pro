const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const FRONTEND_ROOT = path.resolve(__dirname, '..');

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ].filter(Boolean);
    const browser = candidates.find(candidate => fs.existsSync(candidate));
    if (!browser) throw new Error('No se encontró Chrome/Edge instalado');
    return browser;
}

async function freePort() {
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
    const ids = [
        'pacienteHeader','datosContent','documentosContent','historialTomasContent','medsContent',
        'citasHistorialContent','citasContent','tareasContent','historialTareasContent','sintomasContent',
        'signosContent','contactosContent','notasContent','notifPanelBody'
    ];
    return `<!doctype html><html><head><meta charset="utf-8"><title>P0-A browser fixture</title></head>
    <body><main id="fixture">${ids.map(id => `<section id="${id}"></section>`).join('')}</main>
    <script>window.__xssSentinel=0;window.alert=()=>window.__xssSentinel++;window.addEventListener('error',e=>{if(/fixture-xss/.test(String(e.message)))window.__xssSentinel++;});</script>
    <script src="/js/api-b2b.js"></script><script src="/js/utils-b2b.js"></script></body></html>`;
}

function createServer(requestLog) {
    const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml' };
    return http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        requestLog.push({ method: req.method, path: url.pathname });
        if (url.pathname === '/p0-a-fixture.html') {
            res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
            return res.end(fixtureHtml());
        }
        if (url.pathname.startsWith('/api/b2b/')) {
            res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
            return res.end(JSON.stringify({ ok: true }));
        }
        let relative = decodeURIComponent(url.pathname);
        if (relative === '/') relative = '/index.html';
        const target = path.resolve(FRONTEND_ROOT, `.${relative}`);
        if (!target.startsWith(`${FRONTEND_ROOT}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
            res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'no-store' });
        fs.createReadStream(target).pipe(res);
    });
}

class Cdp {
    constructor(url) { this.ws = new WebSocket(url); this.id = 1; this.pending = new Map(); this.waiters = new Map(); }
    async connect() {
        this.ws.addEventListener('message', async event => {
            const raw = typeof event.data === 'string' ? event.data : await event.data.text();
            const msg = JSON.parse(raw);
            if (msg.id) {
                const pending = this.pending.get(msg.id); if (!pending) return;
                this.pending.delete(msg.id); msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result); return;
            }
            const waiters = this.waiters.get(msg.method); if (waiters?.length) waiters.shift()(msg.params);
        });
        if (this.ws.readyState !== WebSocket.OPEN) await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout WebSocket')), 10000);
            this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once:true });
            this.ws.addEventListener('error', reject, { once:true });
        });
    }
    send(method, params = {}) { const id = this.id++; return new Promise((resolve,reject) => { this.pending.set(id,{resolve,reject}); this.ws.send(JSON.stringify({id,method,params})); }); }
    wait(method, timeout = 10000) { return new Promise((resolve,reject) => { const list=this.waiters.get(method)||[]; const timer=setTimeout(()=>reject(new Error(`Timeout ${method}`)),timeout); list.push(value=>{clearTimeout(timer);resolve(value);}); this.waiters.set(method,list); }); }
    async navigate(url) { const loaded=this.wait('Page.loadEventFired'); await this.send('Page.navigate',{url}); await loaded; }
    async reload() { const loaded=this.wait('Page.loadEventFired'); await this.send('Page.reload',{ignoreCache:false}); await loaded; }
    async eval(expression) {
        const result = await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    }
    close() { this.ws.close(); }
}

async function debugVersion(port) {
    for (let i=0;i<100;i++) { try { const r=await fetch(`http://127.0.0.1:${port}/json/version`); if(r.ok)return r.json(); } catch {} await new Promise(r=>setTimeout(r,100)); }
    throw new Error('Chrome no expuso DevTools');
}

async function closeServer(server) {
    if (!server.listening) return;
    const done = new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    server.closeAllConnections?.(); await done;
}

async function stop(child) {
    if (!child || child.exitCode !== null) return;
    const done = new Promise(resolve=>child.once('exit',resolve)); child.kill();
    await Promise.race([done,new Promise(resolve=>setTimeout(resolve,3000))]);
}

async function run() {
    const chromePath=findChrome(), httpPort=await freePort(), debugPort=await freePort();
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cuidadiario-p0-a-'));
    const requests=[]; const server=createServer(requests); const base=`http://127.0.0.1:${httpPort}`;
    let chrome, cdp, assertions=0;
    const check=(a,e,m)=>{assert.deepEqual(a,e,m);assertions++;};
    try {
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(httpPort,'127.0.0.1',resolve);});
        chrome=spawn(chromePath,[
            '--headless=new','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-gpu','--disable-sync',
            '--metrics-recording-only','--no-default-browser-check','--no-first-run','--remote-allow-origins=*',
            `--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'about:blank'
        ],{stdio:['ignore','ignore','pipe'],windowsHide:true});
        await debugVersion(debugPort);
        const target=await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(base+'/p0-a-fixture.html')}`,{method:'PUT'})).json();
        cdp=new Cdp(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
        await cdp.navigate(base+'/p0-a-fixture.html');

        const queueBytes='[  {"method":"POST","path":"/api/b2b/notas","body":{"texto":"á<&>"}}  ]';
        await cdp.eval(`(() => { localStorage.setItem('cd_offline_queue', ${JSON.stringify(queueBytes)}); localStorage.setItem('b2c_fixture','preservar'); API_B2B.BASE_URL=${JSON.stringify(base)}; })()`);
        await cdp.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0,connectionType:'none'});
        const offlineWrites=await cdp.eval(`(async()=>{const out=[];for(const [name,fn] of [['POST',()=>API_B2B.post('/api/b2b/notas',{x:1})],['PATCH',()=>API_B2B.patch('/api/b2b/notas/1',{x:2})],['DELETE',()=>API_B2B.del('/api/b2b/notas/1')]]){try{await fn();out.push({name,ok:true});}catch(e){out.push({name,ok:false,message:e.message,queued:Object.prototype.hasOwnProperty.call(e,'queued')});}}return {out,queue:localStorage.getItem('cd_offline_queue'),b2c:localStorage.getItem('b2c_fixture')};})()`);
        check(offlineWrites.out.every(x=>!x.ok&&/Sin conexión/.test(x.message)&&!x.queued),true,'mutaciones reales offline fallan sin falso queued');
        check(offlineWrites.queue,queueBytes,'Chrome preserva cola byte por byte tras tres mutaciones');
        check(offlineWrites.b2c,'preservar','Chrome preserva clave no-B2B');
        await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'wifi'});
        const writesBefore=requests.filter(r=>r.method!=='GET'&&r.path.startsWith('/api/b2b/')).length;
        await cdp.eval(`window.dispatchEvent(new Event('online')); new Promise(r=>setTimeout(r,150))`);
        await cdp.reload();
        const writesAfter=requests.filter(r=>r.method!=='GET'&&r.path.startsWith('/api/b2b/')).length;
        check(writesAfter,writesBefore,'reconexión y reload no transmiten cola heredada');
        check(await cdp.eval(`localStorage.getItem('cd_offline_queue')`),queueBytes,'reconexión y reload conservan bytes exactos');

        await cdp.eval(`(() => { const p=btoa(JSON.stringify({b2b:true,exp:Math.floor(Date.now()/1000)+3600})).replace(/=/g,'').replace(/\\+/g,'-').replace(/\\//g,'_'); API_B2B.setToken('e30.'+p+'.fixture'); API_B2B.setUser({id:1,nombre:'Fixture Admin',rol:'admin_institucion'}); })()`);
        await cdp.eval(`new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/js/paciente.js';s.onload=resolve;s.onerror=reject;document.body.appendChild(s);})`);
        const xss=await cdp.eval(`(async()=>{
            const script='<script>window.__xssSentinel++<\\/script>';
            const img='<img src=x onerror="window.__xssSentinel++">';
            const svg='<svg onload="window.__xssSentinel++"></svg>';
            const attr='x\\" onmouseover=\\"window.__xssSentinel++';
            const close='</div><script>window.__xssSentinel++<\\/script>';
            const normal='María Pérez'; const clinical='Dolor leve 3/10; presión 120/80';
            _isAdmin=true;_isReadOnly=false;_isEgresado=false;
            const patient={id:'1);window.__xssSentinel++//',nombre:script,apellido:normal,fecha_nacimiento:img,habitacion:attr,dni:close,obra_social:'A & B < C > D',diagnostico:svg,alergias:'Penicilina',antecedentes:'Línea 1\\nLínea 2',notas_ingreso:'HTML benigno <b>sin formato</b>',contacto_familiar_nombre:'Clínica Ñandú 🩺',contacto_familiar_tel:'\\" onclick=window.__xssSentinel++',fecha_ingreso:'2026-01-01'};
            renderPacienteHeader(patient);renderDatosTab(patient);
            _documentos=[{id:'2);window.__xssSentinel++//',nombre_archivo:attr+'.pdf',tipo_mime:'application/pdf',tamanio_bytes:100,subido_nombre:img,created_at:'2026-01-01'}];renderDocumentos(_documentos);
            _meds=[{id:'3);window.__xssSentinel++//',nombre:"O'Hara "+img,dosis:'5 "mg"',frecuencia:clinical,horarios_custom:'08:00',instrucciones:close,stock:'<svg onload=x>',catalogo_id:null}];renderMedicamentos(_meds);
            _citas=[{id:'4);window.__xssSentinel++//',titulo:svg,fecha:'2026-01-01T10:00:00',especialidad:normal,medico:img,lugar:close,estado:attr}];renderCitas(_citas);
            _tareas=[{id:'5);window.__xssSentinel++//',titulo:script,descripcion:img,hora:attr,frecuencia:normal,categoria:close}];renderTareas(_tareas);
            _sintomas=[{id:'6);window.__xssSentinel++//',descripcion:clinical+img,intensidad:'7\\" onmouseover=x',fecha:'2026-01-01',registrador_nombre:svg}];renderSintomas(_sintomas);
            _signos=[{id:'7);window.__xssSentinel++//',tipo:svg,valor:img,unidad:attr,fecha:'2026-01-01',registrador_nombre:close}];renderSignos(_signos);
            _contactos=[{id:'8);window.__xssSentinel++//',nombre:normal+img,relacion:close,telefono:'javascript:window.__xssSentinel++',email:'javascript:window.__xssSentinel++',es_principal:true}];renderContactos(_contactos);
            _notas=[{id:'9);window.__xssSentinel++//',titulo:script,contenido:'Texto multilínea\\n'+img,autor_nombre:svg,created_at:'2026-01-01',urgente:true}];renderNotas(_notas);
            showToast(img,'error',5000);showToast('<b>HTML benigno</b>','info',5000);
            API_B2B.getNotificaciones=async()=>({items:[{href:'javascript:window.__xssSentinel++',icono:svg,titulo:script,descripcion:img,ts:'2026-01-01',es_nuevo:true},{href:'paciente.html?id=1',icono:'✅',titulo:'Normal',descripcion:clinical,ts:'2026-01-01'}]});
            await _renderNotifPanel();await new Promise(r=>setTimeout(r,250));
            const root=document.getElementById('fixture');
            const executable=root.querySelectorAll('script,[onerror],[onload],[onmouseover]').length;
            const hrefs=[...root.querySelectorAll('a')].map(a=>({raw:a.getAttribute('href'),protocol:a.protocol,host:a.host}));
            return {sentinel:window.__xssSentinel,executable,text:root.textContent,hrefs,notif:[...document.querySelectorAll('#notifPanelBody a')].map(a=>a.getAttribute('href')),buttons:[...root.querySelectorAll('button[onclick]')].map(b=>b.getAttribute('onclick'))};
        })()`);
        check(xss.sentinel,0,'ningún payload ejecutó JavaScript en Chrome');
        check(xss.executable,0,'payloads no crearon nodos ni handlers ejecutables');
        check(xss.text.includes('María Pérez'),true,'nombre normal continúa visible');
        check(xss.text.includes('Dolor leve 3/10; presión 120/80'),true,'contenido clínico ficticio continúa visible');
        check(xss.text.includes('Clínica Ñandú 🩺'),true,'Unicode continúa visible');
        check(xss.text.includes('HTML benigno <b>sin formato</b>'),true,'HTML benigno se muestra como texto literal');
        check(xss.buttons.every(value=>!/window|script|onerror|onload|onmouseover/.test(value)),true,'handlers legítimos no contienen texto externo');
        check(xss.hrefs.every(link=>['http:','https:','tel:','mailto:'].includes(link.protocol)),true,'enlaces renderizados usan protocolos permitidos');
        check(xss.notif[0],'#','notificación javascript queda neutralizada');
        check(xss.notif[1].includes('/pages/paciente.html?id=1'),true,'notificación local legítima conserva navegación');

        const version=await cdp.send('Browser.getVersion');
        console.log(JSON.stringify({result:'PASS',assertions,environment:{browser:version.product,node:process.version,origin:base,profile:'temporary-isolated'},evidence:{offlineWrites,queueAfterReload:await cdp.eval(`localStorage.getItem('cd_offline_queue')`),automaticMutationRequests:writesAfter-writesBefore,xss}},null,2));
    } finally {
        if(cdp)cdp.close(); await closeServer(server).catch(()=>{}); await stop(chrome);
        const temp=path.resolve(os.tmpdir()), resolved=path.resolve(profile);
        if(!resolved.startsWith(`${temp}${path.sep}`)||!path.basename(resolved).startsWith('cuidadiario-p0-a-'))throw new Error(`Perfil temporal inesperado: ${resolved}`);
        fs.rmSync(resolved,{recursive:true,force:true});
    }
}

run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
