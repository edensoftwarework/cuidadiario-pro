/**
 * staff.js — Gestión del personal CuidaDiario PRO
 * by EDEN SoftWork
 */

let _staffList = [];
let _pacientesList = [];
let _asignaciones = [];
let _operators = [];
let _editingStaffId = null;
let _editingOperatorId = null;
let _operatorFromStaffId = null;
let _staffReadOnly = false;      // true para medico/cuidador_staff (no puede editar/desactivar staff existente)
let _canCrearStaff = false;      // puede crear nuevo personal
let _canAsignarPaciente = false; // puede gestionar asignaciones
let _staffMenuGlobalsReady = false;

function closeStaffActionMenus(except = null, restoreFocus = false) {
    document.querySelectorAll('.staff-actions-menu[open]').forEach(menu => {
        if (menu === except) return;
        menu.removeAttribute('open');
        const summary = menu.querySelector(':scope > summary');
        const panel = menu.querySelector(':scope > .staff-actions-panel');
        summary?.setAttribute('aria-expanded', 'false');
        panel?.removeAttribute('data-viewport-positioned');
        panel?.removeAttribute('style');
        if (restoreFocus) summary?.focus();
    });
}

function positionStaffActionMenu(menu) {
    const panel = menu.querySelector(':scope > .staff-actions-panel');
    const summary = menu.querySelector(':scope > summary');
    if (!panel || !summary || matchMedia('(max-width: 580px)').matches) return;
    panel.dataset.viewportPositioned = 'true';
    panel.style.visibility = 'hidden';
    const anchor = summary.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const gutter = 8;
    const left = Math.max(gutter, Math.min(anchor.right - box.width, innerWidth - box.width - gutter));
    const below = anchor.bottom + 5;
    const top = below + box.height <= innerHeight - gutter
        ? below
        : Math.max(gutter, anchor.top - box.height - 5);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.visibility = '';
}

function initializeStaffActionMenus(root = document) {
    root.querySelectorAll('.staff-actions-menu').forEach((menu, index) => {
        if (menu.dataset.menuReady === 'true') return;
        menu.dataset.menuReady = 'true';
        const summary = menu.querySelector(':scope > summary');
        const panel = menu.querySelector(':scope > .staff-actions-panel');
        if (!summary || !panel) return;
        if (!panel.id) panel.id = `staff-actions-panel-${Date.now()}-${index}`;
        summary.setAttribute('aria-haspopup', 'menu');
        summary.setAttribute('aria-controls', panel.id);
        summary.setAttribute('aria-expanded', 'false');
        panel.setAttribute('role', 'menu');
        panel.querySelectorAll('button').forEach(button => button.setAttribute('role', 'menuitem'));
        menu.addEventListener('toggle', () => {
            if (menu.open) {
                closeStaffActionMenus(menu);
                summary.setAttribute('aria-expanded', 'true');
                positionStaffActionMenu(menu);
            } else {
                summary.setAttribute('aria-expanded', 'false');
                panel.removeAttribute('data-viewport-positioned');
                panel.removeAttribute('style');
            }
        });
        summary.addEventListener('keydown', event => {
            if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
            event.preventDefault();
            menu.open = true;
            requestAnimationFrame(() => {
                const items = [...panel.querySelectorAll('[role="menuitem"]')];
                (event.key === 'ArrowUp' ? items.at(-1) : items[0])?.focus();
            });
        });
        panel.addEventListener('keydown', event => {
            const items = [...panel.querySelectorAll('[role="menuitem"]')];
            const current = items.indexOf(document.activeElement);
            if (event.key === 'Escape') {
                event.preventDefault();
                menu.open = false;
                summary.focus();
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                    : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next]?.focus();
            }
        });
    });
    if (_staffMenuGlobalsReady) return;
    _staffMenuGlobalsReady = true;
    document.addEventListener('pointerdown', event => {
        if (!event.target.closest('.staff-actions-menu')) closeStaffActionMenus();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeStaffActionMenus(null, true);
    });
    window.addEventListener('resize', () => closeStaffActionMenus());
    window.addEventListener('scroll', () => {
        document.querySelectorAll('.staff-actions-menu[open]').forEach(positionStaffActionMenu);
    }, true);
    window.addEventListener('pagehide', () => closeStaffActionMenus());
    document.addEventListener('visibilitychange', () => { if (document.hidden) closeStaffActionMenus(); });
}

