/**
 * paciente.js — Ficha completa del paciente con todas las secciones
 * by EDEN SoftWork
 */

let _pacienteId = null;
let _paciente = null;
let _isAdmin = false;
let _isReadOnly = false;

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    const params = new URLSearchParams(window.location.search);
    _pacienteId = parseInt(params.get('id'));
    if (!_pacienteId) { showToast('Paciente no encontrado', 'error'); return; }

    const user = API_B2B.getUser();
    _isAdmin = user?.rol === 'admin_institucion';
    _isReadOnly = user?.rol === 'familiar';

    initSidebar();
    populateSidebarUser();
    initTabs(params.get('tab'));
    initForms();
    await loadPaciente();
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
        });
    });
    const tab = defaultTab || 'datos';
    document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
}

// ============================================
// PACIENTE
// ============================================
async function loadPaciente() {
    try {
        const lista = await API_B2B.getPacientes();
        _paciente = lista.find(p => p.id === _pacienteId);
        if (!_paciente) { showToast('Paciente no encontrado', 'error'); return; }
        renderPacienteHeader(_paciente);
        renderDatosTab(_paciente);
    } catch (err) {
        showToast('Error al cargar paciente: ' + err.message, 'error');
    }
}

function renderPacienteHeader(p) {
    const edad = calcEdad(p.fecha_nacimiento);
    document.title = `${p.apellido || ''} ${p.nombre} — CuidaDiario PRO`;
    const el = document.getElementById('pacienteHeader');
    if (!el) return;
    el.innerHTML = `
        <div class="d-flex align-center gap-12 flex-wrap">
            <div class="paciente-avatar-lg">👤</div>
            <div class="paciente-info-header">
                <h1>${escapeHtml(p.apellido || '')} ${escapeHtml(p.nombre)}</h1>
                <div class="paciente-meta">
                    ${edad !== null ? `<span class="paciente-meta-item">🎂 ${edad} años</span>` : ''}
                    ${p.fecha_nacimiento ? `<span class="paciente-meta-item">📅 ${formatDate(p.fecha_nacimiento)}</span>` : ''}
                    ${p.habitacion ? `<span class="paciente-meta-item">🛏️ Hab. ${escapeHtml(p.habitacion)}</span>` : ''}
                    ${p.dni ? `<span class="paciente-meta-item">🪪 DNI ${escapeHtml(p.dni)}</span>` : ''}
                    ${p.obra_social ? `<span class="paciente-meta-item">🏥 ${escapeHtml(p.obra_social)}</span>` : ''}
                    ${p.fecha_ingreso ? `<span class="paciente-meta-item">📋 Ingreso: ${formatDate(p.fecha_ingreso)}</span>` : ''}
                </div>
                ${p.diagnostico ? `<div class="paciente-meta"><span class="paciente-meta-item">🩺 ${escapeHtml(p.diagnostico)}</span></div>` : ''}
                ${p.alergias ? `<div class="paciente-meta"><span class="paciente-meta-item badge-danger" style="background:#fde8e8;color:#c0392b;padding:3px 8px;border-radius:4px;font-weight:600">⚠️ Alergias: ${escapeHtml(p.alergias)}</span></div>` : ''}
            </div>
        </div>`;
}

