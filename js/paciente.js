/**
 * paciente.js — Ficha completa del paciente con todas las secciones
 * by EDEN SoftWork
 */

let _pacienteId = null;
let _paciente = null;
let _isAdmin = false;
let _isReadOnly = false;
let _stockModelo = 'institucional'; // kept for backward compat but always treated as hybrid
let _catalogo = [];                 // institutional catalog items
let _catalogoPaciente = [];         // patient-specific catalog items
let _isEgresado = false;            // true when patient has a discharge date
let _alertas = [];
let _incidentes = [];
let _incidentArchiveFilter = 'activos';
let _estadosResidente = { actual: { tipo: 'presente', presente: true, version: null }, historial: [] };
let _timelineItems = [];
let _timelineCursor = null;
let _evoluciones = [];
let _timelineDirty = true;
let _timelineLoadRevision = 0;
let _alertLoadRevision = 0;

const LA1_LABELS = {
    movilidad: { independiente: 'Independiente', asistencia_parcial: 'Asistencia parcial', asistencia_total: 'Asistencia total', inmovil: 'Inmóvil' },
    dependencia: { baja: 'Baja', media: 'Media', alta: 'Alta', total: 'Total' },
    caida: { bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto' },
    continencia: { continente: 'Continente', asistencia: 'Requiere asistencia', incontinencia_urinaria: 'Incontinencia urinaria', incontinencia_fecal: 'Incontinencia fecal', incontinencia_mixta: 'Incontinencia mixta' },
    estado: { presente: 'Presente', internado: 'Internado', salida_medica: 'Salida médica', salida_familiar: 'Salida familiar', otro: 'Otro' },
    incidente: { caida: 'Caída', golpe_herida: 'Golpe / herida', error_medicacion: 'Error de medicación', omision_medicacion: 'Omisión de medicación', episodio_conductual: 'Episodio conductual', derivacion: 'Derivación', otro: 'Otro' },
    documento: { receta: 'Receta', estudio_analisis: 'Estudio / análisis', epicrisis: 'Epicrisis', indicacion: 'Indicación', dni: 'DNI', cobertura: 'Cobertura', otro: 'Otro' },
};

function uiIcon(name) {
    return `<svg class="ui-icon" aria-hidden="true"><use href="../icons/b2b-ui.svg#${escapeHtml(name)}"></use></svg>`;
}

function toLocalDateTime(value = new Date()) {
    if (value === null || value === undefined || value === '') return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    const params = new URLSearchParams(window.location.search);
    _pacienteId = parseInt(params.get('id'));
    if (!_pacienteId) { showToast('Paciente no encontrado', 'error'); return; }

    const user = API_B2B.getUser();
    _isAdmin = user?.rol === 'admin_institucion';
    _isReadOnly = user?.rol === 'familiar';

    // M8: Actualizar institucion_permisos desde el servidor (pueden haber cambiado sin que el usuario haya vuelto a iniciar sesión)
    if (user?.rol !== 'admin_institucion') {
        try {
            const fresh = await API_B2B.get('/api/b2b/auth/me');
            if (fresh?.institucion_permisos) {
                const stored = API_B2B.getUser() || {};
                stored.institucion_permisos = fresh.institucion_permisos;
                API_B2B.setUser(stored);
            }
        } catch {}
    }

    initSidebar();
    populateSidebarUser();

    // Role-based sidebar & topbar adjustments
    if (_isReadOnly) {
        // Familiar: replace nav with minimal options
        const nav = document.querySelector('.sidebar-nav');
        if (nav) nav.innerHTML = `
            <a href="familiar.html" class="nav-item"><span class="nav-icon">👤</span><span class="nav-label">Mi familiar</span></a>
            <a href="configuracion.html" class="nav-item"><span class="nav-icon">⚙️</span><span class="nav-label">Configuración</span></a>`;
        const topbarLink = document.querySelector('.topbar-title a');
        if (topbarLink) { topbarLink.href = 'familiar.html'; topbarLink.textContent = '← Mi familiar'; }
    } else if (!_isAdmin) {
        // Staff / médico: send them back to their assigned-patients view
        const pacientesLink = document.querySelector('.nav-item[href="pacientes.html"]');
        if (pacientesLink) pacientesLink.setAttribute('href', 'cuidador.html');
        const topbarLink = document.querySelector('.topbar-title a');
        if (topbarLink) { topbarLink.href = 'cuidador.html'; topbarLink.textContent = '← Mis pacientes'; }
    }

    // Familiar: ocultar tabs según permisos de la institución
    if (_isReadOnly) {
        // tabs que pueden ser restringidos por el admin (canFamiliarSee definido en utils-b2b.js)
        const restrictableTabs = ['timeline','medicamentos','citas','tareas','sintomas','signos','contactos','notas','documentos','incidentes'];
        restrictableTabs.forEach(tabName => {
            if (!canFamiliarSee(tabName === 'timeline' ? 'evoluciones' : tabName)) {
                const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
                if (tabBtn) tabBtn.style.display = 'none';
            }
        });
    }

    initForms();

    // Load catalogs (familiar: solo catálogo del paciente; otros: ambos)
    try {
        if (_isReadOnly) {
            _catalogoPaciente = await API_B2B.getCatalogo({ paciente_id: _pacienteId }).catch(() => []);
        } else {
            [_catalogo, _catalogoPaciente] = await Promise.all([
                API_B2B.getCatalogo().catch(() => []),
                API_B2B.getCatalogo({ paciente_id: _pacienteId }).catch(() => [])
            ]);
        }
    } catch(e) { /* silently continue */ }

    await loadPaciente();
    // Resolver el destino de URL sólo con identidad, permisos y ficha ya inicializados.
    initTabs(params.get('tab'));
    await loadAllData();
});

// ============================================
// TABS
// ============================================
function initTabs(defaultTab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + target)?.classList.add('active');
            const picker = document.getElementById('residentSectionSelect');
            if (picker) picker.value = target;
            if (target === 'timeline' && _timelineDirty) loadTimeline(true);
        });
    });
    const picker = document.getElementById('residentSectionSelect');
    if (picker) picker.addEventListener('change', () => activateResidentTab(picker.value));
    const allowedTabs = ['timeline','datos','medicamentos','citas','tareas','sintomas','signos','contactos','notas','documentos','incidentes'];
    const requested = allowedTabs.includes(defaultTab) ? defaultTab : 'timeline';
    const requestedButton = document.querySelector(`.tab-btn[data-tab="${requested}"]`);
    const fallbackButton = document.querySelector('.tab-btn[data-tab="datos"]')
        || [...document.querySelectorAll('.tab-btn')].find(button => button.style.display !== 'none' && !button.disabled);
    const target = requestedButton && requestedButton.style.display !== 'none' && !requestedButton.disabled
        ? requestedButton
        : fallbackButton;
    target?.click();
}

// ============================================
// PACIENTE
// ============================================
async function loadPaciente() {
    try {
        _paciente = await API_B2B.getPaciente(_pacienteId);
        if (!_paciente) { showToast('Paciente no encontrado', 'error'); return; }
        _isEgresado = !!_paciente.fecha_egreso;
        if (_isEgresado) {
            let notice = document.getElementById('egresoNotice');
            if (!notice) {
                notice = document.createElement('div');
                notice.id = 'egresoNotice';
                notice.className = 'alert alert-warning';
                notice.style.marginTop = '12px';
                const hdr = document.getElementById('pacienteHeader');
                if (hdr) hdr.insertAdjacentElement('afterend', notice);
            }
            notice.innerHTML = `<span class="alert-icon">⚠️</span><strong>Paciente dado de alta el ${formatDate(_paciente.fecha_egreso)}</strong>${_paciente.motivo_egreso ? ` — ${escapeHtml(_paciente.motivo_egreso)}` : ''}. La ficha está en modo solo lectura.`;
        }
        renderPacienteHeader(_paciente);
        renderDatosTab(_paciente);
    } catch (err) {
        showToast('Error al cargar paciente: ' + err.message, 'error');
    }
}

function renderPacienteHeader(p) {
    const edad = calcEdad(p.fecha_nacimiento);
    const privatePhoto = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(String(p.foto_url || '')) ? p.foto_url : null;
    document.title = `${p.apellido || ''} ${p.nombre} — CuidaDiario PRO`;
    const el = document.getElementById('pacienteHeader');
    if (!el) return;
    el.innerHTML = `
        <div class="d-flex align-center gap-12 flex-wrap">
            <div class="resident-photo-shell">
                ${privatePhoto ? `<img class="resident-photo" src="${escapeHtml(privatePhoto)}" alt="Fotografía de ${escapeHtml(p.nombre)}">` : `<div class="paciente-avatar-lg">${uiIcon('user')}</div>`}
                ${canDo('editar_paciente') && !p.fecha_egreso ? `<button class="resident-photo-action" type="button" onclick="seleccionarFotoResidente()">${privatePhoto ? 'Cambiar foto' : 'Agregar foto'}</button>${privatePhoto ? '<button class="resident-photo-remove" type="button" onclick="quitarFotoResidente()">Quitar</button>' : ''}` : ''}
            </div>
            <div class="paciente-info-header" style="flex:1">
                <h1>${escapeHtml(p.apellido || '')} ${escapeHtml(p.nombre)}</h1>
                <div class="paciente-meta">
                    ${edad !== null ? `<span class="paciente-meta-item">${uiIcon('calendar')} ${edad} años</span>` : ''}
                    ${p.fecha_nacimiento ? `<span class="paciente-meta-item">${formatDate(p.fecha_nacimiento)}</span>` : ''}
                    ${p.habitacion ? `<span class="paciente-meta-item">Hab. ${escapeHtml(p.habitacion)}</span>` : ''}
                    ${p.dni ? `<span class="paciente-meta-item"><span style="font-size:.72rem;font-weight:800;opacity:.75">DNI</span> ${escapeHtml(p.dni)}</span>` : ''}
                    ${p.obra_social ? `<span class="paciente-meta-item">${escapeHtml(p.obra_social)}</span>` : ''}
                    ${p.fecha_ingreso ? `<span class="paciente-meta-item">Ingreso: ${formatDate(p.fecha_ingreso)}</span>` : ''}
                </div>
                ${p.diagnostico ? `<div class="paciente-meta"><span class="paciente-meta-item">${escapeHtml(p.diagnostico)}</span></div>` : ''}
            </div>
            <div class="d-flex gap-8 align-center flex-wrap">
                ${p.fecha_egreso ? `<span class="badge badge-red" style="font-size:.8rem;padding:6px 12px">Alta: ${formatDate(p.fecha_egreso)} — ${escapeHtml(p.motivo_egreso || '')}</span>` : ''}
                ${canDo('dar_alta') && !p.fecha_egreso ? `<button class="btn btn-sm btn-secondary" onclick="openModalEgreso()">Registrar egreso</button>` : ''}
            </div>
        </div>`;
}

function renderDatosTab(p) {
    const el = document.getElementById('datosContent');
    if (!el) return;
    const actual = _estadosResidente.actual || { tipo: 'presente', presente: true };
    const canCare = canDo('editar_perfil_cuidado') && !_isEgresado;
    const canState = canDo('gestionar_estado_temporal') && !_isEgresado;
    el.innerHTML = `
        <div class="care-overview-grid">
            <section class="profile-section">
                <div class="profile-section-heading"><div><span class="eyebrow">Identificación</span><h2>Datos del residente</h2></div>
                    ${canDo('editar_paciente') && !_isEgresado ? `<button class="btn btn-sm btn-secondary" onclick="openEditPaciente()">Editar ficha</button>` : ''}
                </div>
                <div class="profile-key-values">
                    ${row('Nombre completo', `${p.apellido || ''} ${p.nombre}`)}
                    ${row('Fecha de nacimiento', formatDate(p.fecha_nacimiento))}
                    ${row('DNI', p.dni)}
                    ${row('Habitación', p.habitacion)}
                    ${row('Diagnóstico', p.diagnostico)}
                    ${row('Médico de cabecera', p.medico_cabecera)}
                    ${row('Obra social', p.obra_social)}
                    ${row('Nº afiliado', p.num_afiliado)}
                    ${row('Fecha de ingreso', formatDate(p.fecha_ingreso))}
                    ${p.fecha_egreso ? row('Fecha de egreso', formatDate(p.fecha_egreso)) : ''}
                    ${p.motivo_egreso ? row('Motivo de egreso', p.motivo_egreso) : ''}
                </div>
            </section>
            <section class="profile-section care-profile-card">
                <div class="profile-section-heading"><div><span class="eyebrow">Operativo</span><h2>Perfil de cuidado</h2></div>
                    ${canCare ? `<button class="btn btn-sm btn-secondary" onclick="openEditPaciente()">Actualizar</button>` : ''}
                </div>
                <div class="care-facts">
                    <div><span>Movilidad</span><strong>${escapeHtml(LA1_LABELS.movilidad[p.movilidad] || 'Sin especificar')}</strong></div>
                    <div><span>Dependencia</span><strong>${escapeHtml(LA1_LABELS.dependencia[p.nivel_dependencia] || 'Sin especificar')}</strong></div>
                    <div><span>Riesgo de caída</span><strong>${escapeHtml(LA1_LABELS.caida[p.riesgo_caida] || 'Sin especificar')}</strong></div>
                    <div><span>Continencia</span><strong>${escapeHtml(LA1_LABELS.continencia[p.continencia] || 'Sin especificar')}</strong></div>
                </div>
                <div class="profile-note"><span>Dieta y restricciones</span><p>${escapeHtml(p.dieta_restricciones || 'Sin información registrada')}</p></div>
                <div class="profile-note"><span>Aspectos cognitivos</span><p>${escapeHtml(p.aspectos_cognitivos || 'Sin información registrada')}</p></div>
                <p class="scope-note">Información operativa para organizar el cuidado. No reemplaza documentación clínica oficial.</p>
            </section>
        </div>
        <section class="profile-section mt-16" id="temporaryStatePanel">
            <div class="profile-section-heading"><div><span class="eyebrow">Situación actual</span><h2>Estado del residente</h2></div>
                ${canState ? `<button class="btn btn-sm btn-primary" onclick="openEstadoTemporal()">Registrar cambio</button>` : ''}
            </div>
            <div class="temporary-state-current ${actual.tipo === 'presente' ? 'is-present' : 'is-away'}">
                ${uiIcon(actual.tipo === 'presente' ? 'check' : 'activity')}
                <div><strong>${escapeHtml(LA1_LABELS.estado[actual.tipo] || actual.tipo || 'Presente')}</strong>
                <span>${actual.iniciado_at ? `Desde ${formatDateTime(actual.iniciado_at)}` : 'Sin ausencia temporal vigente'}</span></div>
            </div>
            <div id="temporaryStateHistory"></div>
        </section>
        <div class="care-overview-grid mt-16">
            <section class="profile-section"><div class="profile-section-heading"><div><span class="eyebrow">Referencia</span><h2>Contacto familiar</h2></div></div>
                ${row('Nombre', p.contacto_familiar_nombre)}
                ${row('Teléfono', p.contacto_familiar_tel || '—', safeContactHref('tel', p.contacto_familiar_tel))}
            </section>
            <section class="profile-section"><div class="profile-section-heading"><div><span class="eyebrow">Antecedentes</span><h2>Información complementaria</h2></div></div>
                ${p.antecedentes ? `<div class="profile-note"><span>Antecedentes clínicos</span><p>${escapeHtml(p.antecedentes)}</p></div>` : '<p class="text-muted">Sin antecedentes registrados.</p>'}
                ${p.notas_ingreso ? `<div class="profile-note"><span>Notas de ingreso</span><p>${escapeHtml(p.notas_ingreso)}</p></div>` : ''}
            </section>
        </div>
    `;
    renderEstadoHistory();
}

