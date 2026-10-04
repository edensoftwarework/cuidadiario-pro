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
    const safeType = Object.prototype.hasOwnProperty.call(icons, type) ? type : 'info';
    toast.className = `toast ${safeType}`;
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = icons[safeType];
    const message = document.createElement('span');
    message.className = 'toast-msg';
    message.textContent = msg == null ? '' : String(msg);
    toast.append(icon, message);
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
function requireAuth(redirectTo = '../login.html') {
    if (API_B2B.isAuth()) return true;
    API_B2B.removeToken();
    window.location.href = redirectTo;
    return false;
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
        // Mostrar Catálogo si el permiso gestionar_catalogo está activado para este rol
        if ((user.rol === 'medico' || user.rol === 'cuidador_staff') && canDo('gestionar_catalogo')) {
            document.querySelectorAll('.sidebar-nav a[href="catalogo.html"]').forEach(el => {
                el.style.display = '';
            });
        }
        // Mostrar Staff si el permiso ver_staff está activado para este rol
        if ((user.rol === 'medico' || user.rol === 'cuidador_staff') && canDo('ver_staff')) {
            document.querySelectorAll('.sidebar-nav a[href="staff.html"]').forEach(el => {
                el.style.display = '';
            });
        }
    }
    // Inject "Mis residentes" sidebar link for medico/cuidador_staff on ALL pages
    // (prevents the link from disappearing when navigating away from pacientes.html)
    if ((user.rol === 'cuidador_staff' || user.rol === 'medico') &&
        !document.getElementById('navMisResidentes')) {
        const nav = document.querySelector('.sidebar-nav');
        const pacientesLink = nav?.querySelector('a[href="pacientes.html"]');
        if (pacientesLink) {
            const miRes = document.createElement('a');
            miRes.id = 'navMisResidentes';
            miRes.href = 'cuidador.html';
            miRes.className = 'nav-item';
            miRes.innerHTML = '<span class="nav-icon">🗂️</span><span class="nav-label">Mis residentes</span>';
            if (window.location.pathname.endsWith('cuidador.html')) miRes.classList.add('active');
            pacientesLink.insertAdjacentElement('beforebegin', miRes);
        }
    }
    // Shared station mode: inject worker chip only for non-familiar roles
    // Familiares are read-only and must not have access to worker switching
    if (user.rol !== 'familiar') initSharedStationUI();
    // Notification bell — inject in topbar on all pages
    _initNotifBell();
    // Trial expiry banner for admin
    if (user.rol === 'admin_institucion') _checkTrialBanner(user);
}

// ============================================
// CAMPANA DE NOTIFICACIONES
// ============================================

/** Inyecta la campana en el topbar y carga el conteo inicial de no leídas */
function _initNotifBell() {
    const topbarActions = document.querySelector('.topbar-actions');
    if (!topbarActions || document.getElementById('notifBellBtn')) return;

    // Inyectar CSS una sola vez
    if (!document.getElementById('notifBellCSS')) {
        const s = document.createElement('style');
        s.id = 'notifBellCSS';
        s.textContent = [
            '#notifBellBtn{position:relative;background:none;border:1.5px solid var(--border-color);border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1rem;color:var(--text-primary);transition:background .15s,border-color .15s;flex-shrink:0}',
            '#notifBellBtn:hover{background:var(--bg-page);border-color:var(--pro-primary)}',
            '#notifBellBtn.active{border-color:var(--pro-primary);background:#EEF2FF}',
            '#notifBadge{position:absolute;top:-5px;right:-5px;background:#EF4444;color:#fff;border-radius:9999px;font-size:.62rem;font-weight:800;min-width:16px;height:16px;padding:0 4px;display:flex;align-items:center;justify-content:center;line-height:1;border:2px solid #fff}',
            '#notifPanel{position:fixed;top:60px;right:12px;width:340px;max-width:calc(100vw - 24px);background:#fff;border:1.5px solid var(--border-color);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.14);z-index:9000;display:none;flex-direction:column;max-height:70vh;overflow:hidden}',
            '#notifPanel.open{display:flex}',
            '#notifPanelHeader{padding:12px 16px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}',
            '#notifPanelHeader h4{margin:0;font-size:.92rem;font-weight:700}',
            '#notifPanelBody{overflow-y:auto;flex:1}',
            '.notif-item{display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border-color);cursor:pointer;transition:background .12s;text-decoration:none;color:inherit}',
            '.notif-item:hover{background:var(--bg-page)}',
            '.notif-item.unread{background:#F5F7FF}',
            '.notif-icon{font-size:1.1rem;flex-shrink:0;margin-top:1px}',
            '.notif-body{flex:1;min-width:0}',
            '.notif-title{font-size:.83rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.notif-desc{font-size:.75rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}',
            '.notif-ts{font-size:.68rem;color:var(--text-secondary);opacity:.75;margin-top:2px;display:block}',
            '.notif-empty{padding:24px 16px;text-align:center;font-size:.84rem;color:var(--text-secondary)}',
        ].join('');
        document.head.appendChild(s);
    }

    // Botón campana
    const bell = document.createElement('button');
    bell.id = 'notifBellBtn';
    bell.title = 'Notificaciones';
    bell.innerHTML = '🔔<span id="notifBadge" style="display:none"></span>';
    bell.addEventListener('click', _toggleNotifPanel);
    topbarActions.insertBefore(bell, topbarActions.firstChild);

    // Panel flotante
    if (!document.getElementById('notifPanel')) {
        const panel = document.createElement('div');
        panel.id = 'notifPanel';
        panel.innerHTML = `
            <div id="notifPanelHeader">
                <h4>🔔 Notificaciones</h4>
                <button style="background:none;border:none;cursor:pointer;font-size:1rem;color:var(--text-secondary)" onclick="_closeNotifPanel()">✕</button>
            </div>
            <div id="notifPanelBody"><div class="notif-empty">Cargando…</div></div>`;
        document.body.appendChild(panel);
        // Cerrar al hacer click fuera
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('notifPanel');
            const bell  = document.getElementById('notifBellBtn');
            if (panel && panel.classList.contains('open') && !panel.contains(e.target) && !bell?.contains(e.target)) {
                _closeNotifPanel();
            }
        }, true);
    }

    _loadNotifCount();
}