function renderDatosTab(p) {
    const el = document.getElementById('datosContent');
    if (!el) return;
    el.innerHTML = `
        <div class="grid-2">
            <div class="card">
                <div class="card-header"><span class="card-title">👤 Datos Personales</span>
                    ${_isAdmin ? `<button class="btn btn-sm btn-secondary" onclick="openEditPaciente()">✏️ Editar</button>` : ''}
                </div>
                <div class="card-body">
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
            </div>
            <div class="card">
                <div class="card-header"><span class="card-title">👨‍👩‍👧 Contacto Familiar</span></div>
                <div class="card-body">
                    ${row('Nombre', p.contacto_familiar_nombre)}
                    ${row('Teléfono', p.contacto_familiar_tel ? `<a href="tel:${p.contacto_familiar_tel}" style="color:var(--pro-primary)">${p.contacto_familiar_tel}</a>` : '—')}
                </div>
            </div>
        </div>
        ${p.notas_ingreso ? `<div class="card mt-16"><div class="card-header"><span class="card-title">📋 Notas de ingreso</span></div><div class="card-body">${escapeHtml(p.notas_ingreso)}</div></div>` : ''}
        ${p.alergias ? `<div class="card mt-16" style="border-left:4px solid var(--pro-danger)"><div class="card-header"><span class="card-title" style="color:var(--pro-danger)">⚠️ Alergias y contraindicaciones</span></div><div class="card-body fw-bold text-danger">${escapeHtml(p.alergias)}</div></div>` : ''}
        ${p.antecedentes ? `<div class="card mt-16"><div class="card-header"><span class="card-title">🏥 Antecedentes clínicos</span></div><div class="card-body">${escapeHtml(p.antecedentes)}</div></div>` : ''}
    `;
}

function row(label, val) {
    return `<div class="d-flex justify-between" style="padding:8px 0;border-bottom:1px solid var(--border-color)">
        <span class="text-muted" style="font-size:.82rem">${label}</span>
        <span class="fw-bold" style="font-size:.88rem;text-align:right">${val || '—'}</span>
    </div>`;
}

// ============================================
// LOAD ALL DATA
// ============================================
async function loadAllData() {
    await Promise.all([
        loadMedicamentos(),
        loadCitas(),
        loadTareas(),
        loadSintomas(),
        loadSignos(),
        loadContactos(),
        loadNotas(),
    ]);
}

// ============================================
// MEDICAMENTOS
// ============================================
let _meds = [];
async function loadMedicamentos() {
    try {
        _meds = await API_B2B.getMedicamentos(_pacienteId);
        renderMedicamentos(_meds);
    } catch (err) { console.error(err); }
}