function seleccionarFotoResidente() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
    input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file) return;
        if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
            showToast('Elegí una imagen JPEG, PNG o WebP de hasta 10 MB.', 'warning'); return;
        }
        const reader = new FileReader();
        reader.onload = async () => { try { showToast('Procesando fotografía…', 'info'); await API_B2B.updatePacientePhoto(_pacienteId, reader.result); showToast('Fotografía actualizada', 'success'); await loadPaciente(); } catch (error) { showToast(error.message || 'No se pudo procesar la fotografía', 'error'); } };
        reader.readAsDataURL(file);
    });
    input.click();
}

async function quitarFotoResidente() {
    if (!confirm('¿Quitar la fotografía de este residente?')) return;
    try { await API_B2B.updatePacientePhoto(_pacienteId, null); showToast('Fotografía quitada', 'success'); await loadPaciente(); }
    catch (error) { showToast(error.message || 'No se pudo quitar la fotografía', 'error'); }
}

function activateResidentTab(tab) {
    const button = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (button) button.click();
    const picker = document.getElementById('residentSectionSelect');
    if (picker) picker.value = tab;
}

const DERIVED_ALERT_SOURCE_FIELDS = Object.freeze({
    alergia: 'pAlergias',
    riesgo_caida: 'pRiesgoCaida',
    dieta_especial: 'pDietaRestricciones',
});

function editDerivedAlertSource(type) {
    const fieldName = DERIVED_ALERT_SOURCE_FIELDS[type];
    if (!fieldName || !canDo('editar_perfil_cuidado') || _isEgresado) return;
    activateResidentTab('datos');
    openEditPaciente();
    window.setTimeout(() => {
        const field = document.forms.formEditPaciente?.elements?.[fieldName]
            || document.querySelector(`[name="${fieldName}"]`);
        if (!field) return;
        field.focus({ preventScroll: true });
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
        field.classList.add('source-field-highlight');
        window.setTimeout(() => field.classList.remove('source-field-highlight'), 1800);
    // openModal enfoca su primer control a los 60 ms; ejecutar después para que
    // el campo fuente sea el foco final y no sólo un scroll fugaz.
    }, 100);
}

function row(label, val, href = null) {
    const renderedValue = href
        ? `<a href="${escapeHtml(href)}" style="color:var(--pro-primary)">${escapeHtml(val)}</a>`
        : escapeHtml(val || '—');
    return `<div class="d-flex justify-between" style="padding:8px 0;border-bottom:1px solid var(--border-color)">
        <span class="text-muted" style="font-size:.82rem">${escapeHtml(label)}</span>
        <span class="fw-bold" style="font-size:.88rem;text-align:right">${renderedValue}</span>
    </div>`;
}

// ============================================
// NÚCLEO AMPLIADO DEL RESIDENTE — PAQUETE 1
// ============================================
async function loadAlertas() {
    const revision = ++_alertLoadRevision;
    const patientId = Number(_pacienteId);
    try {
        const alertas = await API_B2B.getAlertas(patientId);
        if (revision !== _alertLoadRevision || patientId !== Number(_pacienteId)) return;
        _alertas = alertas;
        renderAlertas();
    } catch (error) {
        if (revision !== _alertLoadRevision || patientId !== Number(_pacienteId)) return;
        const strip = document.getElementById('residentAlertStrip');
        if (strip) strip.innerHTML = '<span class="alert-chip severity-informativa">Alertas no disponibles</span>';
    }
}

function renderAlertas() {
    const strip = document.getElementById('residentAlertStrip');
    if (!strip) return;
    const canManage = canDo('gestionar_alertas') && !_isEgresado;
    const visible = (_alertas || []).filter(a => a.activa !== false);
    const inactiveManual = (_alertas || []).filter(a => !a.derivada && a.activa === false);
    strip.classList.toggle('has-alerts', visible.length > 0 || canManage);
    const chips = visible.map(a => `<span class="resident-alert-chip severity-${escapeHtml(a.severidad || 'informativa')} ${a.derivada ? 'is-derived' : 'is-manual'}">
        ${uiIcon(a.tipo === 'riesgo_caida' ? 'activity' : 'alert')}<span>${escapeHtml(a.etiqueta)}</span>
        ${a.derivada ? `<span class="alert-source">Perfil de cuidado</span>${canDo('editar_perfil_cuidado') && DERIVED_ALERT_SOURCE_FIELDS[a.tipo] ? `<button type="button" data-alert-type="${escapeHtml(a.tipo)}" onclick="editDerivedAlertSource(this.dataset.alertType)">Modificar origen</button>` : ''}` : '<span class="alert-source">Manual</span>'}
        ${!a.derivada && canManage ? `<button type="button" aria-label="Editar alerta" onclick="openAlerta(${safeRecordId(a.id)})">Editar</button>` : ''}
    </span>`).join('');
    const inactive = canManage && inactiveManual.length ? `<details class="resident-inactive-alerts">
        <summary>Alertas inactivas (${inactiveManual.length})</summary>
        <div>${inactiveManual.map(a => `<span>${escapeHtml(a.etiqueta)} <button type="button" aria-label="Editar alerta inactiva ${escapeHtml(a.etiqueta)}" onclick="openAlerta(${safeRecordId(a.id)})">Editar / activar</button></span>`).join('')}</div>
    </details>` : '';
    strip.innerHTML = `<div class="resident-alert-list">${chips || '<span class="alert-empty">Sin alertas activas</span>'}${inactive}</div>
        ${canManage ? `<button class="btn btn-sm btn-secondary alert-add" onclick="openAlerta()">+ Alerta</button>` : ''}`;
}

function openAlerta(id = null) {
    const f = document.getElementById('formAlerta');
    if (!f) return;
    f.reset();
    f.aId.value = id || '';
    f.aVersion.value = '';
    f.aActiva.checked = true;
    f.aSeveridad.value = 'moderada';
    document.getElementById('modalAlertaTitle').textContent = id ? 'Editar alerta' : 'Nueva alerta';
    if (id) {
        const item = _alertas.find(a => safeRecordId(a.id) === safeRecordId(id) && !a.derivada);
        if (!item) return;
        f.aVersion.value = item.version;
        f.aTipo.value = item.tipo;
        f.aEtiqueta.value = item.etiqueta || '';
        f.aSeveridad.value = item.severidad || 'moderada';
        f.aDesde.value = toLocalDateTime(item.vigente_desde);
        f.aHasta.value = toLocalDateTime(item.vigente_hasta);
        f.aActiva.checked = item.activa !== false;
    }
    openModal('modalAlerta');
}

async function handleSaveAlerta(event) {
    event.preventDefault();
    const f = event.target;
    if (f.aDesde.value && f.aHasta.value && new Date(f.aHasta.value).getTime() < new Date(f.aDesde.value).getTime()) {
        showToast('La vigencia hasta no puede ser anterior a la vigencia desde', 'error');
        f.aHasta.focus();
        return;
    }
    const submit = f.querySelector('[type=submit]');
    submit.disabled = true;
    const id = safeRecordId(f.aId.value);
    const data = {
        tipo: f.aTipo.value,
        etiqueta: f.aEtiqueta.value.trim(),
        severidad: f.aSeveridad.value,
        vigente_desde: toApiDateTime(f.aDesde.value),
        vigente_hasta: toApiDateTime(f.aHasta.value),
        activa: f.aActiva.checked,
    };
    if (id) data.expected_version = Number(f.aVersion.value);
    try {
        if (id) await API_B2B.updateAlerta(id, data);
        else await API_B2B.createAlerta(_pacienteId, data);
        closeModal('modalAlerta');
        showToast('Alerta guardada', 'success');
        await loadAlertas();
    } catch (error) {
        if (!handleOfflineWrite(error, { modal: 'modalAlerta', form: f })) showToast(error.message || 'No se pudo guardar la alerta', 'error');
    } finally { submit.disabled = false; }
}

async function loadEstadosResidente() {
    try {
        _estadosResidente = await API_B2B.getEstadosResidente(_pacienteId);
        if (_paciente) renderDatosTab(_paciente);
    } catch (error) {
        _estadosResidente = { actual: { tipo: 'presente', presente: true, version: null }, historial: [] };
        if (_paciente) renderDatosTab(_paciente);
    }
}

function renderEstadoHistory() {
    const el = document.getElementById('temporaryStateHistory');
    if (!el) return;
    const rows = (_estadosResidente.historial || []).slice(0, 6).map(state => `<div class="state-history-row">
        <strong>${escapeHtml(LA1_LABELS.estado[state.tipo] || state.tipo)}</strong>
        <span>${formatDateTime(state.iniciado_at)}${state.finalizado_at ? ` → ${formatDateTime(state.finalizado_at)}` : ' · vigente'}</span>
        ${state.motivo ? `<small>${escapeHtml(state.motivo)}</small>` : ''}
    </div>`).join('');
    el.innerHTML = rows ? `<details class="state-history"><summary>Ver historial reciente</summary>${rows}</details>` : '';
}

function openEstadoTemporal() {
    const f = document.getElementById('formEstadoTemporal');
    if (!f) return;
    f.reset();
    f.eVersion.value = _estadosResidente.actual?.version || '';
    f.eOcurridoAt.value = toLocalDateTime();
    f.eTipo.value = _estadosResidente.actual?.tipo === 'presente' ? 'salida_medica' : 'presente';
    openModal('modalEstadoTemporal');
}

async function handleSaveEstadoTemporal(event) {
    event.preventDefault();
    const f = event.target;
    const submit = f.querySelector('[type=submit]');
    submit.disabled = true;
    const data = { tipo: f.eTipo.value, ocurrido_at: toApiDateTime(f.eOcurridoAt.value), motivo: f.eMotivo.value.trim() };
    if (f.eVersion.value) data.expected_version = Number(f.eVersion.value);
    try {
        await API_B2B.transitionEstadoResidente(_pacienteId, data);
        closeModal('modalEstadoTemporal');
        showToast('Estado actualizado', 'success');
        await Promise.all([loadEstadosResidente(), invalidateTimelineAfterMutation()]);
    } catch (error) {
        if (!handleOfflineWrite(error, { modal: 'modalEstadoTemporal', form: f })) showToast(error.message || 'No se pudo actualizar el estado', 'error');
    } finally { submit.disabled = false; }
}

async function loadIncidentes() {
    const el = document.getElementById('incidentesContent');
    if (!el) return;
    try {
        _incidentes = await API_B2B.getIncidentes(_pacienteId, _incidentArchiveFilter);
        renderIncidentes();
    } catch (error) {
        el.innerHTML = '<div class="empty-state"><h3>No se pudieron cargar los incidentes</h3></div>';
    }
}

