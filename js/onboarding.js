/**
 * onboarding.js — Wizard de configuración inicial para nuevas instituciones
 * Se muestra una única vez luego del registro o primer login.
 * by EDEN SoftWork
 */

// ── Estado del wizard ──
let _currentStep = 1;
const TOTAL_STEPS = 4;

// Datos recopilados en el wizard
// (nombre, tipo, teléfono ya se guardaron en el registro)
const _onbData = {
    modo_compartida: true
};

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    if (!requireAuth()) return;

    const user = API_B2B.getUser();
    // Solo admin puede hacer el onboarding
    if (user?.rol !== 'admin_institucion') {
        window.location.href = 'dashboard.html';
        return;
    }
    // Si ya completó el onboarding, redirigir directo
    if (user?.onboarding_done === true) {
        window.location.href = 'dashboard.html';
        return;
    }

    // ─ Verificación de email: bloquear el onboarding si el email no está verificado
    // email_verified puede ser false (sabemos que está pendiente), undefined (backend viejo sin el campo)
    // Solo bloqueamos si explícitamente es false; si es undefined/null, dejamos pasar (retrocompatibilidad)
    if (user?.email_verified === false) {
        _showEmailVerificationGate(user.email);
        return;
    }

    // Listeners de las option-cards (modo operación)
    _setupOptionCards('modoOp', ['optCompartida', 'optIndividual'], (val) => {
        _onbData.modo_compartida = val === 'compartida';
    });

    _updateProgress();
});

/** Conecta los radio-buttons con las tarjetas visuales */
function _setupOptionCards(radioName, cardIds, onChange) {
    cardIds.forEach(id => {
        const card = document.getElementById(id);
        if (!card) return;
        const radio = card.querySelector(`input[type="radio"]`);
        if (!radio) return;
        card.addEventListener('click', () => {
            // Desmarcar todas las tarjetas del grupo
            cardIds.forEach(oid => document.getElementById(oid)?.classList.remove('selected'));
            card.classList.add('selected');
            radio.checked = true;
            onChange(radio.value);
        });
    });
}

// ── Navegación ──
function onbNext(fromStep) {
    if (fromStep === 2) {
        _onbData.modo_compartida = (document.querySelector('input[name="modoOp"]:checked')?.value || 'individual') === 'compartida';
        _buildSummary();
    }
    if (fromStep === 3) {
        // Step 3 is plans info — build summary before going to step 4
        _buildSummary();
    }
    _clearAlert();
    _goToStep(fromStep + 1);
}

function onbBack(fromStep) {
    _clearAlert();
    _goToStep(fromStep - 1);
}

function _goToStep(step) {
    document.querySelectorAll('.onb-step').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`onbStep${step}`);
    if (target) target.classList.add('active');
    _currentStep = step;
    _updateProgress();
}

function _updateProgress() {
    const bar = document.getElementById('onbProgressBar');
    if (bar) bar.style.width = `${(_currentStep / TOTAL_STEPS) * 100}%`;
}

// ── Resumen del paso 2 ──
function _buildSummary() {
    const modoLabel = _onbData.modo_compartida
        ? '🖥️ Estación compartida (se activará al finalizar)'
        : '👤 Acceso individual por cuenta';

    const instNombre = API_B2B.getUser()?.institucion_nombre || 'Tu institución';
    const items = [
        { icon: '🏥', label: 'Institución', value: instNombre },
        { icon: '📦', label: 'Gestión de insumos', value: 'Modelo híbrido — catálogo institucional + insumos por residente' },
        { icon: '🖥️', label: 'Modo de trabajo', value: modoLabel }
    ];

    const el = document.getElementById('onbSummary');
    if (el) {
        el.innerHTML = items.map(i => `
            <li>
                <span style="font-size:1.2rem;flex-shrink:0">${i.icon}</span>
                <div>
                    <div class="sum-label">${i.label}</div>
                    <div class="sum-value">${escapeHtml(i.value)}</div>
                </div>
            </li>`).join('');
    }
}

