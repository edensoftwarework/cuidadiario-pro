/**
 * familiar.js — Vista de solo lectura para familiares / referentes
 * Solo pueden ver los pacientes que tienen asignados.
 * by EDEN SoftWork
 */

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;

    // Solo el rol familiar puede estar en esta página
    const user = API_B2B.getUser();
    if (user?.rol !== 'familiar') {
        // Si por algún motivo llega aquí otro rol, redirigir apropiadamente
        if (user?.rol === 'admin_institucion') { window.location.href = 'dashboard.html'; return; }
        if (user?.rol === 'cuidador_staff' || user?.rol === 'medico') { window.location.href = 'cuidador.html'; return; }
    }

    initSidebar();
    populateSidebarUser();

    // Saludo personalizado
    const bienvenida = document.getElementById('familiarBienvenida');
    if (bienvenida && user?.nombre) {
        bienvenida.textContent = `Bienvenido/a, ${user.nombre}`;
    }

    await cargarMisFamiliares();
});

async function cargarMisFamiliares() {
    const loader  = document.getElementById('familiarLoader');
    const grid    = document.getElementById('familiarGrid');
    const count   = document.getElementById('familiarCount');
    const empty   = document.getElementById('familiarEmpty');

    if (loader) loader.style.display = 'flex';
    if (grid)   grid.style.display   = 'none';

    try {
        const lista = await API_B2B.getPacientes();

        if (loader) loader.style.display = 'none';
        if (grid)   grid.style.display   = 'block';

        if (lista.length === 0) {
            if (empty) empty.style.display = 'block';
            if (count) count.style.display = 'none';
            mostrarContactoInstitucion();
            return;
        }

        if (empty) empty.style.display = 'none';
        if (count) {
            count.style.display = 'block';
            count.textContent = `${lista.length} familiar${lista.length !== 1 ? 'es' : ''} vinculado${lista.length !== 1 ? 's' : ''}`;
        }

        renderFamiliares(lista);

    } catch (err) {
        if (loader) loader.style.display = 'none';
        showToast('Error al cargar información: ' + err.message, 'error');
    }
}