function renderIncidentes() {
    const el = document.getElementById('incidentesContent');
    if (!el) return;
    const canManage = canDo('gestionar_incidentes') && !_isEgresado;
    const toolbar = `<div class="section-toolbar"><div><span class="eyebrow">Seguimiento operativo</span><h2>Incidentes</h2></div>
        ${canManage ? '<button class="btn btn-primary btn-sm" onclick="openIncidente()">Registrar incidente</button>' : ''}</div>`;
    const filters = `<div class="filter-tabs incident-filter-tabs" role="group" aria-label="Filtrar incidentes">
        ${[['activos','Activos'],['archivados','Archivados'],['todos','Todos']].map(([value,label]) => `<button type="button" class="filter-tab${_incidentArchiveFilter === value ? ' active' : ''}" aria-pressed="${_incidentArchiveFilter === value}" onclick="setIncidentArchiveFilter('${value}')">${label}</button>`).join('')}
    </div>`;
    if (!_incidentes.length) {
        const emptyTitle = _incidentArchiveFilter === 'archivados' ? 'Sin incidentes archivados' : _incidentArchiveFilter === 'activos' ? 'Sin incidentes activos' : 'Sin incidentes registrados';
        el.innerHTML = toolbar + filters + `<div class="empty-state"><h3>${emptyTitle}</h3><p class="text-muted">Los incidentes archivados se conservan con autoría e historial de cambios.</p></div>`;
        return;
    }
    el.innerHTML = toolbar + filters + `<div class="incident-list">${_incidentes.map(item => `<article class="incident-card severity-${escapeHtml(item.severidad)}${item.deleted_at ? ' is-archived' : ''}">
        <div class="incident-heading"><div><span class="badge badge-gray">${escapeHtml(LA1_LABELS.incidente[item.categoria] || item.categoria)}</span><span class="badge badge-gray">${escapeHtml(item.estado.replace('_', ' '))}</span>${item.deleted_at ? '<span class="badge badge-archived">Archivado</span>' : ''}</div><time>${formatDateTime(item.ocurrido_at)}</time></div>
        <h3>${escapeHtml(item.descripcion)}</h3>
        ${item.accion_tomada ? `<p><strong>Acción:</strong> ${escapeHtml(item.accion_tomada)}</p>` : ''}
        <div class="incident-meta">Registró ${escapeHtml(item.actor_nombre || '—')}${item.notificacion_realizada ? ` · Contacto notificado${item.contacto_notificado_nombre ? `: ${escapeHtml(item.contacto_notificado_nombre)}` : ''}` : ''}</div>
        ${item.deleted_at ? `<div class="incident-archive-meta">Archivado el ${formatDateTime(item.archivado_at || item.deleted_at)}${item.archivado_por_nombre ? ` por ${escapeHtml(item.archivado_por_nombre)}` : ''}${item.deletion_reason ? ` · ${escapeHtml(item.deletion_reason)}` : ''}</div>` : ''}
        ${canManage && !item.deleted_at ? `<div class="item-actions"><button class="btn btn-sm btn-secondary" onclick="openIncidente(${safeRecordId(item.id)})">Editar</button><button class="btn btn-sm btn-danger" onclick="deleteIncidente(${safeRecordId(item.id)})">Archivar</button></div>` : ''}
    </article>`).join('')}</div>`;
}

async function setIncidentArchiveFilter(filter) {
    if (!['activos', 'archivados', 'todos'].includes(filter) || filter === _incidentArchiveFilter) return;
    _incidentArchiveFilter = filter;
    await loadIncidentes();
}

function toggleIncidentNotificationFields(show) {
    const fields = document.getElementById('incidentNotificationFields');
    const form = document.getElementById('formIncidente');
    if (!fields || !form) return;
    fields.hidden = !show;
    fields.setAttribute('aria-hidden', String(!show));
    form.iContacto.required = show;
    form.iNotificadaAt.required = show;
    if (show && !form.iNotificadaAt.value) form.iNotificadaAt.value = toLocalDateTime();
    if (!show) {
        form.iContacto.value = '';
        form.iNotificadaAt.value = '';
        form.iNotificacionDetalle.value = '';
    }
}

function openIncidente(id = null) {
    const f = document.getElementById('formIncidente');
    if (!f) return;
    f.reset();
    f.iId.value = id || '';
    f.iVersion.value = '';
    f.iOcurridoAt.value = toLocalDateTime();
    f.iSeveridad.value = 'moderada';
    f.iEstado.value = 'abierto';
    f.iContacto.innerHTML = '<option value="">— Seleccionar —</option>' + _contactos.map(c => `<option value="${safeRecordId(c.id)}">${escapeHtml(c.nombre)}</option>`).join('');
    document.getElementById('modalIncidenteTitle').textContent = id ? 'Editar incidente' : 'Registrar incidente';
    if (id) {
        const item = _incidentes.find(i => safeRecordId(i.id) === safeRecordId(id));
        if (!item) return;
        f.iVersion.value = item.version;
        f.iCategoria.value = item.categoria;
        f.iSeveridad.value = item.severidad;
        f.iOcurridoAt.value = toLocalDateTime(item.ocurrido_at);
        f.iEstado.value = item.estado;
        f.iDescripcion.value = item.descripcion || '';
        f.iAccion.value = item.accion_tomada || '';
        f.iNotificado.checked = !!item.notificacion_realizada;
        f.iContacto.value = item.contacto_notificado_id || '';
        f.iNotificadaAt.value = toLocalDateTime(item.notificada_at);
        f.iNotificacionDetalle.value = item.notificacion_detalle || '';
    }
    toggleIncidentNotificationFields(f.iNotificado.checked);
    openModal('modalIncidente');
}

async function handleSaveIncidente(event) {
    event.preventDefault();
    const f = event.target;
    const submit = f.querySelector('[type=submit]');
    submit.disabled = true;
    const id = safeRecordId(f.iId.value);
    const data = { categoria: f.iCategoria.value, severidad: f.iSeveridad.value, ocurrido_at: toApiDateTime(f.iOcurridoAt.value),
        estado: f.iEstado.value, descripcion: f.iDescripcion.value.trim(), accion_tomada: f.iAccion.value.trim(),
        notificacion_realizada: f.iNotificado.checked, contacto_notificado_id: f.iNotificado.checked ? (f.iContacto.value || null) : null,
        notificada_at: f.iNotificado.checked ? toApiDateTime(f.iNotificadaAt.value) : null,
        notificacion_detalle: f.iNotificado.checked ? f.iNotificacionDetalle.value.trim() : '' };
    if (id) data.expected_version = Number(f.iVersion.value);
    try {
        if (id) await API_B2B.updateIncidente(id, data);
        else await API_B2B.createIncidente(_pacienteId, data);
        closeModal('modalIncidente');
        showToast('Incidente guardado', 'success');
        await Promise.all([loadIncidentes(), invalidateTimelineAfterMutation()]);
    } catch (error) {
        if (!handleOfflineWrite(error, { modal: 'modalIncidente', form: f })) showToast(error.message || 'No se pudo guardar el incidente', 'error');
    } finally { submit.disabled = false; }
}

function deleteIncidente(id) {
    const item = _incidentes.find(i => safeRecordId(i.id) === safeRecordId(id));
    if (!item) return;
    confirmDialog('¿Archivar este incidente? Podrás consultarlo en Ficha del paciente > Incidentes > Archivados.', async () => {
        try {
            await API_B2B.deleteIncidente(id, item.version);
            showToast('Incidente archivado', 'success');
            await Promise.all([loadIncidentes(), invalidateTimelineAfterMutation()]);
        } catch (error) { showToast(error.message || 'No se pudo archivar', 'error'); }
    }, 'Archivar');
}

// ============================================
// LOAD ALL DATA
// ============================================
// Returns a resolved promise (no-op) when a familiar is blocked from seeing a section.
// For all other roles _canLoad always returns true so loaders run normally.
function _canLoad(section) {
    if (!_isReadOnly) return true;
    return canFamiliarSee(section);
}

async function loadAllData() {
    await Promise.all([
        _canLoad('alertas')      ? loadAlertas()      : Promise.resolve(),
        _canLoad('estados')      ? loadEstadosResidente() : Promise.resolve(),
        _canLoad('medicamentos') ? loadMedicamentos() : Promise.resolve(),
        _canLoad('citas')        ? loadCitas()        : Promise.resolve(),
        _canLoad('tareas')       ? loadTareas()       : Promise.resolve(),
        _canLoad('sintomas')     ? loadSintomas()     : Promise.resolve(),
        _canLoad('signos')       ? loadSignos()       : Promise.resolve(),
        _canLoad('contactos')    ? loadContactos()    : Promise.resolve(),
        _canLoad('notas')        ? loadNotas()        : Promise.resolve(),
        _canLoad('documentos')   ? loadDocumentos()   : Promise.resolve(),
        _canLoad('incidentes')   ? loadIncidentes()   : Promise.resolve(),
        _canLoad('evoluciones')  ? loadTimeline(true) : Promise.resolve(),
    ]);
}

// ============================================
// LÍNEA DE TIEMPO Y EVOLUCIONES — PAQUETE 2
// ============================================
const TIMELINE_GROUPS = Object.freeze({
    evolucion: ['evaluacion','seguimiento','observacion','cambio_clinico'],
    medicacion: ['medicacion_administrada','medicacion_omitida','medicacion_rechazada','medicacion_no_disponible','cambio_esquema'],
    observaciones: ['sintoma','signo_vital','nota'],
    operacion: ['incidente','cita','estado_temporal','regreso','documento','tarea_completada'],
});

const TIMELINE_LABELS = Object.freeze({
    evaluacion:'Evaluación', seguimiento:'Seguimiento', observacion:'Observación', cambio_clinico:'Cambio relevante',
    sintoma:'Síntoma', signo_vital:'Signo vital', nota:'Nota', incidente:'Incidente', cita:'Cita',
    medicacion_administrada:'Administración', medicacion_omitida:'Omisión', medicacion_rechazada:'Rechazo',
    medicacion_no_disponible:'No disponible', cambio_esquema:'Cambio de esquema', estado_temporal:'Estado temporal', regreso:'Regreso',
    documento:'Documento', tarea_completada:'Tarea completada',
});

async function loadTimeline(reset = false) {
    const el = document.getElementById('timelineContent');
    if (!el) return;
    if (!reset && _timelineDirty) reset = true;
    const revision = ++_timelineLoadRevision;
    const patientId = Number(_pacienteId);
    try {
        const params = { limit: 25 };
        if (!reset && _timelineCursor) params.cursor = _timelineCursor;
        const [page, evolutions] = await Promise.all([
            API_B2B.getTimeline(patientId, params),
            reset ? API_B2B.getEvoluciones(patientId) : Promise.resolve(_evoluciones),
        ]);
        if (revision !== _timelineLoadRevision || patientId !== Number(_pacienteId)) return;
        _timelineItems = reset ? page.items : [..._timelineItems, ...page.items];
        _timelineCursor = page.next_cursor;
        _evoluciones = evolutions;
        _timelineDirty = false;
        renderTimeline();
    } catch (error) {
        if (revision !== _timelineLoadRevision || patientId !== Number(_pacienteId)) return;
        el.innerHTML = `<div class="empty-state"><h3>No se pudo cargar la línea de tiempo</h3><p class="text-muted">${escapeHtml(error.message || 'Intentá nuevamente.')}</p></div>`;
    }
}

function timelineIsVisible() {
    return document.getElementById('tab-timeline')?.classList.contains('active') === true;
}

async function invalidateTimelineAfterMutation() {
    _timelineDirty = true;
    if (timelineIsVisible()) await loadTimeline(true);
}

function timelineSourceTab(source) {
    return ({ sintoma:'sintomas',signo:'signos',nota:'notas',incidente:'incidentes',cita:'citas',administracion:'medicamentos',esquema:'medicamentos',estado:'datos',estado_regreso:'datos',documento:'documentos',tarea:'tareas' })[source] || null;
}

function renderTimeline() {
    const el = document.getElementById('timelineContent');
    if (!el) return;
    const selected = document.getElementById('timelineFilter')?.value || 'todos';
    const allowed = selected === 'todos' ? null : TIMELINE_GROUPS[selected];
    const items = allowed ? _timelineItems.filter(item => allowed.includes(item.tipo)) : _timelineItems;
    const canWrite = canDo('registrar_evolucion') && !_isEgresado;
    const toolbar = `<div class="timeline-toolbar">
        <div><span class="eyebrow">Historia operativa</span><h2>Línea de tiempo</h2><p>Eventos existentes y evoluciones, sin duplicar sus fuentes.</p></div>
        <div class="timeline-controls"><label for="timelineFilter">Mostrar</label><select id="timelineFilter" class="form-control" onchange="renderTimeline()"><option value="todos"${selected==='todos'?' selected':''}>Todo</option><option value="evolucion"${selected==='evolucion'?' selected':''}>Evoluciones</option><option value="medicacion"${selected==='medicacion'?' selected':''}>Medicación</option><option value="observaciones"${selected==='observaciones'?' selected':''}>Síntomas, signos y notas</option><option value="operacion"${selected==='operacion'?' selected':''}>Operación</option></select>${canWrite ? '<button class="btn btn-primary btn-sm" onclick="openEvolucion()">Nueva evolución</button>' : ''}</div>
    </div>`;
    if (!items.length) {
        el.innerHTML = toolbar + '<div class="empty-state"><h3>Sin eventos para este filtro</h3><p class="text-muted">Los nuevos registros aparecerán en orden cronológico.</p></div>';
        return;
    }
    const rows = items.map(item => {
        const sourceTab = timelineSourceTab(item.source);
        const evolutionId = item.source === 'evolucion' ? Number(item.source_id) : null;
        return `<article class="timeline-event timeline-${escapeHtml(item.tipo)}">
            <div class="timeline-marker" aria-hidden="true"></div>
            <div class="timeline-card">
                <div class="timeline-heading"><div><span class="metadata-tag">${escapeHtml(TIMELINE_LABELS[item.tipo] || item.tipo)}</span><time>${formatDateTime(item.ocurrido_at)}</time></div><span class="timeline-actor">${escapeHtml(item.actor_nombre || 'No disponible')}</span></div>
                <h3>${escapeHtml(item.titulo || 'Evento')}</h3>${item.detalle ? `<p>${escapeHtml(item.detalle)}</p>` : ''}
                <div class="item-actions">${sourceTab ? `<button class="btn btn-secondary btn-sm" data-source-tab="${escapeHtml(sourceTab)}" onclick="activateResidentTab(this.dataset.sourceTab)">Ver origen</button>` : ''}${evolutionId && canWrite ? `<button class="btn btn-secondary btn-sm" onclick="openEvolucion(${safeRecordId(evolutionId)})">Editar</button>` : ''}</div>
            </div>
        </article>`;
    }).join('');
    el.innerHTML = toolbar + `<div class="timeline-list">${rows}</div>${_timelineCursor ? '<div class="timeline-more"><button class="btn btn-secondary" onclick="loadTimeline(false)">Cargar anteriores</button></div>' : ''}`;
}

