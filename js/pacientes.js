/**
 * pacientes.js — Lista de pacientes CuidaDiario PRO
 * by EDEN SoftWork
 */

let _allPacientes = [];
let _staffList = [];
let _currentTab  = 'activos'; // 'activos' | 'egresados' | 'todos'

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    initSidebar();
    populateSidebarUser();
    initSearch();
    await loadPacientes();
    const user = API_B2B.getUser();
    if (user?.rol === 'admin_institucion') {
        await loadStaff();
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
    }
    // Mostrar botón Nuevo Paciente según permisos
    const btnNuevo = document.getElementById('btnNuevoPaciente');
    if (btnNuevo) btnNuevo.style.display = canDo('crear_paciente') ? '' : 'none';
    // Staff y médicos: agregar enlace "Mis residentes" (cuidador.html) antes del enlace Pacientes
    if (user?.rol === 'cuidador_staff' || user?.rol === 'medico') {
        const nav = document.querySelector('.sidebar-nav');
        const pacientesLink = nav?.querySelector('a[href="pacientes.html"]');
        if (pacientesLink && nav) {
            const li = document.createElement('a');
            li.href = 'cuidador.html';
            li.className = 'nav-item';
            li.innerHTML = '<span class="nav-icon">🗂️</span><span class="nav-label">Mis residentes</span>';
            pacientesLink.insertAdjacentElement('beforebegin', li);
        }
    }
    initModalForm();
});

async function loadPacientes() {
    showLoader(true);
    try {
        _allPacientes = await API_B2B.getPacientes();
        populateHabitacionFilter();
        applyFilters();
    } catch (err) {
        showToast('Error al cargar pacientes: ' + err.message, 'error');
    } finally {
        showLoader(false);
    }
}

async function loadStaff() {
    try { _staffList = await API_B2B.getStaff(); } catch {}
}

function showLoader(show) {
    const loader = document.getElementById('pacientesLoader');
    const grid = document.getElementById('pacientesGrid');
    if (loader) loader.style.display = show ? 'flex' : 'none';
    if (grid) grid.style.display = show ? 'none' : 'grid';
}

