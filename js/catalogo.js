/**
 * catalogo.js — Catálogo institucional de insumos
 * CuidaDiario PRO — by EDEN SoftWork
 */

'use strict';

let _catalogoItems = [];
let _editingCatalogoId = null;
let _stockModelo = 'familiar';

async function initCatalogo() {
    if (!requireAuth()) return;

    const user = API_B2B.getUser();
    if (user?.rol !== 'admin_institucion') {
        // Solo admins pueden gestionar el catálogo
        window.location.href = 'dashboard.html';
        return;
    }

    initSidebar();
    populateSidebarUser();

    // Cargar modelo de stock de la institución
    try {
        const inst = await API_B2B.getInstitucion();
        const data = inst.institucion || inst;
        _stockModelo = data.stock_modelo || 'familiar';

        // Actualizar nombre en topbar
        if (data.nombre) {
            const tb = document.getElementById('topbarInstitucion');
            if (tb) tb.textContent = data.nombre;
        }
    } catch (e) { /* continuar */ }

    if (_stockModelo !== 'institucion') {
        document.getElementById('catalogoInactivo').style.display = '';
        document.getElementById('catalogoMainCard').style.display = 'none';
    } else {
        document.getElementById('catalogoInactivo').style.display = 'none';
        document.getElementById('catalogoMainCard').style.display = '';
        await loadCatalogo();
    }

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
}

async function loadCatalogo() {
    try {
        _catalogoItems = await API_B2B.getCatalogo();
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
                <span class="text-muted">${c.stock_actual} / ${c.stock_minimo ?? 5} ${c.unidad}s</span>
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

    if (lista.length === 0) {
        el.innerHTML = `<div class="empty-state">
            <div class="empty-icon">📦</div>
            <h3>Catálogo vacío</h3>
            <p>Agregaá los insumos que maneja la institución (medicamentos, materiales, elementos de stock) para llevar un inventario centralizado.</p>
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
            ${lista.length} ítem${lista.length !== 1 ? 's' : ''} en el catálogo
        </div>
        </div>`;
}

function openModalCatalogoItem(id) {
    _editingCatalogoId = id || null;
    document.getElementById('modalCatalogoTitle').textContent = id ? 'Editar ítem del catálogo' : 'Agregar ítem al catálogo';
    const f = document.getElementById('formCatalogoItem');
    if (!f) return;
    f.reset();
    if (id) {
        const item = _catalogoItems.find(c => c.id === id);
        if (item) {
            f.querySelector('[name="cNombre"]').value = item.nombre || '';
            f.querySelector('[name="cPrincipioActivo"]').value = item.principio_activo || '';
            f.querySelector('[name="cPresentacion"]').value = item.presentacion || '';
            f.querySelector('[name="cStockActual"]').value = item.stock_actual ?? 0;
            f.querySelector('[name="cStockMinimo"]').value = item.stock_minimo ?? 5;
            f.querySelector('[name="cUnidad"]').value = item.unidad || 'comprimido';
        }
    }
    openModal('modalCatalogoItem');
}

async function handleSaveCatalogoItem(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    const data = {
        nombre: f.querySelector('[name="cNombre"]').value.trim(),
        principio_activo: f.querySelector('[name="cPrincipioActivo"]').value.trim() || null,
        presentacion: f.querySelector('[name="cPresentacion"]').value.trim() || null,
        stock_actual: parseInt(f.querySelector('[name="cStockActual"]').value) || 0,
        stock_minimo: parseInt(f.querySelector('[name="cStockMinimo"]').value) || 5,
        unidad: f.querySelector('[name="cUnidad"]').value
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
        await loadCatalogo();
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
