/**
 * staff.js — Gestión del personal CuidaDiario PRO
 * by EDEN SoftWork
 */

let _staffList = [];
let _pacientesList = [];
let _asignaciones = [];
let _editingStaffId = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    if (!requireRole('admin_institucion')) return;
    initSidebar();
    populateSidebarUser();
    initForms();
    await Promise.all([loadStaff(), loadPacientes(), loadAsignaciones()]);
});

async function loadStaff() {
    try {
        _staffList = await API_B2B.getStaff();
        renderStaff(_staffList);
    } catch (err) {
        showToast('Error al cargar staff: ' + err.message, 'error');
    }
}

async function loadPacientes() {
    try { _pacientesList = await API_B2B.getPacientes(); } catch {}
}

async function loadAsignaciones() {
    try {
        _asignaciones = await API_B2B.getAsignaciones();
        renderAsignaciones(_asignaciones);
    } catch {}
}

function renderStaff(lista) {
    const tbody = document.getElementById('staffTbody');
    const countEl = document.getElementById('staffCount');
    if (countEl) countEl.textContent = lista.length;
    if (!tbody) return;
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:30px">No hay personal cargado aún</td></tr>`;
        return;
    }
    tbody.innerHTML = lista.map(s => `
        <tr>
            <td>
                <div class="d-flex align-center gap-8" style="min-width:0">
                    <div class="sidebar-avatar" style="width:34px;height:34px;font-size:.85rem;flex-shrink:0">${(s.nombre || 'U').charAt(0).toUpperCase()}</div>
                    <div style="min-width:0">
                        <div class="fw-bold" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${escapeHtml(s.nombre)}</div>
                        <div class="text-muted" style="font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${escapeHtml(s.email)}</div>
                    </div>
                </div>
            </td>
            <td>${rolBadge(s.rol)}</td>
            <td><span class="badge ${s.activo ? 'badge-green' : 'badge-gray'}">${s.activo ? '✅ Activo' : '⛔ Inactivo'}</span></td>
            <td class="text-muted" style="font-size:.78rem">${formatDate(s.created_at)}</td>
            <td>
                <div class="td-actions">
                    <button class="btn btn-sm btn-secondary" onclick="openEditStaff(${s.id})">✏️ Editar</button>
                    ${s.activo ? `<button class="btn btn-sm btn-danger" onclick="desactivarStaff(${s.id},'${escapeHtml(s.nombre)}')">🚫 Desactivar</button>` : `<button class="btn btn-sm btn-success" onclick="reactivarStaff(${s.id})">✅ Activar</button>`}
                </div>
            </td>
        </tr>`).join('');
}

function renderAsignaciones(lista) {
    const tbody = document.getElementById('asignTbody');
    if (!tbody) return;
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted" style="padding:30px">No hay asignaciones</td></tr>`;
        return;
    }
    tbody.innerHTML = lista.map(a => `
        <tr>
            <td>${escapeHtml(a.paciente_nombre)} ${escapeHtml(a.paciente_apellido || '')} ${a.habitacion ? `<span class="badge badge-gray">Hab. ${a.habitacion}</span>` : ''}</td>
            <td>${escapeHtml(a.cuidador_nombre)} ${rolBadge(a.cuidador_rol)}</td>
            <td class="text-muted" style="font-size:.78rem">${formatDate(a.created_at)}</td>
            <td><button class="btn btn-sm btn-danger" onclick="removeAsignacion(${a.id})">🗑 Quitar</button></td>
        </tr>`).join('');
}

// ========== MODALS ==========
function initForms() {
    const formStaff = document.getElementById('formStaff');
    if (formStaff) formStaff.addEventListener('submit', handleSaveStaff);
    const formAsig = document.getElementById('formAsignacion');
    if (formAsig) formAsig.addEventListener('submit', handleSaveAsignacion);
    // Populate select in asignacion modal
    const pacSelect = document.getElementById('asigPaciente');
    const cuidSelect = document.getElementById('asigCuidador');
    if (pacSelect && cuidSelect) {
        // Populated on modal open
    }
}

