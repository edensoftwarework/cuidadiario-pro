/*
 * Guard visual B2B para ventanas coordinadas.
 *
 * El estado se obtiene exclusivamente por red desde el backend B2B mediante
 * B2B_MAINTENANCE_MODE. No usa localStorage, Cache Storage ni el service worker
 * como interruptor operativo. El bridge sigue siendo la barrera de mutaciones.
 */
(function () {
    'use strict';

    // api-b2b.js se carga antes de este guard en todas las entradas B2B.
    // API_B2B es un binding global léxico (const), no una propiedad de globalThis.
    const backendBase = typeof API_B2B !== 'undefined' ? API_B2B.BASE_URL : null;
    const statusUrl = backendBase
        ? `${backendBase.replace(/\/$/, '')}/api/b2b/maintenance-status`
        : null;
    const pollIntervalMs = 5000;
    const requestTimeoutMs = 4000;
    let overlay = null;
    let overlayCard = null;
    let guardActive = false;
    let retryButton = null;

    function isGuardControl(target) {
        return target instanceof Element && Boolean(target.closest('#b2bMaintenanceRetry'));
    }

    function blockInteraction(event) {
        if (!guardActive || isGuardControl(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    ['click', 'dblclick', 'pointerdown', 'pointerup', 'submit', 'keydown'].forEach(type => {
        document.addEventListener(type, blockInteraction, true);
    });

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('section');
        overlay.id = 'b2bMaintenanceOverlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483647', 'display:grid',
            'place-items:center', 'padding:24px', 'background:#f3f6fb',
            'color:#14213d', 'font-family:system-ui,-apple-system,"Segoe UI",sans-serif'
        ].join(';');
        overlayCard = document.createElement('div');
        overlayCard.style.cssText = [
            'width:min(100%,560px)', 'padding:40px 32px', 'border:1px solid #dbe4f0',
            'border-radius:18px', 'background:#fff', 'box-shadow:0 18px 50px rgba(20,33,61,.12)',
            'text-align:center'
        ].join(';');
        const icon = document.createElement('div');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '🛠️';
        icon.style.cssText = 'margin-bottom:20px;font-size:46px;line-height:1';
        const title = document.createElement('h1');
        title.id = 'b2bMaintenanceTitle';
        title.style.cssText = 'margin:0 0 14px;font-size:clamp(1.45rem,4vw,2rem)';
        const detail = document.createElement('p');
        detail.id = 'b2bMaintenanceDetail';
        detail.style.cssText = 'margin:8px 0;color:#53627a;line-height:1.6';
        retryButton = document.createElement('button');
        retryButton.id = 'b2bMaintenanceRetry';
        retryButton.type = 'button';
        retryButton.textContent = 'Reintentar';
        retryButton.style.cssText = 'margin-top:20px;padding:10px 18px;border:0;border-radius:9px;background:#173b7a;color:#fff;font:inherit;font-weight:650;cursor:pointer';
        retryButton.addEventListener('click', () => { void refreshStatus(true); });
        overlayCard.append(icon, title, detail, retryButton);
        overlay.append(overlayCard);
        document.body.append(overlay);
        return overlay;
    }

    function showInitialPending() {
        guardActive = true;
        const element = ensureOverlay();
        element.dataset.state = 'pending';
        element.setAttribute('role', 'presentation');
        element.setAttribute('aria-hidden', 'true');
        element.removeAttribute('aria-modal');
        element.removeAttribute('aria-live');
        overlayCard.hidden = true;
        document.body.setAttribute('aria-busy', 'true');
    }

    function showBlocking(kind) {
        guardActive = true;
        const element = ensureOverlay();
        element.dataset.state = kind;
        element.setAttribute('role', 'alertdialog');
        element.setAttribute('aria-modal', 'true');
        element.setAttribute('aria-live', 'assertive');
        element.removeAttribute('aria-hidden');
        overlayCard.hidden = false;
        document.body.setAttribute('aria-busy', 'true');
        const title = element.querySelector('#b2bMaintenanceTitle');
        const detail = element.querySelector('#b2bMaintenanceDetail');
        if (kind === 'maintenance') {
            title.textContent = 'CuidaDiario PRO se encuentra temporalmente en mantenimiento.';
            detail.textContent = 'El servicio estará disponible nuevamente en unos minutos.';
        } else if (kind === 'checking') {
            title.textContent = 'Verificando disponibilidad de CuidaDiario PRO…';
            detail.textContent = 'Por favor esperá un momento.';
        } else {
            title.textContent = 'No se pudo verificar la disponibilidad de CuidaDiario PRO.';
            detail.textContent = 'Por favor, no realices operaciones pendientes. Reintentá en unos instantes.';
        }
        retryButton.disabled = kind === 'checking';
        retryButton.style.opacity = retryButton.disabled ? '0.6' : '1';
        retryButton.style.cursor = retryButton.disabled ? 'wait' : 'pointer';
        if (document.activeElement !== retryButton) retryButton.focus({ preventScroll: true });
    }

    function clearBlocking() {
        guardActive = false;
        overlay?.remove();
        overlay = null;
        overlayCard = null;
        retryButton = null;
        document.body.removeAttribute('aria-busy');
    }

    async function requestStatus() {
        if (!statusUrl) throw new Error('B2B maintenance endpoint no configurado');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
            const response = await fetch(statusUrl, {
                method: 'GET',
                cache: 'no-store',
                credentials: 'omit',
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const status = await response.json();
            return status?.maintenance === true;
        } finally {
            clearTimeout(timeout);
        }
    }

    async function refreshStatus(initial) {
        if (initial) showBlocking('checking');
        try {
            const maintenance = await requestStatus();
            if (maintenance) {
                showBlocking('maintenance');
                return { mode: 'maintenance' };
            }
            clearBlocking();
            return { mode: 'normal' };
        } catch {
            showBlocking('unavailable');
            return { mode: 'unavailable' };
        }
    }

    showInitialPending();
    globalThis.B2B_MAINTENANCE_READY = refreshStatus(false);
    window.setInterval(() => { void refreshStatus(false); }, pollIntervalMs);
})();