let _notifPollTimer = null;

async function _loadNotifCount() {
    try {
        const data = await API_B2B.getNotificaciones();
        const badge = document.getElementById('notifBadge');
        if (badge) {
            const count = data.unread || 0;
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        }
    } catch { /* sin conexión — ignorar */ }
    // Refrescar conteo cada 2 minutos
    clearTimeout(_notifPollTimer);
    _notifPollTimer = setTimeout(_loadNotifCount, 120_000);
}

async function _toggleNotifPanel() {
    const panel = document.getElementById('notifPanel');
    const bell  = document.getElementById('notifBellBtn');
    if (!panel) return;
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
        _closeNotifPanel();
    } else {
        panel.classList.add('open');
        bell?.classList.add('active');
        await _renderNotifPanel();
        // Marcar como vistas (actualiza notif_last_seen_at en el servidor)
        try { await API_B2B.marcarNotifVistas(); } catch {}
        // Limpiar badge
        const badge = document.getElementById('notifBadge');
        if (badge) badge.style.display = 'none';
    }
}

function _closeNotifPanel() {
    const panel = document.getElementById('notifPanel');
    const bell  = document.getElementById('notifBellBtn');
    panel?.classList.remove('open');
    bell?.classList.remove('active');
}

/** Formatea un timestamp como tiempo relativo corto: "hace 5 min", "hace 2h", "ayer", etc. */
function _formatTsShort(ts) {
    if (!ts) return '';
    try {
        const s = String(ts).replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '');
        const d = new Date(s);
        if (isNaN(d)) return '';
        const diffMs  = Date.now() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1)  return 'ahora';
        if (diffMin < 60) return `hace ${diffMin} min`;
        const diffH = Math.floor(diffMin / 60);
        if (diffH  < 24) return `hace ${diffH}h`;
        const diffD = Math.floor(diffH  / 24);
        if (diffD === 1) return 'ayer';
        if (diffD  < 7)  return `hace ${diffD} días`;
        return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch { return ''; }
}

