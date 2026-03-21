/**
 * cuidador.js — Vista simplificada del personal (sus residentes/pacientes asignados)
 * by EDEN SoftWork
 */

let _misPacientes = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    initSidebar();
    populateSidebarUser();
    const user = API_B2B.getUser();

    // Role guard: admins belong in dashboard, familiares in familiar.html
    if (user?.rol === 'admin_institucion') { window.location.href = 'dashboard.html'; return; }
    if (user?.rol === 'familiar')          { window.location.href = 'familiar.html';  return; }

    // Fill cuidador card
    const avatarEl = document.getElementById('cuidadorAvatar');
    const nombreEl = document.getElementById('cuidadorNombre');
    const subtitleEl = document.getElementById('cuidadorSubtitle');
    if (avatarEl) avatarEl.textContent = (user?.nombre || 'C').charAt(0).toUpperCase();
    if (nombreEl) nombreEl.textContent = user?.nombre || user?.email || '—';
    if (subtitleEl) subtitleEl.textContent = user?.institucion_nombre
        ? `${user.institucion_nombre} · Pacientes asignados`
        : 'Pacientes asignados hoy';

    await loadMisPacientes();
});

async function loadMisPacientes() {
    showLoader(true);
    try {
        _misPacientes = await API_B2B.getPacientes();
        renderMisPacientes(_misPacientes);
    } catch (err) {
        showToast('Error al cargar tus pacientes: ' + err.message, 'error');
    } finally {
        showLoader(false);
    }
}

function showLoader(show) {
    const loader = document.getElementById('cuidadorLoader');
    const grid   = document.getElementById('cuidadorGrid');
    const count  = document.getElementById('cuidadorCount');
    if (loader) loader.style.display = show ? 'flex' : 'none';
    if (grid)   grid.style.display   = show ? 'none' : 'grid';
    if (count && !show) count.style.display = 'block';
}

function renderMisPacientes(lista) {
    const grid  = document.getElementById('cuidadorGrid');
    const count = document.getElementById('cuidadorCount');
    const empty = document.getElementById('cuidadorEmpty');
    const activos   = lista.filter(p => !p.fecha_egreso);
    const egresados = lista.filter(p =>  p.fecha_egreso);
    if (count) count.textContent = `${activos.length} paciente${activos.length !== 1 ? 's' : ''} activo${activos.length !== 1 ? 's' : ''} asignado${activos.length !== 1 ? 's' : ''}`;
    if (empty) empty.style.display = (lista.length === 0) ? 'block' : 'none';
    if (!grid) return;
    if (lista.length === 0) {
        grid.innerHTML = '';
        return;
    }

    const renderCard = (p) => {
        const edad = calcEdad(p.fecha_nacimiento);
        const isEgresado = !!p.fecha_egreso;
        const headerBg = isEgresado
            ? 'background:linear-gradient(135deg,#6b7280,#9ca3af)'
            : 'background:linear-gradient(135deg,var(--pro-primary-dark),var(--pro-primary))';
        return `
        <div class="card" style="overflow:visible${isEgresado ? ';opacity:.72' : ''}">
            <div style="${headerBg};padding:16px;display:flex;align-items:center;gap:12px;border-radius:10px 10px 0 0">
                <div style="width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;color:#fff">${isEgresado ? '🚪' : (p.nombre||'P').charAt(0).toUpperCase()}</div>
                <div style="flex:1">
                    <div style="color:#fff;font-weight:700;font-size:1rem">${escapeHtml(p.apellido || '')} ${escapeHtml(p.nombre)}</div>
                    <div style="color:rgba(255,255,255,0.75);font-size:0.78rem">
                        ${edad !== null ? edad + ' años' : ''}
                        ${isEgresado ? ` · Egresado ${formatDate(p.fecha_egreso)}` : (p.habitacion ? ' · Hab. ' + escapeHtml(p.habitacion) : '')}
                    </div>
                </div>
                ${isEgresado ? '<span style="background:rgba(255,255,255,0.18);color:#fff;font-size:.66rem;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap">Egresado</span>' : ''}
            </div>
            <div class="card-body" style="padding:14px 16px">
                ${p.diagnostico ? `<div class="mb-8"><span class="badge badge-${isEgresado ? 'gray' : 'blue'}">${escapeHtml(p.diagnostico)}</span></div>` : ''}
                ${!isEgresado ? `
                <div class="d-flex gap-8 flex-wrap mt-8">
                    <a href="paciente.html?id=${p.id}&tab=medicamentos" class="btn btn-sm btn-secondary" style="flex:1">💊 Medicamentos</a>
                    <a href="paciente.html?id=${p.id}&tab=tareas"      class="btn btn-sm btn-secondary" style="flex:1">&#x2705; Tareas</a>
                </div>
                <div class="d-flex gap-8 flex-wrap mt-8">
                    <a href="paciente.html?id=${p.id}&tab=sintomas"    class="btn btn-sm btn-secondary" style="flex:1">🩺 Síntomas</a>
                    <a href="paciente.html?id=${p.id}&tab=signos"      class="btn btn-sm btn-secondary" style="flex:1">❤️ Signos</a>
                </div>` : ''}
                <a href="paciente.html?id=${p.id}" class="btn btn-${isEgresado ? 'secondary' : 'primary'} btn-sm btn-block mt-12">${isEgresado ? '📋 Ver historial' : 'Ver ficha completa →'}</a>
            </div>
        </div>`;
    };

    let html = activos.map(renderCard).join('');

    if (egresados.length > 0) {
        html += `
        <div class="egresados-section" style="grid-column:1/-1">
            <div class="egresados-section-toggle" onclick="toggleEgresadosSection(this)">
                <span class="toggle-arrow">▶</span>
                <span>Pacientes egresados (${egresados.length})</span>
            </div>
            <div class="egresados-section-body" id="egresadosBody" style="display:none">
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-top:12px">
                    ${egresados.map(renderCard).join('')}
                </div>
            </div>
        </div>`;
    }

    if (!html.trim()) {
        html = `<div class="empty-state" style="grid-column:1/-1">
            <div class="empty-icon">👤</div>
            <h3>No tenés residentes activos asignados</h3>
            <p>Contactá al administrador para que te asigne pacientes.</p>
        </div>`;
    }

    grid.innerHTML = html;
}
