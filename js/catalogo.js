/**
 * catalogo.js — Catálogo híbrido de insumos
 * Institucional (general) + Por residente (familia provee)
 * CuidaDiario PRO — by EDEN SoftWork
 */

'use strict';

/** Pluraliza la unidad de medida de un insumo */
function pluralUnidad(u) {
    if (!u) return '';
    const map = { 'unidad': 'unidades', 'comprimido': 'comprimidos', 'c\u00e1psula': 'c\u00e1psulas',
        'ampolla': 'ampollas', 'frasco': 'frascos', 'sobre': 'sobres', 'parche': 'parches' };
    return map[u] || (u + 's');
}

let _catalogoItems = [];
let _catalogoView = 'institucional'; // 'institucional' | 'paciente'
let _selectedPacienteId = null;
let _editingCatalogoId = null;
let _pacientesList = [];             // lista de pacientes para el selector

async function initCatalogo() {
    if (!requireAuth()) return;

    const user = API_B2B.getUser();
    if (user?.rol !== 'admin_institucion') {
        window.location.href = 'dashboard.html';
        return;
    }

    initSidebar();
    populateSidebarUser();

    // Topbar: nombre institución
    try {
        const inst = await API_B2B.getInstitucion();
        const data = inst.institucion || inst;
        if (data.nombre) {
            const tb = document.getElementById('topbarInstitucion');
            if (tb) tb.textContent = data.nombre;
        }
    } catch (e) { /* continuar */ }

    // Cargar lista de pacientes para los selectores
    try {
        const pacs = await API_B2B.getPacientes();
        _pacientesList = (pacs || []).filter(p => !p.fecha_egreso);
        _populatePacienteSelectors();
    } catch (e) { /* continuar */ }

    // Búsqueda en tiempo real
    const searchInput = document.getElementById('catalogoSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.toLowerCase().trim();
            const filtered = q ? _catalogoItems.filter(c =>
                c.nombre.toLowerCase().includes(q) ||
                (c.principio_activo || '').toLowerCase().includes(q) ||
                (c.presentacion || '').toLowerCase().includes(q)
            ) : _catalogoItems;
            renderCatalogo(filtered);
        });
    }

    // Attach form handler
    const form = document.getElementById('formCatalogoItem');
    if (form) form.addEventListener('submit', handleSaveCatalogoItem);

    // Iniciar con vista institucional
    await switchView('institucional');
}

function _populatePacienteSelectors() {
    // Selector en la barra de vista
    const viewSel = document.getElementById('pacienteSelector');
    if (viewSel) {
        viewSel.innerHTML = '<option value="">— Seleccioná un residente —</option>';
        _pacientesList.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.apellido || ''} ${p.nombre}`.trim();
            viewSel.appendChild(opt);
        });
    }
    // Selector en el modal de agregar ítem
    const modalSel = document.getElementById('cPacienteId');
    if (modalSel) {
        modalSel.innerHTML = '<option value="">— Seleccioná un residente —</option>';
        _pacientesList.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.apellido || ''} ${p.nombre}`.trim();
            modalSel.appendChild(opt);
        });
    }
}