async function _renderNotifPanel() {
    const body = document.getElementById('notifPanelBody');
    if (!body) return;
    body.innerHTML = '<div class="notif-empty">Cargando…</div>';
    try {
        const { items } = await API_B2B.getNotificaciones();
        if (!items || items.length === 0) {
            body.innerHTML = '<div class="notif-empty">✅ Todo al día, sin alertas pendientes.</div>';
            return;
        }
        // Detect current path depth for relative links
        const inPages = window.location.pathname.includes('/pages/');
        const base    = inPages ? '' : 'pages/';
        body.replaceChildren();
        items.forEach(n => {
            const link = document.createElement('a');
            link.className = `notif-item${n.es_nuevo ? ' unread' : ''}`;
            link.href = _safeSameOriginHref(n.href || '#', base);

            const icon = document.createElement('span');
            icon.className = 'notif-icon';
            icon.textContent = n.icono == null ? '' : String(n.icono);

            const content = document.createElement('span');
            content.className = 'notif-body';
            const title = document.createElement('span');
            title.className = 'notif-title';
            title.textContent = n.titulo == null ? '' : String(n.titulo);
            const desc = document.createElement('span');
            desc.className = 'notif-desc';
            desc.textContent = n.descripcion == null ? '' : String(n.descripcion);
            content.append(title, desc);

            const tsStr = _formatTsShort(n.ts);
            if (tsStr) {
                const ts = document.createElement('span');
                ts.className = 'notif-ts';
                ts.textContent = `🕐 ${tsStr}`;
                content.appendChild(ts);
            }
            link.append(icon, content);
            body.appendChild(link);
        });
    } catch (err) {
        body.innerHTML = `<div class="notif-empty" style="color:var(--danger)">Error al cargar notificaciones.</div>`;
    }
}

/**
 * Muestra un banner de aviso cuando el período de prueba está por vencer,
 * o un overlay de bloqueo total cuando ya venció.
 */
function _checkTrialBanner(user) {
    if (!user || user.plan !== 'free' || !user.trial_started_at) return;

    const trialEnd = new Date(user.trial_started_at);
    trialEnd.setDate(trialEnd.getDate() + 60);
    const daysLeft = Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24));

    if (daysLeft > 15) return; // más de 15 días — no molestar

    // --- Trial expirado ---
    if (daysLeft <= 0) {
        // Mostrar overlay solo UNA vez por sesión (al primer inicio de sesión)
        // Las acciones bloqueadas muestran el overlay vía el handler de API error.
        const sessionKey = 'cd_trial_expired_shown';
        if (!sessionStorage.getItem(sessionKey)) {
            sessionStorage.setItem(sessionKey, '1');
            _showTrialExpiredOverlay(user);
        }
        return;
    }

    // --- Aviso previo al vencimiento (banner) ---
    let type = daysLeft <= 5 ? 'critical' : 'warn';
    const sessionKey = `cd_trial_banner_${type}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');

    const msgs = {
        critical: { text: `⚠️ Tu prueba vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'}. Activá un plan ahora.`, color: '#92400E', bg: '#FFFBEB' },
        warn:     { text: `⏳ Tu prueba vence en ${daysLeft} días. Elegí un plan antes de que expire.`,              color: '#92400E', bg: '#FFFBEB' },
    };
    const m = msgs[type];
    const banner = document.createElement('div');
    banner.id = 'trialExpiryBanner';
    banner.style.cssText = `background:${m.bg};color:${m.color};padding:10px 16px;font-size:.83rem;font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid ${m.color}33;position:sticky;top:0;z-index:100`;
    banner.innerHTML = `
        <span>${m.text}</span>
        <span style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <a href="configuracion.html" style="background:${m.color};color:#fff;padding:4px 12px;border-radius:6px;text-decoration:none;font-size:.78rem">Ver planes</a>
            <button onclick="this.closest('#trialExpiryBanner').remove()" style="background:none;border:none;cursor:pointer;font-size:1rem;color:${m.color};line-height:1;padding:0">✕</button>
        </span>`;
    const mainContent = document.getElementById('mainContent');
    if (mainContent) mainContent.insertBefore(banner, mainContent.firstChild);
}

/**
 * Muestra un overlay de bloqueo total cuando el trial expiró.
 * Permite solo navegar a pacientes.html, staff.html y configuracion.html.
 * Bloquea todo lo demás hasta que contraten un plan.
 * @param {object} user - objeto usuario; puede tener _pacientes_count/_staff_count ya calculados
 */
