/* ============================================================
   reportes.js — Lógica de la página de reportes B2B
   CuidaDiario PRO
   ============================================================ */

'use strict';

let _pacientes = [];
let _reporteData = null;

async function initReportes() {
    if (!requireAuth()) return;
    requireRole('admin_institucion', 'medico', 'cuidador_staff');
    initSidebar();
    populateSidebarUser();

    // Fecha por defecto: último mes
    const hoy = today();
    const hace30 = new Date();
    hace30.setDate(hace30.getDate() - 30);
    const hace30Str = hace30.toISOString().split('T')[0];
    document.getElementById('reporteDesde').value = hace30Str;
    document.getElementById('reporteHasta').value = hoy;
    document.getElementById('direccionHasta').value = hoy;
    document.getElementById('direccionDesde').value = hace30Str;
    document.getElementById('formDireccion').addEventListener('submit', event => { event.preventDefault(); loadDashboardDireccion(); });
    if (canDo('ver_dashboard_direccion')) loadDashboardDireccion();
    else document.getElementById('direccionDashboard').style.display = 'none';

    // Cargar pacientes para el select
    try {
        const res = await API_B2B.getPacientes();
        _pacientes = Array.isArray(res) ? res : [];
        const sel = document.getElementById('reportePacienteId');
        const pacActivos   = _pacientes.filter(p => !p.fecha_egreso);
        const pacEgresados = _pacientes.filter(p =>  p.fecha_egreso);
        // Pacientes activos primero (uso más frecuente)
        pacActivos.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.nombre}${p.apellido ? ' ' + p.apellido : ''}${p.habitacion ? ' — Hab. ' + p.habitacion : ''}`;
            sel.appendChild(opt);
        });
        // Egresados en grupo separado (para informes de egreso / auditoría)
        if (pacEgresados.length > 0) {
            const grp = document.createElement('optgroup');
            grp.label = '— Pacientes egresados —';
            pacEgresados.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.nombre}${p.apellido ? ' ' + p.apellido : ''} — Egresado ${p.fecha_egreso ? formatDate(p.fecha_egreso) : ''}`;
                grp.appendChild(opt);
            });
            sel.appendChild(grp);
        }
    } catch (e) {
        showToast('Error al cargar pacientes', 'error');
    }
}

async function loadDashboardDireccion() {
    const loader=document.getElementById('direccionLoader');
    const error=document.getElementById('direccionError');
    const container=document.getElementById('direccionKpis');
    loader.style.display='flex'; error.style.display='none'; container.setAttribute('aria-busy','true');
    try {
        const data=await API_B2B.getDashboardDireccion({
            desde:document.getElementById('direccionDesde').value,
            hasta:document.getElementById('direccionHasta').value,
        });
        renderDashboardDireccion(data);
    } catch (err) {
        error.textContent=err.message || 'No se pudieron calcular los indicadores.';
        error.style.display='block';
    } finally { loader.style.display='none'; container.removeAttribute('aria-busy'); }
}