async function switchView(view) {
    _catalogoView = view;

    const btnInst   = document.getElementById('btnViewInstitucional');
    const btnPac    = document.getElementById('btnViewPaciente');
    const pacWrap   = document.getElementById('pacienteSelectWrap');
    const cardTitle = document.getElementById('catalogoCardTitle');

    if (view === 'institucional') {
        if (btnInst) { btnInst.className = 'btn btn-primary btn-sm'; }
        if (btnPac)  { btnPac.className  = 'btn btn-secondary btn-sm'; }
        if (pacWrap) pacWrap.style.display = 'none';
        if (cardTitle) cardTitle.textContent = '📦 Inventario institucional';
        _selectedPacienteId = null;
        await loadCatalogo();
    } else {
        if (btnInst) { btnInst.className = 'btn btn-secondary btn-sm'; }
        if (btnPac)  { btnPac.className  = 'btn btn-primary btn-sm'; }
        if (pacWrap) pacWrap.style.display = '';
        if (cardTitle) cardTitle.textContent = '👤 Insumos del residente';
        // Restore patient selection from DOM selector (may have been cleared when switching to institucional)
        const domSel = document.getElementById('pacienteSelector');
        if (!_selectedPacienteId && domSel?.value) {
            _selectedPacienteId = parseInt(domSel.value);
        }
        if (_selectedPacienteId) {
            const pac = _pacientesList.find(p => p.id === _selectedPacienteId);
            if (cardTitle) cardTitle.textContent = `👤 Insumos de ${pac ? escapeHtml((pac.apellido + ' ' + pac.nombre).trim()) : 'residente'}`;
            await loadCatalogo();
        } else {
            document.getElementById('catalogoList').innerHTML =
                `<div class="empty-state"><div class="empty-icon">👤</div><h3>Seleccioná un residente</h3><p>Elegí un residente del selector de arriba para ver o agregar sus insumos específicos.</p></div>`;
            document.getElementById('stockBajoCard').style.display = 'none';
        }
    }
}

async function onPacienteSelectorChange() {
    const sel = document.getElementById('pacienteSelector');
    _selectedPacienteId = sel?.value ? parseInt(sel.value) : null;

    const cardTitle = document.getElementById('catalogoCardTitle');
    if (_selectedPacienteId) {
        const pac = _pacientesList.find(p => p.id === _selectedPacienteId);
        if (cardTitle) cardTitle.textContent = `👤 Insumos de ${pac ? escapeHtml((pac.apellido + ' ' + pac.nombre).trim()) : 'residente'}`;
        await loadCatalogo();
    } else {
        if (cardTitle) cardTitle.textContent = '👤 Insumos del residente';
        document.getElementById('catalogoList').innerHTML =
            `<div class="empty-state"><div class="empty-icon">👤</div><h3>Seleccioná un residente</h3><p>Elegí un residente del selector de arriba para ver o agregar sus insumos específicos.</p></div>`;
        document.getElementById('stockBajoCard').style.display = 'none';
    }
}

async function loadCatalogo() {
    try {
        const params = _selectedPacienteId ? { paciente_id: _selectedPacienteId } : {};
        _catalogoItems = await API_B2B.getCatalogo(params);
        renderCatalogo(_catalogoItems);
        renderStockBajoAlert();
    } catch (e) {
        showToast('Error al cargar catálogo', 'error');
    }
}

function renderStockBajoAlert() {
    const bajo = _catalogoItems.filter(c => c.stock_actual <= (c.stock_minimo ?? 5));
    const card = document.getElementById('stockBajoCard');
    const list = document.getElementById('stockBajoList');
    if (!card || !list) return;
    if (bajo.length > 0) {
        card.style.display = '';
        list.innerHTML = bajo.map(c => `
            <div class="d-flex align-center gap-12" style="padding:8px 0;border-bottom:1px solid var(--border-color)">
                <span class="badge ${c.stock_actual <= 0 ? 'badge-red' : 'badge-orange'}">
                    ${c.stock_actual <= 0 ? '❌ Sin stock' : '⚠️ Bajo'}
                </span>
                <span style="font-weight:600">${escapeHtml(c.nombre)}</span>
                ${c.paciente_nombre ? `<span class="badge badge-purple" style="font-size:.7rem">👤 ${escapeHtml(c.paciente_nombre)} ${escapeHtml(c.paciente_apellido || '')}</span>` : ''}
                <span class="text-muted">${c.stock_actual} / ${c.stock_minimo ?? 5} ${pluralUnidad(c.unidad)}</span>
                <button class="btn btn-sm btn-secondary" onclick="openModalCatalogoItem(${c.id})" style="margin-left:auto">
                    + Reponer stock
                </button>
            </div>`).join('');
    } else {
        card.style.display = 'none';
    }
}