async function _showTrialExpiredOverlay(user) {
    // Evitar múltiples overlays
    if (document.getElementById('trialExpiredOverlay')) return;

    // En configuracion.html no mostrar el overlay — el usuario ya está en la página
    // correcta para contratar un plan y no hay que bloquear los botones de planes.
    const currentPage = window.location.pathname.split('/').pop();
    if (currentPage === 'configuracion.html') return;

    // Páginas donde se puede navegar libremente (para reducir conteos)
    const allowedPages = ['pacientes.html', 'staff.html'];
    const isAllowedPage = allowedPages.includes(currentPage);

    // Obtener conteos actuales
    let pacientesCount = user._pacientes_count !== undefined ? user._pacientes_count : 0;
    let staffCount = user._staff_count !== undefined ? user._staff_count : 0;
    if (user._pacientes_count === undefined) {
        try {
            const inst = await API_B2B.getInstitucion();
            pacientesCount = inst.pacientes_count || 0;
            staffCount = inst.staff_count || 0;
        } catch (e) { /* si falla, continuar con 0 */ }
    }
    pacientesCount = safeFiniteNumber(pacientesCount);
    staffCount = safeFiniteNumber(staffCount);

    const canUseBasico = pacientesCount <= 30 && staffCount <= 20;
    // const canUsePro = pacientesCount <= 40 && staffCount <= 20;  // Plan PRO desactivado temporalmente

    // Advertencia de conteos solo si excede límites de Básico
    let countWarning = '';
    if (!canUseBasico) {
        const parts = [];
        if (pacientesCount > 30) parts.push(`${pacientesCount} pacientes activos (máx. 30 en Básico)`);
        if (staffCount > 20)     parts.push(`${staffCount} miembros de staff (máx. 20 en Básico)`);
        countWarning = `
            <div style="margin:14px 0 0;padding:12px 14px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:10px;text-align:left">
                <p style="font-weight:700;color:#92400E;margin-bottom:6px;font-size:.85rem">⚠️ Para el Plan Básico necesitás reducir:</p>
                <ul style="margin:0;padding-left:18px;color:#78350F;font-size:.82rem;line-height:1.8">
                    ${parts.map(p => `<li>${p}</li>`).join('')}
                </ul>
                <p style="font-size:.78rem;color:#92400E;margin-top:6px;margin-bottom:0">Gestioná desde <a href="pacientes.html" style="color:#92400E;font-weight:700">Pacientes</a> y <a href="staff.html" style="color:#92400E;font-weight:700">Staff</a>.</p>
            </div>`;
    }

    // Botón Básico
    const btnBasico = canUseBasico
        ? `<a href="configuracion.html?autoplan=basico" style="display:block;background:#fff;color:#0F172A;padding:10px 18px;border-radius:10px;font-weight:600;text-decoration:none;font-size:.88rem;border:1.5px solid #CBD5E1">Contratar Plan Básico — $19.000/mes</a>`
        : `<button disabled style="display:block;width:100%;background:#F1F5F9;color:#94A3B8;padding:10px 18px;border-radius:10px;font-weight:600;font-size:.88rem;border:1.5px solid #E2E8F0;cursor:not-allowed">Plan Básico — Reducí pacientes/staff primero</button>`;

    // Botón PRO — desactivado temporalmente
    // const btnPro = ...;

    const overlay = document.createElement('div');
    overlay.id = 'trialExpiredOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.82);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
        <div style="position:relative;background:#fff;border-radius:16px;max-width:480px;width:100%;padding:30px 26px;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,.4)">
            <button id="trialOverlayDismiss" style="position:absolute;top:12px;right:12px;background:#F1F5F9;border:none;cursor:pointer;color:#64748B;font-size:1rem;line-height:1;padding:5px 9px;border-radius:6px" title="Cerrar">✕</button>
            <div style="font-size:2.2rem;margin-bottom:10px">🔒</div>
            <h2 style="font-size:1.15rem;font-weight:800;color:#0F172A;margin-bottom:8px">Tu período de prueba venció</h2>
            <p style="color:#64748B;font-size:.87rem;line-height:1.6;margin-bottom:0">
                Los 60 días de prueba de <strong>CuidaDiario PRO</strong> terminaron.<br>
                Elegí un plan para continuar usando todas las funciones.
            </p>
            ${countWarning}
            <div style="display:flex;flex-direction:column;gap:9px;margin-top:18px">
                <a href="configuracion.html?autoplan=total" style="display:block;background:#4C1D95;color:#fff;padding:12px 18px;border-radius:10px;font-weight:700;text-decoration:none;font-size:.95rem">🏆 Contratar Plan Total — $45.000/mes</a>
                ${btnBasico}
            </div>
            <p style="margin-top:14px;font-size:.76rem;color:#94A3B8">Podés seguir accediendo a <a href="pacientes.html" style="color:#64748B">Pacientes</a>, <a href="staff.html" style="color:#64748B">Staff</a> y <a href="configuracion.html" style="color:#64748B">Configuración</a>.</p>
        </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('#trialOverlayDismiss').onclick = () => overlay.remove();
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
        if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return '—';
        return new Date(datePart + 'T12:00:00').toLocaleDateString('es-AR', options || { day:'2-digit', month:'2-digit', year:'numeric' });
    } catch { return '—'; }
}
function formatDateTime(isoString) {
    if (!isoString) return '—';
    try {
        // El backend tiene SET TIME ZONE 'America/Argentina/Buenos_Aires', por lo que
        // todos los TIMESTAMP (created_at, fecha) almacenan hora local de Argentina.
        // node-postgres los serializa con sufijo Z (fake-UTC), así que al quitarlo
        // JS los parsea como hora local del navegador → muestra la hora correcta.
        // También se eliminan offsets ±HH:MM por si viene algún TIMESTAMPTZ.
        const s = String(isoString).replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '');
        const date = new Date(s);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12: false });
    } catch { return '—'; }
}
function calcEdad(fechaNacimiento) {
    if (!fechaNacimiento) return null;
    const hoy = new Date();
    const nac = new Date(fechaNacimiento);
    if (Number.isNaN(nac.getTime())) return null;
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
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function safeRecordId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function safeFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function _safeSameOriginHref(value, relativePrefix = '') {
    const raw = String(value == null ? '' : value).trim();
    if (!raw || raw === '#') return '#';
    try {
        const isAbsoluteOrRooted = /^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('/') || raw.startsWith('#');
        const url = new URL(isAbsoluteOrRooted ? raw : relativePrefix + raw, window.location.href);
        if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) return '#';
        return url.pathname + url.search + url.hash;
    } catch {
        return '#';
    }
}

