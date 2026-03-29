/* ============================================================
   configuracion.js — Lógica de la página de configuración B2B
   CuidaDiario PRO
   ============================================================ */

'use strict';

async function initConfiguracion() {
    requireAuth();
    initSidebar();
    populateSidebarUser();

    const user = JSON.parse(localStorage.getItem('cd_pro_user') || '{}');
    const isAdmin = user.rol === 'admin_institucion';

    // Ocultar secciones de admin si no es admin
    if (!isAdmin) {
        document.querySelectorAll('.admin-only').forEach(el => {
            if (!el.classList.contains('nav-item') && !el.classList.contains('nav-section-label')) {
                el.style.display = 'none';
            }
        });
    }

    // Familiar: reemplazar nav por versión restringida
    if (user.rol === 'familiar') {
        const nav = document.querySelector('.sidebar-nav');
        if (nav) nav.innerHTML = `
            <a href="familiar.html" class="nav-item"><span class="nav-icon">👤</span><span class="nav-label">Mi familiar</span></a>
            <a href="configuracion.html" class="nav-item active"><span class="nav-icon">⚙️</span><span class="nav-label">Configuración</span></a>`;
    }

    // Llenar perfil con datos del token
    document.getElementById('perfilNombre').value = user.nombre || '';
    document.getElementById('perfilEmail').value = user.email || '';
    document.getElementById('perfilRol').value = formatRol(user.rol);

    // Cargar datos de institución (solo admin)
    if (isAdmin) {
        cargarInstitucion();
        loadPermisos();
        await cargarEstadoPlan();
        // Si llegamos desde el overlay de trial vencido con ?autoplan=xxx,
        // disparar la suscripción automáticamente sin que el usuario tenga que
        // buscar el botón correcto.
        const _autoplan = new URLSearchParams(window.location.search).get('autoplan');
        if (_autoplan && ['basico', 'pro', 'total'].includes(_autoplan)) {
            setTimeout(() => suscribirPlan(_autoplan, false), 300);
        }
    }
    loadNotifPrefs();
    loadSharedMode();
}

function formatRol(rol) {
    const map = {
        admin_institucion: 'Administrador',
        cuidador_staff: 'Personal / Operativo',
        familiar: 'Familiar',
        medico: 'Médico'
    };
    return map[rol] || rol || '';
}

async function cargarInstitucion() {
    try {
        const res = await API_B2B.get('/api/b2b/institucion');
        const inst = res.institucion || res;
        document.getElementById('instNombre').value = inst.nombre || '';
        document.getElementById('instTipo').value = inst.tipo || '';
        document.getElementById('instTelefono').value = inst.telefono || '';
        document.getElementById('instEmail').value = inst.email || '';
        document.getElementById('instDireccion').value = inst.direccion || '';

        // Sincronizar shared_mode desde la DB (fuente de verdad cross-device)
        const sharedMode = !!inst.shared_mode;
        if (sharedMode) {
            localStorage.setItem('cd_shared_mode', '1');
        } else {
            localStorage.removeItem('cd_shared_mode');
        }
        const smToggle = document.getElementById('sharedModeToggle');
        if (smToggle) smToggle.checked = sharedMode;
        const smInfo = document.getElementById('sharedModeInfo');
        if (smInfo) smInfo.style.display = sharedMode ? '' : 'none';

        // Actualizar nombre en topbar
        if (inst.nombre) {
            const tb = document.getElementById('topbarInstitucion');
            if (tb) tb.textContent = inst.nombre;
        }

        // Cargar permisos desde la DB (campo permisos_equipo de la institución)
        _loadPermisosFromObj(inst.permisos_equipo || {});
    } catch (e) {
        // silencioso — puede fallar en roles no admin
    }
}

async function guardarPerfil(e) {
    e.preventDefault();
    const form = e.target;
    const nombre = form.nombre.value.trim();
    const email = form.email.value.trim();

    if (!nombre || !email) {
        showToast('Completá nombre y email', 'warning');
        return;
    }

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        await API_B2B.patch('/api/b2b/auth/me', { nombre, email });

        // Actualizar datos locales
        const user = JSON.parse(localStorage.getItem('cd_pro_user') || '{}');
        user.nombre = nombre;
        user.email = email;
        localStorage.setItem('cd_pro_user', JSON.stringify(user));

        // Refrescar sidebar
        populateSidebarUser();
        showToast('Perfil actualizado ✅', 'success');
    } catch (err) {
        showToast(err.message || 'Error al guardar perfil', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar perfil';
    }
}

async function cambiarPassword(e) {
    e.preventDefault();
    const form = e.target;
    const passwordActual = form.passwordActual.value;
    const passwordNueva = form.passwordNueva.value;
    const passwordConfirm = form.passwordConfirm.value;

    if (!passwordActual || !passwordNueva) {
        showToast('Completá todos los campos', 'warning');
        return;
    }
    if (passwordNueva !== passwordConfirm) {
        showToast('Las contraseñas no coinciden', 'error');
        return;
    }
    if (passwordNueva.length < 8) {
        showToast('La contraseña debe tener al menos 8 caracteres', 'warning');
        return;
    }

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        await API_B2B.patch('/api/b2b/auth/me', { password_actual: passwordActual, password_nueva: passwordNueva });
        showToast('Contraseña actualizada ✅', 'success');
        form.reset();
    } catch (err) {
        showToast(err.message || 'Error al cambiar contraseña', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Cambiar contraseña';
    }
}

