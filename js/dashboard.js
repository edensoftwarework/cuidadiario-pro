/**
 * dashboard.js — Panel principal CuidaDiario PRO
 * by EDEN SoftWork
 */

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
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
        const data = await API_B2B.getDashboard();
        renderResumen(data.resumen);
        renderCitasProximas(data.citas_proximas);
        renderSintomasRecientes(data.sintomas_recientes);
        renderNotasUrgentes(data.notas_urgentes);
        renderCumpleanosHoy(data.cumpleanos_hoy);
        renderStockBajo(data.stock_bajo);
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

function renderCitasProximas(citas) {
    const container = document.getElementById('citasProximas');
    if (!container) return;
    if (!citas || citas.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><p>No hay citas en los próximos 7 días</p></div>`;
        return;
    }
    container.innerHTML = citas.map(c => `
        <div class="item-row">
            <div class="item-icon badge-blue">📅</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(c.titulo)}</div>
                <div class="item-subtitle">${escapeHtml(c.paciente_nombre)} ${escapeHtml(c.paciente_apellido || '')} · ${c.especialidad ? escapeHtml(c.especialidad) + ' · ' : ''}${formatDateTime(c.fecha)}</div>
                ${c.medico ? `<div class="item-meta"><span class="badge badge-gray">🩺 ${escapeHtml(c.medico)}</span></div>` : ''}
            </div>
            <a href="paciente.html?id=${c.paciente_id}" class="btn btn-sm btn-secondary">Ver</a>
        </div>`).join('');
}

function renderSintomasRecientes(sintomas) {
    const container = document.getElementById('sintomasRecientes');
    if (!container) return;
    if (!sintomas || sintomas.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">🩺</div><p>Sin s\u00edntomas registrados en las \u00faltimas 24h</p></div>`;
        return;
    }
    container.innerHTML = sintomas.map(s => `
        <div class="item-row">
            <div class="item-icon badge-orange">🩺</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(s.paciente_nombre)} ${escapeHtml(s.paciente_apellido || '')}</div>
                <div class="item-subtitle">${escapeHtml(s.descripcion)}</div>
                <div class="item-meta">
                    ${s.intensidad ? `<span class="badge badge-orange">Intensidad: ${s.intensidad}/10</span>` : ''}
                    <span class="badge badge-gray">${formatDateTime(s.fecha)}</span>
                    <span class="badge badge-gray">por ${escapeHtml(s.registrador_nombre || '—')}</span>
                </div>
            </div>
            <a href="paciente.html?id=${s.paciente_id}&tab=sintomas" class="btn btn-sm btn-secondary">Ver</a>
        </div>`).join('');
}

function renderNotasUrgentes(notas) {
    const container = document.getElementById('notasUrgentes');
    if (!container) return;
    if (!notas || notas.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><p>Sin notas urgentes</p></div>`;
        return;
    }
    container.innerHTML = notas.map(n => `
        <div class="item-row" style="border-left: 3px solid var(--pro-danger)">
            <div class="item-icon badge-red">🚨</div>
            <div class="item-body">
                <div class="item-title urgente-flag">🚨 ${escapeHtml(n.titulo || 'Sin título')}</div>
                <div class="item-subtitle">${escapeHtml(n.paciente_nombre)} ${escapeHtml(n.paciente_apellido || '')}</div>
                <div class="item-subtitle mt-8">${escapeHtml(n.contenido || '')}</div>
                <div class="item-meta">
                    <span class="badge badge-gray">por ${escapeHtml(n.autor_nombre || '—')}</span>
                    <span class="badge badge-gray">${formatDateTime(n.created_at)}</span>
                </div>
            </div>
            <a href="paciente.html?id=${n.paciente_id}&tab=notas" class="btn btn-sm btn-danger">Ver</a>
        </div>`).join('');
}
function renderCumpleanosHoy(lista) {
    const container = document.getElementById('cumpleanosHoy');
    if (!container) return;
    if (!lista || lista.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎂</div><p>Sin cumpleaños hoy</p></div>`;
        return;
    }
    container.innerHTML = lista.map(p => `
        <div class="item-row">
            <div class="item-icon badge-purple">🎂</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(p.nombre)} ${escapeHtml(p.apellido || '')}</div>
                <div class="item-subtitle">${p.edad ? `Cumple ${p.edad} años hoy 🎉` : 'Hoy es su cumpleaños 🎉'}</div>
            </div>
            <a href="paciente.html?id=${p.id}" class="btn btn-sm btn-secondary">Ver ficha</a>
        </div>`).join('');
}

function renderStockBajo(lista) {
    const container = document.getElementById('stockBajo');
    if (!container) return;
    if (!lista || lista.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">💊</div><p>Todos los medicamentos tienen stock suficiente</p></div>`;
        return;
    }
    container.innerHTML = lista.map(m => `
        <div class="item-row" style="border-left:3px solid var(--pro-warning)">
            <div class="item-icon badge-orange">💊</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(m.nombre)}</div>
                <div class="item-subtitle">${escapeHtml(m.dosis_horario || '')}</div>
            </div>
            <span class="badge badge-danger">Stock: ${m.stock}</span>
        </div>`).join('');
}