function safeExternalHttpsHref(value, allowedHostnameSuffixes = []) {
    try {
        const url = new URL(String(value));
        if (url.protocol !== 'https:') return null;
        const host = url.hostname.toLowerCase();
        if (allowedHostnameSuffixes.length && !allowedHostnameSuffixes.some(suffix => host === suffix || host.endsWith('.' + suffix))) return null;
        return url.href;
    } catch {
        return null;
    }
}

function safeContactHref(kind, value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    if (kind === 'tel') {
        return /^\+?[\d\s().-]{3,40}$/.test(raw) ? `tel:${raw}` : null;
    }
    if (kind === 'mailto') {
        if (/[\u0000-\u0020\u007f<>"/?#&]/.test(raw)) return null;
        return /^[^@]+@[^@]+\.[^@]+$/.test(raw) ? `mailto:${raw}` : null;
    }
    return null;
}

function rolBadge(rol) {
    const map = {
        admin_institucion: ['🔑 Admin', 'badge-purple'],
        cuidador_staff:    ['👤 Personal', 'badge-blue'],
        familiar:          ['👨‍👩‍👧 Familiar / Referente', 'badge-teal'],
        medico:            ['🩺 Médico / Profesional', 'badge-green'],
    };
    const [label, cls] = map[rol] || [rol, 'badge-gray'];
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
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
    crear_paciente:      { medico: true,  cuidador_staff: true  },
    editar_paciente:     { medico: true,  cuidador_staff: true  },
    ver_todos_pacientes: { medico: true,  cuidador_staff: true  },
    dar_alta:            { medico: true,  cuidador_staff: false },
    eliminar_paciente:   { medico: false, cuidador_staff: false },
    gestionar_catalogo:  { medico: false, cuidador_staff: false },
    ver_staff:           { medico: false, cuidador_staff: false },
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

// Defaults para secciones visibles por el familiar en la ficha del paciente
const _FAMILIAR_SECTION_DEFAULTS = {
    medicamentos: true,
    citas:        true,
    tareas:       true,
    sintomas:     true,
    signos:       true,
    contactos:    true,
    notas:        false,
    documentos:   true,
};

// Retorna true si el familiar puede ver la sección dada según los permisos de la institución.
// section: 'medicamentos' | 'citas' | 'tareas' | 'sintomas' | 'signos' | 'contactos' | 'notas' | 'documentos'
function canFamiliarSee(section) {
    const user = API_B2B.getUser();
    if (!user || user.rol !== 'familiar') return true; // no aplica para otros roles
    const perms = user.institucion_permisos || {};
    const key = `familiar_ver_${section}`;
    if (key in perms) return !!perms[key];
    return _FAMILIAR_SECTION_DEFAULTS[section] ?? false;
}

// ============================================
// CONFIRM DIALOG (custom)
// ============================================
function confirmDialog(message, onConfirm, confirmLabel = 'Confirmar') {
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
    newBtn.textContent = confirmLabel;
    newBtn.addEventListener('click', () => { closeModal('confirmModal'); onConfirm(); });
    openModal('confirmModal');
}

// ============================================
// MODO ESTACIÓN COMPARTIDA — P1-C
// El principal conserva la sesión B2B. El operador humano se identifica
// contra el backend mediante ID estable + PIN y nunca por un nombre libre.
// ============================================

function getRegistrador() {
    return API_B2B.getOperatorContext()?.nombre || API_B2B.getPrincipalUser()?.nombre || '';
}

function _workersKey() {
    const instId = API_B2B.getPrincipalUser()?.institucion_id || 'anon';
    return `cd_workers_recientes_${instId}`;
}

function _actualizarWorkerChip() {
    const operator = API_B2B.getOperatorContext();
    const principal = API_B2B.getPrincipalUser();
    const nombre = operator?.nombre || principal?.nombre || principal?.email || 'Usuario';
    const roleLabels = { admin_institucion: 'Administrador', cuidador_staff: 'Personal', medico: 'Médico / Profesional' };
    const effectiveRole = operator?.rol || principal?.rol;
    const role = roleLabels[effectiveRole] || effectiveRole || '';
    const inicial = escapeHtml(nombre.charAt(0).toUpperCase());
    const nombreHtml = escapeHtml(nombre);
    const roleHtml = escapeHtml(role);

    const chip = document.getElementById('workerChip');
    if (chip) {
        chip.innerHTML = `<span class="operator-chip-avatar">${inicial}</span><span class="operator-chip-text"><strong>${nombreHtml}</strong><small>${roleHtml}</small></span>`;
        chip.title = operator
            ? `Registrando como ${nombre}. Tocá para cambiar o volver a tu identidad.`
            : `Registrando como ${nombre}. Tocá para cambiar de persona.`;
        chip.classList.remove('operator-required');
    }

    const widget = document.getElementById('sidebarWorkerWidget');
    if (widget) {
        widget.innerHTML = `
            <div class="sidebar-worker-av">${inicial}</div>
            <div class="sidebar-worker-info">
                <div class="sidebar-worker-label">Operando como</div>
                <div class="sidebar-worker-name">${nombreHtml}</div>
                <div class="sidebar-worker-role">${roleHtml}</div>
            </div>
            <span class="sidebar-worker-change">cambiar</span>`;
    }
}

function initSharedStationUI() {
    const principal = API_B2B.getPrincipalUser();
    if (!principal?.shared_mode) return;
    try {
        sessionStorage.removeItem('cd_active_worker');
        localStorage.removeItem(_workersKey());
    } catch {}
    if (!document.getElementById('sharedModeCSS')) {
        const style = document.createElement('style');
        style.id = 'sharedModeCSS';
        style.textContent = [
            '.worker-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}',
            '.worker-btn{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1.5px solid var(--border-color);border-radius:10px;background:var(--bg-card);cursor:pointer;font-size:.88rem;font-weight:600;min-width:0;transition:border-color .15s}',
            '.worker-btn:hover{border-color:var(--pro-primary)}',
            '.worker-btn.active{border-color:var(--pro-primary);background:#EEF2FF;color:var(--pro-primary)}',
            '.worker-btn-av{width:30px;height:30px;border-radius:50%;background:var(--pro-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:700;flex-shrink:0}',
            '.operator-chip-avatar{width:22px;height:22px;border-radius:50%;background:var(--pro-primary);color:#fff;font-size:.7rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}',
            '.operator-chip-text{display:flex;flex-direction:column;line-height:1.05;text-align:left;overflow:hidden}.operator-chip-text strong{font-size:.75rem;overflow:hidden;text-overflow:ellipsis}.operator-chip-text small{font-size:.62rem;color:var(--text-secondary);margin-top:2px}',
            '.sidebar-worker{padding:8px 14px;border-top:1px solid var(--border-color);display:flex;align-items:center;gap:8px;cursor:pointer;transition:background .15s;border-radius:0 0 12px 12px}',
            '.sidebar-worker:hover{background:var(--bg-page)}',
            '.sidebar-worker-av{width:28px;height:28px;border-radius:50%;background:var(--pro-primary);color:#fff;font-size:.78rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
            '.sidebar-worker-info{flex:1;min-width:0}',
            '.sidebar-worker-label{font-size:.68rem;color:var(--text-secondary);line-height:1}',
            '.sidebar-worker-name{font-size:.82rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.sidebar-worker-role{font-size:.65rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.sidebar-worker-change{font-size:.68rem;color:var(--pro-primary);flex-shrink:0}',
            '.collapsed .sidebar-worker-info,.collapsed .sidebar-worker-change{display:none}',
            '.operator-required-modal{z-index:12000}',
        ].join('');
        document.head.appendChild(style);
    }
    const topbarActions = document.querySelector('.topbar-actions');
    if (topbarActions && !document.getElementById('workerChip')) {
        const chip = document.createElement('button');
        chip.id = 'workerChip';
        chip.className = 'btn btn-secondary btn-sm';
        chip.style.cssText = 'padding:4px 10px;border-radius:20px;display:flex;align-items:center;gap:6px;max-width:190px;overflow:hidden';
        chip.addEventListener('click', () => openWorkerSwitcher(false));
        topbarActions.insertBefore(chip, topbarActions.firstChild);
    }
    const sidebarFooter = document.querySelector('.sidebar-footer');
    if (sidebarFooter && !document.getElementById('sidebarWorkerWidget')) {
        const widget = document.createElement('div');
        widget.id = 'sidebarWorkerWidget';
        widget.className = 'sidebar-worker';
        widget.title = 'Cambiar quién registra';
        widget.addEventListener('click', () => openWorkerSwitcher(false));
        sidebarFooter.insertAdjacentElement('afterbegin', widget);
    }
    _actualizarWorkerChip();
    window.addEventListener('b2b:operator-required', () => openWorkerSwitcher(false));
    window.addEventListener('b2b:operator-cleared', () => {
        _actualizarWorkerChip();
    });
    const existing = API_B2B.getOperatorContext();
    if (existing) {
        API_B2B.validateOperatorContext().catch(() => openWorkerSwitcher(false));
    }
}

async function openWorkerSwitcher(required = false) {
    const current = API_B2B.getOperatorContext();
    const principal = API_B2B.getPrincipalUser();
    let operators = [];
    try {
        operators = await API_B2B.getOperators(false);
    } catch (error) {
        showToast('No se pudo obtener el directorio de operadores: ' + error.message, 'error');
    }

    let modal = document.getElementById('workerSwitcherModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'workerSwitcherModal';
        modal.className = 'modal-overlay operator-required-modal';
        document.body.appendChild(modal);
    }
    modal.classList.remove('required');

    const roleLabels = { admin_institucion: 'Administrador', cuidador_staff: 'Personal', medico: 'Médico / Profesional' };
    const principalName = principal?.nombre || principal?.email || 'Mi identidad';
    const principalRole = roleLabels[principal?.rol] || principal?.rol || '';
    const principalButton = `<button type="button" class="worker-btn${current ? '' : ' active'}" id="selectPrincipalIdentity">
        <span class="worker-btn-av">${escapeHtml(principalName.charAt(0).toUpperCase())}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left">${escapeHtml(principalName)}<small style="display:block;color:var(--text-secondary);font-weight:400">${escapeHtml(principalRole)} · titular de la sesión</small></span>
    </button>`;
    const buttons = operators.map(operator => {
        const active = operator.id === current?.id ? ' active' : '';
        return `<button type="button" class="worker-btn${active}" data-operator-id="${safeRecordId(operator.id)}">
            <span class="worker-btn-av">${escapeHtml(operator.nombre.charAt(0).toUpperCase())}</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left">${escapeHtml(operator.nombre)}<small style="display:block;color:var(--text-secondary);font-weight:400">${escapeHtml(roleLabels[operator.rol] || operator.rol)}</small></span>
        </button>`;
    }).join('');

    modal.innerHTML = `
        <div class="modal modal-sm">
            <div class="modal-header">
                <span class="modal-title">👤 Cambiar quién registra</span>
                <button class="modal-close" id="workerModalClose">✕</button>
            </div>
            <div class="modal-body">
                <p class="text-muted" style="font-size:.82rem;margin-bottom:12px">
                    Tu identidad autenticada no requiere PIN. Si otra persona utiliza esta estación, debe seleccionar su operador e ingresar su PIN. Su contexto dura hasta 8 horas y se bloquea tras 60 minutos de inactividad.
                </p>
                <div class="worker-grid">${principalButton}${buttons}</div>
                ${operators.length ? '' : '<p class="text-muted" style="font-size:.82rem;margin-bottom:12px">No hay otras personas habilitadas. Podés continuar normalmente con tu identidad.</p>'}
                <form id="operatorPinForm" style="display:none">
                    <input type="hidden" id="selectedOperatorId">
                    <div class="form-group"><label class="form-label">PIN de 6 dígitos</label><input id="operatorPin" class="form-control" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></div>
                    <button class="btn btn-primary" type="submit" style="width:100%">Comenzar turno</button>
                </form>
                <div style="border-top:1px solid var(--border-color);margin-top:14px;padding-top:12px;display:flex;gap:8px;flex-wrap:wrap">
                    ${current ? '<button type="button" id="endOperatorShift" class="btn btn-secondary btn-sm">Volver a mi identidad</button>' : ''}
                    ${API_B2B.getPrincipalUser()?.rol === 'admin_institucion' ? '<a href="staff.html#operadores" id="manageOperatorsLink" class="btn btn-secondary btn-sm">Administrar operadores</a>' : ''}
                </div>
            </div>
        </div>`;

    modal.querySelector('#workerModalClose').addEventListener('click', () => closeModal('workerSwitcherModal'));
    modal.querySelector('#selectPrincipalIdentity').addEventListener('click', async event => {
        event.currentTarget.disabled = true;
        await API_B2B.endOperatorShift('return-to-principal');
        showToast(`Registrando como ${principalName}`, 'success');
        closeModal('workerSwitcherModal');
        window.location.reload();
    });
    modal.querySelectorAll('[data-operator-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            modal.querySelectorAll('[data-operator-id]').forEach(candidate => candidate.classList.remove('active'));
            btn.classList.add('active');
            modal.querySelector('#selectedOperatorId').value = btn.dataset.operatorId;
            modal.querySelector('#operatorPinForm').style.display = '';
            modal.querySelector('#operatorPin').value = '';
            modal.querySelector('#operatorPin').focus();
        });
    });
    modal.querySelector('#operatorPinForm').addEventListener('submit', async event => {
        event.preventDefault();
        const submit = event.target.querySelector('[type=submit]');
        submit.disabled = true;
        try {
            const operator = await API_B2B.activateOperator(Number(modal.querySelector('#selectedOperatorId').value), modal.querySelector('#operatorPin').value);
            showToast(`Operando como ${operator.nombre}`, 'success');
            closeModal('workerSwitcherModal');
            window.location.reload();
        } catch (error) {
            showToast(error.message, 'error');
            modal.querySelector('#operatorPin').value = '';
            modal.querySelector('#operatorPin').focus();
        } finally { submit.disabled = false; }
    });
    modal.querySelector('#endOperatorShift')?.addEventListener('click', async () => {
        await API_B2B.endOperatorShift('return-to-principal');
        closeModal('workerSwitcherModal');
        window.location.reload();
    });
    modal.querySelector('#manageOperatorsLink')?.addEventListener('click', () => closeModal('workerSwitcherModal'));

    openModal('workerSwitcherModal');
}