function openEvolucion(id = null) {
    const form = document.getElementById('formEvolucion');
    if (!form) return;
    form.reset();
    form.eId.value = id || '';
    form.eVersion.value = '';
    form.eOcurridoAt.value = toLocalDateTime();
    document.getElementById('modalEvolucionTitle').textContent = id ? 'Editar evolución' : 'Nueva evolución';
    if (id) {
        const item = _evoluciones.find(row => safeRecordId(row.id) === safeRecordId(id));
        if (!item) return;
        form.eVersion.value = item.version;
        form.eTipo.value = item.tipo;
        form.eOcurridoAt.value = toLocalDateTime(item.ocurrido_at);
        form.eTitulo.value = item.titulo || '';
        form.eContenido.value = item.contenido || '';
    }
    openModal('modalEvolucion');
}

async function handleSaveEvolucion(event) {
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    const id = safeRecordId(form.eId.value);
    const data = { tipo:form.eTipo.value, ocurrido_at:toApiDateTime(form.eOcurridoAt.value), titulo:form.eTitulo.value.trim(), contenido:form.eContenido.value.trim() };
    if (id) data.expected_version = Number(form.eVersion.value);
    try {
        if (id) await API_B2B.updateEvolucion(id, data);
        else await API_B2B.createEvolucion(_pacienteId, data);
        closeModal('modalEvolucion');
        showToast('Evolución guardada', 'success');
        await invalidateTimelineAfterMutation();
    } catch (error) {
        if (error.code === 'VERSION_CONFLICT') {
            showToast('Otra persona modificó esta evolución. Cerrá y volvé a abrirla para editar la versión actual.', 'error');
        } else if (!handleOfflineWrite(error, { modal:'modalEvolucion', form })) {
            showToast(error.message || 'No se pudo guardar la evolución', 'error');
        }
    } finally { submit.disabled = false; }
}

function deleteEvolucion(id) {
    const item = _evoluciones.find(row => safeRecordId(row.id) === safeRecordId(id));
    if (!item) return;
    confirmDialog('¿Archivar esta evolución? Se preservará su trazabilidad.', async () => {
        try { await API_B2B.deleteEvolucion(id, item.version); await invalidateTimelineAfterMutation(); }
        catch (error) { showToast(error.message || 'No se pudo archivar', 'error'); }
    }, 'Archivar');
}

// ============================================
// DOCUMENTOS ADJUNTOS
// ============================================
let _documentos = [];

async function loadDocumentos() {
    const el = document.getElementById('documentosContent');
    if (!el) return;
    try {
        _documentos = await API_B2B.getDocumentos(_pacienteId);
        renderDocumentos(_documentos);
    } catch (err) {
        el.innerHTML = `<div class="empty-state"><h3>Error al cargar documentos</h3></div>`;
    }
}

function renderDocumentos(lista) {
    const el = document.getElementById('documentosContent');
    if (!el) return;

    const canUpload = !_isReadOnly && !_isEgresado;
    const toolbar = canUpload ? `
        <div class="d-flex justify-between align-center mb-16">
            <span class="text-muted">${lista.length} documento${lista.length !== 1 ? 's' : ''}</span>
            <button class="btn btn-primary btn-sm" onclick="openDocumento()">Adjuntar documento</button>
        </div>` : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} documento${lista.length !== 1 ? 's' : ''}</span></div>`;

    if (lista.length === 0) {
        el.innerHTML = toolbar + `<div class="empty-state"><h3>Sin documentos adjuntos</h3><p class="text-muted">Podés subir archivos PDF, Word, Excel o imágenes (máx. 5 MB).</p></div>`;
        return;
    }

    const rows = lista.map(d => {
        const icon = _docIcon(d.tipo_mime, d.nombre_archivo);
        const size = _formatBytes(d.tamanio_bytes);
        const canDel = _isAdmin || d.subido_nombre === API_B2B.getUser()?.nombre;
        return `
        <div class="item-row" id="doc-row-${safeRecordId(d.id)}">
            <div class="item-icon badge-blue" style="font-size:1.2rem;min-width:40px;height:40px;display:flex;align-items:center;justify-content:center">${icon}</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(d.nombre_archivo)}</div>
                <div class="item-subtitle">${size} · Subido por ${escapeHtml(d.subido_nombre || '—')} · ${formatDate(d.created_at)}</div>
                <div class="item-meta">
                    ${d.categoria ? `<span class="badge badge-blue">${escapeHtml(LA1_LABELS.documento[d.categoria] || d.categoria)}</span>` : ''}
                    ${d.fecha_documento ? `<span class="badge badge-gray">Fecha: ${formatDate(d.fecha_documento)}</span>` : ''}
                </div>
                ${d.descripcion ? `<div class="item-subtitle mt-8">${escapeHtml(d.descripcion)}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn btn-sm btn-secondary" onclick="descargarDocumento(${safeRecordId(d.id)})">&#x2B07;&#xFE0F; Descargar</button>
                ${canDel ? `<button class="btn btn-sm btn-secondary" onclick="openDocumento(${safeRecordId(d.id)})">Editar datos</button><button class="btn btn-sm btn-danger" onclick="eliminarDocumento(${safeRecordId(d.id)})">Archivar</button>` : ''}
            </div>
        </div>`;
    }).join('');

    el.innerHTML = toolbar + `<div class="item-list">${rows}</div>`;
}

function descargarDocumento(id) {
    const safeId = safeRecordId(id);
    const documento = _documentos.find(d => safeRecordId(d.id) === safeId);
    if (!safeId || !documento) return;
    API_B2B.downloadDocumento(safeId, documento.nombre_archivo || 'documento');
}

function _docIcon(mime, nombre) {
    const ext = (nombre || '').split('.').pop().toLowerCase();
    if (mime === 'application/pdf' || ext === 'pdf') return '📄';
    if (mime === 'application/msword' || ext === 'doc') return '📃';
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return '📃';
    if (mime?.includes('spreadsheet') || ext === 'xls' || ext === 'xlsx') return '📊';
    if (mime?.startsWith('image/') || ['jpg','jpeg','png','gif','webp'].includes(ext)) return '🖼️';
    return '📎';
}

function _formatBytes(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function openDocumento(id = null) {
    const f = document.getElementById('formDocumento');
    if (!f) return;
    f.reset();
    f.dId.value = id || '';
    f.dVersion.value = '';
    const editing = !!id;
    f.dArchivo.required = !editing;
    document.getElementById('documentFileGroup').hidden = editing;
    document.getElementById('modalDocumentoTitle').textContent = editing ? 'Editar datos del documento' : 'Adjuntar documento';
    if (editing) {
        const item = _documentos.find(d => safeRecordId(d.id) === safeRecordId(id));
        if (!item) return;
        f.dVersion.value = item.version;
        f.dCategoria.value = item.categoria || '';
        f.dFecha.value = item.fecha_documento ? item.fecha_documento.slice(0, 10) : '';
        f.dDescripcion.value = item.descripcion || '';
    }
    openModal('modalDocumento');
}

async function handleDocumentoUpload(event) {
    event.preventDefault();
    const form = event.target;
    const id = safeRecordId(form.dId.value);
    const file = form.dArchivo.files?.[0];
    if (!id && !file) return;
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    if (file && file.size > 5 * 1024 * 1024) {
        showToast('El archivo supera el límite de 5 MB', 'error');
        submit.disabled = false;
        return;
    }
    const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'image/jpeg', 'image/png', 'image/gif', 'image/webp'
    ];
    if (file && !allowedTypes.includes(file.type)) {
        showToast('Formato no permitido. Usá PDF, Word, Excel, imagen o TXT.', 'warning');
        submit.disabled = false;
        return;
    }
    try {
        const metadata = { categoria: form.dCategoria.value || null, fecha_documento: form.dFecha.value || null, descripcion: form.dDescripcion.value.trim() };
        if (id) {
            await API_B2B.updateDocumento(id, { ...metadata, expected_version: Number(form.dVersion.value) });
            showToast('Datos del documento actualizados', 'success');
        } else {
            const b64 = await _fileToBase64(file);
            await API_B2B.uploadDocumento({ paciente_id: _pacienteId, nombre_archivo: file.name, tipo_mime: file.type, datos: b64, ...metadata });
            showToast('Documento subido', 'success');
        }
        closeModal('modalDocumento');
        await Promise.all([loadDocumentos(), invalidateTimelineAfterMutation()]);
    } catch (err) {
        showToast(err.message || 'Error al subir el documento', 'error');
    } finally { submit.disabled = false; }
}

