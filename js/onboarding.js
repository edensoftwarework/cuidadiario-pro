/**
 * onboarding.js — Wizard de configuración inicial para nuevas instituciones
 * Se muestra una única vez luego del registro o primer login.
 * by EDEN SoftWork
 */

// ── Estado del wizard ──
let _currentStep = 1;
const TOTAL_STEPS = 4;

// Datos recopilados
const _onbData = {
    nombre: '',
    tipo: '',
    telefono: '',
    direccion: '',
    stock_modelo: 'institucional',
    modo_compartida: false
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

    // Prellenar con el nombre de la institución que ya está guardado (si existe)
    if (user?.institucion_nombre) {
        const el = document.getElementById('onbNombre');
        if (el) el.value = user.institucion_nombre;
    }

    // Listeners de las option-cards (stock model)
    _setupOptionCards('stockModelo', ['optInstitucion', 'optFamiliar'], (val) => {
        _onbData.stock_modelo = val;
    });
    // Listeners de las option-cards (modo operación)
    _setupOptionCards('modoOp', ['optIndividual', 'optCompartida'], (val) => {
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
        const nombre = document.getElementById('onbNombre')?.value?.trim();
        if (!nombre) {
            _showAlert('El nombre de la institución es obligatorio.', 'danger');
            document.getElementById('onbNombre')?.focus();
            return;
        }
        _onbData.nombre     = nombre;
        _onbData.tipo       = document.getElementById('onbTipo')?.value || '';
        _onbData.telefono   = document.getElementById('onbTelefono')?.value?.trim() || '';
        _onbData.direccion  = document.getElementById('onbDireccion')?.value?.trim() || '';
    }
    if (fromStep === 2) {
        _onbData.stock_modelo = document.querySelector('input[name="stockModelo"]:checked')?.value || 'institucional';
    }
    if (fromStep === 3) {
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

// ── Resumen del paso 4 ──
function _buildSummary() {
    const tipoLabel = {
        residencia_adultos_mayores: 'Residencia de adultos mayores',
        clinica_rehabilitacion: 'Clínica de rehabilitación',
        hogar_cuidados: 'Hogar de cuidados',
        hospital: 'Hospital / Sanatorio',
        centro_dia: 'Centro de día',
        otro: 'Otro',
        '': 'No especificado'
    };
    const stockLabel = {
        institucional: '🏥 Stock institucional (la institución provee)',
        familiar: '👨‍👩‍👧 Stock por paciente (la familia provee)'
    };
    const modoLabel = _onbData.modo_compartida
        ? '🖥️ Estación compartida (se activará al finalizar)'
        : '👤 Acceso individual por cuenta';

    const items = [
        { icon: '🏥', label: 'Institución', value: _onbData.nombre },
        { icon: '📋', label: 'Tipo', value: tipoLabel[_onbData.tipo] || 'No especificado' },
        { icon: '💊', label: 'Medicamentos', value: stockLabel[_onbData.stock_modelo] || _onbData.stock_modelo },
        { icon: '🖥️', label: 'Modo de trabajo', value: modoLabel }
    ];
    if (_onbData.telefono) items.push({ icon: '📞', label: 'Teléfono', value: _onbData.telefono });
    if (_onbData.direccion) items.push({ icon: '📍', label: 'Dirección', value: _onbData.direccion });

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
        // Guardar configuración en el backend
        await API_B2B.updateInstitucion({
            nombre:         _onbData.nombre,
            tipo:           _onbData.tipo || undefined,
            telefono:       _onbData.telefono || undefined,
            direccion:      _onbData.direccion || undefined,
            stock_modelo:   _onbData.stock_modelo,
            onboarding_done: true
        });

        // Actualizar el objeto usuario en localStorage
        const user = API_B2B.getUser();
        if (user) {
            user.onboarding_done        = true;
            user.institucion_nombre     = _onbData.nombre;
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
