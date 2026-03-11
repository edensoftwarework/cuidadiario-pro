/**
 * utils-b2b.js — Utilidades compartidas para CuidaDiario PRO
 * by EDEN SoftWork
 */

// ============================================
// TOAST NOTIFICATIONS
// ============================================
function showToast(msg, type = 'info', duration = 3500) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-msg">${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(30px)'; toast.style.transition = 'all 0.3s ease'; setTimeout(() => toast.remove(), 300); }, duration);
}

// ============================================
// MODAL HELPERS
// ============================================
function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('active');
    setTimeout(() => {
        const first = m.querySelector('input:not([type=hidden]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])');
        if (first) first.focus();
    }, 60);
}
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }
function closeAllModals() { document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); }

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active');
});
// Close modal on Escape
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });

// ============================================
// AUTH GUARD
// ============================================
function requireAuth(redirectTo = '../index.html') {
    if (!API_B2B.isAuth()) {
        window.location.href = redirectTo;
        return false;
    }
    return true;
}

function requireRole(...roles) {
    const user = API_B2B.getUser();
    if (!user || !roles.includes(user.rol)) {
        showToast('No tenés permisos para acceder a esta sección', 'error');
        setTimeout(() => window.history.back(), 1500);
        return false;
    }
    return true;
}

// ============================================
// SIDEBAR
// ============================================
function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    const toggleBtn = document.getElementById('sidebarToggle');
    const mobileBtn = document.getElementById('mobileMenuBtn');

    // Desktop toggle (collapse)
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            if (mainContent) mainContent.classList.toggle('expanded');
            localStorage.setItem('cd_pro_sidebar_collapsed', sidebar.classList.contains('collapsed'));
        });
        // Restore state
        if (localStorage.getItem('cd_pro_sidebar_collapsed') === 'true') {
            sidebar.classList.add('collapsed');
            if (mainContent) mainContent.classList.add('expanded');
        }
    }

    // Mobile toggle
    if (mobileBtn) {
        let overlay = document.getElementById('sidebarOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'sidebarOverlay';
            overlay.className = 'sidebar-overlay';
            overlay.style.display = 'none';
            document.body.appendChild(overlay);
        }
        mobileBtn.addEventListener('click', () => {
            sidebar.classList.toggle('mobile-open');
            overlay.style.display = sidebar.classList.contains('mobile-open') ? 'block' : 'none';
        });
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('mobile-open');
            overlay.style.display = 'none';
        });
    }

    // Highlight active nav item
    const currentPage = window.location.pathname.split('/').pop();
    document.querySelectorAll('.nav-item').forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.includes(currentPage)) link.classList.add('active');
    });
}

// ============================================
// USER INFO IN SIDEBAR
// ============================================
function populateSidebarUser() {
    const user = API_B2B.getUser();
    if (!user) return;
    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');
    const avatarEl = document.getElementById('sidebarAvatar');
    const instEl = document.getElementById('topbarInstitucion');
    if (nameEl) nameEl.textContent = user.nombre || user.email;
    if (avatarEl) avatarEl.textContent = (user.nombre || 'U').charAt(0).toUpperCase();
    const roleLabels = { admin_institucion: 'Administrador', cuidador_staff: 'Personal', familiar: 'Familiar / Referente', medico: 'Médico / Profesional' };
    if (roleEl) roleEl.textContent = roleLabels[user.rol] || user.rol;
    if (instEl && user.institucion_nombre) instEl.textContent = user.institucion_nombre;
    // Hide admin-only nav items for non-admin
    if (user.rol !== 'admin_institucion') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        // Médicos y personal cuidador también pueden acceder a Reportes (informes clínicos)
        if (user.rol === 'medico' || user.rol === 'cuidador_staff') {
            document.querySelectorAll('.sidebar-nav a[href="reportes.html"]').forEach(el => {
                el.style.display = '';
            });
        }
    }
    // Shared station mode: inject worker chip if the feature is enabled
    initSharedStationUI();
}