async function guardarInstitucion(e) {
    e.preventDefault();
    const form = e.target;
    const telefono = form.telefono.value.trim();

    if (!form.nombre.value.trim()) {
        showToast('El nombre de la institución es obligatorio', 'warning');
        return;
    }
    if (telefono && (/[a-zA-Z]/.test(telefono) || !/^[\+\d\s\-\(\)]{6,25}$/.test(telefono))) {
        showToast('El teléfono ingresado no es válido. Usá solo números, espacios, guiones y paréntesis.', 'warning');
        return;
    }

    const payload = {
        nombre: form.nombre.value.trim(),
        tipo: form.tipo.value,
        telefono: telefono,
        email: form.email.value.trim(),
        direccion: form.direccion.value.trim()
    };

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        await API_B2B.patch('/api/b2b/institucion', payload);
        showToast('Institución actualizada ✅', 'success');

        const tb = document.getElementById('topbarInstitucion');
        if (tb) tb.textContent = payload.nombre;
    } catch (err) {
        showToast(err.message || 'Error al guardar institución', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar institución';
    }
}

// ============================================
// CATÁLOGO DE INSUMOS — siempre activo (modelo híbrido)
// ============================================

// ============================================
// ALERTAS DEL DASHBOARD — persistencia en DB
// ============================================
const NOTIF_IDS = ['notifSintomas', 'notifNotas', 'notifCitas', 'notifStock'];

async function loadNotifPrefs() {
    try {
        const prefs = await API_B2B.getNotifPrefs();
        NOTIF_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el && id in prefs) el.checked = prefs[id];
        });
    } catch {
        // Fallback silencioso: si no hay conexión, los toggles quedan en su estado por defecto
    }
}

async function guardarNotifPrefs() {
    const prefs = {};
    NOTIF_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) prefs[id] = el.checked;
    });
    try {
        await API_B2B.saveNotifPrefs(prefs);
        // Sincronizar en el objeto local para que _applyNotifPrefs() funcione sin re-login
        const _u = API_B2B.getUser();
        if (_u) { _u.notif_prefs = prefs; API_B2B.setUser(_u); }
        showToast('Preferencias de alertas guardadas ✅', 'success');
    } catch (err) {
        showToast('Error al guardar preferencias: ' + err.message, 'error');
    }
}

// ============================================
// CACHÉ DE LA APP
// ============================================
async function limpiarCache() {
    const btn = document.getElementById('btnLimpiarCache');
    if (btn) { btn.disabled = true; btn.textContent = 'Limpiando...'; }
    try {
        // 1. Borrar todos los caches del Cache Storage de este origen
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        // 2. Dar de baja el service worker para que se vuelva a registrar con los archivos nuevos
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(r => r.unregister()));
        }
        showToast('Caché limpiado. Recargando…', 'success');
        setTimeout(() => window.location.reload(true), 900);
    } catch (err) {
        showToast('No se pudo limpiar el caché: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Limpiar caché y recargar'; }
    }
}

// ============================================
// MODO ESTACIÓN COMPARTIDA
// ============================================
function loadSharedMode() {
    const enabled = !!localStorage.getItem('cd_shared_mode');
    const toggle = document.getElementById('sharedModeToggle');
    const info   = document.getElementById('sharedModeInfo');
    if (toggle) toggle.checked = enabled;
    if (info)   info.style.display = enabled ? '' : 'none';
}

function toggleSharedMode(enabled) {
    const info = document.getElementById('sharedModeInfo');
    if (enabled) {
        localStorage.setItem('cd_shared_mode', '1');
        if (info) info.style.display = '';
        // Persistir en la DB para sincronización cross-device
        API_B2B.updateInstitucion({ shared_mode: true }).catch(err => console.warn('[shared_mode] Error guardando en DB:', err.message));
        // Si no hay nadie activo, abrir el selector enseguida
        if (!sessionStorage.getItem('cd_active_worker')) {
            setTimeout(() => openWorkerSwitcher(), 350);
        }
        showToast('Modo estación compartida activado ✅', 'success');
    } else {
        localStorage.removeItem('cd_shared_mode');
        sessionStorage.removeItem('cd_active_worker');
        if (info) info.style.display = 'none';
        document.getElementById('workerChip')?.remove();
        // Persistir en la DB para sincronización cross-device
        API_B2B.updateInstitucion({ shared_mode: false }).catch(err => console.warn('[shared_mode] Error guardando en DB:', err.message));
        showToast('Modo estación compartida desactivado', 'info');
    }
}
// ============================================
// PERMISOS DEL EQUIPO (configurable por admin)
// ============================================
const PERM_KEYS = [
    'medico_crear_paciente',
    'medico_editar_paciente',
    'medico_dar_alta',
    'cuidador_staff_crear_paciente',
    'cuidador_staff_editar_paciente',
    'cuidador_staff_dar_alta',
];

const PERM_DEFAULTS = {
    medico_crear_paciente:           true,
    medico_editar_paciente:          true,
    medico_dar_alta:                 true,
    cuidador_staff_crear_paciente:   true,
    cuidador_staff_editar_paciente:  true,
    cuidador_staff_dar_alta:         false,
};

function _loadPermisosFromObj(perms) {
    PERM_KEYS.forEach(k => {
        const el = document.getElementById('perm_' + k);
        if (!el) return;
        el.checked = k in perms ? !!perms[k] : (PERM_DEFAULTS[k] ?? false);
    });
}

