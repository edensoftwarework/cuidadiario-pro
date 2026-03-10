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
    if (count) count.textContent = `${lista.length} paciente${lista.length !== 1 ? 's' : ''} asignado${lista.length !== 1 ? 's' : ''}`;
    if (empty) empty.style.display = lista.length === 0 ? 'block' : 'none';
    if (!grid) return;
    if (lista.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <div class="empty-icon">👤</div>
            <h3>No tenés residentes / pacientes asignados</h3>
            <p>Contactá al administrador para que te asigne pacientes.</p>
        </div>`;
        return;
    }
    grid.innerHTML = lista.map(p => {
        const edad = calcEdad(p.fecha_nacimiento);
        return `
        <div class="card" style="overflow:visible">
            <div style="background:linear-gradient(135deg,var(--pro-primary-dark),var(--pro-primary));padding:16px;display:flex;align-items:center;gap:12px;border-radius:10px 10px 0 0">
                <div style="width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:1.3rem">🧓</div>
                <div>
                    <div style="color:#fff;font-weight:700;font-size:1rem">${escapeHtml(p.apellido || '')} ${escapeHtml(p.nombre)}</div>
                    <div style="color:rgba(255,255,255,0.75);font-size:0.78rem">
                        ${edad !== null ? edad + ' años' : ''}
                        ${p.habitacion ? ' · Hab. ' + escapeHtml(p.habitacion) : ''}
                    </div>
                </div>
            </div>
            <div class="card-body" style="padding:14px 16px">
                ${p.diagnostico ? `<div class="mb-8"><span class="badge badge-blue">${escapeHtml(p.diagnostico)}</span></div>` : ''}
                <div class="d-flex gap-8 flex-wrap mt-8">
                    <a href="paciente.html?id=${p.id}&tab=medicamentos" class="btn btn-sm btn-secondary" style="flex:1">💊 Medicamentos</a>
                    <a href="paciente.html?id=${p.id}&tab=tareas"      class="btn btn-sm btn-secondary" style="flex:1">✅ Tareas</a>
                </div>
                <div class="d-flex gap-8 flex-wrap mt-8">
                    <a href="paciente.html?id=${p.id}&tab=sintomas"    class="btn btn-sm btn-secondary" style="flex:1">🤒 Síntomas</a>
                    <a href="paciente.html?id=${p.id}&tab=signos"      class="btn btn-sm btn-secondary" style="flex:1">❤️ Signos</a>
                </div>
                <a href="paciente.html?id=${p.id}" class="btn btn-primary btn-sm btn-block mt-12">Ver ficha completa →</a>
            </div>
        </div>`;
    }).join('');
}