// ============================================
// DATE / TIME HELPERS
// ============================================
function formatDate(isoString, options) {
    if (!isoString) return '—';
    try {
        // Always extract YYYY-MM-DD and anchor to local noon to prevent any
        // timezone shift, regardless of whether the backend returns a date-only
        // string or a full ISO timestamp with Z or +00:00 suffix.
        const datePart = String(isoString).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return String(isoString);
        return new Date(datePart + 'T12:00:00').toLocaleDateString('es-AR', options || { day:'2-digit', month:'2-digit', year:'numeric' });
    } catch { return isoString; }
}
function formatDateTime(isoString) {
    if (!isoString) return '—';
    try {
        // Datetimes entered by users (e.g. citas) are stored in local time but node-postgres
        // returns them with a Z suffix (treated as UTC), causing a -3h display offset in AR.
        // Stripping the Z makes JS parse the value as local time — matching what was entered.
        const s = String(isoString).replace(/Z$/, '').replace(/\+\d{2}:\d{2}$/, '');
        return new Date(s).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    } catch { return isoString; }
}
function calcEdad(fechaNacimiento) {
    if (!fechaNacimiento) return null;
    const hoy = new Date();
    const nac = new Date(fechaNacimiento);
    let edad = hoy.getFullYear() - nac.getFullYear();
    const m = hoy.getMonth() - nac.getMonth();
    if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
    return edad;
}
function today() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}
function todayDatetimeLocal() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
}

// ============================================
// MISC
// ============================================
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function rolBadge(rol) {
    const map = {
        admin_institucion: ['🔑 Admin', 'badge-purple'],
        cuidador_staff:    ['👤 Personal', 'badge-blue'],
        familiar:          ['👨‍👩‍👧 Familiar / Referente', 'badge-teal'],
        medico:            ['🩺 Médico / Profesional', 'badge-green'],
    };
    const [label, cls] = map[rol] || [rol, 'badge-gray'];
    return `<span class="badge ${cls}">${label}</span>`;
}

function tipoSignoBadge(tipo) {
    const map = {
        'presion_arterial': ['🩸', 'badge-red'],
        'frecuencia_cardiaca': ['❤️', 'badge-red'],
        'temperatura': ['🌡️', 'badge-orange'],
        'saturacion_oxigeno': ['💨', 'badge-blue'],
        'glucosa': ['🩸', 'badge-purple'],
        'peso': ['⚖️', 'badge-teal'],
        'talla': ['📏', 'badge-teal'],
    };
    const [icon, cls] = map[tipo] || ['📊', 'badge-gray'];
    return { icon, cls };
}

// ============================================
// EGRESADOS SECTION TOGGLE (shared utility)
// ============================================
function toggleEgresadosSection(toggleEl) {
    const body = document.getElementById('egresadosBody');
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    toggleEl.classList.toggle('open', !isOpen);
}

// ============================================
// PERMISSIONS — role-based + admin-configurable
// ============================================
// Default permissions reflect real-world practice in care institutions:
//   medico: can create/edit patients and give discharge
//   cuidador_staff: can create/edit patients but NOT give discharge
//   admin: always allowed; familiar: never allowed (read-only)
const _PERM_DEFAULTS = {
    crear_paciente:    { medico: true,  cuidador_staff: true  },
    editar_paciente:   { medico: true,  cuidador_staff: true  },
    dar_alta:          { medico: true,  cuidador_staff: false },
    eliminar_paciente: { medico: false, cuidador_staff: false },
};

function canDo(action) {
    const user = API_B2B.getUser();
    if (!user) return false;
    if (user.rol === 'admin_institucion') return true;
    if (user.rol === 'familiar') return false;
    // Primero: permisos configurados por el admin en la DB (viajan en el objeto user tras el login)
    try {
        const perms = user.institucion_permisos || {};
        const key = `${user.rol}_${action}`;
        if (key in perms) return !!perms[key];
    } catch {}
    // Fallback: localStorage (compatibilidad con sesiones antiguas)
    try {
        const stored = JSON.parse(localStorage.getItem('cd_perm_config') || '{}');
        const key = `${user.rol}_${action}`;
        if (key in stored) return !!stored[key];
    } catch {}
    return _PERM_DEFAULTS[action]?.[user.rol] ?? false;
}

