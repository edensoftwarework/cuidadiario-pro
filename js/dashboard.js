/**
 * dashboard.js — Panel principal CuidaDiario PRO
 * by EDEN SoftWork
 */

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    // Redirigir si el onboarding no fue completado (onboarding_done puede ser false o undefined)
    const _u = API_B2B.getUser();
    if (_u?.rol === 'admin_institucion' && !_u?.onboarding_done) {
        window.location.href = 'onboarding.html';
        return;
    }
    initSidebar();
    populateSidebarUser();
    await loadDashboard();
    globalThis.B2B_CONTRACT_NOTICE_READY = Promise.resolve(globalThis.ContractNoticeB2B?.init?.());
    await globalThis.B2B_CONTRACT_NOTICE_READY;
});

async function loadDashboard() {
    const user = API_B2B.getUser();
    const titleEl = document.getElementById('topbarTitle');
    if (titleEl) {
        titleEl.textContent = user?.institucion_nombre
            ? `Resumen de ${user.institucion_nombre}`
            : 'Resumen de la residencia';
    }

    showDashboardLoading(true);
    try {
        // El backend ya filtra pacientes egresados en SQL — solo una llamada necesaria
        const data = await API_B2B.getDashboard();

        renderResumen(data.resumen, data.requiere_atencion || []);
        renderCitasProximas(data.citas_proximas);
        renderSintomasRecientes(data.sintomas_recientes);
        renderNotasUrgentes(data.notas_urgentes);
        renderCumpleanosHoy(data.cumpleanos_hoy);
        renderStockBajo(data.stock_bajo);
        renderRequiereAtencion(data.requiere_atencion || []);
        _applyNotifPrefs();
        // Topbar: show +Paciente button only if the user can create patients
        const btnTopbar = document.getElementById('btnTopbarNuevoPaciente');
        if (btnTopbar && !canDo('crear_paciente')) btnTopbar.style.display = 'none';
    } catch (err) {
        showToast('Error al cargar el dashboard: ' + err.message, 'error');
    } finally {
        showDashboardLoading(false);
    }
}

function showDashboardLoading(show) {
    const el = document.getElementById('dashboardLoader');
    if (el) el.style.display = show ? 'flex' : 'none';
    const content = document.getElementById('dashboardContent');
    if (content) content.style.display = show ? 'none' : 'block';
}