function _fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // result is data:[mime];base64,[data] — strip the prefix
            const b64 = reader.result.split(',')[1];
            resolve(b64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function eliminarDocumento(id) {
    confirmDialog('¿Archivar este documento? Se conservará el registro y la trazabilidad.', async () => {
        try {
            await API_B2B.deleteDocumento(id);
            showToast('Documento archivado', 'success');
            await Promise.all([loadDocumentos(), invalidateTimelineAfterMutation()]);
        } catch (err) {
            showToast(err.message || 'Error al eliminar', 'error');
        }
    }, 'Archivar');
}

// ============================================
// MEDICAMENTOS
// ============================================
let _meds = [];
async function loadMedicamentos() {
    try {
        _meds = await API_B2B.getMedicamentos(_pacienteId);
        renderMedicamentos(_meds);
        loadHistorialTomas(); // non-blocking, refresh alongside stock
    } catch (err) {
        console.error(err);
        const el = document.getElementById('medsContent');
        if (el) el.innerHTML = `<div class="empty-state"><h3>Error al cargar medicamentos</h3><p class="text-muted">Verificá tu conexión e intentá nuevamente.</p></div>`;
    }
}

// ============================================
// HISTORIAL DE TOMAS
// ============================================
async function loadHistorialTomas() {
    try {
        const hist = await API_B2B.getHistorialMeds(_pacienteId);
        renderHistorialTomas(hist);
    } catch (_) {}
}

function renderHistorialTomas(lista) {
    const el = document.getElementById('historialTomasContent');
    if (!el) return;
    const header = `<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 0 8px;border-top:2px solid var(--border-color);margin-top:16px">
        <span style="font-weight:700;font-size:.88rem;color:var(--text-primary)">Administraciones y omisiones recientes</span>
    </div>`;
    if (!lista || lista.length === 0) {
        el.innerHTML = header + `<p style="font-size:.82rem;color:var(--text-secondary);padding:4px 0 12px">Sin tomas registradas aún para este paciente.</p>`;
        return;
    }
    const rows = lista.slice(0, 15).map(t => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--border-color)">
            <span class="medication-result-dot is-${escapeHtml(t.resultado || 'administrada')}" aria-hidden="true"></span>
            <div style="flex:1;min-width:0">
                <div style="font-size:.86rem;font-weight:600;color:var(--text-primary)">${escapeHtml(t.medicamento_nombre || '—')} <span class="badge ${t.resultado === 'administrada' || !t.resultado ? 'badge-green' : 'badge-orange'}">${escapeHtml((t.resultado || 'administrada').replace('_',' '))}</span>${t.dosis ? `<span style="font-weight:400;color:var(--text-secondary)"> — ${escapeHtml(t.dosis)}</span>` : ''}${safeFiniteNumber(t.cantidad) > 1 ? `<span style="font-weight:400;color:var(--text-secondary)"> × ${safeFiniteNumber(t.cantidad)}</span>` : ''}</div>
                <div style="font-size:.78rem;color:var(--text-secondary);margin-top:2px">
                    ${formatInstitutionDateTime(t.fecha)} · por <strong>${escapeHtml(t.administrador_nombre || '—')}</strong>${t.motivo_omision ? ` · Motivo: ${escapeHtml(t.motivo_omision)}` : ''}${t.notas ? ` · <em>${escapeHtml(t.notas)}</em>` : ''}
                </div>
            </div>
        </div>`).join('');
    el.innerHTML = header + `<div>${rows}</div>`;
}

// Pluraliza unidades de forma inteligente para el badge de stock.
// "unidad" → "unidades"; "comprimido" → "comprimidos"; "ml/mg/g" → sin cambio, etc.
function _pluralUnidad(u) {
    if (!u) return '';
    const s = u.trim();
    const l = s.toLowerCase();
    if (l === 'unidad') return 'unidades';
    if (l.endsWith('es') || l.endsWith('os') || l.endsWith('as') || l.endsWith('is')) return s; // ya plural
    if (s.length <= 3 && /^[a-zA-Z]+$/.test(s)) return s; // abreviatura (ml, mg, g, kg, cc…)
    const last = l[l.length - 1];
    if ('aeiouáéíóú'.includes(last)) return s + 's';
    return s + 'es';
}

function renderMedicamentos(lista) {
    const el = document.getElementById('medsContent');
    if (!el) return;
    const canManage = canDo('gestionar_prescripcion') && !_isEgresado;
    const canAdminister = canDo('registrar_administracion') && !_isEgresado;
    const toolbar = canManage ? `
        <div class="d-flex justify-between align-center mb-16">
            <span class="text-muted">${lista.length} medicamento${lista.length !== 1 ? 's' : ''}</span>
            <button class="btn btn-primary btn-sm" onclick="openModalMed()">+ Nueva prescripción</button>
        </div>` : '';
    if (lista.length === 0) {
        el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">💊</div><h3>Sin medicamentos</h3></div>`;
        return;
    }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(m => `
        <div class="item-row">
            <div class="item-icon badge-purple">💊</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(m.nombre)} ${m.dosis ? `— ${escapeHtml(m.dosis)}` : ''}</div>
                <div class="item-subtitle">${m.frecuencia ? escapeHtml(m.frecuencia) : ''} ${m.horarios_custom ? '· ' + escapeHtml(Array.isArray(m.horarios_custom) ? m.horarios_custom.join(', ') : m.horarios_custom) : ''}</div>
                <div class="metadata-line">${m.via ? `<span class="metadata-tag">Vía: ${escapeHtml(m.via)}</span>` : ''}${m.prescriptor ? `<span class="metadata-tag">Prescriptor: ${escapeHtml(m.prescriptor)}</span>` : ''}<span class="metadata-tag">Esquema v${safeFiniteNumber(m.esquema_version,1)}</span>${m.vigente_desde ? `<span>Desde ${formatDateTime(m.vigente_desde)}</span>` : ''}${m.vigente_hasta ? `<span>Hasta ${formatDateTime(m.vigente_hasta)}</span>` : ''}</div>
                ${m.indicacion ? `<div class="item-subtitle mt-8"><strong>Indicación:</strong> ${escapeHtml(m.indicacion)}</div>` : ''}
                ${m.instrucciones ? `<div class="item-subtitle mt-8">${escapeHtml(m.instrucciones)}</div>` : ''}
                <div class="item-meta">
                    ${ !_isReadOnly ? (
                        m.catalogo_id
                            ? `<span class="badge ${safeFiniteNumber(m.catalogo_stock) <= 0 ? 'badge-red' : safeFiniteNumber(m.catalogo_stock) <= safeFiniteNumber(m.catalogo_stock_minimo, 5) ? 'badge-orange' : 'badge-teal'}">📦 Stock: ${safeFiniteNumber(m.catalogo_stock)}${m.catalogo_unidad ? ' '+escapeHtml(_pluralUnidad(m.catalogo_unidad)) : ''}${safeFiniteNumber(m.catalogo_stock) <= safeFiniteNumber(m.catalogo_stock_minimo, 5) ? ' ⚠️' : ''}</span>`
                            : (m.stock !== null ? `<span class="badge badge-teal">Stock: ${safeFiniteNumber(m.stock)}</span>` : '<span class="badge badge-gray" style="opacity:.65">Sin stock</span>')
                    ) : '' }
                </div>
            </div>
            <div class="item-actions">
                ${canAdminister ? `<button class="btn btn-sm btn-success" onclick="registrarToma(${safeRecordId(m.id)},'administrada')">Administrar</button><button class="btn btn-sm btn-secondary" onclick="registrarToma(${safeRecordId(m.id)},'omitida')">Omitir</button>` : ''}
                <button class="btn btn-sm btn-secondary" onclick="openMedicationHistory(${safeRecordId(m.id)})">Historial</button>
                ${canManage ? `<button class="btn btn-sm btn-secondary btn-icon" aria-label="Editar prescripción" onclick="openModalMed(${safeRecordId(m.id)})">${uiIcon('edit')}</button>
                <button class="btn btn-sm btn-danger btn-icon medication-retire-action" title="Retirar prescripción" aria-label="Retirar prescripción" onclick="deleteMed(${safeRecordId(m.id)})">${uiIcon('trash')}</button>` : ''}
            </div>
        </div>`).join('')}</div>`;
}

let _editingMedId = null;
function openModalMed(id) {
    _editingMedId = id || null;
    document.getElementById('modalMedTitle').textContent = _editingMedId ? 'Editar Medicamento' : 'Nuevo Medicamento';
    const f = document.getElementById('formMed');
    f.reset();

    // Both catalog pickers always visible
    const catGroup   = document.getElementById('catalogoPickerGroup');
    const stockGroup = document.getElementById('stockFamiliarGroup');
    if (catGroup)   catGroup.style.display   = '';
    if (stockGroup) stockGroup.style.display = '';

    // Clear hint
    const hintDiv = document.getElementById('catLinkHint');
    if (hintDiv) { hintDiv.textContent = ''; hintDiv.style.display = 'none'; }

    // Populate institutional catalog select
    const instSel = document.getElementById('mCatalogoInstSelect');
    if (instSel) {
        instSel.innerHTML = '<option value="">— Sin vincular al institucional —</option>';
        _catalogo.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.nombre}${c.presentacion ? ' — ' + c.presentacion : ''} (Stock: ${c.stock_actual})`;
            instSel.appendChild(opt);
        });
    }

    // Populate patient-specific catalog select
    const pacSel = document.getElementById('mCatalogoPacSelect');
    if (pacSel) {
        pacSel.innerHTML = '<option value="">— Sin vincular al del residente —</option>';
        _catalogoPaciente.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.nombre}${c.presentacion ? ' — ' + c.presentacion : ''} (Stock: ${c.stock_actual})`;
            pacSel.appendChild(opt);
        });
    }

    if (_editingMedId) {
        const m = _meds.find(x => x.id === id);
        if (m) {
            f.mNombre.value = m.nombre || '';
            f.mDosis.value = m.dosis || '';
            f.mFrecuencia.value = m.frecuencia || '';
            f.mHorarios.value = Array.isArray(m.horarios_custom) ? m.horarios_custom.join(', ') : (m.horarios_custom || '');
            f.mInstrucciones.value = m.instrucciones || '';
            f.mVia.value = m.via || '';
            f.mPrescriptor.value = m.prescriptor || '';
            f.mIndicacion.value = m.indicacion || '';
            f.mVigenteDesde.value = m.vigente_desde ? toLocalDateTime(m.vigente_desde) : '';
            f.mVigenteHasta.value = m.vigente_hasta ? toLocalDateTime(m.vigente_hasta) : '';
            f.mHorariosProgramados.value = Array.isArray(m.horarios_programados) ? m.horarios_programados.join(', ') : '';
            f.mStock.value = m.stock ?? '';
            if (m.catalogo_id) {
                // Pre-select in whichever list contains this id
                const isInst = _catalogo.some(c => c.id === m.catalogo_id);
                if (isInst && instSel) {
                    instSel.value = m.catalogo_id;
                    onCatalogoSelectChange('inst', instSel);
                } else if (pacSel) {
                    pacSel.value = m.catalogo_id;
                    onCatalogoSelectChange('pac', pacSel);
                }
            }
        }
    }
    openModal('modalMed');
    setTimeout(() => {
        const stockInp = document.querySelector('#formMed [name="mStock"]');
        if (stockInp) _onStockInput(stockInp);
    }, 0);
}

// Called when either catalog picker changes
// type: 'inst' | 'pac'
function onCatalogoSelectChange(type, sel) {
    const instSel    = document.getElementById('mCatalogoInstSelect');
    const pacSel     = document.getElementById('mCatalogoPacSelect');
    const stockGroup = document.getElementById('stockFamiliarGroup');
    const hintDiv    = document.getElementById('catLinkHint');

    // Mutual exclusion: selecting one clears the other
    if (type === 'inst' && sel.value && pacSel) pacSel.value = '';
    if (type === 'pac'  && sel.value && instSel) instSel.value = '';

    const hasValue = !!sel.value;
    if (!hasValue) {
        // Check if the OTHER select still has a value
        const otherVal = type === 'inst' ? pacSel?.value : instSel?.value;
        if (!otherVal) {
            // Neither selected — show manual stock
            if (stockGroup) stockGroup.style.display = '';
            if (hintDiv) { hintDiv.textContent = ''; hintDiv.style.display = 'none'; }
        }
        return;
    }

    // A catalog item is selected — hide manual stock
    if (stockGroup) stockGroup.style.display = 'none';

    // Auto-fill name if empty
    const valInt = parseInt(sel.value);
    const catalog = type === 'inst' ? _catalogo : _catalogoPaciente;
    const item = catalog.find(c => c.id === valInt);
    if (item) {
        const f = document.getElementById('formMed');
        if (f && !f.mNombre.value.trim()) f.mNombre.value = item.nombre;
    }

    // Show hint
    if (hintDiv) {
        if (type === 'inst') {
            hintDiv.textContent = '📦 El stock se descuenta del inventario institucional.';
            hintDiv.style.color = 'var(--pro-primary, #1565C0)';
            hintDiv.style.background = '#EEF2FF';
        } else {
            hintDiv.textContent = '👤 El stock se descuenta del catálogo personal del residente.';
            hintDiv.style.color = '#7C3AED';
            hintDiv.style.background = '#F5F3FF';
        }
        hintDiv.style.padding = '6px 10px';
        hintDiv.style.borderRadius = '6px';
        hintDiv.style.display = 'block';
    }
}

function _onStockInput(inp) {
    const note = document.getElementById('stockNullNote');
    if (note) note.style.display = inp.value === '' ? 'block' : 'none';
}

async function handleSaveMed(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    const instSel = document.getElementById('mCatalogoInstSelect');
    const pacSel  = document.getElementById('mCatalogoPacSelect');
    const catId   = (instSel?.value ? parseInt(instSel.value) : null) || (pacSel?.value ? parseInt(pacSel.value) : null) || null;
    const horariosCustom = f.mHorarios.value.split(',').map(value => value.trim()).filter(Boolean);
    const horariosProgramados = f.mHorariosProgramados.value.split(',').map(value => value.trim()).filter(Boolean);
    const data = { paciente_id: _pacienteId, nombre: f.mNombre.value.trim(), dosis: f.mDosis.value.trim(), frecuencia: f.mFrecuencia.value.trim(), horarios_custom: horariosCustom.length ? horariosCustom : null, instrucciones: f.mInstrucciones.value.trim(), stock: f.mStock.value !== '' ? parseInt(f.mStock.value) : null, catalogo_id: catId,
        via:f.mVia.value.trim(), prescriptor:f.mPrescriptor.value.trim(), indicacion:f.mIndicacion.value.trim(),
        vigente_desde:toApiDateTime(f.mVigenteDesde.value), vigente_hasta:toApiDateTime(f.mVigenteHasta.value),
        horarios_programados:horariosProgramados.length ? horariosProgramados : null, motivo_cambio:f.mMotivoCambio.value.trim() };
    if (_editingMedId) {
        const current = _meds.find(med => Number(med.id) === Number(_editingMedId));
        if (current?.version) data.expected_version = Number(current.version);
    }
    if (_editingMedId && !data.motivo_cambio) { showToast('Indicá el motivo del cambio de esquema', 'warning'); btn.disabled = false; return; }
    try {
        if (_editingMedId) { await API_B2B.updateMedicamento(_editingMedId, data); showToast('Medicamento actualizado', 'success'); }
        else {
            await API_B2B.createMedicamento(data);
            if (data.stock === null && !data.catalogo_id) {
                showToast('Medicamento agregado. Nota: sin stock cargado, las tomas no descontarán unidades.', 'info', 5000);
            } else {
                showToast('Medicamento agregado', 'success');
            }
        }
        closeModal('modalMed');
        await Promise.all([loadMedicamentos(), invalidateTimelineAfterMutation()]);
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalMed', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

// ============================================
// CREAR INSUMO RÁPIDO DESDE MODAL DE MEDICAMENTO
// ============================================
function openModalCrearInsumoRapido(tipo) {
    // tipo: 'inst' = institucional, 'pac' = específico del paciente
    document.getElementById('crearInsumoTipo').value = tipo;
    const title = tipo === 'pac'
        ? 'Nuevo insumo para este residente'
        : 'Nuevo insumo institucional';
    document.getElementById('modalCrearInsumoTitle').textContent = title;
    const f = document.getElementById('formCrearInsumoRapido');
    if (f) f.reset();
    openModal('modalCrearInsumoRapido');
}

async function handleCrearInsumoRapido(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Creando…';

    const tipo = document.getElementById('crearInsumoTipo')?.value || 'inst';
    const data = {
        nombre:           f.ciNombre.value.trim(),
        principio_activo: f.ciPrincipioActivo.value.trim() || null,
        presentacion:     f.ciPresentacion.value.trim() || null,
        unidad:           f.ciUnidad.value,
        stock_actual:     parseInt(f.ciStockActual.value) || 0,
        stock_minimo:     parseInt(f.ciStockMinimo.value) || 5,
        paciente_id:      tipo === 'pac' ? (_pacienteId || null) : null,
    };
    if (!data.nombre) {
        showToast('El nombre es obligatorio', 'warning');
        btn.disabled = false; btn.textContent = 'Crear y seleccionar';
        return;
    }

    try {
        const newItem = await API_B2B.createCatalogoItem(data);
        showToast(`Insumo "${newItem.nombre}" creado ✅`, 'success');
        closeModal('modalCrearInsumoRapido');

        // Reload catalogs and auto-select the new item
        if (tipo === 'pac') {
            _catalogoPaciente = await API_B2B.getCatalogo({ paciente_id: _pacienteId });
            const sel = document.getElementById('mCatalogoPacSelect');
            if (sel) {
                sel.innerHTML = '<option value="">— Sin vincular al del residente —</option>' +
                    _catalogoPaciente.map(c => `<option value="${safeRecordId(c.id)}">${escapeHtml(c.nombre)}${c.presentacion ? ' — ' + escapeHtml(c.presentacion) : ''} (${safeFiniteNumber(c.stock_actual)} ${escapeHtml(c.unidad || '')})</option>`).join('');
                sel.value = String(newItem.id);
                onCatalogoSelectChange('pac', sel);
            }
        } else {
            _catalogo = await API_B2B.getCatalogo();
            const sel = document.getElementById('mCatalogoInstSelect');
            if (sel) {
                sel.innerHTML = '<option value="">— Sin vincular al institucional —</option>' +
                    _catalogo.map(c => `<option value="${safeRecordId(c.id)}">${escapeHtml(c.nombre)}${c.presentacion ? ' — ' + escapeHtml(c.presentacion) : ''} (${safeFiniteNumber(c.stock_actual)} ${escapeHtml(c.unidad || '')})</option>`).join('');
                sel.value = String(newItem.id);
                onCatalogoSelectChange('inst', sel);
            }
        }
        // Pre-fill the medication name if not already set
        const nomInput = document.querySelector('#formMed [name="mNombre"]');
        if (nomInput && !nomInput.value.trim()) nomInput.value = newItem.nombre;
    } catch (err) {
        if (!handleOfflineWrite(err, { modal: 'modalCrearInsumoRapido', form: f })) showToast('Error al crear insumo: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ Crear y seleccionar';
    }
}

function registrarToma(id, resultado = 'administrada') {
    // Block toma if stock is depleted
    const med = _meds.find(m => safeRecordId(m.id) === safeRecordId(id));
    const nombre = med?.nombre || 'medicamento';
    if (med && resultado === 'administrada') {
        if (med.catalogo_id) {
            // Stock managed by catalog (institutional or patient-specific)
            if ((med.catalogo_stock ?? 0) <= 0) {
                showToast(`Sin stock en catálogo para "${nombre}". Reponé el insumo antes de registrar una toma.`, 'warning', 4000);
                return;
            }
        } else if (med.stock !== null && med.stock !== undefined && med.stock <= 0) {
            showToast(`Sin stock disponible para "${nombre}". Actualizá el stock antes de registrar una toma.`, 'warning', 4000);
            return;
        }
    }
    document.getElementById('tomaInfo').textContent = `Registrar resultado para: ${nombre}`;
    document.getElementById('tomaMedId').value = id;
    document.getElementById('formToma').reset();
    document.getElementById('tomaMedId').value = id;
    document.getElementById('tomaResultado').value = resultado;
    toggleMedicationResultFields();
    // Pre-set cantidad to 1 and cap max at available stock for UX
    const _cantInput = document.getElementById('tomaCantidad');
    if (_cantInput) {
        _cantInput.value = 1;
        const _stockDisp = med?.catalogo_id ? (med.catalogo_stock ?? 0) : (med?.stock ?? 0);
        _cantInput.max = _stockDisp > 0 ? _stockDisp : '';
    }
    openModal('modalToma');
}

function toggleMedicationResultFields() {
    const result = document.getElementById('tomaResultado')?.value || 'administrada';
    const omitted = result !== 'administrada';
    const reasonGroup = document.getElementById('tomaMotivoGroup');
    const quantity = document.getElementById('tomaCantidad')?.closest('.form-group');
    if (reasonGroup) reasonGroup.style.display = omitted ? '' : 'none';
    if (quantity) quantity.style.display = omitted ? 'none' : '';
}

async function handleSaveToma(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    const id = parseInt(document.getElementById('tomaMedId').value);
    const resultado = f.tomaResultado.value;
    const cantidad = Math.max(1, parseInt(f.tomaCantidad?.value) || 1);
    const motivo = f.tomaMotivo.value.trim();
    if (resultado !== 'administrada' && motivo.length < 3) { showToast('Indicá el motivo de la no administración', 'warning'); btn.disabled = false; return; }
    try {
        await API_B2B.registerMedicationEvent(id, { resultado, motivo_omision:motivo || null, notas:f.tomaNotas.value.trim(), cantidad, programada_para:toApiDateTime(f.tomaProgramadaPara.value) });
        showToast(resultado === 'administrada' ? `Administración registrada${cantidad > 1 ? ` (${cantidad} unidades)` : ''}` : 'No administración registrada', 'success');
        closeModal('modalToma');
        await Promise.all([loadMedicamentos(), invalidateTimelineAfterMutation()]);
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalToma', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function openMedicationHistory(id) {
    const content = document.getElementById('medicationHistoryContent');
    if (!content) return;
    content.innerHTML = '<div class="page-loader"><div class="spinner spinner-dark"></div></div>';
    openModal('modalMedicationHistory');
    try {
        const data = await API_B2B.getMedicationSchemes(id);
        const current = data.vigente;
        const rows = data.historial.map(item => `<article class="scheme-history-row"><div><strong>Versión ${safeFiniteNumber(item.esquema_version)}</strong><time>${formatDateTime(item.registrado_at)}</time></div><p>${escapeHtml(item.motivo || 'Sin motivo registrado')}</p><small>${escapeHtml(item.actor_nombre || 'No disponible')}</small></article>`).join('');
        content.innerHTML = `<section class="current-scheme"><span class="eyebrow">Esquema vigente</span><h3>${escapeHtml(current.nombre)} ${escapeHtml(current.dosis || '')}</h3><p>${escapeHtml(current.indicacion || current.instrucciones || 'Sin indicación ampliada')}</p></section><section><h3>Versiones conservadas</h3>${rows || '<p class="text-muted">Este esquema legado todavía no registra cambios históricos.</p>'}</section>`;
    } catch (error) { content.innerHTML = `<p class="text-muted">${escapeHtml(error.message || 'No se pudo cargar el historial')}</p>`; }
}

async function deleteMed(id) {
    confirmDialog('¿Retirar esta prescripción? Se conservarán su historial, administraciones y auditoría.', async () => {
        try { await API_B2B.deleteMedicamento(id); showToast('Prescripción retirada', 'success'); await Promise.all([loadMedicamentos(), invalidateTimelineAfterMutation()]); }
        catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); }
    });
}

// ============================================
// EGRESO
// ============================================
function openModalEgreso() {
    const overlay = document.getElementById('modalEgreso');
    if (!overlay) { console.error('modalEgreso not found in DOM'); return; }
    const f = document.getElementById('formEgreso');
    if (f) {
        f.reset();
        const fechaInput = f.querySelector('[name="eFechaEgreso"]');
        if (fechaInput) fechaInput.value = today();
        const otroGroup = document.getElementById('eMotivoOtroGroup');
        if (otroGroup) otroGroup.style.display = 'none';
    }
    openModal('modalEgreso');
}

async function handleSaveEgreso(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    const fechaInput = f.querySelector('[name="eFechaEgreso"]');
    const motivoSel = f.querySelector('[name="eMotivoEgreso"]');
    const motivoOtroInput = f.querySelector('[name="eMotivoOtro"]');
    if (!fechaInput?.value || !motivoSel?.value) {
        showToast('Completá la fecha y el motivo de egreso', 'warning');
        btn.disabled = false; return;
    }
    const motivo = motivoSel.value === 'Otro'
        ? (motivoOtroInput?.value?.trim() || 'Otro')
        : motivoSel.value;
    try {
        await API_B2B.updatePaciente(_pacienteId, { fecha_egreso: fechaInput.value, motivo_egreso: motivo });
        showToast('Paciente dado de alta ✅', 'success');
        closeModal('modalEgreso');
        await loadPaciente();
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalEgreso', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

// ============================================
// CITAS
// ============================================
let _citas = [];
async function loadCitas() {
    try { _citas = await API_B2B.getCitas(_pacienteId); renderCitas(_citas); } catch (err) {
        console.error(err);
        const el = document.getElementById('citasContent');
        if (el) el.innerHTML = `<div class="empty-state"><h3>Error al cargar citas</h3><p class="text-muted">Verificá tu conexión e intentá nuevamente.</p></div>`;
    }
    await loadCitasHistorial();
}

let _citasHistorial = [];
async function loadCitasHistorial() {
    try {
        _citasHistorial = await API_B2B.getCitasHistorial(_pacienteId);
        renderCitasHistorial(_citasHistorial);
    } catch (err) { console.error('loadCitasHistorial:', err); }
}

function renderCitasHistorial(lista) {
    let el = document.getElementById('citasHistorialContent');
    if (!el) {
        // Inject below the main citas section
        const parent = document.getElementById('citasContent');
        if (!parent) return;
        el = document.createElement('div');
        el.id = 'citasHistorialContent';
        parent.parentNode.insertBefore(el, parent.nextSibling);
    }
    if (!lista || lista.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div style="margin-top:24px;margin-bottom:8px;font-weight:600;color:var(--text-secondary);font-size:.85rem;display:flex;align-items:center;gap:6px">
            ⏳ Historial de citas realizadas <span class="badge badge-gray">${lista.length}</span>
        </div>
        <div class="item-list">${lista.map(h => `
        <div class="item-row" style="opacity:.85">
            <div class="item-icon badge-green">📋</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(h.titulo)}</div>
                <div class="item-subtitle">📆 ${formatInstitutionDateTime(h.fecha)} ${h.especialidad ? '· ' + escapeHtml(h.especialidad) : ''}</div>
                ${h.medico ? `<div class="item-subtitle">🩺 Dr. ${escapeHtml(h.medico)}</div>` : ''}
                ${h.lugar ? `<div class="item-subtitle">📍 ${escapeHtml(h.lugar)}</div>` : ''}
                <div class="item-meta"><span class="badge badge-green">✅ Realizada</span></div>
            </div>
            ${!_isReadOnly ? `
            <div class="item-actions">
                <button class="btn btn-sm btn-secondary" onclick="openModalReutilizarCita(${safeRecordId(h.id)})" title="Reutilizar cita">🔁 Reutilizar</button>
            </div>` : ''}
        </div>`).join('')}</div>`;
}