function renderCatalogo(lista) {
    const el = document.getElementById('catalogoList');
    if (!el) return;

    const isPatientView = _catalogoView === 'paciente' && _selectedPacienteId;
    const emptyMsg = isPatientView
        ? 'No hay insumos específicos registrados para este residente. Podés agregar los que provee la familia.'
        : 'Agregá los insumos que maneja la institución (medicamentos, materiales, elementos de stock) para llevar un inventario centralizado.';

    if (lista.length === 0) {
        el.innerHTML = `<div class="empty-state">
            <div class="empty-icon">📦</div>
            <h3>${isPatientView ? 'Sin insumos del residente' : 'Catálogo vacío'}</h3>
            <p>${emptyMsg}</p>
            <button class="btn btn-primary" onclick="openModalCatalogoItem()">+ Agregar primer ítem</button>
        </div>`;
        return;
    }

    el.innerHTML = `
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.9rem">
            <thead>
                <tr style="border-bottom:2px solid var(--border-color);text-align:left">
                    <th style="padding:10px 8px;color:var(--text-secondary);font-weight:600">Ítem</th>
                    <th style="padding:10px 8px;color:var(--text-secondary);font-weight:600">Presentación</th>
                    ${!isPatientView ? `<th style="padding:10px 8px;color:var(--text-secondary);font-weight:600">Residente</th>` : ''}
                    <th style="padding:10px 8px;color:var(--text-secondary);font-weight:600;text-align:center">Stock actual</th>
                    <th style="padding:10px 8px;color:var(--text-secondary);font-weight:600;text-align:center">Mínimo</th>
                    <th style="padding:10px 8px;color:var(--text-secondary);font-weight:600;text-align:center">Estado</th>
                    <th style="padding:10px 8px"></th>
                </tr>
            </thead>
            <tbody>
                ${lista.map(c => {
                    const low = c.stock_actual <= (c.stock_minimo ?? 5);
                    const empty = c.stock_actual <= 0;
                    return `<tr style="border-bottom:1px solid var(--border-color)">
                        <td style="padding:10px 8px">
                            <div style="font-weight:600">${escapeHtml(c.nombre)}</div>
                            ${c.principio_activo ? `<div class="text-muted" style="font-size:.82rem">${escapeHtml(c.principio_activo)}</div>` : ''}
                        </td>
                        <td style="padding:10px 8px;color:var(--text-secondary)">${escapeHtml(c.presentacion || '—')}</td>
                        ${!isPatientView ? `<td style="padding:10px 8px">
                            ${c.paciente_nombre ? `<span class="badge badge-purple" style="font-size:.75rem">👤 ${escapeHtml(c.paciente_nombre)} ${escapeHtml(c.paciente_apellido || '')}</span>` : '<span class="text-muted" style="font-size:.8rem">General</span>'}
                        </td>` : ''}
                        <td style="padding:10px 8px;text-align:center;font-weight:700;font-size:1.1rem;color:${empty ? 'var(--pro-danger)' : low ? '#E65100' : 'var(--pro-success)'}">${c.stock_actual}</td>
                        <td style="padding:10px 8px;text-align:center;color:var(--text-secondary)">${c.stock_minimo ?? 5}</td>
                        <td style="padding:10px 8px;text-align:center">
                            <span class="badge ${empty ? 'badge-red' : low ? 'badge-orange' : 'badge-green'}">
                                ${empty ? '❌ Sin stock' : low ? '⚠️ Bajo' : '✅ OK'}
                            </span>
                        </td>
                        <td style="padding:10px 8px;text-align:right">
                            <div class="d-flex gap-8 justify-end">
                                <button class="btn btn-sm btn-secondary btn-icon" onclick="openModalCatalogoItem(${c.id})" title="Editar">✏️</button>
                                <button class="btn btn-sm btn-danger btn-icon" onclick="deleteCatalogoItem(${c.id})" title="Eliminar">🗑</button>
                            </div>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
        <div style="padding:12px 8px;font-size:.82rem;color:var(--text-secondary)">
            ${lista.length} ítem${lista.length !== 1 ? 's' : ''}
        </div>
        </div>`;
}

function onCatTipoChange(val) {
    const pacGroup = document.getElementById('catPacienteGroup');
    const lblInst  = document.getElementById('catTipoInst');
    const lblPac   = document.getElementById('catTipoPaciente');
    if (pacGroup) pacGroup.style.display = val === 'paciente' ? '' : 'none';
    if (lblInst)  lblInst.style.borderColor  = val === 'institucional' ? 'var(--pro-primary)' : 'var(--border-color)';
    if (lblPac)   lblPac.style.borderColor   = val === 'paciente'      ? 'var(--pro-primary)' : 'var(--border-color)';
}

function openModalCatalogoItem(id) {
    _editingCatalogoId = id || null;
    document.getElementById('modalCatalogoTitle').textContent = id ? 'Editar ítem del catálogo' : 'Agregar ítem al catálogo';
    const f = document.getElementById('formCatalogoItem');
    if (!f) return;
    f.reset();

    const defaultTipo = (_catalogoView === 'paciente' && _selectedPacienteId) ? 'paciente' : 'institucional';
    const radioInst = f.querySelector('input[name="catTipo"][value="institucional"]');
    const radioPac  = f.querySelector('input[name="catTipo"][value="paciente"]');

    if (id) {
        const item = _catalogoItems.find(c => c.id === id);
        if (item) {
            f.querySelector('[name="cNombre"]').value          = item.nombre || '';
            f.querySelector('[name="cPrincipioActivo"]').value = item.principio_activo || '';
            f.querySelector('[name="cPresentacion"]').value    = item.presentacion || '';
            f.querySelector('[name="cStockActual"]').value     = item.stock_actual ?? 0;
            f.querySelector('[name="cStockMinimo"]').value     = item.stock_minimo ?? 5;
            f.querySelector('[name="cUnidad"]').value          = item.unidad || 'comprimido';
            if (item.paciente_id) {
                if (radioPac)  { radioPac.checked = true; }
                onCatTipoChange('paciente');
                const pacSel = f.querySelector('[name="cPacienteId"]');
                if (pacSel) pacSel.value = item.paciente_id;
            } else {
                if (radioInst) { radioInst.checked = true; }
                onCatTipoChange('institucional');
            }
        } else {
            // Item not found in current list — safe fallback
            if (radioInst) radioInst.checked = true;
            onCatTipoChange('institucional');
        }
    } else {
        if (defaultTipo === 'paciente') {
            if (radioPac) radioPac.checked = true;
            onCatTipoChange('paciente');
            const pacSel = f.querySelector('[name="cPacienteId"]');
            if (pacSel && _selectedPacienteId) pacSel.value = _selectedPacienteId;
        } else {
            if (radioInst) radioInst.checked = true;
            onCatTipoChange('institucional');
        }
    }

    openModal('modalCatalogoItem');

    // Restock fields: only relevant when editing an existing item
    const notasRestockGroup = document.getElementById('catNotasRestockGroup');
    const historialBox      = document.getElementById('catRestockHistorialBox');
    const historialList     = document.getElementById('catRestockHistorialList');
    if (notasRestockGroup) notasRestockGroup.style.display = id ? '' : 'none';
    if (historialBox)      historialBox.style.display      = id ? '' : 'none';
    if (historialList)   { historialList.style.display = 'none'; historialList.innerHTML = ''; }
}

async function handleSaveCatalogoItem(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    const tipoVal    = f.querySelector('input[name="catTipo"]:checked')?.value || 'institucional';
    const pacienteId = tipoVal === 'paciente' ? (parseInt(f.querySelector('[name="cPacienteId"]')?.value) || null) : null;

    if (tipoVal === 'paciente' && !pacienteId) {
        showToast('Seleccioná un residente para este insumo', 'warning');
        btn.disabled = false; btn.textContent = 'Guardar';
        return;
    }

    const data = {
        nombre:           f.querySelector('[name="cNombre"]').value.trim(),
        principio_activo: f.querySelector('[name="cPrincipioActivo"]').value.trim() || null,
        presentacion:     f.querySelector('[name="cPresentacion"]').value.trim() || null,
        stock_actual:     parseInt(f.querySelector('[name="cStockActual"]').value) || 0,
        stock_minimo:     parseInt(f.querySelector('[name="cStockMinimo"]').value) || 5,
        unidad:           f.querySelector('[name="cUnidad"]').value,
        paciente_id:      pacienteId,
        // notas_restock se envía solo al editar (el backend lo usa si stock aumentó)
        notas_restock:    _editingCatalogoId ? (f.querySelector('[name="cNotasRestock"]')?.value?.trim() || null) : undefined,
    };
    if (!data.nombre) { showToast('El nombre es obligatorio', 'warning'); btn.disabled = false; btn.textContent = 'Guardar'; return; }

    try {
        if (_editingCatalogoId) {
            await API_B2B.updateCatalogoItem(_editingCatalogoId, data);
            showToast('Ítem actualizado ✅', 'success');
        } else {
            await API_B2B.createCatalogoItem(data);
            showToast('Ítem agregado ✅', 'success');
        }
        closeModal('modalCatalogoItem');
        // Si se agregó un ítem de paciente y no estamos en esa vista, cambiar
        if (pacienteId && _catalogoView !== 'paciente') {
            const sel = document.getElementById('pacienteSelector');
            if (sel) sel.value = pacienteId;
            _selectedPacienteId = pacienteId;
            await switchView('paciente');
        } else {
            await loadCatalogo();
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar';
    }
}

async function deleteCatalogoItem(id) {
    const item = _catalogoItems.find(c => c.id === id);
    const nombre = item ? item.nombre : 'este ítem';
    confirmDialog(`¿Eliminar "${nombre}" del catálogo?`, async () => {
        try {
            await API_B2B.deleteCatalogoItem(id);
            showToast('Ítem eliminado', 'success');
            await loadCatalogo();
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

document.addEventListener('DOMContentLoaded', initCatalogo);

// ============================================
// HISTORIAL DE RESTOCK (por ítem del catálogo)
// ============================================
function toggleRestockHistorial() {
    const list = document.getElementById('catRestockHistorialList');
    if (!list) return;
    if (list.style.display === 'none') {
        list.style.display = 'block';
        if (!list.innerHTML.trim()) loadRestockHistorial(_editingCatalogoId);
    } else {
        list.style.display = 'none';
    }
}

async function loadRestockHistorial(catalogoId) {
    const list = document.getElementById('catRestockHistorialList');
    if (!list || !catalogoId) return;
    list.innerHTML = '<div style="padding:8px;text-align:center"><div class="spinner spinner-sm spinner-dark"></div></div>';
    try {
        const historial = await API_B2B.getRestockHistorial({ catalogo_id: catalogoId });
        if (!historial.length) {
            list.innerHTML = '<p style="font-size:.8rem;color:var(--text-secondary);padding:6px 0;margin:0">Sin registros de restock aún.</p>';
            return;
        }
        list.innerHTML = historial.map(h => `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border-color);font-size:.79rem;gap:8px">
                <div style="min-width:0">
                    <strong style="color:var(--success)">+${h.cantidad_repuesta}</strong>
                    <span style="color:var(--text-primary)"> ${escapeHtml(h.nombre_item)}</span>
                    ${h.notas ? `<br><em style="color:var(--text-secondary)">${escapeHtml(h.notas)}</em>` : ''}
                    <br><span style="color:var(--text-secondary)">${h.stock_anterior} → ${h.stock_nuevo} · ${escapeHtml(h.registrador || 'Sistema')}</span>
                </div>
                <span style="color:var(--text-secondary);white-space:nowrap;flex-shrink:0">${formatDate(h.created_at)}</span>
            </div>
        `).join('');
    } catch (err) {
        list.innerHTML = '<p style="font-size:.8rem;color:var(--danger);margin:0">Error al cargar historial.</p>';
    }
}