// ── Finalizar ──
async function onbFinish() {
    const btn = document.getElementById('onbFinishBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando...'; }

    try {
        // Guardar configuración en el backend (nombre/tipo/tel ya guardados en el registro)
        await API_B2B.updateInstitucion({
            shared_mode:     _onbData.modo_compartida,
            onboarding_done: true
        });

        // Actualizar el objeto usuario en localStorage
        const user = API_B2B.getUser();
        if (user) {
            user.onboarding_done = true;
            API_B2B.setUser(user);
        }

        // Activar Modo Estación Compartida si el usuario lo eligió
        if (_onbData.modo_compartida) {
            localStorage.setItem('cd_shared_mode', '1');
        }

        // Ir al dashboard
        window.location.href = 'dashboard.html';

    } catch (err) {
        _showAlert(err.message || 'Error al guardar la configuración. Intentá de nuevo.', 'danger');
        if (btn) { btn.disabled = false; btn.innerHTML = 'Ir al panel →'; }
    }
}

// ── Helpers ──
function _showAlert(msg, type = 'danger') {
    const icons = { danger: '❌', warning: '⚠️', info: 'ℹ️', success: '✅' };
    const el = document.getElementById('onbAlert');
    if (el) el.innerHTML = `<div class="alert alert-${type}"><span class="alert-icon">${icons[type]}</span>${escapeHtml(msg)}</div>`;
}
function _clearAlert() {
    const el = document.getElementById('onbAlert');
    if (el) el.innerHTML = '';
}
// ── Pantalla de verificación de email (bloquea el onboarding) ──
function _showEmailVerificationGate(email) {
    // Ocultar el wizard normal y el banner de bienvenida
    document.querySelectorAll('.onb-step, .onb-progress-wrap').forEach(el => el.style.display = 'none');
    const banner = document.querySelector('[style*="EEF2FF"]');
    if (banner) banner.style.display = 'none';

    const alertEl = document.getElementById('onbAlert');
    if (alertEl) {
        alertEl.style.padding = '20px 28px';
        alertEl.innerHTML = `
            <div style="text-align:center;padding:16px 0">
                <div style="width:56px;height:56px;background:#EFF6FF;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </div>
                <div style="font-weight:700;font-size:1rem;color:var(--text-primary);margin-bottom:8px">¿Recibiste el email de confirmación?</div>
                <p style="font-size:.88rem;color:var(--text-secondary);margin-bottom:6px;line-height:1.6">
                    Para activar tu cuenta, necesitás confirmar tu email.<br>
                    Enviamos un link a <strong>${escapeHtml(email || 'tu email')}</strong>.
                </p>
                <p style="font-size:.82rem;color:var(--text-secondary);margin-bottom:20px">
                    Si no lo ves, revisá la carpeta de <strong>spam</strong> o correo no deseado.
                </p>
                <div id="verifyGateAlert" style="margin-bottom:12px"></div>
                <button id="btnResendVerification" class="btn btn-primary" onclick="_resendVerificationEmail()" style="width:100%;margin-bottom:10px">
                    Reenviar email de confirmación
                </button>
                <p style="font-size:.78rem;color:var(--text-secondary)">
                    ¿Ya lo confirmaste? <span style="color:var(--pro-primary);cursor:pointer;text-decoration:underline" onclick="location.reload()">
                        Hacer clic aquí para continuar
                    </span>
                </p>
            </div>
        `;
    }
}

async function _resendVerificationEmail() {
    const btn = document.getElementById('btnResendVerification');
    const alertEl = document.getElementById('verifyGateAlert');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Enviando...'; }
    try {
        await API_B2B.post('/api/b2b/auth/resend-verification', {});
        if (alertEl) alertEl.innerHTML = '<div class="alert alert-success" style="font-size:.85rem"><span class="alert-icon">\u2705</span>Email enviado. Revisá tu bandeja de entrada y spam.</div>';
        if (btn) { btn.disabled = false; btn.innerHTML = 'Reenviar email de confirmación'; }
    } catch (err) {
        if (alertEl) alertEl.innerHTML = `<div class="alert alert-danger" style="font-size:.85rem"><span class="alert-icon">\u274C</span>${escapeHtml(err.message || 'Error al reenviar. Intentá de nuevo.')}</div>`;
        if (btn) { btn.disabled = false; btn.innerHTML = 'Reenviar email de confirmación'; }
    }
}