function loadPermisos() {
    // Attempt to load from the user object (populated on login with institucion_permisos)
    try {
        const user = JSON.parse(localStorage.getItem('cd_pro_user') || '{}');
        if (user.institucion_permisos && Object.keys(user.institucion_permisos).length > 0) {
            _loadPermisosFromObj(user.institucion_permisos);
            return;
        }
    } catch {}
    // Fallback: legacy localStorage config
    try {
        const stored = JSON.parse(localStorage.getItem('cd_perm_config') || '{}');
        _loadPermisosFromObj(stored);
    } catch {}
}

async function guardarPermisos() {
    const out = {};
    PERM_KEYS.forEach(k => {
        const el = document.getElementById('perm_' + k);
        if (el) out[k] = el.checked;
    });
    const btn = document.getElementById('btnGuardarPermisos');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
    try {
        // Persistir en la DB para que todos los usuarios de la institución reciban los permisos
        await API_B2B.patch('/api/b2b/institucion', { permisos_equipo: out });
        // Actualizar el objeto user local para que canDo() se actualice sin re-login
        const user = JSON.parse(localStorage.getItem('cd_pro_user') || '{}');
        user.institucion_permisos = out;
        localStorage.setItem('cd_pro_user', JSON.stringify(user));
        // También actualizar localStorage legacy por si acaso
        localStorage.setItem('cd_perm_config', JSON.stringify(out));
        showToast('Permisos del equipo guardados \u2705', 'success');
    } catch (err) {
        showToast(err.message || 'Error al guardar permisos', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '\uD83D\uDD10 Guardar permisos'; }
    }
}
async function exportarDatos() {
    showToast('Generando reporte... puede tardar unos segundos.', 'info');
    try {
        const d = await API_B2B.get('/api/b2b/reporte/export');
        const html = buildExportHTML(d);
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
    } catch (e) {
        showToast('Error al exportar datos', 'error');
    }
}

function esc(v) {
    if (v === null || v === undefined || v === '') return '—';
    return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric'}); } catch { return iso; }
}
function fDateTime(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}); } catch { return iso; }
}
function tipoLabel(t) {
    const m = {geriatrico:'Geriátrico',discapacidad:'Centro discapacidad',salud_mental:'Salud mental',rehabilitacion:'Rehabilitación',oncologia:'Oncológico',dialisis:'Diálisis',hogar_convivencial:'Hogar convivencial',pediatrico_especial:'Pediátrico especial',cuidado_domiciliario:'Cuidado domiciliario',clinica:'Clínica',otro:'Otro'};
    return m[t] || esc(t);
}
function rolLabel(r) {
    const m = {admin_institucion:'Administrador',cuidador_staff:'Personal / Operativo',familiar:'Familiar / Referente',medico:'Médico / Profesional'};
    return m[r] || esc(r);
}