// ============================================
// CONFIRM DIALOG (custom)
// ============================================
function confirmDialog(message, onConfirm) {
    let modal = document.getElementById('confirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirmModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal modal-sm">
                <div class="modal-header">
                    <span class="modal-title">⚠️ Confirmación</span>
                    <button class="modal-close" onclick="closeModal('confirmModal')">✕</button>
                </div>
                <div class="modal-body"><p id="confirmMsg" style="font-size:0.95rem"></p></div>
                <div class="modal-footer">
                    <button class="btn btn-secondary btn-sm" onclick="closeModal('confirmModal')">Cancelar</button>
                    <button class="btn btn-danger btn-sm" id="confirmOkBtn">Confirmar</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }
    document.getElementById('confirmMsg').textContent = message;
    const okBtn = document.getElementById('confirmOkBtn');
    const newBtn = okBtn.cloneNode(true);
    okBtn.replaceWith(newBtn);
    newBtn.addEventListener('click', () => { closeModal('confirmModal'); onConfirm(); });
    openModal('confirmModal');
}

// ============================================
// MODO ESTACIÓN COMPARTIDA
// Permite a un único dispositivo ser usado por todo el equipo
// sin necesidad de múltiples logins/logouts. Cada persona selecciona
// su nombre antes de registrar; la sesión JWT es siempre la del admin.
// ============================================

/**
 * Devuelve el nombre que se usará como "registrador" en los registros clínicos.
 * Si el modo estación está ON y hay un trabajador activo → ese nombre.
 * Si no → el nombre del usuario JWT logueado.
 */
function getRegistrador() {
    if (localStorage.getItem('cd_shared_mode')) {
        const w = sessionStorage.getItem('cd_active_worker');
        if (w) return w;
    }
    return API_B2B.getUser()?.nombre || '';
}

/** Guarda quién está trabajando ahora en este dispositivo */
function setActiveWorker(nombre) {
    sessionStorage.setItem('cd_active_worker', nombre);
    // Mantener lista de personas recientes (max 8) en localStorage
    try {
        const recientes = JSON.parse(localStorage.getItem('cd_workers_recientes') || '[]');
        const filtrados = recientes.filter(n => n !== nombre);
        filtrados.unshift(nombre);
        localStorage.setItem('cd_workers_recientes', JSON.stringify(filtrados.slice(0, 8)));
    } catch {}
    _actualizarWorkerChip();
    closeModal('workerSwitcherModal');
    showToast(`Registrando como: ${nombre}`, 'success', 2000);
}

function _actualizarWorkerChip() {
    const chip = document.getElementById('workerChip');
    if (!chip) return;
    const nombre = sessionStorage.getItem('cd_active_worker') || API_B2B.getUser()?.nombre || '?';
    const inicial = nombre.charAt(0).toUpperCase();
    chip.innerHTML = `<span style="width:20px;height:20px;border-radius:50%;background:var(--pro-primary);color:#fff;font-size:.7rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:5px">${inicial}</span>${escapeHtml(nombre)}`;
    chip.title = `Registrando como: ${nombre}\nTocá para cambiar`;
}

