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
});

async function loadDashboard() {
    const user = API_B2B.getUser();
    const titleEl = document.getElementById('topbarTitle');
    if (titleEl) {
        const h = new Date().getHours();
        const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
        titleEl.textContent = `${saludo}, ${(user?.nombre || '').split(' ')[0]} 👋`;
    }

    showDashboardLoading(true);
    try {
        // El backend ya filtra pacientes egresados en SQL — solo una llamada necesaria
        const data = await API_B2B.getDashboard();

        renderResumen(data.resumen);
        renderCitasProximas(data.citas_proximas);
        renderSintomasRecientes(data.sintomas_recientes);
        renderNotasUrgentes(data.notas_urgentes);
        renderCumpleanosHoy(data.cumpleanos_hoy);
        renderStockBajo(data.stock_bajo);
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

function renderResumen(resumen) {
    if (!resumen) return;
    setVal('statPacientes', resumen.pacientes_activos ?? 0);
    setVal('statTomasHoy', resumen.tomas_hoy ?? 0);
    setVal('statTareasHoy', resumen.tareas_completadas_hoy ?? 0);
    // Staff breakdown by role
    let totalStaff = 0;
    const roleLabels = {
        admin_institucion: ['Admin', 'Admins'],
        cuidador_staff:    ['Personal', 'Personal'],
        familiar:          ['Familiar', 'Familiares'],
        medico:            ['M\u00e9dico', 'M\u00e9dicos']
    };
    const breakdown = [];
    if (Array.isArray(resumen.staff)) {
        resumen.staff.forEach(s => {
            const n = parseInt(s.total);
            totalStaff += n;
            const labels = roleLabels[s.rol];
            if (labels && n > 0) breakdown.push(`${n}\u00a0${n === 1 ? labels[0] : labels[1]}`);
        });
    }
    setVal('statStaff', totalStaff);
    const bdEl = document.getElementById('staffBreakdown');
    if (bdEl) bdEl.textContent = breakdown.join(' \u00b7 ') || '\u2014';
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
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
            <a href="paciente.html?id=${c.paciente_id}" class="btn btn-sm btn-secondary">Ver</a>
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
                    ${s.intensidad ? `<span class="badge badge-orange">Intensidad: ${s.intensidad}/10</span>` : ''}
                    <span class="badge badge-gray">${formatDateTime(s.fecha)}</span>
                    <span class="badge badge-gray">por ${escapeHtml(s.registrador_nombre || '—')}</span>
                </div>
            </div>
            <a href="paciente.html?id=${s.paciente_id}&tab=sintomas" class="btn btn-sm btn-secondary">Ver</a>
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
                    <span class="badge badge-gray">por ${escapeHtml(n.autor_nombre || '—')}</span>
                    <span class="badge badge-gray">${formatDateTime(n.created_at)}</span>
                </div>
            </div>
            <a href="paciente.html?id=${n.paciente_id}&tab=notas" class="btn btn-sm btn-danger">Ver</a>
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
                <div class="item-subtitle">${p.edad ? `Cumple ${p.edad} años hoy 🎉` : 'Hoy es su cumpleaños 🎉'}</div>
            </div>
            <a href="paciente.html?id=${p.id}" class="btn btn-sm btn-secondary">Ver ficha</a>
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
            <span class="badge badge-danger">Stock: ${m.stock}${m.unidad ? ' ' + escapeHtml(m.unidad) : ''}</span>
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