function renderPacientes(lista) {
    const grid = document.getElementById('pacientesGrid');
    const countEl = document.getElementById('pacientesCount');
    if (countEl) countEl.textContent = lista.length;
    if (!grid) return;
    if (lista.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <div class="empty-icon">👤</div>
            <h3>No hay pacientes</h3>
            <p>Agregá el primer paciente haciendo clic en "Nuevo Paciente"</p>
        </div>`;
        return;
    }
    grid.innerHTML = lista.map(p => {
        const edad = calcEdad(p.fecha_nacimiento);
        return `
        <div class="paciente-card" onclick="window.location.href='paciente.html?id=${p.id}'">
            <div class="paciente-card-avatar">👤</div>
            <div class="paciente-card-body">
                <div class="paciente-card-name">${escapeHtml(p.apellido || '')} ${escapeHtml(p.nombre)}</div>
                <div class="paciente-card-meta">
                    ${edad !== null ? edad + ' años' : ''}
                    ${p.habitacion ? ' · Hab. ' + escapeHtml(p.habitacion) : ''}
                </div>
                <div class="paciente-card-tags">
                    ${p.diagnostico ? `<span class="badge badge-blue">${escapeHtml(p.diagnostico)}</span>` : ''}
                    ${p.obra_social ? `<span class="badge badge-teal">${escapeHtml(p.obra_social)}</span>` : ''}
                </div>
            </div>
            <span class="paciente-card-action">›</span>
        </div>`;
    }).join('');
}

function initSearch() {
    const input = document.getElementById('searchPacientes');
    const filterHab = document.getElementById('filterHabitacion');
    if (input) input.addEventListener('input', applyFilters);
    if (filterHab) filterHab.addEventListener('change', applyFilters);
}

function applyFilters() {
    const q   = (document.getElementById('searchPacientes')?.value || '').toLowerCase();
    const hab = document.getElementById('filterHabitacion')?.value || '';
    let result = _allPacientes;
    if (_currentTab === 'activos')   result = result.filter(p => !p.fecha_egreso);
    if (_currentTab === 'egresados') result = result.filter(p =>  p.fecha_egreso);
    if (q)   result = result.filter(p => `${p.nombre} ${p.apellido || ''} ${p.diagnostico || ''}`.toLowerCase().includes(q));
    if (hab) result = result.filter(p => p.habitacion === hab);
    renderPacientes(result);
}

function setTab(tab) {
    _currentTab = tab;
    document.querySelectorAll('.filter-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    // Filtro habitación no aplica en vista de egresados (ya no tienen habitación)
    const habFilter = document.getElementById('filterHabitacion');
    if (habFilter) habFilter.style.display = (tab === 'egresados') ? 'none' : '';
    applyFilters();
}

function populateHabitacionFilter() {
    const sel = document.getElementById('filterHabitacion');
    if (!sel) return;
    const current = sel.value;
    const habs = [...new Set(_allPacientes.filter(p => p.habitacion && !p.fecha_egreso).map(p => p.habitacion))].sort();
    sel.innerHTML = '<option value="">Todas las habitaciones</option>';
    habs.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = 'Hab. ' + h;
        if (h === current) opt.selected = true;
        sel.appendChild(opt);
    });
}

// ========== MODAL NUEVO PACIENTE ==========
let _editingPacienteId = null;

function initModalForm() {
    const form = document.getElementById('formPaciente');
    if (form) form.addEventListener('submit', handleSavePaciente);
}

function openNuevoPaciente() {
    _editingPacienteId = null;
    document.getElementById('modalPacienteTitle').textContent = 'Nuevo Paciente';
    document.getElementById('formPaciente').reset();
    openModal('modalPaciente');
}

function openEditPaciente(id, event) {
    if (event) event.stopPropagation();
    const p = _allPacientes.find(x => x.id === id);
    if (!p) return;
    _editingPacienteId = id;
    document.getElementById('modalPacienteTitle').textContent = 'Editar Paciente';
    const f = document.getElementById('formPaciente');
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
    f.pNotas.value = p.notas_ingreso || '';
    if (f.pMedicoCabecera) f.pMedicoCabecera.value = p.medico_cabecera || '';
    if (f.pAlergias) f.pAlergias.value = p.alergias || '';
    if (f.pAntecedentes) f.pAntecedentes.value = p.antecedentes || '';
    openModal('modalPaciente');
}

async function handleSavePaciente(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    const data = {
        nombre: f.pNombre.value.trim(),
        apellido: f.pApellido.value.trim(),
        fecha_nacimiento: f.pFechaNac.value || null,
        dni: f.pDni.value.trim(),
        habitacion: f.pHabitacion.value.trim(),
        diagnostico: f.pDiagnostico.value.trim(),
        obra_social: f.pObraSocial.value.trim(),
        num_afiliado: f.pNumAfiliado.value.trim(),
        contacto_familiar_nombre: f.pContactoFamiliarNombre.value.trim(),
        contacto_familiar_tel: f.pContactoFamiliarTel.value.trim(),
        fecha_ingreso: f.pFechaIngreso.value || null,
        notas_ingreso: f.pNotas.value.trim(),
        medico_cabecera: f.pMedicoCabecera ? f.pMedicoCabecera.value.trim() || null : undefined,
        alergias: f.pAlergias ? f.pAlergias.value.trim() || null : undefined,
        antecedentes: f.pAntecedentes ? f.pAntecedentes.value.trim() || null : undefined,
    };
    try {
        if (_editingPacienteId) {
            await API_B2B.updatePaciente(_editingPacienteId, data);
            showToast('Paciente actualizado', 'success');
        } else {
            await API_B2B.createPaciente(data);
            showToast('Paciente creado', 'success');
        }
        closeModal('modalPaciente');
        await loadPacientes();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

async function deletePaciente(id, event) {
    if (event) event.stopPropagation();
    confirmDialog('¿Dar de baja a este paciente? Se desactivará del sistema.', async () => {
        try {
            await API_B2B.deletePaciente(id);
            showToast('Paciente dado de baja', 'success');
            await loadPacientes();
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}