/** Inyecta el chip en el topbar y añade los estilos CSS necesarios */
function initSharedStationUI() {
    if (!localStorage.getItem('cd_shared_mode')) return;
    // Inyectar CSS una sola vez
    if (!document.getElementById('sharedModeCSS')) {
        const style = document.createElement('style');
        style.id = 'sharedModeCSS';
        style.textContent = [
            '.worker-grid{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}',
            '.worker-btn{display:flex;align-items:center;gap:8px;padding:9px 14px;border:1.5px solid var(--border-color);border-radius:10px;background:var(--bg-card);cursor:pointer;font-size:.88rem;font-weight:600;flex-basis:calc(50% - 4px);min-width:0;transition:border-color .15s}',
            '.worker-btn:hover{border-color:var(--pro-primary)}',
            '.worker-btn.active{border-color:var(--pro-primary);background:#EEF2FF;color:var(--pro-primary)}',
            '.worker-btn-av{width:30px;height:30px;border-radius:50%;background:var(--pro-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:700;flex-shrink:0}',
        ].join('');
        document.head.appendChild(style);
    }
    // Inyectar chip en topbar
    const topbarActions = document.querySelector('.topbar-actions');
    if (topbarActions && !document.getElementById('workerChip')) {
        const chip = document.createElement('button');
        chip.id = 'workerChip';
        chip.className = 'btn btn-secondary btn-sm';
        chip.style.cssText = 'font-size:.78rem;padding:4px 10px;border-radius:20px;display:flex;align-items:center;gap:4px';
        chip.onclick = openWorkerSwitcher;
        topbarActions.insertBefore(chip, topbarActions.firstChild);
    }
    _actualizarWorkerChip();
}

/** Abre el modal para seleccionar quién está trabajando ahora */
function openWorkerSwitcher() {
    const recientes = JSON.parse(localStorage.getItem('cd_workers_recientes') || '[]');
    const currentWorker = sessionStorage.getItem('cd_active_worker') || '';
    const jwtNombre = API_B2B.getUser()?.nombre || '';

    let modal = document.getElementById('workerSwitcherModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'workerSwitcherModal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }

    const recBtns = recientes.map(n => {
        const active = n === currentWorker ? ' active' : '';
        return `<button class="worker-btn${active}" onclick="setActiveWorker(${JSON.stringify(n)})">
            <span class="worker-btn-av">${n.charAt(0).toUpperCase()}</span>${escapeHtml(n)}
        </button>`;
    }).join('');

    modal.innerHTML = `
        <div class="modal modal-sm">
            <div class="modal-header">
                <span class="modal-title">&#x1F465; &#xBF;Qui&#xE9;n est&#xE1; registrando?</span>
                <button class="modal-close" onclick="closeModal('workerSwitcherModal')">&#x2715;</button>
            </div>
            <div class="modal-body">
                <p class="text-muted" style="font-size:.82rem;margin-bottom:12px">Seleccion&#xE1; qui&#xE9;n va a registrar las acciones. No se necesita contrase&#xF1;a.</p>
                ${recientes.length ? `<div class="worker-grid">${recBtns}</div>` : ''}
                <div class="form-group mt-12">
                    <label class="form-label">Agregar nombre</label>
                    <div class="d-flex gap-8">
                        <input type="text" id="workerNuevoInput" class="form-control" placeholder="Nombre del personal..."
                            onkeydown="if(event.key==='Enter'){_agregarNuevoWorker();event.preventDefault();}">
                        <button class="btn btn-primary btn-sm" onclick="_agregarNuevoWorker()">&#x2713;</button>
                    </div>
                </div>
                ${jwtNombre && jwtNombre !== currentWorker
                    ? `<button class="btn btn-secondary btn-sm" style="width:100%;margin-top:8px"
                        onclick="setActiveWorker(${JSON.stringify(jwtNombre)})">
                        &#x1F511; Soy ${escapeHtml(jwtNombre)} (cuenta principal)
                    </button>`
                    : ''}
            </div>
        </div>`;
    openModal('workerSwitcherModal');
    setTimeout(() => document.getElementById('workerNuevoInput')?.focus(), 80);
}

function _agregarNuevoWorker() {
    const input = document.getElementById('workerNuevoInput');
    const nombre = input?.value?.trim();
    if (!nombre) { showToast('Ingres&#xE1; un nombre', 'warning'); return; }
    setActiveWorker(nombre);
}