function staffRoleLabel(role) {
    return ({ admin_institucion:'Administrador',medico:'Médico / Profesional',cuidador_staff:'Personal / Operativo',familiar:'Familiar' })[role] || role || 'Sin rol';
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    const _currentUser = API_B2B.getUser();
    if (_currentUser?.rol !== 'admin_institucion') {
        const _canVer = canDo('ver_staff');
        _canCrearStaff     = canDo('crear_staff');
        _canAsignarPaciente = canDo('asignar_paciente');
        if (!_canVer && !_canCrearStaff && !_canAsignarPaciente) {
            showToast('No tenés permisos para acceder a esta sección', 'error');
            setTimeout(() => window.location.href = 'dashboard.html', 1500);
            return;
        }
        _staffReadOnly = true;
        if (!_canCrearStaff)       document.getElementById('btnNuevoStaff')?.setAttribute('style', 'display:none');
        if (!_canAsignarPaciente)  document.getElementById('btnNuevaAsignacion')?.setAttribute('style', 'display:none');
    } else {
        _canCrearStaff = true;
        _canAsignarPaciente = true;
    }
    initSidebar();
    populateSidebarUser();
    if (!_staffReadOnly || _canCrearStaff || _canAsignarPaciente) initForms();
    if (_currentUser?.rol !== 'admin_institucion') document.getElementById('operatorsCard')?.setAttribute('style', 'display:none');
    initializeStaffActionMenus();
    await Promise.all([loadStaff(), loadPacientes(), loadAsignaciones(), _currentUser?.rol === 'admin_institucion' ? loadOperators() : Promise.resolve()]);
});

async function loadStaff() {
    try {
        _staffList = await API_B2B.getStaff();
        renderStaff(_staffList);
    } catch (err) {
        showToast('Error al cargar staff: ' + err.message, 'error');
    }
}

async function loadOperators() {
    try {
        _operators = await API_B2B.getOperators(true);
        renderOperators(_operators);
    } catch (err) {
        showToast('Error al cargar operadores: ' + err.message, 'error');
    }
}