function renderMedicamentos(lista) {
    const el = document.getElementById('medsContent');
    if (!el) return;
    const toolbar = _isReadOnly ? '' : `
        <div class="d-flex justify-between align-center mb-16">
            <span class="text-muted">${lista.length} medicamento${lista.length !== 1 ? 's' : ''}</span>
            <button class="btn btn-primary btn-sm" onclick="openModalMed()">+ Agregar</button>
        </div>`;
    if (lista.length === 0) {
        el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">💊</div><h3>Sin medicamentos</h3></div>`;
        return;
    }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(m => `
        <div class="item-row">
            <div class="item-icon badge-purple">💊</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(m.nombre)} ${m.dosis ? `— ${escapeHtml(m.dosis)}` : ''}</div>
                <div class="item-subtitle">${m.frecuencia ? escapeHtml(m.frecuencia) : ''} ${m.horarios_custom ? '· ' + escapeHtml(m.horarios_custom) : ''}</div>
                ${m.instrucciones ? `<div class="item-subtitle mt-8">${escapeHtml(m.instrucciones)}</div>` : ''}
                <div class="item-meta">
                    ${m.stock !== null ? `<span class="badge badge-teal">Stock: ${m.stock}</span>` : ''}
                </div>
            </div>
            <div class="item-actions">
                ${!_isReadOnly ? `<button class="btn btn-sm btn-success" onclick="registrarToma(${m.id},'${escapeHtml(m.nombre)}')">✅ Toma</button>` : ''}
                ${_isAdmin ? `<button class="btn btn-sm btn-secondary btn-icon" onclick="openModalMed(${m.id})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteMed(${m.id})">🗑</button>` : ''}
            </div>
        </div>`).join('')}</div>`;
}

let _editingMedId = null;
function openModalMed(id) {
    _editingMedId = id || null;
    const title = _editingMedId ? 'Editar Medicamento' : 'Nuevo Medicamento';
    document.getElementById('modalMedTitle').textContent = title;
    const f = document.getElementById('formMed');
    f.reset();
    if (_editingMedId) {
        const m = _meds.find(x => x.id === id);
        if (m) { f.mNombre.value = m.nombre || ''; f.mDosis.value = m.dosis || ''; f.mFrecuencia.value = m.frecuencia || ''; f.mHorarios.value = m.horarios_custom || ''; f.mInstrucciones.value = m.instrucciones || ''; f.mStock.value = m.stock ?? ''; }
    }
    openModal('modalMed');
}

async function handleSaveMed(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    const data = { paciente_id: _pacienteId, nombre: f.mNombre.value.trim(), dosis: f.mDosis.value.trim(), frecuencia: f.mFrecuencia.value.trim(), horarios_custom: f.mHorarios.value.trim(), instrucciones: f.mInstrucciones.value.trim(), stock: f.mStock.value !== '' ? parseInt(f.mStock.value) : null };
    try {
        if (_editingMedId) { await API_B2B.updateMedicamento(_editingMedId, data); showToast('Medicamento actualizado', 'success'); }
        else { await API_B2B.createMedicamento(data); showToast('Medicamento agregado', 'success'); }
        closeModal('modalMed');
        await loadMedicamentos();
    } catch (err) { showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

function registrarToma(id, nombre) {
    document.getElementById('tomaInfo').textContent = `Registrar toma de: ${nombre}`;
    document.getElementById('tomaMedId').value = id;
    document.getElementById('formToma').reset();
    document.getElementById('tomaMedId').value = id;
    openModal('modalToma');
}

async function handleSaveToma(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    const id = parseInt(document.getElementById('tomaMedId').value);
    try {
        await API_B2B.registrarToma(id, f.tomaNotas.value.trim());
        showToast('Toma registrada ✅', 'success');
        closeModal('modalToma');
    } catch (err) { showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteMed(id) {
    confirmDialog('¿Eliminar este medicamento?', async () => {
        try { await API_B2B.deleteMedicamento(id); showToast('Eliminado', 'success'); await loadMedicamentos(); }
        catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
}

// ============================================
// CITAS
// ============================================
let _citas = [];
async function loadCitas() {
    try { _citas = await API_B2B.getCitas(_pacienteId); renderCitas(_citas); } catch (err) { console.error(err); }
}

function renderCitas(lista) {
    const el = document.getElementById('citasContent');
    if (!el) return;
    const toolbar = _isReadOnly ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} cita${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModalCita()">+ Agregar</button></div>`;
    if (lista.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">📅</div><h3>Sin citas registradas</h3></div>`; return; }
    const estadoColor = { pendiente: 'badge-orange', realizada: 'badge-green', cancelada: 'badge-red' };
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(c => `
        <div class="item-row">
            <div class="item-icon badge-blue">📅</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(c.titulo)}</div>
                <div class="item-subtitle">📆 ${formatDateTime(c.fecha)} ${c.especialidad ? '· ' + escapeHtml(c.especialidad) : ''}</div>
                ${c.medico ? `<div class="item-subtitle">🩺 Dr. ${escapeHtml(c.medico)}</div>` : ''}
                ${c.lugar ? `<div class="item-subtitle">📍 ${escapeHtml(c.lugar)}</div>` : ''}
                <div class="item-meta"><span class="badge ${estadoColor[c.estado] || 'badge-gray'}">${c.estado || 'pendiente'}</span></div>
            </div>
            <div class="item-actions">
                ${!_isReadOnly ? `<button class="btn btn-sm btn-secondary btn-icon" onclick="openModalCita(${c.id})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteCita(${c.id})">🗑</button>` : ''}
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
        if (c) { f.cTitulo.value = c.titulo || ''; f.cFecha.value = c.fecha ? c.fecha.slice(0,16) : ''; f.cEspecialidad.value = c.especialidad || ''; f.cMedico.value = c.medico || ''; f.cLugar.value = c.lugar || ''; f.cDescripcion.value = c.descripcion || ''; f.cEstado.value = c.estado || 'pendiente'; }
    }
    openModal('modalCita');
}

async function handleSaveCita(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const data = { paciente_id: _pacienteId, titulo: f.cTitulo.value.trim(), fecha: f.cFecha.value, especialidad: f.cEspecialidad.value.trim(), medico: f.cMedico.value.trim(), lugar: f.cLugar.value.trim(), descripcion: f.cDescripcion.value.trim(), estado: f.cEstado.value };
    try {
        if (_editingCitaId) { await API_B2B.updateCita(_editingCitaId, data); showToast('Cita actualizada', 'success'); }
        else { await API_B2B.createCita(data); showToast('Cita creada', 'success'); }
        closeModal('modalCita'); await loadCitas();
    } catch (err) { showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteCita(id) {
    confirmDialog('¿Eliminar esta cita?', async () => { try { await API_B2B.deleteCita(id); showToast('Eliminada', 'success'); await loadCitas(); } catch (err) { showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// TAREAS
// ============================================
let _tareas = [];
async function loadTareas() {
    try { _tareas = await API_B2B.getTareas(_pacienteId); renderTareas(_tareas); } catch (err) { console.error(err); }
}

function renderTareas(lista) {
    const el = document.getElementById('tareasContent');
    if (!el) return;
    const toolbar = _isReadOnly ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} tarea${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModalTarea()">+ Agregar</button></div>`;
    const catColors = { higiene: 'badge-teal', alimentacion: 'badge-orange', medicacion: 'badge-purple', movilidad: 'badge-blue', recreacion: 'badge-green', otro: 'badge-gray' };
    if (lista.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">✅</div><h3>Sin tareas de cuidado</h3></div>`; return; }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(t => `
        <div class="item-row">
            <div class="item-icon badge-teal">📋</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(t.titulo)}</div>
                ${t.descripcion ? `<div class="item-subtitle">${escapeHtml(t.descripcion)}</div>` : ''}
                <div class="item-meta">
                    ${t.hora ? `<span class="badge badge-gray">🕐 ${t.hora}</span>` : ''}
                    ${t.frecuencia ? `<span class="badge badge-gray">🔄 ${escapeHtml(t.frecuencia)}</span>` : ''}
                    ${t.categoria ? `<span class="badge ${catColors[t.categoria] || 'badge-gray'}">${t.categoria}</span>` : ''}
                </div>
            </div>
            <div class="item-actions">
                ${!_isReadOnly ? `<button class="btn btn-sm btn-success" onclick="completarTarea(${t.id},'${escapeHtml(t.titulo)}')">✅ Completar</button>
                ${_isAdmin ? `<button class="btn btn-sm btn-secondary btn-icon" onclick="openModalTarea(${t.id})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteTarea(${t.id})">🗑</button>` : ''}` : ''}
            </div>
        </div>`).join('')}</div>`;
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
        closeModal('modalTarea'); await loadTareas();
    } catch (err) { showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

function completarTarea(id, titulo) {
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
    } catch (err) { showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteTarea(id) {
    confirmDialog('¿Eliminar esta tarea?', async () => { try { await API_B2B.deleteTarea(id); showToast('Eliminada', 'success'); await loadTareas(); } catch (err) { showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// SÍNTOMAS
// ============================================
let _sintomas = [];
async function loadSintomas() {
    try { _sintomas = await API_B2B.getSintomas(_pacienteId); renderSintomas(_sintomas); } catch (err) { console.error(err); }
}

function renderSintomas(lista) {
    const el = document.getElementById('sintomasContent');
    if (!el) return;
    const toolbar = _isReadOnly ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} síntoma${lista.length !== 1 ? 's' : ''} registrados</span><button class="btn btn-primary btn-sm" onclick="openModal('modalSintoma')">+ Registrar</button></div>`;
    if (lista.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">🤒</div><h3>Sin síntomas registrados</h3></div>`; return; }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(s => `
        <div class="item-row">
            <div class="item-icon badge-orange">🤒</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(s.descripcion)}</div>
                <div class="item-meta">
                    ${s.intensidad !== null ? `<span class="badge ${s.intensidad >= 7 ? 'badge-red' : s.intensidad >= 4 ? 'badge-orange' : 'badge-teal'}">Intensidad: ${s.intensidad}/10</span>` : ''}
                    <span class="badge badge-gray">${formatDateTime(s.fecha)}</span>
                    <span class="badge badge-gray">por ${escapeHtml(s.registrador_nombre || '—')}</span>
                </div>
            </div>
            ${!_isReadOnly ? `<button class="btn btn-sm btn-danger btn-icon" onclick="deleteSintoma(${s.id})">🗑</button>` : ''}
        </div>`).join('')}</div>`;
}

async function handleSaveSintoma(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const data = { paciente_id: _pacienteId, descripcion: f.sDesc.value.trim(), intensidad: f.sIntensidad.value ? parseInt(f.sIntensidad.value) : null };
    try { await API_B2B.createSintoma(data); showToast('Síntoma registrado', 'success'); closeModal('modalSintoma'); f.reset(); await loadSintomas(); }
    catch (err) { showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteSintoma(id) {
    confirmDialog('¿Eliminar este síntoma?', async () => { try { await API_B2B.deleteSintoma(id); showToast('Eliminado', 'success'); await loadSintomas(); } catch (err) { showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// SIGNOS VITALES
// ============================================
let _signos = [];
async function loadSignos() {
    try { _signos = await API_B2B.getSignos(_pacienteId); renderSignos(_signos); } catch (err) { console.error(err); }
}

const SIGNOS_TIPOS = [ { id: 'presion_arterial', label: 'Presión arterial', unidad: 'mmHg', icon: '🩸' }, { id: 'frecuencia_cardiaca', label: 'Frec. cardíaca', unidad: 'lpm', icon: '❤️' }, { id: 'temperatura', label: 'Temperatura', unidad: '°C', icon: '🌡️' }, { id: 'saturacion_oxigeno', label: 'Saturación O₂', unidad: '%', icon: '💨' }, { id: 'glucosa', label: 'Glucosa', unidad: 'mg/dL', icon: '🩸' }, { id: 'peso', label: 'Peso', unidad: 'kg', icon: '⚖️' }, { id: 'talla', label: 'Talla', unidad: 'cm', icon: '📏' } ];

function renderSignos(lista) {
    const el = document.getElementById('signosContent');
    if (!el) return;
    const toolbar = _isReadOnly ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} registro${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModal('modalSigno')">+ Registrar</button></div>`;

    // Latest per type
    const ultimoPorTipo = {};
    lista.forEach(s => { if (!ultimoPorTipo[s.tipo]) ultimoPorTipo[s.tipo] = s; });

    const signosCards = SIGNOS_TIPOS.filter(t => ultimoPorTipo[t.id]).map(t => {
        const s = ultimoPorTipo[t.id];
        return `<div class="vital-card">
            <div class="vital-type">${t.icon} ${t.label}</div>
            <div class="vital-value">${escapeHtml(s.valor)}</div>
            <div class="vital-unit">${t.unidad}</div>
            <div class="vital-date">${formatDate(s.fecha)}</div>
            <div class="vital-who">${escapeHtml(s.registrador_nombre || '')}</div>
        </div>`;
    }).join('');

    const historial = lista.slice(0, 20).map(s => {
        const tipo = SIGNOS_TIPOS.find(t => t.id === s.tipo);
        return `<tr>
            <td>${tipo?.icon || ''} ${tipo?.label || s.tipo}</td>
            <td class="fw-bold">${escapeHtml(s.valor)} <span class="text-muted">${tipo?.unidad || ''}</span></td>
            <td class="text-muted">${formatDateTime(s.fecha)}</td>
            <td class="text-muted">${escapeHtml(s.registrador_nombre || '—')}</td>
            ${!_isReadOnly ? `<td><button class="btn btn-danger btn-icon btn-sm" onclick="deleteSigno(${s.id})">🗑</button></td>` : '<td></td>'}
        </tr>`;
    }).join('');

    el.innerHTML = toolbar + (signosCards ? `<div class="vitals-row mb-20">${signosCards}</div>` : '') +
        `<div class="card"><div class="card-header"><span class="card-title">📊 Historial de signos vitales</span></div>
        <div class="table-wrapper"><table><thead><tr><th>Tipo</th><th>Valor</th><th>Fecha</th><th>Registrado por</th><th></th></tr></thead>
        <tbody>${historial || `<tr><td colspan="5" class="text-center text-muted" style="padding:20px">Sin registros</td></tr>`}</tbody></table></div></div>`;
}

async function handleSaveSigno(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const tipo = f.gTipo.value;
    const tipoData = SIGNOS_TIPOS.find(t => t.id === tipo);
    const data = { paciente_id: _pacienteId, tipo, valor: f.gValor.value.trim(), unidad: tipoData?.unidad || f.gUnidad.value.trim(), notas: f.gNotas.value.trim() };
    try { await API_B2B.createSigno(data); showToast('Signo vital registrado', 'success'); closeModal('modalSigno'); f.reset(); await loadSignos(); }
    catch (err) { showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteSigno(id) {
    confirmDialog('¿Eliminar este registro?', async () => { try { await API_B2B.deleteSigno(id); showToast('Eliminado', 'success'); await loadSignos(); } catch (err) { showToast('Error: ' + err.message, 'error'); } });
}

// Auto-fill unidad al seleccionar tipo
function onSignoTipoChange(select) {
    const tipo = SIGNOS_TIPOS.find(t => t.id === select.value);
    const unidadInput = document.getElementById('gUnidad');
    if (unidadInput && tipo) unidadInput.value = tipo.unidad;
}

// ============================================
// CONTACTOS DE EMERGENCIA
// ============================================
let _contactos = [];
async function loadContactos() {
    try { _contactos = await API_B2B.getContactos(_pacienteId); renderContactos(_contactos); } catch (err) { console.error(err); }
}

function renderContactos(lista) {
    const el = document.getElementById('contactosContent');
    if (!el) return;
    const toolbar = _isReadOnly ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} contacto${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModalContacto()">+ Agregar</button></div>`;
    if (lista.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">📞</div><h3>Sin contactos de emergencia</h3></div>`; return; }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(c => `
        <div class="item-row" ${c.es_principal ? 'style="border-left:3px solid var(--pro-success-light)"' : ''}>
            <div class="item-icon badge-teal">👤</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(c.nombre)} ${c.es_principal ? '<span class="badge badge-green">Principal</span>' : ''}</div>
                ${c.relacion ? `<div class="item-subtitle">${escapeHtml(c.relacion)}</div>` : ''}
                <div class="item-meta">
                    ${c.telefono ? `<a href="tel:${c.telefono}" class="badge badge-blue">📞 ${escapeHtml(c.telefono)}</a>` : ''}
                    ${c.email ? `<a href="mailto:${c.email}" class="badge badge-gray">✉️ ${escapeHtml(c.email)}</a>` : ''}
                </div>
            </div>
            ${!_isReadOnly ? `<div class="item-actions">
                <button class="btn btn-sm btn-secondary btn-icon" onclick="openModalContacto(${c.id})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteContacto(${c.id})">🗑</button>
            </div>` : ''}
        </div>`).join('')}</div>`;
}

let _editingContactoId = null;
function openModalContacto(id) {
    _editingContactoId = id || null;
    document.getElementById('modalContactoTitle').textContent = id ? 'Editar Contacto' : 'Nuevo Contacto';
    const f = document.getElementById('formContacto');
    f.reset();
    if (id) {
        const c = _contactos.find(x => x.id === id);
        if (c) { f.cNombre.value = c.nombre || ''; f.cRelacion.value = c.relacion || ''; f.cTel.value = c.telefono || ''; f.cEmail.value = c.email || ''; f.cPrincipal.checked = !!c.es_principal; }
    }
    openModal('modalContacto');
}

async function handleSaveContacto(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const data = { paciente_id: _pacienteId, nombre: f.cNombre.value.trim(), relacion: f.cRelacion.value.trim(), telefono: f.cTel.value.trim(), email: f.cEmail.value.trim(), es_principal: f.cPrincipal.checked };
    try {
        if (_editingContactoId) { await API_B2B.updateContacto(_editingContactoId, data); showToast('Contacto actualizado', 'success'); }
        else { await API_B2B.createContacto(data); showToast('Contacto agregado', 'success'); }
        closeModal('modalContacto'); await loadContactos();
    } catch (err) { showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteContacto(id) {
    confirmDialog('¿Eliminar este contacto?', async () => { try { await API_B2B.deleteContacto(id); showToast('Eliminado', 'success'); await loadContactos(); } catch (err) { showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// NOTAS INTERNAS
// ============================================
let _notas = [];
async function loadNotas() {
    try { _notas = await API_B2B.getNotas(_pacienteId); renderNotas(_notas); } catch (err) { console.error(err); }
}

function renderNotas(lista) {
    const el = document.getElementById('notasContent');
    if (!el) return;
    const toolbar = _isReadOnly ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} nota${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModalNota()">+ Agregar nota</button></div>`;
    if (lista.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">📝</div><h3>Sin notas internas</h3></div>`; return; }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(n => `
        <div class="item-row" ${n.urgente ? 'style="border-left:3px solid var(--pro-danger)"' : ''}>
            <div class="item-icon ${n.urgente ? 'badge-red' : 'badge-gray'}">${n.urgente ? '🚨' : '📝'}</div>
            <div class="item-body">
                <div class="item-title">${n.urgente ? '<span class="urgente-flag">🚨 URGENTE</span> ' : ''}${escapeHtml(n.titulo || 'Sin título')}</div>
                ${n.contenido ? `<div class="item-subtitle mt-8">${escapeHtml(n.contenido)}</div>` : ''}
                <div class="item-meta">
                    <span class="badge badge-gray">por ${escapeHtml(n.autor_nombre || '—')}</span>
                    <span class="badge badge-gray">${formatDateTime(n.created_at)}</span>
                </div>
            </div>
            ${!_isReadOnly ? `<div class="item-actions">
                <button class="btn btn-sm btn-secondary btn-icon" onclick="openModalNota(${n.id})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteNota(${n.id})">🗑</button>
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
        closeModal('modalNota'); await loadNotas();
    } catch (err) { showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteNota(id) {
    confirmDialog('¿Eliminar esta nota?', async () => { try { await API_B2B.deleteNota(id); showToast('Eliminada', 'success'); await loadNotas(); } catch (err) { showToast('Error: ' + err.message, 'error'); } });
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
    f.pNotas.value = p.notas_ingreso || '';
    openModal('modalEditPaciente');
}

async function handleEditPaciente(e) {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const data = { nombre: f.pNombre.value.trim(), apellido: f.pApellido.value.trim(), fecha_nacimiento: f.pFechaNac.value || null, dni: f.pDni.value.trim(), habitacion: f.pHabitacion.value.trim(), diagnostico: f.pDiagnostico.value.trim(), obra_social: f.pObraSocial.value.trim(), num_afiliado: f.pNumAfiliado.value.trim(), contacto_familiar_nombre: f.pContactoFamiliarNombre.value.trim(), contacto_familiar_tel: f.pContactoFamiliarTel.value.trim(), medico_cabecera: f.pMedicoCabecera.value.trim(), fecha_ingreso: f.pFechaIngreso.value || null, fecha_egreso: f.pFechaEgreso.value || null, motivo_egreso: f.pMotivoEgreso.value.trim(), alergias: f.pAlergias.value.trim(), antecedentes: f.pAntecedentes.value.trim(), notas_ingreso: f.pNotas.value.trim() };
    try {
        await API_B2B.updatePaciente(_pacienteId, data);
        showToast('Paciente actualizado', 'success');
        closeModal('modalEditPaciente');
        await loadPaciente();
    } catch (err) { showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

// ============================================
// INIT FORMS (attach submit listeners)
// ============================================
function initForms() {
    const pairs = [
        ['formMed', handleSaveMed],
        ['formToma', handleSaveToma],
        ['formCita', handleSaveCita],
        ['formTarea', handleSaveTarea],
        ['formCompletarTarea', handleCompletarTarea],
        ['formSintoma', handleSaveSintoma],
        ['formSigno', handleSaveSigno],
        ['formContacto', handleSaveContacto],
        ['formNota', handleSaveNota],
        ['formEditPaciente', handleEditPaciente],
    ];
    pairs.forEach(([id, fn]) => { const f = document.getElementById(id); if (f) f.addEventListener('submit', fn); });
}
