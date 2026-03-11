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
    }
}

// ============================================
// DATE / TIME HELPERS
// ============================================
function formatDate(isoString, options) {
    if (!isoString) return '—';
    try {
        // Date-only strings (YYYY-MM-DD) parse as UTC midnight and can show the previous day
        // in Western Hemisphere timezones. Appending T12:00:00 keeps us safely within the same day.
        const s = /^\d{4}-\d{2}-\d{2}$/.test(String(isoString))
            ? isoString + 'T12:00:00'
            : isoString;
        return new Date(s).toLocaleDateString('es-AR', options || { day:'2-digit', month:'2-digit', year:'numeric' });
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
    return new Date().toISOString().slice(0, 10);
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
