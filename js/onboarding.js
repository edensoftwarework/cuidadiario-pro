/**
 * onboarding.js — Wizard de configuración inicial para nuevas instituciones
 * Se muestra una única vez luego del registro o primer login.
 * by EDEN SoftWork
 */

// ── Estado del wizard ──
let _currentStep = 1;
const TOTAL_STEPS = 3;

// Datos recopilados en el wizard
// (nombre, tipo, teléfono ya se guardaron en el registro)
const _onbData = {
    stock_modelo: 'institucion',
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

    // Listeners de las option-cards (stock model)
    _setupOptionCards('stockModelo', ['optInstitucion', 'optFamiliar'], (val) => {
        _onbData.stock_modelo = val;
    });
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
    if (fromStep === 1) {
        _onbData.stock_modelo = document.querySelector('input[name="stockModelo"]:checked')?.value || 'institucion';
    }
    if (fromStep === 2) {
        _onbData.modo_compartida = (document.querySelector('input[name="modoOp"]:checked')?.value || 'individual') === 'compartida';
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

// ── Resumen del paso 3 ──
function _buildSummary() {
    const stockLabel = {
        institucion: '🏥 Stock institucional (la institución provee)',
        familiar: '👨‍👩‍👧 Stock por paciente (la familia provee)'
    };
    const modoLabel = _onbData.modo_compartida
        ? '🖥️ Estación compartida (se activará al finalizar)'
        : '👤 Acceso individual por cuenta';

    const instNombre = API_B2B.getUser()?.institucion_nombre || 'Tu institución';
    const items = [
        { icon: '🏥', label: 'Institución', value: instNombre },
        { icon: '💊', label: 'Medicamentos', value: stockLabel[_onbData.stock_modelo] || _onbData.stock_modelo },
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
            stock_modelo:    _onbData.stock_modelo,
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