function renderOperators(list) {
    const tbody = document.getElementById('operatorsTbody');
    const count = document.getElementById('operatorsCount');
    if (count) count.textContent = list.length;
    if (!tbody) return;
    if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:24px">Todavía no hay personas habilitadas. Usá “Habilitar para estación compartida” desde la lista de Staff.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(operator => `
        <tr>
            <td><strong>${escapeHtml(operator.nombre)}</strong></td>
            <td>${rolBadge(operator.rol)}</td>
            <td><span class="status-text ${operator.activo ? 'is-active' : 'is-inactive'}">${operator.activo ? 'Activo' : 'Inactivo'}</span>${operator.usuario_b2b_id ? '<span class="text-muted ml-4">· vinculado al personal</span>' : ''}</td>
            <td><span class="status-text ${operator.pin_configured ? 'is-active' : 'is-warning'}">${operator.pin_configured ? 'PIN configurado' : 'PIN pendiente'}</span></td>
            <td><details class="staff-actions-menu"><summary class="btn btn-sm btn-secondary" aria-label="Acciones para ${escapeHtml(operator.nombre)}">Acciones</summary><div class="staff-actions-panel">
                <button class="staff-menu-action" type="button" onclick="openEditOperator(${safeRecordId(operator.id)});this.closest('details').removeAttribute('open')">${b2bIcon('edit')} Editar o cambiar PIN</button>
                <button class="staff-menu-action ${operator.activo ? 'is-danger' : ''}" type="button" onclick="toggleOperator(${safeRecordId(operator.id)},${operator.activo ? 'false' : 'true'});this.closest('details').removeAttribute('open')">${operator.activo ? 'Desactivar acceso a estación' : 'Activar acceso a estación'}</button>
            </div></details></td>
        </tr>`).join('');
    initializeStaffActionMenus(tbody);
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
            <td data-label="Persona">
                <div class="d-flex align-center gap-8" style="min-width:0">
                    <div class="sidebar-avatar" style="width:34px;height:34px;font-size:.85rem;flex-shrink:0">${escapeHtml((s.nombre || 'U').charAt(0).toUpperCase())}</div>
                    <div style="min-width:0">
                        <div class="fw-bold" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${escapeHtml(s.nombre)}</div>
                        <div class="text-muted" style="font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${escapeHtml(s.email)}</div>
                    </div>
                </div>
            </td>
            <td data-label="Rol">${rolBadge(s.rol)}</td>
            <td data-label="Estado"><span class="status-text ${s.activo ? 'is-active' : 'is-inactive'}">${s.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td data-label="Estación">${s.operador_b2b_id
                ? `<span class="status-text ${s.operador_activo ? 'is-active' : 'is-inactive'}">${s.operador_activo ? 'Habilitada' : 'Inactiva'}</span>`
                : '<span class="text-muted">No habilitada</span>'}</td>
            <td data-label="Acciones">
                ${_staffReadOnly ? '—' : `<details class="staff-actions-menu">
                    <summary class="btn btn-sm btn-secondary" aria-label="Acciones para ${escapeHtml(s.nombre)}">Acciones</summary>
                    <div class="staff-actions-panel">
                        <button class="staff-menu-action" type="button" onclick="openEditStaff(${safeRecordId(s.id)});this.closest('details').removeAttribute('open')">${b2bIcon('edit')} Editar datos</button>
                        ${s.activo && ['admin_institucion','medico','cuidador_staff'].includes(s.rol) && !s.operador_b2b_id
                            ? `<button class="staff-menu-action" type="button" onclick="openEnableStaffOperator(${safeRecordId(s.id)});this.closest('details').removeAttribute('open')">${b2bIcon('lock')} Habilitar estación</button>` : ''}
                        <button class="staff-menu-action ${s.activo ? 'is-danger' : ''}" type="button" onclick="${s.activo ? 'desactivarStaff' : 'reactivarStaff'}(${safeRecordId(s.id)});this.closest('details').removeAttribute('open')">${s.activo ? 'Desactivar acceso' : 'Activar acceso'}</button>
                    </div>
                </details>`}
            </td>
        </tr>`).join('');
    initializeStaffActionMenus(tbody);
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
            <td>${escapeHtml(a.paciente_nombre)} ${escapeHtml(a.paciente_apellido || '')} ${a.habitacion ? `<span class="badge badge-gray">Hab. ${escapeHtml(a.habitacion)}</span>` : ''}</td>
            <td>${escapeHtml(a.cuidador_nombre)} ${rolBadge(a.cuidador_rol)}</td>
            <td class="text-muted" style="font-size:.78rem">${formatDate(a.created_at)}</td>
            <td>${(!_staffReadOnly || _canAsignarPaciente) ? `<button class="btn btn-sm btn-link-danger" onclick="removeAsignacion(${safeRecordId(a.id)})">${b2bIcon('trash')} Quitar asignación</button>` : '—'}</td>
        </tr>`).join('');
}

// ========== MODALS ==========
function initForms() {
    const formStaff = document.getElementById('formStaff');
    if (formStaff) formStaff.addEventListener('submit', handleSaveStaff);
    const formAsig = document.getElementById('formAsignacion');
    if (formAsig) formAsig.addEventListener('submit', handleSaveAsignacion);
    const formOperator = document.getElementById('formOperator');
    if (formOperator) formOperator.addEventListener('submit', handleSaveOperator);
    // Populate select in asignacion modal
    const pacSelect = document.getElementById('asigPaciente');
    const cuidSelect = document.getElementById('asigCuidador');
    if (pacSelect && cuidSelect) {
        // Populated on modal open
    }
}

function openNuevoOperator() {
    _editingOperatorId = null;
    _operatorFromStaffId = null;
    document.getElementById('modalOperatorTitle').textContent = 'Nuevo operador';
    document.getElementById('formOperator').reset();
    document.getElementById('operatorIdentityFields').style.display = '';
    document.getElementById('operatorStaffSummary').style.display = 'none';
    document.getElementById('operatorPinHint').textContent = 'El PIN es obligatorio y debe tener exactamente 6 dígitos.';
    openModal('modalOperator');
}

function openEnableStaffOperator(id) {
    const staff = _staffList.find(item => safeRecordId(item.id) === safeRecordId(id));
    if (!staff || !staff.activo || !['admin_institucion','medico','cuidador_staff'].includes(staff.rol)) {
        showToast('Este miembro del Staff no puede habilitarse para estación compartida', 'warning');
        return;
    }
    _editingOperatorId = null;
    _operatorFromStaffId = staff.id;
    const form = document.getElementById('formOperator');
    form.reset();
    document.getElementById('modalOperatorTitle').textContent = 'Habilitar para estación compartida';
    document.getElementById('operatorIdentityFields').style.display = 'none';
    const summary = document.getElementById('operatorStaffSummary');
    summary.style.display = '';
    summary.innerHTML = `<strong>${escapeHtml(staff.nombre)}</strong><span>${escapeHtml(staffRoleLabel(staff.rol))} · ${escapeHtml(staff.email)}</span>`;
    document.getElementById('operatorPinHint').textContent = 'Definí un PIN de 6 dígitos que sólo conocerá esta persona.';
    openModal('modalOperator');
}

function openEditOperator(id) {
    const operator = _operators.find(item => safeRecordId(item.id) === safeRecordId(id));
    if (!operator) return;
    _editingOperatorId = operator.id;
    _operatorFromStaffId = null;
    const form = document.getElementById('formOperator');
    document.getElementById('modalOperatorTitle').textContent = 'Editar operador';
    form.reset();
    document.getElementById('operatorIdentityFields').style.display = '';
    document.getElementById('operatorStaffSummary').style.display = 'none';
    form.oNombre.value = operator.nombre;
    form.oRol.value = operator.rol;
    document.getElementById('operatorPinHint').textContent = 'Dejá vacío para conservar el PIN. Un PIN nuevo invalida todas sus sesiones anteriores.';
    openModal('modalOperator');
}

async function handleSaveOperator(event) {
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('[type=submit]');
    const data = _operatorFromStaffId
        ? { usuario_b2b_id: safeRecordId(_operatorFromStaffId) }
        : { nombre: form.oNombre.value.trim(), rol: form.oRol.value };
    const pin = form.oPin.value.trim();
    if (!_editingOperatorId && !/^\d{6}$/.test(pin)) return showToast('Ingresá un PIN de exactamente 6 dígitos', 'warning');
    if (pin && !/^\d{6}$/.test(pin)) return showToast('El PIN debe contener exactamente 6 dígitos', 'warning');
    if (pin) data.pin = pin;
    submit.disabled = true;
    try {
        if (_editingOperatorId) await API_B2B.updateOperator(_editingOperatorId, data);
        else await API_B2B.createOperator(data);
        form.oPin.value = '';
        closeModal('modalOperator');
        showToast(_editingOperatorId ? 'Operador actualizado' : (_operatorFromStaffId ? 'Staff habilitado para estación compartida' : 'Operador creado'), 'success');
        _operatorFromStaffId = null;
        await Promise.all([loadOperators(),loadStaff()]);
    } catch (error) {
        form.oPin.value = '';
        showToast('Error: ' + error.message, 'error');
    } finally { submit.disabled = false; }
}

function toggleOperator(id, activo) {
    const operator = _operators.find(item => safeRecordId(item.id) === safeRecordId(id));
    confirmDialog(`${activo ? '¿Activar' : '¿Desactivar'} a ${operator?.nombre || 'este operador'}? El cambio invalida sus turnos abiertos.`, async () => {
        try {
            await API_B2B.updateOperator(id, { activo });
            showToast(activo ? 'Operador activado' : 'Operador desactivado', 'success');
            await loadOperators();
        } catch (error) { showToast('Error: ' + error.message, 'error'); }
    });
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

async function desactivarStaff(id) {
    const nombre = _staffList.find(s => safeRecordId(s.id) === safeRecordId(id))?.nombre || 'este miembro del staff';
    confirmDialog(`¿Desactivar el acceso de ${nombre}? No podrá iniciar sesión, pero sus registros históricos se conservarán.`, async () => {
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
    if (pacSelect) pacSelect.innerHTML = '<option value="">— Seleccionar paciente —</option>' + _pacientesList.filter(p => !p.fecha_egreso).map(p => `<option value="${safeRecordId(p.id)}">${escapeHtml(p.apellido || '')} ${escapeHtml(p.nombre)}${p.habitacion ? ' · Hab. ' + escapeHtml(p.habitacion) : ''}</option>`).join('');
    if (cuidSelect) cuidSelect.innerHTML = '<option value="">— Seleccionar cuidador —</option>' + _staffList.filter(s => s.activo).map(s => `<option value="${safeRecordId(s.id)}">${escapeHtml(s.nombre)} (${escapeHtml(s.rol)})</option>`).join('');
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
    const assignment = _asignaciones.find(item => safeRecordId(item.id) === safeRecordId(id));
    const detail = assignment ? `${assignment.cuidador_nombre} dejará de tener asignado a ${assignment.paciente_nombre} ${assignment.paciente_apellido || ''}` : 'Se quitará esta asignación';
    confirmDialog(`¿Quitar la asignación? ${detail}. No se eliminarán registros históricos.`, async () => {
        try {
            await API_B2B.deleteAsignacion(id);
            showToast('Asignación eliminada', 'success');
            await loadAsignaciones();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
}