function openNuevoStaff() {
    _editingStaffId = null;
    document.getElementById('modalStaffTitle').textContent = 'Nuevo Miembro del Staff';
    document.getElementById('formStaff').reset();
    document.getElementById('staffPasswordGroup').style.display = '';
    openModal('modalStaff');
}

function openEditStaff(id) {
    const s = _staffList.find(x => x.id === id);
    if (!s) return;
    _editingStaffId = id;
    document.getElementById('modalStaffTitle').textContent = 'Editar Staff';
    const f = document.getElementById('formStaff');
    f.sNombre.value = s.nombre || '';
    f.sEmail.value = s.email || '';
    f.sRol.value = s.rol || 'cuidador_staff';
    f.sPassword.value = '';
    document.getElementById('staffPasswordGroup').style.display = '';
    openModal('modalStaff');
}

async function handleSaveStaff(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    const data = { nombre: f.sNombre.value.trim(), email: f.sEmail.value.trim(), rol: f.sRol.value };
    if (f.sPassword.value) data.password = f.sPassword.value;
    try {
        if (_editingStaffId) {
            if (data.password && data.password.length < 8) { showToast('La contraseña debe tener al menos 8 caracteres', 'warning'); btn.disabled = false; return; }
            await API_B2B.updateStaff(_editingStaffId, data);
            showToast('Staff actualizado', 'success');
        } else {
            if (!data.password) { showToast('La contraseña es requerida para nuevo staff', 'error'); btn.disabled = false; return; }
            if (data.password.length < 8) { showToast('La contraseña debe tener al menos 8 caracteres', 'warning'); btn.disabled = false; return; }
            await API_B2B.createStaff(data);
            showToast('Staff creado', 'success');
        }
        closeModal('modalStaff');
        await loadStaff();
    } catch (err) {
        if (err.code === 'PLAN_LIMIT' || err.code === 'TRIAL_EXPIRED') {
            confirmDialog(
                `${err.message} ¿Querés ver los planes disponibles?`,
                () => window.location.href = 'configuracion.html',
                '📋 Ver planes'
            );
        } else {
            showToast('Error: ' + err.message, 'error');
        }
    } finally {
        btn.disabled = false;
    }
}

async function desactivarStaff(id, nombre) {
    confirmDialog(`¿Desactivar a ${nombre}? No podrá iniciar sesión.`, async () => {
        try {
            await API_B2B.deleteStaff(id);
            showToast('Staff desactivado', 'success');
            await loadStaff();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
}

async function reactivarStaff(id) {
    try {
        await API_B2B.updateStaff(id, { activo: true });
        showToast('Staff reactivado', 'success');
        await loadStaff();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// ========== ASIGNACIONES ==========
function openNuevaAsignacion() {
    const pacSelect = document.getElementById('asigPaciente');
    const cuidSelect = document.getElementById('asigCuidador');
    if (pacSelect) pacSelect.innerHTML = '<option value="">— Seleccionar paciente —</option>' + _pacientesList.filter(p => !p.fecha_egreso).map(p => `<option value="${p.id}">${escapeHtml(p.apellido || '')} ${escapeHtml(p.nombre)}${p.habitacion ? ' · Hab. ' + p.habitacion : ''}</option>`).join('');
    if (cuidSelect) cuidSelect.innerHTML = '<option value="">— Seleccionar cuidador —</option>' + _staffList.filter(s => s.activo).map(s => `<option value="${s.id}">${escapeHtml(s.nombre)} (${s.rol})</option>`).join('');
    document.getElementById('formAsignacion').reset();
    openModal('modalAsignacion');
}

async function handleSaveAsignacion(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
        await API_B2B.createAsignacion({ cuidador_id: parseInt(f.asigCuidador.value), paciente_id: parseInt(f.asigPaciente.value) });
        showToast('Asignación creada', 'success');
        closeModal('modalAsignacion');
        await loadAsignaciones();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

async function removeAsignacion(id) {
    confirmDialog('¿Quitar esta asignación?', async () => {
        try {
            await API_B2B.deleteAsignacion(id);
            showToast('Asignación eliminada', 'success');
            await loadAsignaciones();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
}