function setActiveWorker() { throw new Error('P1-C: la identidad nominal sin PIN fue retirada'); }
function _agregarNuevoWorker() { /* legacy retirado por P1-C */ }

// ============================================
// OFFLINE BANNER
// ============================================
(function() {
    function showOfflineBanner() {
        let b = document.getElementById('_offlineBanner');
        if (!b) {
            b = document.createElement('div');
            b.id = '_offlineBanner';
            b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#374151;color:#fff;padding:10px 16px;text-align:center;font-size:.84rem;z-index:9999;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 -2px 8px rgba(0,0,0,.3)';
            b.textContent = '\uD83D\uDCF5 Sin conexi\u00f3n \u2014 Las consultas y los cambios B2B requieren conexi\u00f3n. Ninguna operaci\u00f3n se guardar\u00e1 para enviarla despu\u00e9s.';
            document.body.appendChild(b);
        }
        b.style.display = 'flex';
    }
    function hideOfflineBanner() {
        const b = document.getElementById('_offlineBanner');
        if (b) b.style.display = 'none';
    }
    window.addEventListener('offline', showOfflineBanner);
    window.addEventListener('online', () => {
        hideOfflineBanner();
        showToast && showToast('Conexión restablecida ✅', 'success');
    });
    if (!navigator.onLine) showOfflineBanner();
})();

/**
 * Compatibilidad temporal para consumidores existentes.
 * P0-3 convirtió las escrituras B2B en network-only: ningún error se presenta
 * como éxito, no se cierra el modal y no se reinicia el formulario.
 */
function handleOfflineWrite() {
    return false;
}