function renderCitas(lista) {
    const el = document.getElementById('citasContent');
    if (!el) return;
    // Las citas realizadas se muestran en el historial, no en la lista activa
    const activas = lista.filter(c => c.estado !== 'realizada');
    const toolbar = (_isReadOnly || _isEgresado) ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${activas.length} cita${activas.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModalCita()">+ Agregar</button></div>`;
    if (activas.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">📅</div><h3>Sin citas registradas</h3></div>`; return; }
    const estadoColor = { pendiente: 'badge-orange', realizada: 'badge-green', cancelada: 'badge-red' };
    el.innerHTML = toolbar + `<div class="item-list">${activas.map(c => `
        <div class="item-row">
            <div class="item-icon badge-blue">📅</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(c.titulo)}</div>
                <div class="item-subtitle">📆 ${formatInstitutionDateTime(c.fecha)} ${c.especialidad ? '· ' + escapeHtml(c.especialidad) : ''}</div>
                ${c.medico ? `<div class="item-subtitle">🩺 Dr. ${escapeHtml(c.medico)}</div>` : ''}
                ${c.lugar ? `<div class="item-subtitle">📍 ${escapeHtml(c.lugar)}</div>` : ''}
                <div class="item-meta"><span class="badge ${estadoColor[c.estado] || 'badge-gray'}">${escapeHtml(c.estado || 'pendiente')}</span></div>
            </div>
            <div class="item-actions">
                ${!_isReadOnly ? `<button class="btn btn-sm btn-secondary" onclick="openModalReutilizarCita(${safeRecordId(c.id)})" title="Reutilizar">🔁</button>
                <button class="btn btn-sm btn-secondary btn-icon" onclick="openModalCita(${safeRecordId(c.id)})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteCita(${safeRecordId(c.id)})">&#x1F5D1;</button>` : ''}
            </div>
        </div>`).join('')}</div>`;
}

let _editingCitaId = null;
function openModalCita(id) {
    _editingCitaId = id || null;
    document.getElementById('modalCitaTitle').textContent = id ? 'Editar Cita' : 'Nueva Cita';
    const f = document.getElementById('formCita');
    f.reset();
    if (id) {
        const c = _citas.find(x => x.id === id);
        if (c) {
            f.cTitulo.value = c.titulo || '';
            f.cFecha.value = c.fecha ? c.fecha.slice(0,16) : '';
            f.cEspecialidad.value = c.especialidad || '';
            f.cMedico.value = c.medico || '';
            f.cLugar.value = c.lugar || '';
            f.cDescripcion.value = c.descripcion || '';
            f.cEstado.value = c.estado || 'pendiente';
        }
    }
    openModal('modalCita');
}

// Reutilizar: abre el modal de cita con todos los campos pre-llenados, creando una NUEVA cita al guardar
function openModalReutilizarCita(id) {
    const c = _citas.find(x => x.id === id) || _citasHistorial.find(x => x.id === id);
    if (!c) { showToast('Cita no encontrada', 'error'); return; }
    _editingCitaId = null; // null = crear nueva cita al guardar
    document.getElementById('modalCitaTitle').textContent = '🔁 Reutilizar cita';
    const f = document.getElementById('formCita');
    f.reset();
    f.cTitulo.value = c.titulo || '';
    // Sugerir fecha 1 mes después de la original
    try {
        const d = new Date(String(c.fecha).replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, ''));
        d.setMonth(d.getMonth() + 1);
        const pad = n => String(n).padStart(2, '0');
        f.cFecha.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { f.cFecha.value = ''; }
    f.cEspecialidad.value = c.especialidad || '';
    f.cMedico.value = c.medico || '';
    f.cLugar.value = c.lugar || '';
    f.cDescripcion.value = c.descripcion || '';
    f.cEstado.value = 'pendiente';
    openModal('modalCita');
}

async function handleSaveCita(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const data = { paciente_id: _pacienteId, titulo: f.cTitulo.value.trim(), fecha: toApiDateTime(f.cFecha.value), especialidad: f.cEspecialidad.value.trim(), medico: f.cMedico.value.trim(), lugar: f.cLugar.value.trim(), descripcion: f.cDescripcion.value.trim(), estado: f.cEstado.value };
    try {
        if (_editingCitaId) { await API_B2B.updateCita(_editingCitaId, data); showToast('Cita actualizada', 'success'); }
        else { await API_B2B.createCita(data); showToast('Cita creada', 'success'); }
        closeModal('modalCita'); await Promise.all([loadCitas(), invalidateTimelineAfterMutation()]);
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalCita', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteCita(id) {
    confirmDialog('¿Eliminar esta cita?', async () => { try { await API_B2B.deleteCita(id); showToast('Eliminada', 'success'); await Promise.all([loadCitas(), invalidateTimelineAfterMutation()]); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// TAREAS
// ============================================
let _tareas = [];
async function loadTareas() {
    try { _tareas = await API_B2B.getTareas(_pacienteId); renderTareas(_tareas); loadHistorialTareas(); } catch (err) {
        console.error(err);
        const el = document.getElementById('tareasContent');
        if (el) el.innerHTML = `<div class="empty-state"><h3>Error al cargar tareas</h3><p class="text-muted">Verificá tu conexión e intentá nuevamente.</p></div>`;
    }
}


function renderTareas(lista) {
    const el = document.getElementById('tareasContent');
    if (!el) return;
    const toolbar = (_isReadOnly || _isEgresado) ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} tarea${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModalTarea()">+ Agregar</button></div>`;
    const catColors = { higiene: 'badge-teal', alimentacion: 'badge-orange', medicacion: 'badge-purple', movilidad: 'badge-blue', recreacion: 'badge-green', otro: 'badge-gray' };
    if (lista.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">✅</div><h3>Sin tareas de cuidado</h3></div>`; return; }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(t => `
        <div class="item-row">
            <div class="item-icon badge-teal">📋</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(t.titulo)}</div>
                ${t.descripcion ? `<div class="item-subtitle">${escapeHtml(t.descripcion)}</div>` : ''}
                <div class="item-meta">
                    ${t.hora ? `<span class="badge badge-gray">🕐 ${escapeHtml(t.hora)}</span>` : ''}
                    ${t.frecuencia ? `<span class="badge badge-gray">🔄 ${escapeHtml(t.frecuencia)}</span>` : ''}
                    ${t.categoria ? `<span class="badge ${catColors[t.categoria] || 'badge-gray'}">${escapeHtml(t.categoria)}</span>` : ''}
                </div>
            </div>
            <div class="item-actions">
                ${!_isReadOnly && !_isEgresado ? `<button class="btn btn-sm btn-success" onclick="completarTarea(${safeRecordId(t.id)})">✅ Completar</button>` : ''}
                ${!_isReadOnly ? `<button class="btn btn-sm btn-secondary btn-icon" onclick="openModalTarea(${safeRecordId(t.id)})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteTarea(${safeRecordId(t.id)})">🗑</button>` : ''}
            </div>
        </div>`).join('')}</div>`;
}

// ============================================
// HISTORIAL DE TAREAS
// ============================================
async function loadHistorialTareas() {
    try {
        const hist = await API_B2B.getHistorialTareas(_pacienteId);
        renderHistorialTareas(hist);
    } catch (_) {}
}

function renderHistorialTareas(lista) {
    const el = document.getElementById('historialTareasContent');
    if (!el) return;
    const header = `<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 0 8px;border-top:2px solid var(--border-color);margin-top:16px">
        <span style="font-weight:700;font-size:.88rem;color:var(--text-primary)">🕐 Últimas tareas completadas</span>
    </div>`;
    if (!lista || lista.length === 0) {
        el.innerHTML = header + `<p style="font-size:.82rem;color:var(--text-secondary);padding:4px 0 12px">Sin tareas completadas aún para este paciente.</p>`;
        return;
    }
    const rows = lista.slice(0, 15).map(t => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--border-color)">
            <span style="flex-shrink:0;margin-top:1px;font-size:.95rem">✅</span>
            <div style="flex:1;min-width:0">
                <div style="font-size:.86rem;font-weight:600;color:var(--text-primary)">${escapeHtml(t.tarea_titulo || '—')}</div>
                <div style="font-size:.78rem;color:var(--text-secondary);margin-top:2px">
                    ${formatInstitutionDateTime(t.fecha)} · por <strong>${escapeHtml(t.completador_nombre || '—')}</strong>${t.notas ? ` · <em>${escapeHtml(t.notas)}</em>` : ''}
                </div>
            </div>
        </div>`).join('');
    el.innerHTML = header + `<div>${rows}</div>`;
}

let _editingTareaId = null;
function openModalTarea(id) {
    _editingTareaId = id || null;
    document.getElementById('modalTareaTitle').textContent = id ? 'Editar Tarea' : 'Nueva Tarea';
    const f = document.getElementById('formTarea');
    f.reset();
    if (id) {
        const t = _tareas.find(x => x.id === id);
        if (t) { f.tTitulo.value = t.titulo || ''; f.tDescripcion.value = t.descripcion || ''; f.tCategoria.value = t.categoria || ''; f.tFrecuencia.value = t.frecuencia || ''; f.tHora.value = t.hora || ''; }
    }
    openModal('modalTarea');
}

async function handleSaveTarea(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const data = { paciente_id: _pacienteId, titulo: f.tTitulo.value.trim(), descripcion: f.tDescripcion.value.trim(), categoria: f.tCategoria.value, frecuencia: f.tFrecuencia.value.trim(), hora: f.tHora.value || null };
    try {
        if (_editingTareaId) { await API_B2B.updateTarea(_editingTareaId, data); showToast('Tarea actualizada', 'success'); }
        else { await API_B2B.createTarea(data); showToast('Tarea creada', 'success'); }
        closeModal('modalTarea'); await Promise.all([loadTareas(), invalidateTimelineAfterMutation()]);
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalTarea', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

function completarTarea(id) {
    const titulo = _tareas.find(t => safeRecordId(t.id) === safeRecordId(id))?.titulo || 'tarea';
    document.getElementById('tareaInfo').textContent = `Completar: ${titulo}`;
    document.getElementById('tareaTareaId').value = id;
    document.getElementById('formCompletarTarea').reset();
    document.getElementById('tareaTareaId').value = id;
    openModal('modalCompletarTarea');
}

async function handleCompletarTarea(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const id = parseInt(document.getElementById('tareaTareaId').value);
    try {
        await API_B2B.completarTarea(id, f.tareaNotas.value.trim());
        showToast('Tarea completada ✅', 'success');
        closeModal('modalCompletarTarea');
        Promise.all([loadTareas(), invalidateTimelineAfterMutation()]); // refresh list + timeline (non-blocking)
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalCompletarTarea', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteTarea(id) {
    confirmDialog('¿Eliminar esta tarea?', async () => { try { await API_B2B.deleteTarea(id); showToast('Eliminada', 'success'); await Promise.all([loadTareas(), invalidateTimelineAfterMutation()]); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// SÍNTOMAS
// ============================================
let _sintomas = [];
async function loadSintomas() {
    try { _sintomas = await API_B2B.getSintomas(_pacienteId); renderSintomas(_sintomas); } catch (err) {
        console.error(err);
        const el = document.getElementById('sintomasContent');
        if (el) el.innerHTML = `<div class="empty-state"><h3>Error al cargar síntomas</h3><p class="text-muted">Verificá tu conexión e intentá nuevamente.</p></div>`;
    }
}

function renderSintomas(lista) {
    const el = document.getElementById('sintomasContent');
    if (!el) return;
    const toolbar = (_isReadOnly || _isEgresado) ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} síntoma${lista.length !== 1 ? 's' : ''} registrados</span><button class="btn btn-primary btn-sm" onclick="openModalSintoma()">+ Registrar</button></div>`;
    if (lista.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">${uiIcon('activity')}</div><h3>Sin s\u00edntomas registrados</h3></div>`; return; }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(s => `
        <div class="item-row">
            <div class="item-icon badge-orange">${uiIcon('activity')}</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(s.descripcion)}</div>
                <div class="item-meta">
                    ${s.intensidad !== null ? `<span class="badge ${safeFiniteNumber(s.intensidad) >= 7 ? 'badge-red' : safeFiniteNumber(s.intensidad) >= 4 ? 'badge-orange' : 'badge-teal'}">Intensidad: ${safeFiniteNumber(s.intensidad)}/10</span>` : ''}
                    <span class="badge badge-gray">${formatInstitutionDateTime(s.fecha)}</span>
                    <span class="badge badge-gray">Registrado por: ${escapeHtml(s.registrador_nombre || 'No disponible')}</span>
                </div>
            </div>
            ${!_isReadOnly ? `<div class="item-actions">
                <button class="btn btn-sm btn-secondary btn-icon" onclick="openModalSintoma(${safeRecordId(s.id)})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteSintoma(${safeRecordId(s.id)})">🗑</button>
            </div>` : ''}
        </div>`).join('')}</div>`;
}

let _editingSintomaId = null;
function openModalSintoma(id) {
    _editingSintomaId = id || null;
    const titleEl = document.getElementById('modalSintomaTitle');
    if (titleEl) titleEl.textContent = id ? 'Editar s\u00edntoma' : 'Registrar s\u00edntoma';
    const f = document.getElementById('formSintoma');
    f.reset();
    if (id) {
        const s = _sintomas.find(x => x.id === id);
        if (s) { f.sDesc.value = s.descripcion || ''; f.sIntensidad.value = s.intensidad != null ? s.intensidad : ''; }
    }
    openModal('modalSintoma');
}

async function handleSaveSintoma(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const data = { paciente_id: _pacienteId, descripcion: f.sDesc.value.trim(), intensidad: f.sIntensidad.value ? parseInt(f.sIntensidad.value) : null };
    try {
        if (_editingSintomaId) { await API_B2B.updateSintoma(_editingSintomaId, data); showToast('S\u00edntoma actualizado', 'success'); }
        else { await API_B2B.createSintoma(data); showToast('S\u00edntoma registrado', 'success'); }
        closeModal('modalSintoma'); f.reset(); await Promise.all([loadSintomas(), invalidateTimelineAfterMutation()]);
    }
    catch (err) { if (!handleOfflineWrite(err, { modal: 'modalSintoma', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteSintoma(id) {
    confirmDialog('¿Eliminar este síntoma?', async () => { try { await API_B2B.deleteSintoma(id); showToast('Eliminado', 'success'); await Promise.all([loadSintomas(), invalidateTimelineAfterMutation()]); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// SIGNOS VITALES
// ============================================
let _signos = [];
async function loadSignos() {
    try { _signos = await API_B2B.getSignos(_pacienteId); renderSignos(_signos); } catch (err) {
        console.error(err);
        const el = document.getElementById('signosContent');
        if (el) el.innerHTML = `<div class="empty-state"><h3>Error al cargar signos vitales</h3><p class="text-muted">Verificá tu conexión e intentá nuevamente.</p></div>`;
    }
}

const SIGNOS_TIPOS = [
    { id: 'presion_arterial',    label: 'Presión arterial',  unidad: 'mmHg',  icon: 'activity', placeholder: 'Ej: 120/80',   referencia: 'Normal: 90/60 – 120/80 mmHg' },
    { id: 'frecuencia_cardiaca', label: 'Frec. cardíaca',    unidad: 'lpm',   icon: 'heart', placeholder: 'Ej: 75',       referencia: 'Normal: 60–100 lpm' },
    { id: 'temperatura',         label: 'Temperatura',       unidad: '°C',    icon: 'activity', placeholder: 'Ej: 36.8',     referencia: 'Normal: 36.1–37.2 °C' },
    { id: 'saturacion_oxigeno',  label: 'Saturación O₂',     unidad: '%',     icon: 'activity', placeholder: 'Ej: 98',       referencia: 'Normal: ≥95%' },
    { id: 'glucosa',             label: 'Glucosa',           unidad: 'mg/dL', icon: 'activity', placeholder: 'Ej: 95',       referencia: 'Normal (ayunas): 70–100 mg/dL' },
    { id: 'peso',                label: 'Peso',              unidad: 'kg',    icon: 'activity', placeholder: 'Ej: 70.5',     referencia: null },
    { id: 'talla',               label: 'Talla',             unidad: 'cm',    icon: 'activity', placeholder: 'Ej: 170',      referencia: null },
];

function renderSignos(lista) {
    const el = document.getElementById('signosContent');
    if (!el) return;
    const toolbar = (_isReadOnly || _isEgresado) ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} registro${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModal('modalSigno')">+ Registrar</button></div>`;

    // Latest per type
    const ultimoPorTipo = {};
    lista.forEach(s => { if (!ultimoPorTipo[s.tipo]) ultimoPorTipo[s.tipo] = s; });

    const signosCards = SIGNOS_TIPOS.filter(t => ultimoPorTipo[t.id]).map(t => {
        const s = ultimoPorTipo[t.id];
        return `<div class="vital-card">
            <div class="vital-type">${uiIcon(t.icon)} ${t.label}</div>
            <div class="vital-value">${escapeHtml(s.valor)}</div>
            <div class="vital-unit">${t.unidad}</div>
            <div class="vital-date">${formatDate(s.fecha)}</div>
            <div class="vital-who">Registrado por: ${escapeHtml(s.registrador_nombre || 'No disponible')}</div>
        </div>`;
    }).join('');

    const historial = lista.slice(0, 20).map(s => {
        const tipo = SIGNOS_TIPOS.find(t => t.id === s.tipo);
        return `<tr>
            <td>${tipo ? uiIcon(tipo.icon) : ''} ${escapeHtml(tipo?.label || s.tipo)}</td>
            <td class="fw-bold">${escapeHtml(s.valor)} <span class="text-muted">${tipo?.unidad || ''}</span></td>
            <td class="text-muted">${formatInstitutionDateTime(s.fecha)}</td>
            <td class="text-muted">${escapeHtml(s.registrador_nombre || 'No disponible')}</td>
            ${!_isReadOnly ? `<td><button class="btn btn-danger btn-icon btn-sm" onclick="deleteSigno(${safeRecordId(s.id)})">🗑</button></td>` : '<td></td>'}
        </tr>`;
    }).join('');

    el.innerHTML = toolbar + (signosCards ? `<div class="vitals-row mb-20">${signosCards}</div>` : '') +
        `<div class="card"><div class="card-header"><span class="card-title">${uiIcon('activity')} Historial de signos vitales</span></div>
        <div class="table-wrapper"><table><thead><tr><th>Tipo</th><th>Valor</th><th>Fecha</th><th>Registrado por</th><th></th></tr></thead>
        <tbody>${historial || `<tr><td colspan="5" class="text-center text-muted" style="padding:20px">Sin registros</td></tr>`}</tbody></table></div></div>`;
}

async function handleSaveSigno(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const tipo = f.gTipo.value;
    const tipoData = SIGNOS_TIPOS.find(t => t.id === tipo);
    const data = { paciente_id: _pacienteId, tipo, valor: f.gValor.value.trim(), unidad: tipoData?.unidad || f.gUnidad.value.trim(), notas: f.gNotas.value.trim() };
    try { await API_B2B.createSigno(data); showToast('Signo vital registrado', 'success'); closeModal('modalSigno'); f.reset(); await Promise.all([loadSignos(), invalidateTimelineAfterMutation()]); }
    catch (err) { if (!handleOfflineWrite(err, { modal: 'modalSigno', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteSigno(id) {
    confirmDialog('¿Eliminar este registro?', async () => { try { await API_B2B.deleteSigno(id); showToast('Eliminado', 'success'); await Promise.all([loadSignos(), invalidateTimelineAfterMutation()]); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
}

// Auto-fill unidad + placeholder + referencia al seleccionar tipo
function onSignoTipoChange(select) {
    const tipo = SIGNOS_TIPOS.find(t => t.id === select.value);
    if (!tipo) return;
    const unidadInput = document.getElementById('gUnidad');
    const valorInput  = document.getElementById('gValor');
    const refHint     = document.getElementById('gRefHint');
    if (unidadInput) unidadInput.value      = tipo.unidad;
    if (valorInput)  valorInput.placeholder  = tipo.placeholder || '';
    if (refHint) {
        refHint.textContent  = tipo.referencia ? 'Referencia orientativa: ' + tipo.referencia : '';
        refHint.style.display = tipo.referencia ? 'block' : 'none';
    }
}

// ============================================
// CONTACTOS DE EMERGENCIA
// ============================================
let _contactos = [];
async function loadContactos() {
    try { _contactos = await API_B2B.getContactos(_pacienteId); renderContactos(_contactos); } catch (err) {
        console.error(err);
        const el = document.getElementById('contactosContent');
        if (el) el.innerHTML = `<div class="empty-state"><h3>Error al cargar contactos</h3><p class="text-muted">Verificá tu conexión e intentá nuevamente.</p></div>`;
    }
}

function renderContactos(lista) {
    const el = document.getElementById('contactosContent');
    if (!el) return;
    const toolbar = (_isReadOnly || _isEgresado) ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} contacto${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModalContacto()">+ Agregar</button></div>`;
    if (lista.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">📞</div><h3>Sin contactos de emergencia</h3></div>`; return; }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(c => {
        const telHref = safeContactHref('tel', c.telefono);
        const emailHref = safeContactHref('mailto', c.email);
        return `
        <div class="item-row" ${c.es_principal ? 'style="border-left:3px solid var(--pro-success-light)"' : ''}>
            <div class="item-icon badge-teal">👤</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(c.nombre)} ${c.es_principal ? '<span class="badge badge-green">Principal</span>' : ''}</div>
                ${c.relacion ? `<div class="item-subtitle">${escapeHtml(c.relacion)}</div>` : ''}
                <div class="item-meta">
                    ${c.prioridad ? `<span class="badge badge-orange">Prioridad ${safeFiniteNumber(c.prioridad)}</span>` : ''}
                    ${c.telefono ? telHref ? `<a href="${escapeHtml(telHref)}" class="badge badge-blue">📞 ${escapeHtml(c.telefono)}</a>` : `<span class="badge badge-blue">📞 ${escapeHtml(c.telefono)}</span>` : ''}
                    ${c.email ? emailHref ? `<a href="${escapeHtml(emailHref)}" class="badge badge-gray">✉️ ${escapeHtml(c.email)}</a>` : `<span class="badge badge-gray">✉️ ${escapeHtml(c.email)}</span>` : ''}
                </div>
                ${c.observaciones ? `<div class="item-subtitle mt-8">${escapeHtml(c.observaciones)}</div>` : ''}
                ${c.alcance_autorizacion ? `<div class="contact-scope"><strong>Alcance operativo:</strong> ${escapeHtml(c.alcance_autorizacion)}</div>` : ''}
            </div>
            ${!_isReadOnly ? `<div class="item-actions">
                <button class="btn btn-sm btn-secondary btn-icon" onclick="openModalContacto(${safeRecordId(c.id)})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteContacto(${safeRecordId(c.id)})">🗑</button>
            </div>` : ''}
        </div>`;
    }).join('')}</div>`;
}

let _editingContactoId = null;
function openModalContacto(id) {
    _editingContactoId = id || null;
    document.getElementById('modalContactoTitle').textContent = id ? 'Editar Contacto' : 'Nuevo Contacto';
    const f = document.getElementById('formContacto');
    f.reset();
    if (id) {
        const c = _contactos.find(x => x.id === id);
        if (c) { f.cNombre.value = c.nombre || ''; f.cRelacion.value = c.relacion || ''; f.cTel.value = c.telefono || ''; f.cEmail.value = c.email || ''; f.cPrioridad.value = c.prioridad || ''; f.cObservaciones.value = c.observaciones || ''; f.cAlcance.value = c.alcance_autorizacion || ''; f.cPrincipal.checked = !!c.es_principal; }
    }
    openModal('modalContacto');
}

async function handleSaveContacto(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const data = { paciente_id: _pacienteId, nombre: f.cNombre.value.trim(), relacion: f.cRelacion.value.trim(), telefono: f.cTel.value.trim(), email: f.cEmail.value.trim(), prioridad: f.cPrioridad.value ? Number(f.cPrioridad.value) : null, observaciones: f.cObservaciones.value.trim(), alcance_autorizacion: f.cAlcance.value.trim(), es_principal: f.cPrincipal.checked };
    try {
        if (_editingContactoId) { await API_B2B.updateContacto(_editingContactoId, data); showToast('Contacto actualizado', 'success'); }
        else { await API_B2B.createContacto(data); showToast('Contacto agregado', 'success'); }
        closeModal('modalContacto'); await loadContactos();
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalContacto', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteContacto(id) {
    confirmDialog('¿Eliminar este contacto?', async () => { try { await API_B2B.deleteContacto(id); showToast('Eliminado', 'success'); await loadContactos(); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// NOTAS INTERNAS
// ============================================
let _notas = [];
async function loadNotas() {
    try { _notas = await API_B2B.getNotas(_pacienteId); renderNotas(_notas); } catch (err) {
        console.error(err);
        const el = document.getElementById('notasContent');
        if (el) el.innerHTML = `<div class="empty-state"><h3>Error al cargar notas</h3><p class="text-muted">Verificá tu conexión e intentá nuevamente.</p></div>`;
    }
}

function renderNotas(lista) {
    const el = document.getElementById('notasContent');
    if (!el) return;
    const toolbar = (_isReadOnly || _isEgresado) ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} nota${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModalNota()">+ Agregar nota</button></div>`;
    if (lista.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">${uiIcon('note')}</div><h3>Sin notas internas</h3></div>`; return; }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(n => `
        <div class="item-row" ${n.urgente ? 'style="border-left:3px solid var(--pro-danger)"' : ''}>
            <div class="item-icon ${n.urgente ? 'badge-red' : 'badge-gray'}">${uiIcon(n.urgente ? 'alert' : 'note')}</div>
            <div class="item-body">
                <div class="item-title">${n.urgente ? '<span class="urgente-flag">URGENTE</span> ' : ''}${escapeHtml(n.titulo || 'Sin título')}</div>
                ${n.contenido ? `<div class="item-subtitle mt-8">${escapeHtml(n.contenido)}</div>` : ''}
                <div class="item-meta">
                    <span class="badge badge-gray">Registrado por: ${escapeHtml(n.autor_nombre || 'No disponible')}</span>
                    <span class="badge badge-gray">${formatInstitutionDateTime(n.created_at)}</span>
                </div>
            </div>
            ${!_isReadOnly ? `<div class="item-actions">
                <button class="btn btn-sm btn-secondary btn-icon" onclick="openModalNota(${safeRecordId(n.id)})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteNota(${safeRecordId(n.id)})">🗑</button>
            </div>` : ''}
        </div>`).join('')}</div>`;
}

let _editingNotaId = null;
function openModalNota(id) {
    _editingNotaId = id || null;
    document.getElementById('modalNotaTitle').textContent = id ? 'Editar Nota' : 'Nueva Nota';
    const f = document.getElementById('formNota');
    f.reset();
    if (id) {
        const n = _notas.find(x => x.id === id);
        if (n) { f.nTitulo.value = n.titulo || ''; f.nContenido.value = n.contenido || ''; f.nUrgente.checked = !!n.urgente; }
    }
    openModal('modalNota');
}

async function handleSaveNota(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const data = { paciente_id: _pacienteId, titulo: f.nTitulo.value.trim(), contenido: f.nContenido.value.trim(), urgente: f.nUrgente.checked };
    try {
        if (_editingNotaId) { await API_B2B.updateNota(_editingNotaId, data); showToast('Nota actualizada', 'success'); }
        else { await API_B2B.createNota(data); showToast('Nota guardada', 'success'); }
        closeModal('modalNota'); await Promise.all([loadNotas(), invalidateTimelineAfterMutation()]);
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalNota', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteNota(id) {
    confirmDialog('¿Eliminar esta nota?', async () => { try { await API_B2B.deleteNota(id); showToast('Eliminada', 'success'); await Promise.all([loadNotas(), invalidateTimelineAfterMutation()]); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// EDIT PACIENTE
// ============================================
function openEditPaciente() {
    const p = _paciente;
    const f = document.getElementById('formEditPaciente');
    if (!f || !p) return;
    f.pNombre.value = p.nombre || '';
    f.pApellido.value = p.apellido || '';
    f.pFechaNac.value = p.fecha_nacimiento ? p.fecha_nacimiento.slice(0,10) : '';
    f.pDni.value = p.dni || '';
    f.pHabitacion.value = p.habitacion || '';
    f.pDiagnostico.value = p.diagnostico || '';
    f.pObraSocial.value = p.obra_social || '';
    f.pNumAfiliado.value = p.num_afiliado || '';
    f.pContactoFamiliarNombre.value = p.contacto_familiar_nombre || '';
    f.pContactoFamiliarTel.value = p.contacto_familiar_tel || '';
    f.pFechaIngreso.value = p.fecha_ingreso ? p.fecha_ingreso.slice(0,10) : '';
    f.pFechaEgreso.value = p.fecha_egreso ? p.fecha_egreso.slice(0,10) : '';
    f.pMotivoEgreso.value = p.motivo_egreso || '';
    f.pMedicoCabecera.value = p.medico_cabecera || '';
    f.pAlergias.value = p.alergias || '';
    f.pAntecedentes.value = p.antecedentes || '';
    f.pDietaRestricciones.value = p.dieta_restricciones || '';
    f.pMovilidad.value = p.movilidad || '';
    f.pNivelDependencia.value = p.nivel_dependencia || '';
    f.pRiesgoCaida.value = p.riesgo_caida || '';
    f.pContinencia.value = p.continencia || '';
    f.pAspectosCognitivos.value = p.aspectos_cognitivos || '';
    f.pNotas.value = p.notas_ingreso || '';
    const careFieldset = f.querySelector('.care-profile-fieldset');
    if (careFieldset) careFieldset.disabled = !canDo('editar_perfil_cuidado');
    openModal('modalEditPaciente');
}

async function handleEditPaciente(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const data = { nombre: f.pNombre.value.trim(), apellido: f.pApellido.value.trim(), fecha_nacimiento: f.pFechaNac.value || null, dni: f.pDni.value.trim(), habitacion: f.pHabitacion.value.trim(), diagnostico: f.pDiagnostico.value.trim(), obra_social: f.pObraSocial.value.trim(), num_afiliado: f.pNumAfiliado.value.trim(), contacto_familiar_nombre: f.pContactoFamiliarNombre.value.trim(), contacto_familiar_tel: f.pContactoFamiliarTel.value.trim(), medico_cabecera: f.pMedicoCabecera.value.trim(), fecha_ingreso: f.pFechaIngreso.value || null, fecha_egreso: f.pFechaEgreso.value || null, motivo_egreso: f.pMotivoEgreso.value.trim(), alergias: f.pAlergias.value.trim(), antecedentes: f.pAntecedentes.value.trim(), notas_ingreso: f.pNotas.value.trim() };
    if (canDo('editar_perfil_cuidado')) Object.assign(data, {
        dieta_restricciones: f.pDietaRestricciones.value.trim(), movilidad: f.pMovilidad.value || null,
        nivel_dependencia: f.pNivelDependencia.value || null, riesgo_caida: f.pRiesgoCaida.value || null,
        continencia: f.pContinencia.value || null, aspectos_cognitivos: f.pAspectosCognitivos.value.trim(),
    });
    try {
        await API_B2B.updatePaciente(_pacienteId, data);
        showToast('Paciente actualizado', 'success');
        closeModal('modalEditPaciente');
        await Promise.all([loadPaciente(), loadAlertas()]);
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalEditPaciente', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

// ============================================
// INIT FORMS (attach submit listeners)
// ============================================
function initForms() {
    const pairs = [
        ['formEvolucion', handleSaveEvolucion],
        ['formMed', handleSaveMed],
        ['formCrearInsumoRapido', handleCrearInsumoRapido],
        ['formToma', handleSaveToma],
        ['formCita', handleSaveCita],
        ['formTarea', handleSaveTarea],
        ['formCompletarTarea', handleCompletarTarea],
        ['formSintoma', handleSaveSintoma],
        ['formSigno', handleSaveSigno],
        ['formContacto', handleSaveContacto],
        ['formAlerta', handleSaveAlerta],
        ['formIncidente', handleSaveIncidente],
        ['formEstadoTemporal', handleSaveEstadoTemporal],
        ['formDocumento', handleDocumentoUpload],
        ['formNota', handleSaveNota],
        ['formEditPaciente', handleEditPaciente],
        ['formEgreso', handleSaveEgreso],
    ];
    pairs.forEach(([id, fn]) => { const f = document.getElementById(id); if (f) f.addEventListener('submit', fn); });
}
