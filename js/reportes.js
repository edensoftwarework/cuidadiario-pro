/* ============================================================
   reportes.js — Lógica de la página de reportes B2B
   CuidaDiario PRO
   ============================================================ */

'use strict';

let _pacientes = [];
let _reporteData = null;

async function initReportes() {
    requireAuth();
    requireRole('admin_institucion', 'medico');
    initSidebar();
    populateSidebarUser();

    // Fecha por defecto: último mes
    const hoy = today();
    const hace30 = new Date();
    hace30.setDate(hace30.getDate() - 30);
    const hace30Str = hace30.toISOString().split('T')[0];
    document.getElementById('reporteDesde').value = hace30Str;
    document.getElementById('reporteHasta').value = hoy;

    // Cargar pacientes para el select
    try {
        const res = await API_B2B.getPacientes();
        _pacientes = Array.isArray(res) ? res : [];
        const sel = document.getElementById('reportePacienteId');
        _pacientes.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.nombre}${p.apellido ? ' ' + p.apellido : ''}${p.habitacion ? ' — Hab. ' + p.habitacion : ''}`;
            sel.appendChild(opt);
        });
    } catch (e) {
        showToast('Error al cargar pacientes', 'error');
    }
}

async function generarReporte(e) {
    e.preventDefault();

    const pacienteId = document.getElementById('reportePacienteId').value;
    const desde = document.getElementById('reporteDesde').value || null;
    const hasta = document.getElementById('reporteHasta').value || null;

    if (!pacienteId) { showToast('Seleccioná un paciente', 'warning'); return; }

    const form = document.getElementById('formReporte');
    const checkboxes = {};
    form.querySelectorAll('input[type=checkbox]').forEach(cb => { checkboxes[cb.name] = cb.checked; });

    const loader = document.getElementById('reporteLoader');
    const container = document.getElementById('reporteContainer');
    loader.style.display = 'flex';
    container.style.display = 'none';
    document.getElementById('btnPrint').style.display = 'none';

    try {
        const params = {};
        if (desde) params.desde = desde;
        if (hasta) params.hasta = hasta;

        const data = await API_B2B.getReporte(pacienteId, params);
        _reporteData = data;
        renderReporte(data, checkboxes);
        container.style.display = 'block';
        document.getElementById('btnPrint').style.display = 'inline-flex';
    } catch (err) {
        showToast('Error al generar el reporte', 'error');
    } finally {
        loader.style.display = 'none';
    }
}

function renderReporte(data, checks) {
    // Cabecera del paciente
    const p = data.paciente || {};
    const nombre = `${p.nombre || ''}${p.apellido ? ' ' + p.apellido : ''}`;
    const edad = p.fecha_nacimiento ? ` · ${calcEdad(p.fecha_nacimiento)} años` : '';
    document.getElementById('reportePacienteHeader').innerHTML = `
        <div class="card-body report-patient-header">
            <div class="report-logo">
                <div style="font-size:2rem">🏥</div>
                <div>
                    <div style="font-weight:700;font-size:.75rem;color:var(--text-secondary);letter-spacing:.05em">REPORTE DE PACIENTE</div>
                    <div style="font-size:.8rem;color:var(--text-secondary)">CuidaDiario PRO · ${formatDate(new Date().toISOString())}</div>
                </div>
            </div>
            <div class="report-patient-info">
                <div style="font-size:1.4rem;font-weight:700">${escapeHtml(nombre)}</div>
                <div style="color:var(--text-secondary)">${p.diagnostico ? escapeHtml(p.diagnostico) : ''}${edad}</div>
                <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">
                    ${p.habitacion ? `<span class="badge badge-secondary">Hab. ${escapeHtml(p.habitacion)}</span>` : ''}
                    ${p.dni ? `<span class="badge badge-secondary">DNI: ${escapeHtml(p.dni)}</span>` : ''}
                    ${p.obra_social ? `<span class="badge badge-secondary">${escapeHtml(p.obra_social)}</span>` : ''}
                    ${p.fecha_ingreso ? `<span class="badge badge-secondary">Ingreso: ${formatDate(p.fecha_ingreso)}</span>` : ''}
                </div>
            </div>
        </div>`;

    // Medicamentos
    const meds = data.medicamentos || [];
    const secMeds = document.getElementById('reporteMedicamentos');
    // Agrupar historial de tomas por medicamento_id
    const tomasPorMed = {};
    (data.historial_medicamentos || []).forEach(t => {
        if (!tomasPorMed[t.medicamento_id]) tomasPorMed[t.medicamento_id] = [];
        tomasPorMed[t.medicamento_id].push(t);
    });
    if (checks.incMedicamentos && meds.length) {
        document.getElementById('reporteMedicamentosBody').innerHTML = meds.map(m => {
            const tomas = tomasPorMed[m.id] || [];
            return `<div class="report-item">
                <div class="report-item-header">
                    <strong>💊 ${escapeHtml(m.nombre)}</strong>
                    ${m.dosis ? `<span class="badge badge-secondary">${escapeHtml(m.dosis)}</span>` : ''}
                    ${m.frecuencia ? `<span style="color:var(--text-secondary);font-size:.85rem">${escapeHtml(m.frecuencia)}</span>` : ''}
                </div>
                ${m.instrucciones ? `<div style="color:var(--text-secondary);font-size:.85rem;margin-top:4px">${escapeHtml(m.instrucciones)}</div>` : ''}
                ${tomas.length ? `
                    <div style="margin-top:8px">
                        <div style="font-size:.8rem;color:var(--text-secondary);font-weight:600;margin-bottom:4px">${tomas.length} toma(s) en el período:</div>
                        <div class="tomas-list">${tomas.slice(0, 10).map(t => `<span class="toma-chip">✅ ${formatDateTime(t.fecha)} <span style="opacity:.7">— ${escapeHtml(t.administrador_nombre || '—')}</span></span>`).join('')}</div>
                    </div>` : '<div style="margin-top:4px;font-size:.82rem;color:var(--text-secondary)">Sin tomas registradas en el período</div>'}
            </div>`;
        }).join('') || '<p style="color:var(--text-secondary)">Sin medicamentos en el período.</p>';
        secMeds.style.display = 'block';
    } else { secMeds.style.display = 'none'; }

    // Citas
    const citas = data.citas || [];
    const secCitas = document.getElementById('reporteCitas');
    if (checks.incCitas && citas.length) {
        document.getElementById('reporteCitasBody').innerHTML = `<table class="table"><thead><tr><th>Fecha</th><th>Título</th><th>Especialidad</th><th>Médico</th><th>Estado</th></tr></thead><tbody>
            ${citas.map(c => `<tr>
                <td>${formatDateTime(c.fecha)}</td>
                <td>${escapeHtml(c.titulo)}</td>
                <td>${escapeHtml(c.especialidad || '—')}</td>
                <td>${escapeHtml(c.medico || '—')}</td>
                <td>${citaEstadoBadge(c.estado)}</td>
            </tr>`).join('')}
        </tbody></table>`;
        secCitas.style.display = 'block';
    } else { secCitas.style.display = 'none'; }

    // Síntomas
    const sintomas = data.sintomas || [];
    const secSintomas = document.getElementById('reporteSintomas');
    if (checks.incSintomas && sintomas.length) {
        document.getElementById('reporteSintomasBody').innerHTML = `<table class="table"><thead><tr><th>Fecha</th><th>Descripción</th><th>Intensidad</th><th>Registrado por</th></tr></thead><tbody>
            ${sintomas.map(s => `<tr>
                <td>${formatDateTime(s.fecha)}</td>
                <td>${escapeHtml(s.descripcion)}</td>
                <td>${intensidadBadge(s.intensidad)}</td>
                <td>${escapeHtml(s.registrador_nombre || '—')}</td>
            </tr>`).join('')}
        </tbody></table>`;
        secSintomas.style.display = 'block';
    } else { secSintomas.style.display = 'none'; }

    // Signos vitales
    const signos = data.signos_vitales || [];
    const secSignos = document.getElementById('reporteSignos');
    if (checks.incSignos && signos.length) {
        document.getElementById('reporteSignosBody').innerHTML = `<table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Valor</th><th>Unidad</th><th>Registrado por</th></tr></thead><tbody>
            ${signos.map(g => { const ts = tipoSignoBadge(g.tipo); return `<tr>
                <td>${formatDateTime(g.fecha)}</td>
                <td><span class="badge ${ts.cls}">${ts.icon} ${g.tipo ? g.tipo.replace(/_/g,' ') : '—'}</span></td>
                <td><strong>${escapeHtml(String(g.valor))}</strong></td>
                <td>${escapeHtml(g.unidad || '—')}</td>
                <td>${escapeHtml(g.registrador_nombre || '—')}</td>
            </tr>`; }).join('')}
        </tbody></table>`;
        secSignos.style.display = 'block';
    } else { secSignos.style.display = 'none'; }

    // Tareas — historial_tareas es una lista plana de registros de completado
    const histTareas = data.historial_tareas || [];
    const secTareas = document.getElementById('reporteTareas');
    if (checks.incTareas && histTareas.length) {
        // Agrupar por tarea_titulo para mostrar resumen
        const tareasMap = {};
        histTareas.forEach(h => {
            const key = h.tarea_id || h.tarea_titulo;
            if (!tareasMap[key]) tareasMap[key] = { titulo: h.tarea_titulo, completados: [] };
            tareasMap[key].completados.push(h);
        });
        document.getElementById('reporteTareasBody').innerHTML = Object.values(tareasMap).map(t => `
            <div class="report-item">
                <div class="report-item-header">
                    <strong>✅ ${escapeHtml(t.titulo || 'Tarea')}</strong>
                    <span class="badge badge-success">${t.completados.length} vez${t.completados.length !== 1 ? 'es' : ''} completada</span>
                </div>
                <div style="margin-top:6px;font-size:.82rem;color:var(--text-secondary)">
                    Última: ${formatDateTime(t.completados[0].fecha)} — por ${escapeHtml(t.completados[0].completador_nombre || '—')}
                </div>
            </div>`).join('');
        secTareas.style.display = 'block';
    } else { secTareas.style.display = 'none'; }

    // Notas
    const notas = data.notas || [];
    const secNotas = document.getElementById('reporteNotas');
    if (checks.incNotas && notas.length) {
        document.getElementById('reporteNotasBody').innerHTML = notas.map(n => `
            <div class="report-item ${n.urgente ? 'report-item-urgent' : ''}">
                <div class="report-item-header">
                    ${n.urgente ? '<span class="badge badge-danger">🚨 URGENTE</span>' : ''}
                    <strong>${escapeHtml(n.titulo || 'Sin título')}</strong>
                    <span style="color:var(--text-secondary);font-size:.8rem">${formatDateTime(n.created_at)} · ${escapeHtml(n.autor_nombre || '—')}</span>
                </div>
                ${n.contenido ? `<div style="margin-top:6px;color:var(--text-primary)">${escapeHtml(n.contenido)}</div>` : ''}
            </div>`).join('') || '<p style="color:var(--text-secondary)">Sin notas en el período.</p>';
        secNotas.style.display = 'block';
    } else { secNotas.style.display = 'none'; }
}

// Helpers visuales
function citaEstadoBadge(estado) {
    const map = { pendiente: 'badge-warning', realizada: 'badge-success', cancelada: 'badge-danger' };
    return `<span class="badge ${map[estado] || 'badge-secondary'}">${estado || '—'}</span>`;
}

function intensidadBadge(v) {
    if (!v) return '—';
    const cls = v <= 3 ? 'badge-success' : v <= 6 ? 'badge-warning' : 'badge-danger';
    return `<span class="badge ${cls}">${v}/10</span>`;
}

async function exportarDatos() {
    showToast('Generando exportación...', 'info');
    try {
        const res = await API_B2B.get('/api/b2b/institucion');
        const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cuidadiario-export-${today()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast('Error al exportar datos', 'error');
    }
}

document.addEventListener('DOMContentLoaded', initReportes);