function buildExportHTML(d) {
    const inst = d.institucion || {};
    const pacientes = d.pacientes || [];
    const staff = d.staff || [];
    const meds = d.medicamentos || [];
    const histMeds = d.historial_medicamentos || [];
    const citas = d.citas || [];
    const sintomas = d.sintomas || [];
    const signos = d.signos_vitales || [];
    const notas = d.notas || [];
    const exportadoEn = fDateTime(d.exportado_en);

    // ── helpers para construir tablas ──────────────────────────
    function table(headers, rows) {
        if (!rows.length) return '<p style="color:#9CA3AF;font-size:.85rem;padding:8px 0">Sin registros.</p>';
        const ths = headers.map(h => `<th>${h}</th>`).join('');
        const trs = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
        return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    }
    function section(title, content) {
        return `<div class="section"><h2>${title}</h2>${content}</div>`;
    }
    function subsection(title, content) {
        return `<div class="subsection"><h3>${title}</h3>${content}</div>`;
    }

    // ── pacientes con sus registros ───────────────────────────
    let pacientesHTML = '';
    if (!pacientes.length) {
        pacientesHTML = '<p style="color:#9CA3AF">Sin pacientes registrados.</p>';
    } else {
        pacientesHTML = pacientes.map((p, i) => {
            const pid = p.id;
            const pMeds    = meds.filter(m => m.paciente_id === pid);
            const pTomas   = histMeds.filter(m => m.paciente_id === pid).slice(0, 30);
            const pCitas   = citas.filter(c => c.paciente_id === pid);
            const pSint    = sintomas.filter(s => s.paciente_id === pid).slice(0, 30);
            const pSignos  = signos.filter(s => s.paciente_id === pid).slice(0, 30);
            const pNotas   = notas.filter(n => n.paciente_id === pid);
            const edad = p.fecha_nacimiento ? (() => { const hoy=new Date(),nac=new Date(p.fecha_nacimiento); let e=hoy.getFullYear()-nac.getFullYear(); if(hoy.getMonth()-nac.getMonth()<0||(hoy.getMonth()-nac.getMonth()===0&&hoy.getDate()<nac.getDate()))e--; return e+' años'; })() : '';

            return `
            <div class="paciente-block${i>0?' mt-break':''}">
                <div class="paciente-header">
                    <div class="paciente-initials">${esc((p.apellido||p.nombre||'?').charAt(0).toUpperCase())}</div>
                    <div>
                        <div class="paciente-name">${esc(p.apellido||'')} ${esc(p.nombre)}</div>
                        <div class="paciente-meta">
                            ${p.fecha_nacimiento?'Nac: '+fDate(p.fecha_nacimiento)+(edad?' ('+edad+')':''):''}
                            ${p.habitacion?' · Hab. '+esc(p.habitacion):''}
                            ${p.dni?' · DNI: '+esc(p.dni):''}
                        </div>
                    </div>
                </div>
                <div class="paciente-body">
                    <div class="info-grid">
                        <div class="info-item"><span class="info-label">Diagnóstico</span><span>${esc(p.diagnostico)}</span></div>
                        <div class="info-item"><span class="info-label">Médico de cabecera</span><span>${esc(p.medico_cabecera)}</span></div>
                        <div class="info-item"><span class="info-label">Obra social</span><span>${esc(p.obra_social)}${p.num_afiliado?' — Afil. '+esc(p.num_afiliado):''}</span></div>
                        <div class="info-item"><span class="info-label">Fecha de ingreso</span><span>${fDate(p.fecha_ingreso)}</span></div>
                        ${p.fecha_egreso?`<div class="info-item"><span class="info-label">Fecha de egreso</span><span>${fDate(p.fecha_egreso)}</span></div>`:''}
                        ${p.motivo_egreso?`<div class="info-item"><span class="info-label">Motivo de egreso</span><span>${esc(p.motivo_egreso)}</span></div>`:''}
                        <div class="info-item"><span class="info-label">Contacto familiar</span><span>${esc(p.contacto_familiar_nombre)}${p.contacto_familiar_tel?' — '+esc(p.contacto_familiar_tel):''}</span></div>
                    </div>
                    ${p.alergias?`<div class="alerta-alergias">⚠️ <strong>Alergias:</strong> ${esc(p.alergias)}</div>`:''}
                    ${p.antecedentes?`<div class="antecedentes"><strong>Antecedentes clínicos:</strong> ${esc(p.antecedentes)}</div>`:''}
                    ${p.notas_ingreso?`<div class="antecedentes"><strong>Notas de ingreso:</strong> ${esc(p.notas_ingreso)}</div>`:''}

                    ${subsection('Medicación activa', table(
                        ['Medicamento','Dosis','Frecuencia','Horario','Stock'],
                        pMeds.map(m => [esc(m.nombre), esc(m.dosis), esc(m.frecuencia), esc(m.horarios_custom||m.hora_inicio), m.stock!=null?esc(m.stock):'—'])
                    ))}

                    ${pTomas.length ? subsection(`Historial de tomas (últimas ${pTomas.length})`, table(
                        ['Fecha','Medicamento','Administrado por','Notas'],
                        pTomas.map(t => [fDateTime(t.fecha), esc(t.medicamento_nombre), esc(t.administrador_nombre), esc(t.notas)])
                    )) : ''}

                    ${pCitas.length ? subsection('Citas y turnos', table(
                        ['Fecha','Título','Especialidad','Médico','Estado'],
                        pCitas.map(c => [fDateTime(c.fecha), esc(c.titulo), esc(c.especialidad), esc(c.medico), esc(c.estado)])
                    )) : ''}

                    ${pSint.length ? subsection(`Síntomas registrados (últimos ${pSint.length})`, table(
                        ['Fecha','Descripción','Intensidad','Registrado por'],
                        pSint.map(s => [fDateTime(s.fecha), esc(s.descripcion), s.intensidad?s.intensidad+'/10':'—', esc(s.registrador_nombre)])
                    )) : ''}

                    ${pSignos.length ? subsection(`Signos vitales (últimos ${pSignos.length})`, table(
                        ['Fecha','Tipo','Valor','Unidad','Notas'],
                        pSignos.map(s => [fDateTime(s.fecha), esc(s.tipo), esc(s.valor), esc(s.unidad), esc(s.notas)])
                    )) : ''}

                    ${pNotas.length ? subsection('Notas internas', table(
                        ['Fecha','Título','Contenido','Autor','Urgente'],
                        pNotas.map(n => [fDateTime(n.created_at), esc(n.titulo), esc(n.contenido), esc(n.autor_nombre), n.urgente?'⚠️ Sí':'No'])
                    )) : ''}
                </div>
            </div>`;
        }).join('');
    }

    // ── staff ─────────────────────────────────────────────────
    const staffHTML = table(
        ['Nombre','Email','Rol','Turno','Estado'],
        staff.map(u => [esc(u.nombre), esc(u.email), rolLabel(u.rol), esc(u.turno), u.activo?'Activo':'Inactivo'])
    );

    // ── CSS ───────────────────────────────────────────────────
    const css = `
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1F2937;background:#fff;padding:0}
        .page{max-width:900px;margin:0 auto;padding:32px 28px 48px}
        /* Header institución */
        .inst-header{background:linear-gradient(135deg,#0D2B6B,#1565C0);color:#fff;border-radius:12px;padding:24px 28px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:flex-start}
        .inst-name{font-size:1.5rem;font-weight:800;margin-bottom:4px}
        .inst-meta{font-size:.82rem;opacity:.8;line-height:1.7}
        .inst-badge{background:rgba(255,255,255,0.18);font-size:.72rem;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;margin-top:4px;display:inline-block}
        /* Resumen */
        .resumen-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:28px}
        .resumen-card{background:#EEF2FF;border-radius:10px;padding:14px 16px;text-align:center}
        .resumen-num{font-size:1.6rem;font-weight:800;color:#1565C0}
        .resumen-label{font-size:.75rem;color:#4B5563;margin-top:2px}
        /* Secciones */
        .section{margin-bottom:32px}
        .section h2{font-size:1rem;font-weight:700;color:#1565C0;border-bottom:2px solid #EEF2FF;padding-bottom:8px;margin-bottom:16px}
        .subsection{margin-top:14px;margin-bottom:10px}
        .subsection h3{font-size:.82rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;background:#F9FAFB;padding:5px 10px;border-radius:6px}
        /* Tabla */
        table{width:100%;border-collapse:collapse;font-size:.82rem;margin-bottom:4px}
        thead tr{background:#1565C0;color:#fff}
        th{padding:7px 10px;text-align:left;font-weight:600}
        td{padding:6px 10px;border-bottom:1px solid #E5E7EB;vertical-align:top}
        tr:nth-child(even) td{background:#F9FAFB}
        /* Paciente */
        .paciente-block{border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:24px;page-break-inside:avoid}
        .paciente-header{background:linear-gradient(135deg,#1E40AF,#1565C0);padding:16px 20px;display:flex;align-items:center;gap:14px}
        .paciente-initials{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.2);color:#fff;font-size:1.2rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .paciente-name{color:#fff;font-weight:700;font-size:1rem}
        .paciente-meta{color:rgba(255,255,255,0.75);font-size:.78rem;margin-top:2px}
        .paciente-body{padding:16px 20px}
        .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-bottom:12px}
        .info-item{display:flex;flex-direction:column;padding:6px 0;border-bottom:1px solid #F3F4F6}
        .info-label{font-size:.72rem;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:.03em}
        .alerta-alergias{background:#FEF2F2;border-left:4px solid #EF4444;border-radius:0 8px 8px 0;padding:10px 14px;margin:10px 0;color:#7F1D1D;font-size:.85rem}
        .antecedentes{background:#F0F4FF;border-radius:8px;padding:10px 14px;margin:8px 0;font-size:.83rem;color:#374151}
        /* Print */
        .print-bar{position:fixed;top:0;left:0;right:0;background:#1565C0;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;z-index:999;font-size:.88rem}
        .print-bar button{background:#fff;color:#1565C0;border:none;padding:7px 18px;border-radius:6px;font-weight:700;cursor:pointer;font-size:.88rem}
        .print-bar button:hover{background:#EEF2FF}
        .mt-break{margin-top:20px}
        .footer{text-align:center;font-size:.75rem;color:#9CA3AF;margin-top:40px;padding-top:16px;border-top:1px solid #E5E7EB}
        @media print{
            .print-bar{display:none!important}
            body{padding:0}
            .page{padding:16px}
            .paciente-block{page-break-inside:avoid}
        }
    `;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte institucional — ${esc(inst.nombre)} — ${fDate(new Date().toISOString())}</title>
<style>${css}</style>
</head>
<body>

<div class="print-bar">
    <span>📄 Reporte institucional — ${esc(inst.nombre)}</span>
    <button onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
</div>

<div class="page" style="margin-top:52px">

    <!-- Header institución -->
    <div class="inst-header">
        <div>
            <div class="inst-name">🏥 ${esc(inst.nombre)}</div>
            <div class="inst-meta">
                ${tipoLabel(inst.tipo)}<br>
                ${inst.direccion?esc(inst.direccion)+'<br>':''}
                ${inst.telefono?'Tel: '+esc(inst.telefono)+'  ·  ':''}${inst.email?esc(inst.email):''}
            </div>
        </div>
        <div style="text-align:right">
            <div class="inst-badge">CuidaDiario PRO</div>
            <div style="font-size:.72rem;opacity:.7;margin-top:6px">Generado: ${exportadoEn}</div>
        </div>
    </div>

    <!-- Resumen -->
    <div class="resumen-grid">
        <div class="resumen-card"><div class="resumen-num">${pacientes.length}</div><div class="resumen-label">Residentes</div></div>
        <div class="resumen-card"><div class="resumen-num">${staff.length}</div><div class="resumen-label">Usuarios staff</div></div>
        <div class="resumen-card"><div class="resumen-num">${meds.length}</div><div class="resumen-label">Medicamentos</div></div>
        <div class="resumen-card"><div class="resumen-num">${histMeds.length}</div><div class="resumen-label">Tomas registradas</div></div>
        <div class="resumen-card"><div class="resumen-num">${citas.length}</div><div class="resumen-label">Citas</div></div>
        <div class="resumen-card"><div class="resumen-num">${sintomas.length}</div><div class="resumen-label">Síntomas</div></div>
    </div>

    ${section('👥 Personal / Staff', staffHTML)}

    ${section('📋 Fichas de residentes / pacientes', pacientesHTML)}

    <div class="footer">Reporte generado por CuidaDiario PRO — EDEN SoftWork &nbsp;·&nbsp; ${exportadoEn}</div>
</div>
</body>
</html>`;
}

document.addEventListener('DOMContentLoaded', initConfiguracion);

// ============================================
// PLAN & SUSCRIPCIÓN
// ============================================
async function cargarEstadoPlan() {
    try {
        const inst = await API_B2B.get('/api/b2b/institucion');
        const data = inst.institucion || inst;
        let plan = data.plan || 'free';
        // Si sigue en 'free', verificar si los 60 días de prueba ya vencieron
        if (plan === 'free' && data.trial_started_at) {
            const trialEnd = new Date(data.trial_started_at);
            trialEnd.setDate(trialEnd.getDate() + 60);
            if (trialEnd < new Date()) plan = 'expired';
        }
        const pacientesCount = parseInt(data.pacientes_count) || 0;
        const staffCount     = parseInt(data.staff_count)     || 0;
        renderPlanBadge(plan, data.trial_started_at, pacientesCount, staffCount, data.mp_preapproval_id || null, data.plan_manual_expires_at || null);
    } catch {
        renderPlanBadge('free');
    }
}

let _currentPlan = 'free'; // para detectar upgrades/downgrades en suscribirPlan

function renderPlanBadge(plan, trialStartedAt = null, pacientesCount = 0, staffCount = 0, mpPreapprovalId = null, planExpiresAt = null) {
    // Verificar expiración client-side de planes con fecha de vencimiento
    if (['basico','pro','total'].includes(plan) && planExpiresAt) {
        const expiry = new Date(planExpiresAt);
        if (expiry < new Date()) { plan = 'expired'; planExpiresAt = null; }
    }
    _currentPlan = plan;
    const wrap       = document.getElementById('planBadgeWrap');
    const desc       = document.getElementById('planDesc');
    const btnPRO     = document.getElementById('btnSuscribirPRO');
    const btnBasico  = document.getElementById('btnSuscribirBasico');
    const btnTotal   = document.getElementById('btnSuscribirTotal');
    const btnCancel  = document.getElementById('btnCancelarSuscripcion');
    const expiryInfo = document.getElementById('planExpiryInfo');
    if (!wrap) return;

    // Calcular días restantes de prueba
    let daysLeft = null;
    if (trialStartedAt && (plan === 'free' || plan === 'trial')) {
        const end = new Date(trialStartedAt);
        end.setDate(end.getDate() + 60);
        daysLeft = Math.max(0, Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24)));
    }

    const trialLabel = daysLeft !== null ? `⏳ Período de prueba (${daysLeft}d restantes)` : '⏳ Período de prueba';
    const trialDesc  = daysLeft !== null
        ? `Estás en el período de prueba gratuito. Te quedan ${daysLeft} días. Todas las funciones habilitadas. Al vencer, elegí el plan que mejor se adapte.`
        : 'Estás en el período de prueba gratuito de 60 días. Todas las funciones habilitadas. Al vencer, elegí el plan que mejor se adapte.';

    const configs = {
        total:   { badge: `<span class="badge" style="font-size:.9rem;padding:6px 16px;background:#4C1D95;color:#fff;border-radius:20px">🏆 Plan Total activo</span>`,
                   desc: 'Plan Total activo — pacientes ilimitados, staff ilimitado, todas las funciones.', showPRO: true, showBasico: true, showTotal: false },
        pro:     { badge: `<span class="badge" style="font-size:.9rem;padding:6px 16px;background:#1565C0;color:#fff;border-radius:20px">⭐ Plan PRO activo</span>`,
                   desc: 'Plan PRO activo — hasta 40 pacientes, hasta 20 staff, reportes PDF.', showPRO: false, showBasico: true, showTotal: true },
        basico:  { badge: `<span class="badge" style="font-size:.9rem;padding:6px 16px;background:#0D9488;color:#fff;border-radius:20px">✅ Plan Básico activo</span>`,
                   desc: 'Plan Básico activo — hasta 15 pacientes y 8 miembros de staff.', showPRO: true, showBasico: false, showTotal: true },
        trial:   { badge: `<span class="badge" style="font-size:.9rem;padding:6px 16px;background:#D97706;color:#fff;border-radius:20px">${trialLabel}</span>`,
                   desc: trialDesc, showPRO: true, showBasico: true, showTotal: true },
        free:    { badge: `<span class="badge" style="font-size:.9rem;padding:6px 16px;background:#D97706;color:#fff;border-radius:20px">${trialLabel}</span>`,
                   desc: trialDesc, showPRO: true, showBasico: true, showTotal: true },
        expired: { badge: `<span class="badge" style="font-size:.9rem;padding:6px 16px;background:#6B7280;color:#fff;border-radius:20px">🔒 Sin plan activo</span>`,
                   desc: 'Tu período de prueba venció. Elegí un plan para continuar usando CuidaDiario PRO.', showPRO: true, showBasico: true, showTotal: true },
    };
    const cfg = configs[plan] || configs.free;
    wrap.innerHTML = cfg.badge;
    if (desc) desc.textContent = cfg.desc;

    // Mostrar/ocultar botones de plan
    if (btnPRO)    btnPRO.style.display    = cfg.showPRO    ? '' : 'none';
    if (btnBasico) btnBasico.style.display = cfg.showBasico ? '' : 'none';
    if (btnTotal)  btnTotal.style.display  = cfg.showTotal  ? '' : 'none';

    // Botón cancelar y etiqueta de vencimiento según estado
    const isPaidPlan = ['basico','pro','total'].includes(plan);

    // 4 estados posibles para un plan activo:
    // A) mp_preapproval_id = ID real de MP         → suscripción activa, puede cancelar
    // B) mp_preapproval_id = 'baja_programada'     → baja ya solicitada, acceso hasta fecha
    // C) mp_preapproval_id = null, sin fecha       → plan manual admin, puede dar de baja
    // D) mp_preapproval_id = null, con fecha       → plan admin con vencimiento, puede dar de baja
    const stateCancelable    = isPaidPlan && !!mpPreapprovalId && mpPreapprovalId !== 'baja_programada'; // A
    const stateBajaPendiente = isPaidPlan && mpPreapprovalId === 'baja_programada';                     // B
    const stateDarBaja       = isPaidPlan && !mpPreapprovalId;                                          // C + D

    if (btnCancel) {
        if (stateCancelable) {
            btnCancel.style.display = '';
            btnCancel.textContent   = '🚫 Cancelar suscripción';
            btnCancel.disabled      = false;
        } else if (stateDarBaja) {
            btnCancel.style.display = '';
            btnCancel.textContent   = '🚫 Dar de baja el plan';
            btnCancel.disabled      = false;
        } else {
            // stateBajaPendiente: baja ya solicitada, no mostrar botón
            btnCancel.style.display = 'none';
        }
    }

    // Información de vencimiento / próxima renovación
    if (expiryInfo) {
        if (planExpiresAt && isPaidPlan) {
            const expDate   = new Date(planExpiresAt);
            const daysToEx  = Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24));
            const dateStr   = expDate.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
            const isUrgent  = daysToEx <= 7;
            let   label, icon, style;
            if (stateBajaPendiente) {
                // Baja ya solicitada — mostrar fecha de acceso final
                icon  = '⏳';
                label = 'Baja solicitada — acceso hasta el';
                style = 'color:#92400E;background:#FEF3C7;border:1px solid #FDE68A';
            } else if (mpPreapprovalId) {
                icon  = isUrgent ? '⚠️' : '📅';
                label = 'Próxima renovación';
                style = isUrgent ? 'color:#92400E;background:#FEF3C7;border:1px solid #FDE68A' : 'color:#065F46;background:#D1FAE5;border:1px solid #A7F3D0';
            } else {
                icon  = isUrgent ? '⚠️' : '📅';
                label = 'Vence el';
                style = isUrgent ? 'color:#92400E;background:#FEF3C7;border:1px solid #FDE68A' : 'color:#065F46;background:#D1FAE5;border:1px solid #A7F3D0';
            }
            const dayLabel = daysToEx > 0 ? ` — ${daysToEx} días` : ' — hoy';
            expiryInfo.innerHTML = `<span style="display:inline-block;font-size:.83rem;padding:5px 14px;border-radius:12px;${style}">${icon} ${label}: ${dateStr}${dayLabel}</span>`;
            expiryInfo.style.display = '';
        } else if (isPaidPlan && mpPreapprovalId) {
            expiryInfo.innerHTML = `<span style="display:inline-block;font-size:.83rem;padding:5px 14px;border-radius:12px;color:#1E40AF;background:#EFF6FF;border:1px solid #BFDBFE">🔄 Suscripción activa — renovación mensual automática</span>`;
            expiryInfo.style.display = '';
        } else {
            expiryInfo.style.display = 'none';
        }
    }

    // Etiquetas contextuales: upgrade vs downgrade
    if (btnBasico) btnBasico.textContent = (plan === 'pro' || plan === 'total') ? '↓ Cambiar a Plan Básico' : 'Contratar Plan Básico';
    if (btnPRO)    btnPRO.textContent    = plan === 'total' ? '↓ Cambiar a Plan PRO' : '💳 Contratar Plan PRO';
    if (btnTotal)  btnTotal.textContent  = '🏆 Contratar Plan Total';

    // Deshabilitar planes que superan los límites de conteo
    const canBasico = pacientesCount <= 15 && staffCount <= 8;
    const canPro    = pacientesCount <= 40 && staffCount <= 20;

    // Limpiar warnings anteriores
    ['_planWarnBasico', '_planWarnPRO'].forEach(id => document.getElementById(id)?.remove());

    if (btnBasico && cfg.showBasico && !canBasico) {
        btnBasico.disabled = true;
        btnBasico.title = `Necesitás tener máx. 15 pac. y 8 staff para el Plan Básico (tenés ${pacientesCount} pac. / ${staffCount} staff)`;
        const warn = document.createElement('p');
        warn.id = '_planWarnBasico';
        warn.style.cssText = 'font-size:.78rem;color:#92400E;background:#FEF3C7;border-radius:6px;padding:7px 10px;margin-top:6px';
        warn.innerHTML = `⚠️ No podés usar el Plan Básico con ${pacientesCount} pac. y ${staffCount} staff (límite: 15 pac. / 8 staff). Reducí registros desde <a href="pacientes.html" style="color:#78350F;font-weight:700">Pacientes</a> o <a href="staff.html" style="color:#78350F;font-weight:700">Staff</a>.`;
        btnBasico.insertAdjacentElement('afterend', warn);
    } else if (btnBasico) {
        btnBasico.disabled = false;
        btnBasico.title = '';
    }

    if (btnPRO && cfg.showPRO && !canPro) {
        btnPRO.disabled = true;
        btnPRO.title = `Necesitás tener máx. 40 pac. y 20 staff para el Plan PRO (tenés ${pacientesCount} pac. / ${staffCount} staff)`;
        const warn = document.createElement('p');
        warn.id = '_planWarnPRO';
        warn.style.cssText = 'font-size:.78rem;color:#1E40AF;background:#EFF6FF;border-radius:6px;padding:7px 10px;margin-top:6px';
        warn.innerHTML = `ℹ️ Tu configuración (${pacientesCount} pac. / ${staffCount} staff) supera los límites del Plan PRO. Solo podés contratar el Plan Total.`;
        btnPRO.insertAdjacentElement('afterend', warn);
    } else if (btnPRO) {
        btnPRO.disabled = false;
        btnPRO.title = '';
    }
}

async function suscribirPlan(plan, testMode) {
    // Confirmación cuando ya hay un plan activo (upgrade o downgrade)
    if (['basico','pro','total'].includes(_currentPlan)) {
        const isDowngrade = (_currentPlan === 'total' && (plan === 'pro' || plan === 'basico'))
                         || (_currentPlan === 'pro'   && plan === 'basico');
        const planLabel = { basico: 'Plan Básico', pro: 'Plan PRO', total: 'Plan Total' }[plan];
        const msg = isDowngrade
            ? `¿Confirmás el cambio a ${planLabel}?\n\nSe cancelará tu suscripción actual y comenzará una nueva por $${plan==='basico'?'29.000':plan==='pro'?'59.000':'99.000'}/mes. El cambio es inmediato.`
            : `¿Confirmás el cambio a ${planLabel}?\n\nSe cancelará tu suscripción actual y comenzará una nueva con el precio del ${planLabel}.`;
        if (!confirm(msg)) return;
    }

    const btnId = plan === 'total' ? 'btnSuscribirTotal' : plan === 'pro' ? 'btnSuscribirPRO' : 'btnSuscribirBasico';
    const btn = document.getElementById(btnId);
    const originalText = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = 'Redirigiendo…'; }
    try {
        const res = await API_B2B.createSubscription(plan, testMode);
        if (res.init_point) {
            window.location.href = res.init_point;
        } else {
            showToast('No se pudo obtener el link de pago', 'error');
            if (btn) { btn.disabled = false; btn.textContent = originalText; }
        }
    } catch (err) {
        showToast('Error: ' + (err.message || 'No se pudo crear la suscripción'), 'error');
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
}

async function verificarPlan(preapprovalId = null) {
    const btn    = document.getElementById('btnVerificarPlan');
    const result = document.getElementById('planVerifyResult');
    if (btn) { btn.disabled = true; btn.textContent = '🔄 Verificando…'; }
    if (result) result.innerHTML = '';
    try {
        const res = await API_B2B.verifySubscription(preapprovalId);
        const plan = res.plan || 'free';

        // 'current' = solo consulta sin cambios (no se pasó preapproval_id)
        if (res.status === 'current') {
            renderPlanBadge(plan);
            const planLabels = { pro: 'Plan PRO', basico: 'Plan Básico', total: 'Plan Total', free: 'Período de prueba', expired: 'Sin plan activo' };
            if (result) result.innerHTML = `<div class="alert alert-info" style="font-size:.84rem;margin-top:8px"><span class="alert-icon">ℹ️</span>Tu plan actual es: <strong>${planLabels[plan] || plan}</strong>. Si ya realizaste un pago, aguardá la confirmación de MercadoPago o usá el enlace de verificación que llegó a tu email.</div>`;
            showToast('Plan consultado', 'info');
            return;
        }

        // Actualizar badge, botones y usuario local
        renderPlanBadge(plan);
        const user = API_B2B.getUser();
        if (user) { user.plan = plan; API_B2B.setUser(user); }

        const isOk  = plan === 'pro' || plan === 'basico' || plan === 'total';
        const msgs  = {
            authorized: plan === 'total' ? '✅ ¡Plan Total activo! Sin límites habilitados.' : plan === 'pro' ? '✅ ¡Plan PRO activo! Todos los beneficios habilitados.' : '✅ Plan Básico activo.',
            pending:    '⏳ El pago está siendo procesado. Puede demorar unos minutos.',
        };
        const statusMsg = msgs[res.status] || res.message || (isOk ? 'Plan activado correctamente.' : 'Sin suscripción activa.');
        if (result) result.innerHTML = `<div class="alert alert-${isOk ? 'success' : 'warning'}" style="font-size:.84rem;margin-top:8px"><span class="alert-icon">${isOk ? '✅' : '⚠️'}</span>${statusMsg}</div>`;
        showToast(isOk ? 'Plan activado ✅' : 'Sin suscripción activa aún', isOk ? 'success' : 'warning');
    } catch (err) {
        if (result) result.innerHTML = `<div class="alert alert-danger" style="font-size:.84rem;margin-top:8px"><span class="alert-icon">❌</span>Error: ${escapeHtml(err.message)}</div>`;
        showToast('Error al verificar: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Verificar estado del pago'; }
    }
}

async function cancelarSuscripcion() {
    const planLabels = { basico: 'Plan Básico', pro: 'Plan PRO', total: 'Plan Total' };
    const planLabel  = planLabels[_currentPlan] || 'tu plan actual';
    if (!confirm(`¿Cancelar ${planLabel}?\n\nAl confirmar, se cancela la suscripción automática — no habrá más cobros. Tu acceso sigue activo hasta el vencimiento del período ya pagado.`)) return;

    const btn    = document.getElementById('btnCancelarSuscripcion');
    const result = document.getElementById('planVerifyResult');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Cancelando…'; }
    if (result) result.innerHTML = '';
    try {
        const data = await API_B2B.cancelSubscription();
        const accessDate = data.access_until
            ? new Date(data.access_until).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
            : null;
        showToast('Baja solicitada ✅ — seguís con acceso hasta el vencimiento', 'success');
        // Actualizar usuario en local para reflejar que ya no tiene mp_preapproval
        const user = API_B2B.getUser();
        if (user) { user.mp_preapproval_id = null; API_B2B.setUser(user); }
        await cargarEstadoPlan();
        if (result) result.innerHTML = accessDate
            ? `<div class="alert alert-success" style="font-size:.84rem;margin-top:8px"><span class="alert-icon">✅</span>
               <strong>Baja solicitada.</strong> Tu suscripción automática está cancelada — no se realizarán más cobros.<br>
               Tu plan sigue activo hasta el <strong>${accessDate}</strong>. Después de esa fecha, la cuenta pasa a Free automáticamente.</div>`
            : `<div class="alert alert-success" style="font-size:.84rem;margin-top:8px"><span class="alert-icon">✅</span>Baja solicitada. No se realizarán más cobros.</div>`;
    } catch (err) {
        showToast('Error al cancelar: ' + (err.message || 'Error desconocido'), 'error');
        if (btn) { btn.disabled = false; btn.textContent = '🚫 Cancelar suscripción'; }
        if (result) result.innerHTML = `<div class="alert alert-danger" style="font-size:.84rem;margin-top:8px"><span class="alert-icon">❌</span>${escapeHtml(err.message || 'No se pudo cancelar la suscripción.')}</div>`;
    }
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