function renderDashboardDireccion(data) {
    const current=data.estado_actual || {}; const historical=data.historicos || {};
    const cards=[
        ['Ocupación actual',current.ocupacion?.valor,'residentes','Residentes activos que actualmente no tienen una fecha de egreso. No se muestra un porcentaje porque la capacidad total no está configurada.'],
        ['Ingresos',historical.ingresos?.valor,'en el período','Residentes cuya fecha de ingreso está dentro del período seleccionado.'],
        ['Egresos',historical.egresos?.valor,'en el período','Residentes cuya fecha de egreso está dentro del período seleccionado.'],
        ['Caídas',historical.caidas?.valor,'en el período','Incidentes de caída registrados y no archivados dentro del período seleccionado.'],
        ['Internaciones',historical.internaciones?.valor,'en el período','Internaciones cuyo inicio está dentro del período seleccionado.'],
        ['Derivaciones',historical.derivaciones?.valor,'en el período','Incidentes de derivación registrados y no archivados dentro del período seleccionado.'],
        ['Omisiones de medicación',historical.omisiones_medicacion?.valor,'en el período','Administraciones registradas expresamente como omitidas dentro del período. No se infieren omisiones por falta de registro.'],
        ['Tareas vencidas hoy',current.tareas_vencidas?.valor,'estado actual','Tareas activas con horario anterior a la hora actual y sin finalización registrada hoy.'],
        ['Stock crítico actual',current.stock_critico?.valor,'ítems actuales','Ítems cuyo stock actual alcanzó o bajó el mínimo configurado; en tratamientos individuales sin mínimo, menos de 10 unidades.'],
    ];
    document.getElementById('direccionKpis').innerHTML=cards.map(([label,value,unit,help])=>`<article class="direction-kpi"><span class="eyebrow">${escapeHtml(unit)}</span><h3>${escapeHtml(label)}</h3><div class="kpi-value">${value===null||value===undefined?'No disponible':safeFiniteNumber(value)}</div><p>${escapeHtml(help||'')}</p></article>`).join('');
    document.getElementById('direccionActualizado').textContent=`Actualizado ${formatDateTime(data.actualizado_en)} · ${data.periodo?.timezone || ''}`;
    const definitions=[
        ['Período seleccionado','Incluye la fecha «Desde» y termina antes del día indicado en «Hasta».'],
        ['Indicadores actuales','Ocupación, tareas vencidas y stock crítico muestran la situación al momento de actualizar, no un historial del período.'],
        ['Ingresos y egresos','Se cuentan por la fecha de ingreso o egreso registrada para cada residente.'],
        ['Incidentes','Caídas y derivaciones se cuentan por la fecha en que ocurrieron y excluyen registros archivados.'],
        ['Omisiones de medicación','Sólo se cuentan administraciones registradas expresamente como omitidas.'],
    ];
    document.getElementById('direccionDefinitions').innerHTML=definitions.map(([label,value])=>`<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join('');
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
    const principal = API_B2B.getPrincipalUser?.() || API_B2B.getUser?.() || {};
    const institucion = principal.institucion_nombre || 'Institución';
    const generado = new Date();
    const desdeLabel = data.periodo?.desde ? formatDate(data.periodo.desde) : 'Inicio disponible';
    const hastaLabel = data.periodo?.hasta ? formatDate(data.periodo.hasta) : 'Actualidad';
    document.getElementById('reportePacienteHeader').innerHTML = `
        <div class="card-body report-patient-header">
            <div class="report-logo">
                <div>
                    <div class="report-kicker">REPORTE OPERATIVO DEL RESIDENTE</div>
                    <div class="report-institution">${escapeHtml(institucion)}</div>
                    <div class="report-meta">Período: ${desdeLabel} a ${hastaLabel} · Generado: ${formatDateTime(generado.toISOString())}</div>
                </div>
                <div class="report-product">CuidaDiario PRO</div>
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
        </div>
        <div class="report-disclaimer">Documento operativo generado desde CuidaDiario PRO. No se presenta como historia clínica oficial ni reemplaza la documentación que la institución determine como tal.</div>`;

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
                    <strong>${escapeHtml(m.nombre)}</strong>
                    ${m.dosis ? `<span class="badge badge-secondary">${escapeHtml(m.dosis)}</span>` : ''}
                    ${m.frecuencia ? `<span style="color:var(--text-secondary);font-size:.85rem">${escapeHtml(m.frecuencia)}</span>` : ''}
                </div>
                ${m.instrucciones ? `<div style="color:var(--text-secondary);font-size:.85rem;margin-top:4px">${escapeHtml(m.instrucciones)}</div>` : ''}
                ${tomas.length ? `
                    <div style="margin-top:8px">
                        <div style="font-size:.8rem;color:var(--text-secondary);font-weight:600;margin-bottom:4px">${tomas.length} toma(s) en el período:</div>
                        <div class="tomas-list">${tomas.slice(0, 10).map(t => `<span class="toma-chip">${formatInstitutionDateTime(t.fecha)} <span style="opacity:.7">— ${escapeHtml(t.administrador_nombre || 'No disponible')}</span></span>`).join('')}</div>
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
                <td>${formatInstitutionDateTime(c.fecha)}</td>
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
                <td>${formatInstitutionDateTime(s.fecha)}</td>
                <td>${escapeHtml(s.descripcion)}</td>
                <td>${intensidadBadge(s.intensidad)}</td>
                <td>${escapeHtml(s.registrador_nombre || 'No disponible')}</td>
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
                <td>${formatInstitutionDateTime(g.fecha)}</td>
                <td><span class="badge ${ts.cls}">${escapeHtml(g.tipo ? g.tipo.replace(/_/g,' ') : '—')}</span></td>
                <td><strong>${escapeHtml(String(g.valor))}</strong></td>
                <td>${escapeHtml(g.unidad || '—')}</td>
                <td>${escapeHtml(g.registrador_nombre || 'No disponible')}</td>
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
                    <strong>${escapeHtml(t.titulo || 'Tarea')}</strong>
                    <span class="badge badge-success">${t.completados.length} vez${t.completados.length !== 1 ? 'es' : ''} completada</span>
                </div>
                <div style="margin-top:6px;font-size:.82rem;color:var(--text-secondary)">
                    Última: ${formatInstitutionDateTime(t.completados[0].fecha)} — por ${escapeHtml(t.completados[0].completador_nombre || 'No disponible')}
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
                    ${n.urgente ? '<span class="badge badge-danger">URGENTE</span>' : ''}
                    <strong>${escapeHtml(n.titulo || 'Sin título')}</strong>
                    <span style="color:var(--text-secondary);font-size:.8rem">${formatInstitutionDateTime(n.created_at)} · ${escapeHtml(n.autor_nombre || 'No disponible')}</span>
                </div>
                ${n.contenido ? `<div style="margin-top:6px;color:var(--text-primary)">${escapeHtml(n.contenido)}</div>` : ''}
            </div>`).join('') || '<p style="color:var(--text-secondary)">Sin notas en el período.</p>';
        secNotas.style.display = 'block';
    } else { secNotas.style.display = 'none'; }
}

// Helpers visuales
function citaEstadoBadge(estado) {
    const map = { pendiente: 'badge-warning', realizada: 'badge-success', cancelada: 'badge-danger' };
    return `<span class="badge ${map[estado] || 'badge-secondary'}">${escapeHtml(estado || '—')}</span>`;
}

function intensidadBadge(v) {
    if (!v) return '—';
    const cls = v <= 3 ? 'badge-success' : v <= 6 ? 'badge-warning' : 'badge-danger';
    return `<span class="badge ${cls}">${safeFiniteNumber(v)}/10</span>`;
}

document.addEventListener('DOMContentLoaded', initReportes);