function renderResumen(resumen, requiereAtencion = []) {
    if (!resumen) return;
    setVal('statPacientes', resumen.pacientes_activos ?? 0);
    setVal('statTomasHoy', resumen.tomas_hoy ?? 0);
    setVal('statTareasHoy', resumen.tareas_completadas_hoy ?? 0);
    // Señal operativa existente y tenant-scoped: cantidad de hechos/vencimientos
    // que el mismo dashboard ya prioriza en “Requiere atención”.
    setVal('statStaff', requiereAtencion.length);
    const bdEl = document.getElementById('staffBreakdown');
    if (bdEl) bdEl.textContent = requiereAtencion.length ? 'Revisar la lista priorizada' : 'Sin pendientes detectados';
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

const DASHBOARD_PATIENT_TABS = Object.freeze({
    cita: 'citas', sintoma: 'sintomas', nota_urgente: 'notas', stock_bajo: 'medicamentos',
    incidente_abierto: 'incidentes', omision_medicacion: 'medicamentos', medicacion_vencida: 'medicamentos',
    tarea_vencida: 'tareas', estado_temporal: 'datos', cumpleanos: 'datos', ingreso: 'datos', egreso: 'datos',
});

function patientContextHref(patientId, type) {
    const id = safeRecordId(patientId);
    const tab = DASHBOARD_PATIENT_TABS[type];
    return `paciente.html?id=${id}${tab ? `&tab=${tab}` : ''}`;
}

// Helper: abre el modal genérico "Ver todos" con el HTML pasado directamente
function _openVerTodos(title, html) {
    document.getElementById('modalVerTodosTitle').textContent = title;
    document.getElementById('modalVerTodosBody').innerHTML = html;
    openModal('modalVerTodos');
}

function renderCitasProximas(citas) {
    const container = document.getElementById('citasProximas');
    if (!container) return;
    if (!citas || citas.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><p>No hay citas en los próximos 15 días</p></div>`;
        return;
    }
    const MAX = 5;
    const buildItems = (lista) => lista.map(c => `
        <div class="item-row">
            <div class="item-icon badge-blue">📅</div>
            <div class="item-body">
                <div style="font-size:.8rem;font-weight:700;color:var(--pro-primary);margin-bottom:2px">👤 ${escapeHtml(c.paciente_nombre)} ${escapeHtml(c.paciente_apellido || '')}</div>
                <div class="item-title">${escapeHtml(c.titulo)}</div>
                <div class="item-subtitle">${c.especialidad ? escapeHtml(c.especialidad) + ' · ' : ''}${formatDateTime(c.fecha)}</div>
                ${c.medico ? `<div class="item-meta"><span class="badge badge-gray">🩺 ${escapeHtml(c.medico)}</span></div>` : ''}
            </div>
            <a href="${patientContextHref(c.paciente_id, 'cita')}" class="btn btn-sm btn-secondary">Ver</a>
        </div>`).join('');
    const allHtml = buildItems(citas);
    container.innerHTML = buildItems(citas.slice(0, MAX))
        + (citas.length > MAX ? `<div style="padding:10px 0;text-align:center"><button class="btn btn-sm btn-secondary" id="btnVerTodosCitas">Ver todos (${citas.length})</button></div>` : '');
    if (citas.length > MAX) {
        container.querySelector('#btnVerTodosCitas').addEventListener('click', () => _openVerTodos('📅 Citas próximas (' + citas.length + ')', allHtml));
    }
}

function renderSintomasRecientes(sintomas) {
    const container = document.getElementById('sintomasRecientes');
    if (!container) return;
    if (!sintomas || sintomas.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">🩺</div><p>Sin síntomas registrados en las últimas 24h</p></div>`;
        return;
    }
    const MAX = 5;
    const buildItems = (lista) => lista.map(s => `
        <div class="item-row">
            <div class="item-icon badge-orange">🩺</div>
            <div class="item-body">
                <div style="font-size:.8rem;font-weight:700;color:var(--pro-primary);margin-bottom:2px">👤 ${escapeHtml(s.paciente_nombre)} ${escapeHtml(s.paciente_apellido || '')}</div>
                <div class="item-title">${escapeHtml(s.descripcion)}</div>
                <div class="item-meta">
                    ${s.intensidad ? `<span class="badge badge-orange">Intensidad: ${safeFiniteNumber(s.intensidad)}/10</span>` : ''}
                    <span class="badge badge-gray">${formatDateTime(s.fecha)}</span>
                    <span class="badge badge-gray">por ${escapeHtml(s.registrador_nombre || 'No disponible')}</span>
                </div>
            </div>
            <a href="${patientContextHref(s.paciente_id, 'sintoma')}" class="btn btn-sm btn-secondary">Ver</a>
        </div>`).join('');
    const allHtml = buildItems(sintomas);
    container.innerHTML = buildItems(sintomas.slice(0, MAX))
        + (sintomas.length > MAX ? `<div style="padding:10px 0;text-align:center"><button class="btn btn-sm btn-secondary" id="btnVerTodosSintomas">Ver todos (${sintomas.length})</button></div>` : '');
    if (sintomas.length > MAX) {
        container.querySelector('#btnVerTodosSintomas').addEventListener('click', () => _openVerTodos('🩺 Síntomas recientes (' + sintomas.length + ')', allHtml));
    }
}

function renderNotasUrgentes(notas) {
    const container = document.getElementById('notasUrgentes');
    if (!container) return;
    if (!notas || notas.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><p>Sin notas urgentes</p></div>`;
        return;
    }
    const MAX = 5;
    const buildItems = (lista) => lista.map(n => `
        <div class="item-row" style="border-left: 3px solid var(--pro-danger)">
            <div class="item-icon badge-red">🚨</div>
            <div class="item-body">
                <div style="font-size:.8rem;font-weight:700;color:var(--pro-primary);margin-bottom:2px">👤 ${escapeHtml(n.paciente_nombre)} ${escapeHtml(n.paciente_apellido || '')}</div>
                <div class="item-title urgente-flag">🚨 ${escapeHtml(n.titulo || 'Sin título')}</div>
                <div class="item-subtitle mt-8">${escapeHtml(n.contenido || '')}</div>
                <div class="item-meta">
                    <span class="badge badge-gray">por ${escapeHtml(n.autor_nombre || 'No disponible')}</span>
                    <span class="badge badge-gray">${formatDateTime(n.created_at)}</span>
                </div>
            </div>
            <a href="${patientContextHref(n.paciente_id, 'nota_urgente')}" class="btn btn-sm btn-danger">Ver</a>
        </div>`).join('');
    const allHtml = buildItems(notas);
    container.innerHTML = buildItems(notas.slice(0, MAX))
        + (notas.length > MAX ? `<div style="padding:10px 0;text-align:center"><button class="btn btn-sm btn-danger" id="btnVerTodosNotas">Ver todos (${notas.length})</button></div>` : '');
    if (notas.length > MAX) {
        container.querySelector('#btnVerTodosNotas').addEventListener('click', () => _openVerTodos('🚨 Notas urgentes (' + notas.length + ')', allHtml));
    }
}
function renderCumpleanosHoy(lista) {
    const container = document.getElementById('cumpleanosHoy');
    if (!container) return;
    if (!lista || lista.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><p>Sin cumpleaños hoy</p></div>`;
        return;
    }
    const MAX = 5;
    const buildItems = (arr) => arr.map(p => `
        <div class="item-row">
            <div class="item-icon badge-purple">🎂</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(p.nombre)} ${escapeHtml(p.apellido || '')}</div>
                <div class="item-subtitle">${p.edad ? `Cumple ${safeFiniteNumber(p.edad)} años hoy 🎉` : 'Hoy es su cumpleaños 🎉'}</div>
            </div>
            <a href="${patientContextHref(p.id, 'cumpleanos')}" class="btn btn-sm btn-secondary">Ver ficha</a>
        </div>`).join('');
    const allHtml = buildItems(lista);
    container.innerHTML = buildItems(lista.slice(0, MAX))
        + (lista.length > MAX ? `<div style="padding:10px 0;text-align:center"><button class="btn btn-sm btn-secondary" id="btnVerTodosCumple">Ver todos (${lista.length})</button></div>` : '');
    if (lista.length > MAX) {
        container.querySelector('#btnVerTodosCumple').addEventListener('click', () => _openVerTodos('🎂 Cumpleaños hoy (' + lista.length + ')', allHtml));
    }
}

function renderStockBajo(lista) {
    const container = document.getElementById('stockBajo');
    if (!container) return;
    if (!lista || lista.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>Todos los insumos tienen stock suficiente</p></div>`;
        return;
    }
    const MAX = 5;
    const buildItems = (arr) => arr.map(m => {
        const esPaciente = m.tipo === 'catalogo_paciente' || m.paciente_nombre;
        const pacienteBadge = esPaciente
            ? ` <span class="badge badge-purple" style="font-size:.65rem">👤 ${escapeHtml((m.paciente_nombre || '') + ' ' + (m.paciente_apellido || '')).trim()}</span>`
            : '';
        const catBadge = (m.tipo === 'catalogo' && !esPaciente)
            ? ' <span class="badge badge-blue" style="font-size:.65rem">🏥 Institucional</span>'
            : '';
        return `
        <div class="item-row" style="border-left:3px solid var(--pro-warning)">
            <div class="item-icon badge-orange">${esPaciente ? '👤' : '📦'}</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(m.nombre)}${catBadge}${pacienteBadge}</div>
                <div class="item-subtitle">${escapeHtml(m.dosis_horario || '')}</div>
            </div>
            <span class="badge badge-danger">Stock: ${safeFiniteNumber(m.stock)}${m.unidad ? ' ' + escapeHtml(m.unidad) : ''}</span>
            ${m.paciente_id ? `<a href="${patientContextHref(m.paciente_id, 'stock_bajo')}" class="btn btn-sm btn-secondary">Ver</a>` : ''}
        </div>`;
    }).join('');
    const allHtml = buildItems(lista);
    container.innerHTML = buildItems(lista.slice(0, MAX))
        + (lista.length > MAX ? `<div style="padding:10px 0;text-align:center"><button class="btn btn-sm btn-secondary" id="btnVerTodosStock">Ver todos (${lista.length})</button></div>` : '');
    if (lista.length > MAX) {
        container.querySelector('#btnVerTodosStock').addEventListener('click', () => _openVerTodos('⚠️ Insumos con stock bajo (' + lista.length + ')', allHtml));
    }
}

function _applyNotifPrefs() {
    try {
        // notif_prefs viene del usuario almacenado localmente (hidratado desde la DB en cada login)
        const prefs = API_B2B.getUser()?.notif_prefs || {};
        const map = {
            notifSintomas: 'cardSintomasRecientes',
            notifNotas:    'cardNotasUrgentes',
            notifCitas:    'cardCitasProximas',
            notifStock:    'cardStockBajo'
        };
        Object.entries(map).forEach(([pref, cardId]) => {
            const el = document.getElementById(cardId);
            if (el && pref in prefs) el.style.display = prefs[pref] ? '' : 'none';
        });
    } catch {}
}

function renderRequiereAtencion(items) {
    const container = document.getElementById('requiereAtencion');
    const count = document.getElementById('requiereAtencionCount');
    if (!container) return;
    if (count) count.textContent = String(items.length);
    if (!items.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">✓</div><p>No hay acciones pendientes calculables en este momento.</p></div>';
        return;
    }
    const typeLabels = Object.freeze({
        medicacion_vencida: 'Medicación vencida', stock_critico: 'Stock crítico',
        incidente_abierto: 'Incidentes abiertos', estado_temporal: 'Ausencias temporales',
        omision_medicacion: 'Omisiones de medicación', tarea_vencida: 'Tareas vencidas',
    });
    const incidentLabels = Object.freeze({
        caida:'caída', golpe_herida:'golpe / herida', error_medicacion:'error de medicación',
        omision_medicacion:'omisión de medicación', episodio_conductual:'episodio conductual',
        derivacion:'derivación', otro:'otro',
    });
    const sourceLabels = Object.freeze({ registrado:'Registrado', calculado:'Calculado', estado_actual:'Estado actual' });
    const humanize = value => String(value || '').replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
    const displayTitle = item => {
        if (item.tipo !== 'incidente_abierto') return item.titulo;
        const raw = String(item.titulo || '').replace(/^Incidente:\s*/i, '');
        return `Incidente: ${incidentLabels[raw] || humanize(raw).toLocaleLowerCase('es-AR')}`;
    };
    const renderItem = item => `<div class="attention-row priority-${escapeHtml(item.prioridad)}">
        <div class="attention-priority">${escapeHtml(item.prioridad)}</div>
        <div class="item-body"><div class="item-title">${escapeHtml(displayTitle(item))}</div>
        <div class="item-subtitle">${escapeHtml(item.detalle || '')}</div>
        <div class="item-meta">${item.paciente_nombre ? `<span class="badge badge-gray">${escapeHtml(item.paciente_nombre)}</span>` : '<span class="badge badge-blue">Institucional</span>'}<span class="badge badge-gray">${escapeHtml(sourceLabels[item.source] || humanize(item.source))}</span>${item.ocurrido_at ? `<span class="badge badge-gray">${formatDateTime(item.ocurrido_at)}</span>` : ''}</div></div>
        ${item.paciente_id ? `<a class="btn btn-sm btn-secondary" href="${patientContextHref(item.paciente_id, item.tipo)}">Ver</a>` : ''}
    </div>`;
    const grouped = new Map();
    items.forEach(item => {
        const key = String(item.tipo || 'otro');
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(item);
    });
    container.innerHTML = [...grouped.entries()].map(([type, group], index) => {
        const panelId = `attention-group-${index}`;
        const label = typeLabels[type] || humanize(type);
        return `<section class="attention-group">
            <button type="button" class="attention-group-toggle" aria-expanded="false" aria-controls="${panelId}">
                <span>${escapeHtml(label)}</span><span class="badge badge-orange">${group.length}</span><span class="attention-chevron" aria-hidden="true"></span>
            </button>
            <div class="attention-group-items" id="${panelId}" hidden>${group.map(renderItem).join('')}</div>
        </section>`;
    }).join('');
    container.querySelectorAll('.attention-group-toggle').forEach(button => {
        button.addEventListener('click', () => {
            const panel = document.getElementById(button.getAttribute('aria-controls'));
            const expanded = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', String(!expanded));
            if (panel) panel.hidden = expanded;
        });
    });
}
