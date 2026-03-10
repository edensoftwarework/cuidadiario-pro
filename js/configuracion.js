/* ============================================================
   configuracion.js — Lógica de la página de configuración B2B
   CuidaDiario PRO
   ============================================================ */

'use strict';

async function initConfiguracion() {
    requireAuth();
    initSidebar();
    populateSidebarUser();

    const user = JSON.parse(localStorage.getItem('cd_pro_user') || '{}');
    const isAdmin = user.rol === 'admin_institucion';

    // Ocultar secciones de admin si no es admin
    if (!isAdmin) {
        document.querySelectorAll('.admin-only').forEach(el => {
            if (!el.classList.contains('nav-item') && !el.classList.contains('nav-section-label')) {
                el.style.display = 'none';
            }
        });
    }

    // Llenar perfil con datos del token
    document.getElementById('perfilNombre').value = user.nombre || '';
    document.getElementById('perfilEmail').value = user.email || '';
    document.getElementById('perfilRol').value = formatRol(user.rol);

    // Cargar datos de institución (solo admin)
    if (isAdmin) {
        cargarInstitucion();
    }
}

function formatRol(rol) {
    const map = {
        admin_institucion: 'Administrador',
        cuidador_staff: 'Personal / Operativo',
        familiar: 'Familiar',
        medico: 'Médico'
    };
    return map[rol] || rol || '';
}

async function cargarInstitucion() {
    try {
        const res = await API_B2B.get('/api/b2b/institucion');
        const inst = res.institucion || res;
        document.getElementById('instNombre').value = inst.nombre || '';
        document.getElementById('instTipo').value = inst.tipo || '';
        document.getElementById('instTelefono').value = inst.telefono || '';
        document.getElementById('instEmail').value = inst.email || '';
        document.getElementById('instDireccion').value = inst.direccion || '';

        // Actualizar nombre en topbar
        if (inst.nombre) {
            const tb = document.getElementById('topbarInstitucion');
            if (tb) tb.textContent = inst.nombre;
        }
    } catch (e) {
        // silencioso — puede fallar en roles no admin
    }
}

async function guardarPerfil(e) {
    e.preventDefault();
    const form = e.target;
    const nombre = form.nombre.value.trim();
    const email = form.email.value.trim();

    if (!nombre || !email) {
        showToast('Completá nombre y email', 'warning');
        return;
    }

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        await API_B2B.patch('/api/b2b/auth/me', { nombre, email });

        // Actualizar datos locales
        const user = JSON.parse(localStorage.getItem('cd_pro_user') || '{}');
        user.nombre = nombre;
        user.email = email;
        localStorage.setItem('cd_pro_user', JSON.stringify(user));

        // Refrescar sidebar
        populateSidebarUser();
        showToast('Perfil actualizado ✅', 'success');
    } catch (err) {
        showToast(err.message || 'Error al guardar perfil', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar perfil';
    }
}

async function cambiarPassword(e) {
    e.preventDefault();
    const form = e.target;
    const passwordActual = form.passwordActual.value;
    const passwordNueva = form.passwordNueva.value;
    const passwordConfirm = form.passwordConfirm.value;

    if (!passwordActual || !passwordNueva) {
        showToast('Completá todos los campos', 'warning');
        return;
    }
    if (passwordNueva !== passwordConfirm) {
        showToast('Las contraseñas no coinciden', 'error');
        return;
    }
    if (passwordNueva.length < 6) {
        showToast('La contraseña debe tener al menos 6 caracteres', 'warning');
        return;
    }

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        await API_B2B.patch('/api/b2b/auth/me', { password_actual: passwordActual, password_nueva: passwordNueva });
        showToast('Contraseña actualizada ✅', 'success');
        form.reset();
    } catch (err) {
        showToast(err.message || 'Error al cambiar contraseña', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Cambiar contraseña';
    }
}

async function guardarInstitucion(e) {
    e.preventDefault();
    const form = e.target;
    const payload = {
        nombre: form.nombre.value.trim(),
        tipo: form.tipo.value,
        telefono: form.telefono.value.trim(),
        email: form.email.value.trim(),
        direccion: form.direccion.value.trim()
    };

    if (!payload.nombre) {
        showToast('El nombre de la institución es obligatorio', 'warning');
        return;
    }

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        await API_B2B.patch('/api/b2b/institucion', payload);
        showToast('Institución actualizada ✅', 'success');

        const tb = document.getElementById('topbarInstitucion');
        if (tb) tb.textContent = payload.nombre;
    } catch (err) {
        showToast(err.message || 'Error al guardar institución', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar institución';
    }
}

async function exportarDatos() {
    showToast('Generando exportación...', 'info');
    try {
        const res = await API_B2B.get('/api/b2b/reporte/export');
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

document.addEventListener('DOMContentLoaded', initConfiguracion);