function renderFamiliares(lista) {
    const grid = document.getElementById('familiarGrid');
    if (!grid) return;

    const activos   = lista.filter(p => !p.fecha_egreso);
    const egresados = lista.filter(p =>  p.fecha_egreso);

    // Actualizar contador: solo activos son relevantes en el día a día
    const countEl = document.getElementById('familiarCount');
    if (countEl) {
        countEl.style.display = 'block';
        countEl.textContent = `${activos.length} familiar${activos.length !== 1 ? 'es' : ''} vinculado${activos.length !== 1 ? 's' : ''}`;
    }

    const renderCard = (p) => {
        const edad = calcEdad(p.fecha_nacimiento);
        const isEgresado = !!p.fecha_egreso;
        const edadStr = edad !== null ? `${edad} años` : '';
        const habitacionStr = p.habitacion ? `· Habitación ${escapeHtml(p.habitacion)}` : '';
        const headerBg = isEgresado
            ? 'background:linear-gradient(135deg,#6b7280,#9ca3af)'
            : 'background:linear-gradient(135deg,var(--pro-primary-dark,#0D2B6B),var(--pro-primary,#1565C0))';

        return `
        <div class="card" style="margin-bottom:20px;overflow:visible${isEgresado ? ';opacity:.72' : ''}">
            <!-- Header del paciente -->
            <div style="${headerBg};padding:20px 20px 16px;border-radius:12px 12px 0 0;display:flex;align-items:center;gap:14px">
                <div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;color:#fff;flex-shrink:0">
                    ${isEgresado ? '🚪' : (p.nombre || 'P').charAt(0).toUpperCase()}
                </div>
                <div style="flex:1;min-width:0">
                    <div style="color:#fff;font-weight:700;font-size:1.05rem">${escapeHtml(p.apellido || '')} ${escapeHtml(p.nombre)}</div>
                    <div style="color:rgba(255,255,255,0.72);font-size:.8rem;margin-top:2px">${edadStr} ${isEgresado ? '' : habitacionStr}</div>
                </div>
                <span style="background:rgba(255,255,255,0.15);color:#fff;font-size:.68rem;font-weight:700;padding:3px 9px;border-radius:20px;white-space:nowrap">${isEgresado ? 'Egresado' : 'Solo lectura'}</span>
            </div>

            <!-- Cuerpo -->
            <div class="card-body" style="padding:18px 20px">
                ${isEgresado ? `
                <div style="padding:10px 14px;background:#F3F4F6;border-radius:8px;margin-bottom:12px;display:flex;align-items:center;gap:10px">
                    <span style="font-size:1rem">📋</span>
                    <div>
                        <div style="font-size:.72rem;color:var(--text-secondary);font-weight:600;text-transform:uppercase">Egresado el</div>
                        <div style="font-size:.9rem;font-weight:600">${formatDate(p.fecha_egreso)}</div>
                    </div>
                </div>` : ''}

                ${p.diagnostico ? `
                <div style="margin-bottom:12px">
                    <span style="font-size:.72rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em">Diagnóstico</span>
                    <div style="margin-top:4px"><span class="badge badge-${isEgresado ? 'gray' : 'blue'}">${escapeHtml(p.diagnostico)}</span></div>
                </div>` : ''}

                ${!isEgresado && p.medico_cabecera ? `
                <div style="margin-bottom:12px;padding:10px 14px;background:var(--bg-page,#EEF2FF);border-radius:8px;display:flex;align-items:center;gap:10px">
                    <span style="font-size:1.1rem">🩺</span>
                    <div>
                        <div style="font-size:.72rem;color:var(--text-secondary);font-weight:600">Médico de cabecera</div>
                        <div style="font-size:.9rem;font-weight:600;color:var(--pro-primary-dark)">${escapeHtml(p.medico_cabecera)}</div>
                    </div>
                </div>` : ''}

                ${!isEgresado && p.alergias ? `
                <div style="margin-bottom:12px;padding:10px 14px;background:#FEF2F2;border-left:3px solid var(--pro-danger,#EF4444);border-radius:0 8px 8px 0;display:flex;gap:10px;align-items:flex-start">
                    <span style="font-size:1rem;margin-top:1px">⚠️</span>
                    <div>
                        <div style="font-size:.72rem;color:#991B1B;font-weight:700;text-transform:uppercase">Alergias conocidas</div>
                        <div style="font-size:.88rem;color:#7F1D1D;font-weight:600;margin-top:2px">${escapeHtml(p.alergias)}</div>
                    </div>
                </div>` : ''}

                ${!isEgresado ? `
                <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
                    ${p.fecha_ingreso ? `<div style="font-size:.8rem;color:var(--text-secondary)">📋 Ingreso: <strong>${formatDate(p.fecha_ingreso)}</strong></div>` : ''}
                    ${p.fecha_nacimiento ? `<div style="font-size:.8rem;color:var(--text-secondary)">🎂 Nacimiento: <strong>${formatDate(p.fecha_nacimiento)}</strong></div>` : ''}
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
                    <a href="paciente.html?id=${p.id}&tab=medicamentos" class="btn btn-sm btn-secondary" style="flex:1;min-width:130px;text-align:center">
                        💊 Medicación
                    </a>
                    <a href="paciente.html?id=${p.id}&tab=citas" class="btn btn-sm btn-secondary" style="flex:1;min-width:130px;text-align:center">
                        📅 Citas
                    </a>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
                    <a href="paciente.html?id=${p.id}&tab=signos" class="btn btn-sm btn-secondary" style="flex:1;min-width:130px;text-align:center">
                        ❤️ Signos vitales
                    </a>
                    <a href="paciente.html?id=${p.id}&tab=notas" class="btn btn-sm btn-secondary" style="flex:1;min-width:130px;text-align:center">
                        📝 Notas
                    </a>
                </div>
                <a href="paciente.html?id=${p.id}" class="btn btn-primary btn-sm btn-block" style="margin-top:10px">
                    Ver ficha completa →
                </a>
                <div id="stockAlertFam_${p.id}" style="margin-top:10px"></div>` : `
                <a href="paciente.html?id=${p.id}" class="btn btn-secondary btn-sm btn-block" style="margin-top:10px">
                    📋 Ver historial del paciente
                </a>`}
            </div>
        </div>`;
    };

    let html = activos.map(renderCard).join('');

    if (egresados.length > 0) {
        html += `
        <div class="egresados-section">
            <div class="egresados-section-toggle" onclick="toggleEgresadosSection(this)">
                <span class="toggle-arrow">▶</span>
                <span>Familiares / pacientes egresados (${egresados.length})</span>
            </div>
            <div class="egresados-section-body" id="egresadosBody" style="display:none">
                ${egresados.map(renderCard).join('')}
            </div>
        </div>`;
    }

    grid.innerHTML = html || `<div class="empty-state"><div class="empty-icon">👤</div><h3>Sin familiares vinculados activos</h3></div>`;

    // Load patient-specific stock alerts async per active patient
    activos.forEach(p => _cargarStockAlertFamiliar(p.id));
}

async function _cargarStockAlertFamiliar(pacienteId) {
    const el = document.getElementById(`stockAlertFam_${pacienteId}`);
    if (!el) return;
    try {
        const items = await API_B2B.getCatalogo({ paciente_id: pacienteId });
        const bajos = items.filter(c => c.stock_minimo != null && c.stock_actual <= c.stock_minimo);
        if (bajos.length === 0) return;
        el.innerHTML = `
        <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:10px 13px;margin-top:4px">
            <div style="font-weight:700;font-size:.8rem;color:#92400E;margin-bottom:6px">⚠️ Insumos con stock bajo</div>
            ${bajos.map(c => `
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:.82rem;padding:3px 0;border-bottom:1px solid rgba(245,158,11,.2);color:#78350F">
                <span>📦 ${escapeHtml(c.nombre)}${c.presentacion ? ' — ' + escapeHtml(c.presentacion) : ''}</span>
                <span style="font-weight:700;color:#B45309">Stock: ${c.stock_actual}${c.unidad ? ' ' + escapeHtml(c.unidad) : ''}</span>
            </div>`).join('')}
            <div style="font-size:.75rem;color:#92400E;margin-top:6px">Avisá a la institución para reponer los insumos.</div>
        </div>`;
    } catch { /* silently ignore if not authorized */ }
}

function mostrarContactoInstitucion() {
    // Muestra el contacto de la institución en el empty state
    const user = API_B2B.getUser();
    const el = document.getElementById('familiarContactoInst');
    if (!el || !user?.institucion_nombre) return;
    el.innerHTML = `<div style="background:#F0F4FF;border-radius:10px;padding:14px 18px;display:inline-block;text-align:left">
        <div style="font-weight:700;color:var(--pro-primary);margin-bottom:4px">🏥 ${escapeHtml(user.institucion_nombre)}</div>
        <div style="font-size:.83rem;color:var(--text-secondary)">Contactá al administrador de la institución para solicitar acceso.</div>
    </div>`;
}
