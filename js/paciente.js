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

    initTabs(params.get('tab'));
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
    document.title = `${p.apellido || ''} ${p.nombre} — CuidaDiario PRO`;
    const el = document.getElementById('pacienteHeader');
    if (!el) return;
    el.innerHTML = `
        <div class="d-flex align-center gap-12 flex-wrap">
            <div class="paciente-avatar-lg">👤</div>
            <div class="paciente-info-header" style="flex:1">
                <h1>${escapeHtml(p.apellido || '')} ${escapeHtml(p.nombre)}</h1>
                <div class="paciente-meta">
                    ${edad !== null ? `<span class="paciente-meta-item">🎂 ${edad} años</span>` : ''}
                    ${p.fecha_nacimiento ? `<span class="paciente-meta-item">📅 ${formatDate(p.fecha_nacimiento)}</span>` : ''}
                    ${p.habitacion ? `<span class="paciente-meta-item">🛏️ Hab. ${escapeHtml(p.habitacion)}</span>` : ''}
                    ${p.dni ? `<span class="paciente-meta-item"><span style="font-size:.72rem;font-weight:800;opacity:.75">DNI</span> ${escapeHtml(p.dni)}</span>` : ''}
                    ${p.obra_social ? `<span class="paciente-meta-item">🏥 ${escapeHtml(p.obra_social)}</span>` : ''}
                    ${p.fecha_ingreso ? `<span class="paciente-meta-item">📋 Ingreso: ${formatDate(p.fecha_ingreso)}</span>` : ''}
                </div>
                ${p.diagnostico ? `<div class="paciente-meta"><span class="paciente-meta-item">🩺 ${escapeHtml(p.diagnostico)}</span></div>` : ''}
                ${p.alergias ? `<div class="paciente-meta"><span class="paciente-meta-item badge-danger" style="background:#fde8e8;color:#c0392b;padding:3px 8px;border-radius:4px;font-weight:600">⚠️ Alergias: ${escapeHtml(p.alergias)}</span></div>` : ''}
            </div>
            <div class="d-flex gap-8 align-center flex-wrap">
                ${p.fecha_egreso ? `<span class="badge badge-red" style="font-size:.8rem;padding:6px 12px">🚪 Alta: ${formatDate(p.fecha_egreso)} — ${escapeHtml(p.motivo_egreso || '')}</span>` : ''}
                ${canDo('dar_alta') && !p.fecha_egreso ? `<button class="btn btn-sm" style="background:#fff;color:#E65100;font-weight:700;border:none;box-shadow:0 2px 8px rgba(0,0,0,.2)" onclick="openModalEgreso()">🛎 Dar de alta</button>` : ''}
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
                    ${canDo('editar_paciente') && !_isEgresado ? `<button class="btn btn-sm btn-secondary" onclick="openEditPaciente()">✏️ Editar</button>` : ''}
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
        loadDocumentos(),
    ]);
}

// Refresh all data when offline queue syncs successfully (e.g. toma/tarea registrado sin internet)
window.addEventListener('offlinesynccomplete', () => {
    if (!_pacienteId) return;
    loadMedicamentos();
    loadTareas();
    loadSintomas();
    loadSignos();
    loadNotas();
    loadCitas();
});

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
            <label class="btn btn-primary btn-sm" style="cursor:pointer">
                📂 Subir archivo
                <input type="file" id="inputDocumento" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png" style="display:none" onchange="handleDocumentoUpload(this)">
            </label>
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
        <div class="item-row" id="doc-row-${d.id}">
            <div class="item-icon badge-blue" style="font-size:1.2rem;min-width:40px;height:40px;display:flex;align-items:center;justify-content:center">${icon}</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(d.nombre_archivo)}</div>
                <div class="item-subtitle">${size} · Subido por ${escapeHtml(d.subido_nombre || '—')} · ${formatDate(d.created_at)}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn btn-sm btn-secondary" onclick="API_B2B.downloadDocumento(${d.id}, '${escapeHtml(d.nombre_archivo).replace(/'/g, "\\'")}')">&#x2B07;&#xFE0F; Descargar</button>
                ${canDel ? `<button class="btn btn-sm btn-danger" onclick="eliminarDocumento(${d.id})">&#x1F5D1;</button>` : ''}
            </div>
        </div>`;
    }).join('');

    el.innerHTML = toolbar + `<div class="item-list">${rows}</div>`;
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

async function handleDocumentoUpload(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        showToast('El archivo supera el límite de 5 MB', 'error');
        input.value = '';
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
    if (!allowedTypes.includes(file.type)) {
        showToast('Formato no permitido. Usá PDF, Word, Excel, imagen o TXT.', 'warning');
        input.value = '';
        return;
    }
    const btn = input.closest('label');
    if (btn) btn.textContent = 'Subiendo...';
    try {
        const b64 = await _fileToBase64(file);
        await API_B2B.uploadDocumento({
            paciente_id: _pacienteId,
            nombre_archivo: file.name,
            tipo_mime: file.type,
            datos: b64,
        });
        showToast('Documento subido ✅', 'success');
        await loadDocumentos();
    } catch (err) {
        showToast(err.message || 'Error al subir el documento', 'error');
        await loadDocumentos(); // re-render toolbar
    }
    input.value = '';
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
    confirmDialog('¿Eliminar este documento? Esta acción no se puede deshacer.', async () => {
        try {
            await API_B2B.deleteDocumento(id);
            showToast('Documento eliminado', 'success');
            await loadDocumentos();
        } catch (err) {
            showToast(err.message || 'Error al eliminar', 'error');
        }
    });
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
    } catch (err) { console.error(err); }
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
        <span style="font-weight:700;font-size:.88rem;color:var(--text-primary)">🕐 Últimas tomas registradas</span>
    </div>`;
    if (!lista || lista.length === 0) {
        el.innerHTML = header + `<p style="font-size:.82rem;color:var(--text-secondary);padding:4px 0 12px">Sin tomas registradas aún para este paciente.</p>`;
        return;
    }
    const rows = lista.slice(0, 15).map(t => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--border-color)">
            <span style="flex-shrink:0;margin-top:1px;font-size:.95rem">✅</span>
            <div style="flex:1;min-width:0">
                <div style="font-size:.86rem;font-weight:600;color:var(--text-primary)">${escapeHtml(t.medicamento_nombre || '—')}${t.dosis ? `<span style="font-weight:400;color:var(--text-secondary)"> — ${escapeHtml(t.dosis)}</span>` : ''}${(t.cantidad && t.cantidad > 1) ? `<span style="font-weight:400;color:var(--text-secondary)"> × ${t.cantidad}</span>` : ''}</div>
                <div style="font-size:.78rem;color:var(--text-secondary);margin-top:2px">
                    ${formatDateTime(t.fecha)} · por <strong>${escapeHtml(t.administrador_nombre || '—')}</strong>${t.notas ? ` · <em>${escapeHtml(t.notas)}</em>` : ''}
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
    const toolbar = (_isReadOnly || _isEgresado) ? '' : `
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
                    ${ !_isReadOnly ? (
                        m.catalogo_id
                            ? `<span class="badge ${(m.catalogo_stock??0) <= 0 ? 'badge-red' : (m.catalogo_stock??0) <= (m.catalogo_stock_minimo??5) ? 'badge-orange' : 'badge-teal'}">📦 Stock: ${m.catalogo_stock??0}${m.catalogo_unidad ? ' '+_pluralUnidad(m.catalogo_unidad) : ''}${(m.catalogo_stock??0) <= (m.catalogo_stock_minimo??5) ? ' ⚠️' : ''}</span>`
                            : (m.stock !== null ? `<span class="badge badge-teal">Stock: ${m.stock}</span>` : '<span class="badge badge-gray" style="opacity:.65">Sin stock</span>')
                    ) : '' }
                </div>
            </div>
            <div class="item-actions">
                ${!_isReadOnly && !_isEgresado ? `<button class="btn btn-sm btn-success" onclick="registrarToma(${m.id},'${escapeHtml(m.nombre)}')">✅ Toma</button>` : ''}
                ${!_isReadOnly ? `<button class="btn btn-sm btn-secondary btn-icon" onclick="openModalMed(${m.id})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteMed(${m.id})">🗑</button>` : ''}
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
            f.mHorarios.value = m.horarios_custom || '';
            f.mInstrucciones.value = m.instrucciones || '';
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
    const data = { paciente_id: _pacienteId, nombre: f.mNombre.value.trim(), dosis: f.mDosis.value.trim(), frecuencia: f.mFrecuencia.value.trim(), horarios_custom: f.mHorarios.value.trim(), instrucciones: f.mInstrucciones.value.trim(), stock: f.mStock.value !== '' ? parseInt(f.mStock.value) : null, catalogo_id: catId };
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
        await loadMedicamentos();
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
                    _catalogoPaciente.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}${c.presentacion ? ' — ' + escapeHtml(c.presentacion) : ''} (${c.stock_actual ?? 0} ${escapeHtml(c.unidad || '')})</option>`).join('');
                sel.value = String(newItem.id);
                onCatalogoSelectChange('pac', sel);
            }
        } else {
            _catalogo = await API_B2B.getCatalogo();
            const sel = document.getElementById('mCatalogoInstSelect');
            if (sel) {
                sel.innerHTML = '<option value="">— Sin vincular al institucional —</option>' +
                    _catalogo.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}${c.presentacion ? ' — ' + escapeHtml(c.presentacion) : ''} (${c.stock_actual ?? 0} ${escapeHtml(c.unidad || '')})</option>`).join('');
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

function registrarToma(id, nombre) {
    // Block toma if stock is depleted
    const med = _meds.find(m => m.id === id);
    if (med) {
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
    document.getElementById('tomaInfo').textContent = `Registrar toma de: ${nombre}`;
    document.getElementById('tomaMedId').value = id;
    document.getElementById('formToma').reset();
    document.getElementById('tomaMedId').value = id;
    // Pre-set cantidad to 1 and cap max at available stock for UX
    const _cantInput = document.getElementById('tomaCantidad');
    if (_cantInput) {
        _cantInput.value = 1;
        const _stockDisp = med?.catalogo_id ? (med.catalogo_stock ?? 0) : (med?.stock ?? 0);
        _cantInput.max = _stockDisp > 0 ? _stockDisp : '';
    }
    openModal('modalToma');
}

async function handleSaveToma(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    const id = parseInt(document.getElementById('tomaMedId').value);
    const cantidad = Math.max(1, parseInt(f.tomaCantidad?.value) || 1);
    try {
        await API_B2B.registrarToma(id, f.tomaNotas.value.trim(), getRegistrador(), cantidad);
        showToast(`Toma registrada ✅${cantidad > 1 ? ` (${cantidad} unidades)` : ''}`, 'success');
        closeModal('modalToma');
        await loadMedicamentos(); // refresh stock display
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalToma', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteMed(id) {
    confirmDialog('¿Eliminar este medicamento?', async () => {
        try { await API_B2B.deleteMedicamento(id); showToast('Eliminado', 'success'); await loadMedicamentos(); }
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
    try { _citas = await API_B2B.getCitas(_pacienteId); renderCitas(_citas); } catch (err) { console.error(err); }
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
                <div class="item-subtitle">📆 ${formatDateTime(h.fecha)} ${h.especialidad ? '· ' + escapeHtml(h.especialidad) : ''}</div>
                ${h.medico ? `<div class="item-subtitle">🩺 Dr. ${escapeHtml(h.medico)}</div>` : ''}
                ${h.lugar ? `<div class="item-subtitle">📍 ${escapeHtml(h.lugar)}</div>` : ''}
                <div class="item-meta"><span class="badge badge-green">✅ Realizada</span></div>
            </div>
            ${!_isReadOnly ? `
            <div class="item-actions">
                <button class="btn btn-sm btn-secondary" onclick="openModalReutilizarCita(${h.id})" title="Reutilizar cita">🔁 Reutilizar</button>
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
                <div class="item-subtitle">📆 ${formatDateTime(c.fecha)} ${c.especialidad ? '· ' + escapeHtml(c.especialidad) : ''}</div>
                ${c.medico ? `<div class="item-subtitle">🩺 Dr. ${escapeHtml(c.medico)}</div>` : ''}
                ${c.lugar ? `<div class="item-subtitle">📍 ${escapeHtml(c.lugar)}</div>` : ''}
                <div class="item-meta"><span class="badge ${estadoColor[c.estado] || 'badge-gray'}">${c.estado || 'pendiente'}</span></div>
            </div>
            <div class="item-actions">
                ${!_isReadOnly ? `<button class="btn btn-sm btn-secondary" onclick="openModalReutilizarCita(${c.id})" title="Reutilizar">🔁</button>
                <button class="btn btn-sm btn-secondary btn-icon" onclick="openModalCita(${c.id})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteCita(${c.id})">&#x1F5D1;</button>` : ''}
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
    const data = { paciente_id: _pacienteId, titulo: f.cTitulo.value.trim(), fecha: f.cFecha.value, especialidad: f.cEspecialidad.value.trim(), medico: f.cMedico.value.trim(), lugar: f.cLugar.value.trim(), descripcion: f.cDescripcion.value.trim(), estado: f.cEstado.value };
    try {
        if (_editingCitaId) { await API_B2B.updateCita(_editingCitaId, data); showToast('Cita actualizada', 'success'); }
        else { await API_B2B.createCita(data); showToast('Cita creada', 'success'); }
        closeModal('modalCita'); await loadCitas();
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalCita', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteCita(id) {
    confirmDialog('¿Eliminar esta cita?', async () => { try { await API_B2B.deleteCita(id); showToast('Eliminada', 'success'); await loadCitas(); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// TAREAS
// ============================================
let _tareas = [];
async function loadTareas() {
    try { _tareas = await API_B2B.getTareas(_pacienteId); renderTareas(_tareas); loadHistorialTareas(); } catch (err) { console.error(err); }
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
                    ${t.hora ? `<span class="badge badge-gray">🕐 ${t.hora}</span>` : ''}
                    ${t.frecuencia ? `<span class="badge badge-gray">🔄 ${escapeHtml(t.frecuencia)}</span>` : ''}
                    ${t.categoria ? `<span class="badge ${catColors[t.categoria] || 'badge-gray'}">${t.categoria}</span>` : ''}
                </div>
            </div>
            <div class="item-actions">
                ${!_isReadOnly && !_isEgresado ? `<button class="btn btn-sm btn-success" onclick="completarTarea(${t.id},'${escapeHtml(t.titulo)}')">✅ Completar</button>` : ''}
                ${!_isReadOnly ? `<button class="btn btn-sm btn-secondary btn-icon" onclick="openModalTarea(${t.id})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteTarea(${t.id})">🗑</button>` : ''}
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
                    ${formatDateTime(t.fecha)} · por <strong>${escapeHtml(t.completador_nombre || '—')}</strong>${t.notas ? ` · <em>${escapeHtml(t.notas)}</em>` : ''}
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
        closeModal('modalTarea'); await loadTareas();
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalTarea', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
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
        await API_B2B.completarTarea(id, f.tareaNotas.value.trim(), getRegistrador());
        showToast('Tarea completada ✅', 'success');
        closeModal('modalCompletarTarea');
        loadTareas(); // refresh list + historial (non-blocking)
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalCompletarTarea', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteTarea(id) {
    confirmDialog('¿Eliminar esta tarea?', async () => { try { await API_B2B.deleteTarea(id); showToast('Eliminada', 'success'); await loadTareas(); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
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
    const toolbar = (_isReadOnly || _isEgresado) ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} síntoma${lista.length !== 1 ? 's' : ''} registrados</span><button class="btn btn-primary btn-sm" onclick="openModalSintoma()">+ Registrar</button></div>`;
    if (lista.length === 0) { el.innerHTML = toolbar + `<div class="empty-state"><div class="empty-icon">🩺</div><h3>Sin s\u00edntomas registrados</h3></div>`; return; }
    el.innerHTML = toolbar + `<div class="item-list">${lista.map(s => `
        <div class="item-row">
            <div class="item-icon badge-orange">🩺</div>
            <div class="item-body">
                <div class="item-title">${escapeHtml(s.descripcion)}</div>
                <div class="item-meta">
                    ${s.intensidad !== null ? `<span class="badge ${s.intensidad >= 7 ? 'badge-red' : s.intensidad >= 4 ? 'badge-orange' : 'badge-teal'}">Intensidad: ${s.intensidad}/10</span>` : ''}
                    <span class="badge badge-gray">${formatDateTime(s.fecha)}</span>
                    <span class="badge badge-gray">por ${escapeHtml(s.registrador_nombre || '—')}</span>
                </div>
            </div>
            ${!_isReadOnly ? `<div class="item-actions">
                <button class="btn btn-sm btn-secondary btn-icon" onclick="openModalSintoma(${s.id})">✏️</button>
                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteSintoma(${s.id})">🗑</button>
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
    const data = { paciente_id: _pacienteId, descripcion: f.sDesc.value.trim(), intensidad: f.sIntensidad.value ? parseInt(f.sIntensidad.value) : null, _quien: getRegistrador() };
    try {
        if (_editingSintomaId) { await API_B2B.updateSintoma(_editingSintomaId, data); showToast('S\u00edntoma actualizado', 'success'); }
        else { await API_B2B.createSintoma(data); showToast('S\u00edntoma registrado', 'success'); }
        closeModal('modalSintoma'); f.reset(); await loadSintomas();
    }
    catch (err) { if (!handleOfflineWrite(err, { modal: 'modalSintoma', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteSintoma(id) {
    confirmDialog('¿Eliminar este síntoma?', async () => { try { await API_B2B.deleteSintoma(id); showToast('Eliminado', 'success'); await loadSintomas(); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
}

// ============================================
// SIGNOS VITALES
// ============================================
let _signos = [];
async function loadSignos() {
    try { _signos = await API_B2B.getSignos(_pacienteId); renderSignos(_signos); } catch (err) { console.error(err); }
}

const SIGNOS_TIPOS = [
    { id: 'presion_arterial',    label: 'Presión arterial',  unidad: 'mmHg',  icon: '🩸', placeholder: 'Ej: 120/80',   referencia: 'Normal: 90/60 – 120/80 mmHg' },
    { id: 'frecuencia_cardiaca', label: 'Frec. cardíaca',    unidad: 'lpm',   icon: '❤️', placeholder: 'Ej: 75',       referencia: 'Normal: 60–100 lpm' },
    { id: 'temperatura',         label: 'Temperatura',       unidad: '°C',    icon: '🌡️', placeholder: 'Ej: 36.8',     referencia: 'Normal: 36.1–37.2 °C' },
    { id: 'saturacion_oxigeno',  label: 'Saturación O₂',     unidad: '%',     icon: '💨', placeholder: 'Ej: 98',       referencia: 'Normal: ≥95%' },
    { id: 'glucosa',             label: 'Glucosa',           unidad: 'mg/dL', icon: '🩸', placeholder: 'Ej: 95',       referencia: 'Normal (ayunas): 70–100 mg/dL' },
    { id: 'peso',                label: 'Peso',              unidad: 'kg',    icon: '⚖️', placeholder: 'Ej: 70.5',     referencia: null },
    { id: 'talla',               label: 'Talla',             unidad: 'cm',    icon: '📏', placeholder: 'Ej: 170',      referencia: null },
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
    const data = { paciente_id: _pacienteId, tipo, valor: f.gValor.value.trim(), unidad: tipoData?.unidad || f.gUnidad.value.trim(), notas: f.gNotas.value.trim(), _quien: getRegistrador() };
    try { await API_B2B.createSigno(data); showToast('Signo vital registrado', 'success'); closeModal('modalSigno'); f.reset(); await loadSignos(); }
    catch (err) { if (!handleOfflineWrite(err, { modal: 'modalSigno', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteSigno(id) {
    confirmDialog('¿Eliminar este registro?', async () => { try { await API_B2B.deleteSigno(id); showToast('Eliminado', 'success'); await loadSignos(); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
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
        refHint.textContent  = tipo.referencia ? '📊 Ref: ' + tipo.referencia : '';
        refHint.style.display = tipo.referencia ? 'block' : 'none';
    }
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
    const toolbar = (_isReadOnly || _isEgresado) ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} contacto${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModalContacto()">+ Agregar</button></div>`;
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
    try { _notas = await API_B2B.getNotas(_pacienteId); renderNotas(_notas); } catch (err) { console.error(err); }
}

function renderNotas(lista) {
    const el = document.getElementById('notasContent');
    if (!el) return;
    const toolbar = (_isReadOnly || _isEgresado) ? '' : `<div class="d-flex justify-between align-center mb-16"><span class="text-muted">${lista.length} nota${lista.length !== 1 ? 's' : ''}</span><button class="btn btn-primary btn-sm" onclick="openModalNota()">+ Agregar nota</button></div>`;
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
    const data = { paciente_id: _pacienteId, titulo: f.nTitulo.value.trim(), contenido: f.nContenido.value.trim(), urgente: f.nUrgente.checked, _quien: getRegistrador() };
    try {
        if (_editingNotaId) { await API_B2B.updateNota(_editingNotaId, data); showToast('Nota actualizada', 'success'); }
        else { await API_B2B.createNota(data); showToast('Nota guardada', 'success'); }
        closeModal('modalNota'); await loadNotas();
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalNota', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

async function deleteNota(id) {
    confirmDialog('¿Eliminar esta nota?', async () => { try { await API_B2B.deleteNota(id); showToast('Eliminada', 'success'); await loadNotas(); } catch (err) { if (!handleOfflineWrite(err)) showToast('Error: ' + err.message, 'error'); } });
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
    } catch (err) { if (!handleOfflineWrite(err, { modal: 'modalEditPaciente', form: f })) showToast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; }
}

// ============================================
// INIT FORMS (attach submit listeners)
// ============================================
function initForms() {
    const pairs = [
        ['formMed', handleSaveMed],
        ['formCrearInsumoRapido', handleCrearInsumoRapido],
        ['formToma', handleSaveToma],
        ['formCita', handleSaveCita],
        ['formTarea', handleSaveTarea],
        ['formCompletarTarea', handleCompletarTarea],
        ['formSintoma', handleSaveSintoma],
        ['formSigno', handleSaveSigno],
        ['formContacto', handleSaveContacto],
        ['formNota', handleSaveNota],
        ['formEditPaciente', handleEditPaciente],
        ['formEgreso', handleSaveEgreso],
    ];
    pairs.forEach(([id, fn]) => { const f = document.getElementById(id); if (f) f.addEventListener('submit', fn); });
}