/**
 * api-b2b.js — Cliente API para CuidaDiario PRO (B2B)
 * by EDEN SoftWork
 *
 * Todas las comunicaciones con /api/b2b/* del backend
 */

const API_B2B = {
    BASE_URL: 'https://cuidadiario-backend-production.up.railway.app',
    TOKEN_KEY:     'cd_pro_token',
    USER_KEY:      'cd_pro_user',
    LAST_USER_KEY: 'cd_pro_last_user',   // legacy P0-2 cleanup target; no longer written or restored
    ACTIVE_WORKER_KEY: 'cd_active_worker',
    OPERATOR_TOKEN_KEY: 'cd_operator_token',
    OPERATOR_CONTEXT_KEY: 'cd_operator_context',
    OPERATOR_ACTIVITY_KEY: 'cd_operator_last_activity',
    OPERATOR_IDLE_MS: 60 * 60 * 1000,
    _operatorChannel: null,

    // ---------- Auth storage ----------
    getToken()  { return localStorage.getItem(this.TOKEN_KEY); },
    setToken(t) { localStorage.setItem(this.TOKEN_KEY, t); },
    removeToken() {
        this.clearOperatorContext('session-ended', true);
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
        localStorage.removeItem(this.LAST_USER_KEY);
        try { sessionStorage.removeItem(this.ACTIVE_WORKER_KEY); } catch {}
        this.purgeLegacyGetCache();
    },
    getPrincipalUser() { const u = localStorage.getItem(this.USER_KEY); return u ? JSON.parse(u) : null; },
    getUser() {
        const principal = this.getPrincipalUser();
        const operator = this.getOperatorContext();
        if (!principal || !operator || !principal.shared_mode) return principal;
        return {
            ...principal,
            principal_nombre: principal.nombre,
            nombre: operator.nombre,
            rol: operator.rol,
            operador_b2b_id: operator.id,
        };
    },
    setUser(u)  { localStorage.setItem(this.USER_KEY, JSON.stringify(u)); },
    getOperatorToken() { try { return sessionStorage.getItem(this.OPERATOR_TOKEN_KEY); } catch { return null; } },
    getOperatorContext() {
        try {
            const raw = sessionStorage.getItem(this.OPERATOR_CONTEXT_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed?.id || !parsed?.expires_at || new Date(parsed.expires_at).getTime() <= Date.now()) {
                this.clearOperatorContext('expired', false);
                return null;
            }
            return parsed;
        } catch { return null; }
    },
    setOperatorContext(token, operator, expiresAt) {
        sessionStorage.removeItem(this.ACTIVE_WORKER_KEY);
        sessionStorage.setItem(this.OPERATOR_TOKEN_KEY, token);
        sessionStorage.setItem(this.OPERATOR_CONTEXT_KEY, JSON.stringify({ ...operator, expires_at: expiresAt }));
        sessionStorage.setItem(this.OPERATOR_ACTIVITY_KEY, String(Date.now()));
        this._broadcastOperatorEvent('operator-changed');
    },
    clearOperatorContext(reason = 'cleared', broadcast = false) {
        try {
            sessionStorage.removeItem(this.OPERATOR_TOKEN_KEY);
            sessionStorage.removeItem(this.OPERATOR_CONTEXT_KEY);
            sessionStorage.removeItem(this.OPERATOR_ACTIVITY_KEY);
            sessionStorage.removeItem(this.ACTIVE_WORKER_KEY);
        } catch {}
        if (broadcast) this._broadcastOperatorEvent(reason);
        try { window.dispatchEvent(new CustomEvent('b2b:operator-cleared', { detail: { reason } })); } catch {}
    },
    _broadcastOperatorEvent(reason) {
        try { this._operatorChannel?.postMessage({ type: 'invalidate', reason, at: Date.now() }); } catch {}
    },
    initOperatorLifecycle() {
        const principal = this.getPrincipalUser();
        if (!principal?.shared_mode) return;
        try {
            if (typeof BroadcastChannel === 'function' && !this._operatorChannel) {
                this._operatorChannel = new BroadcastChannel('cuidadiario-b2b-operator');
                this._operatorChannel.addEventListener('message', event => {
                    if (event.data?.type === 'invalidate') this.clearOperatorContext(event.data.reason || 'other-tab', false);
                });
            }
        } catch {}
        const markActivity = () => {
            if (this.getOperatorToken()) sessionStorage.setItem(this.OPERATOR_ACTIVITY_KEY, String(Date.now()));
        };
        ['pointerdown', 'keydown', 'touchstart'].forEach(name => window.addEventListener(name, markActivity, { passive: true }));
        setInterval(() => {
            const token = this.getOperatorToken();
            if (!token) return;
            const last = Number(sessionStorage.getItem(this.OPERATOR_ACTIVITY_KEY) || 0);
            if (!last || Date.now() - last >= this.OPERATOR_IDLE_MS) this.endOperatorShift('idle');
        }, 30000);
    },
    isAuth() {
        const token = this.getToken();
        if (!token) return false;
        try {
            const parts = token.split('.');
            if (parts.length !== 3 || parts.some(part => !part)) return false;
            const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
            const payload = JSON.parse(atob(padded));
            const now = Math.floor(Date.now() / 1000);
            return payload.b2b === true
                && Number.isFinite(payload.exp)
                && payload.exp > now
                && (!Number.isFinite(payload.nbf) || payload.nbf <= now);
        } catch {
            return false;
        }
    },

    // ---------- Headers ----------
    headers(auth = true, includeOperator = true) {
        const h = { 'Content-Type': 'application/json' };
        if (auth) { const t = this.getToken(); if (t) h['Authorization'] = `Bearer ${t}`; }
        if (auth && includeOperator) { const t = this.getOperatorToken(); if (t) h['X-B2B-Operator-Token'] = t; }
        return h;
    },

    // ---------- Error handler ----------
    async handle(res) {
        if (res.status === 401) {
            this.removeToken();

            // If NOT on login page → session expired while using the app → redirect to login.
            // If ON login page → this is a wrong-credentials error, show it to the user.
            const isLoginPage = window.location.pathname.endsWith('login.html');
            if (!isLoginPage) {
                const inPages = window.location.pathname.includes('/pages/');
                window.location.href = (inPages ? '../' : '') + 'login.html?expired=1';
                throw new Error('Sesión expirada.'); // prevent caller from continuing
            }

            let msg = 'Email o contraseña incorrectos. Verificá tus datos.';
            try { const e = await res.json(); msg = e.error || msg; } catch {}
            throw new Error(msg);
        }
        if (!res.ok) {
            let msg = `Error ${res.status}`;
            let code = null;
            let extra = {};
            try {
                const e = await res.json();
                msg = e.error || msg;
                code = e.code || null;
                extra = { pacientes_count: e.pacientes_count, staff_count: e.staff_count, can_use_basico: e.can_use_basico };
            } catch {}
            if (code === 'OPERATOR_REQUIRED') {
                this.clearOperatorContext('operator-required', true);
                try { window.dispatchEvent(new CustomEvent('b2b:operator-required')); } catch {}
            }
            const apiErr = new Error(msg);
            if (code) apiErr.code = code;
            Object.assign(apiErr, extra);
            // Si el trial expiró, mostrar el overlay de bloqueo automáticamente
            if (code === 'TRIAL_EXPIRED' && typeof _showTrialExpiredOverlay === 'function') {
                const user = this.getUser() || {};
                _showTrialExpiredOverlay({ ...user, _pacientes_count: extra.pacientes_count, _staff_count: extra.staff_count });
            }
            throw apiErr;
        }
        return res.json();
    },

    // ---------- Network-safe fetch wrapper ----------
    async _fetch(url, opts) {
        try { return await fetch(url, opts); }
        catch { throw new Error('Sin conexión. Verificá tu internet e intentá nuevamente.'); }
    },

    // ---------- Legacy GET cache cleanup ----------
    // GET responses are network-only now. Remove only legacy keys whose encoded
    // path belongs to /api/b2b and preserve every other localStorage entry
    // (session/offline queue/preferences are separate P0s).
    purgeLegacyGetCache() {
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key === 'cd_api_/api/b2b' || key.startsWith('cd_api_/api/b2b/'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
        } catch {}
    },

    async get(path) {
        return this.handle(await this._fetch(`${this.BASE_URL}${path}`, { headers: this.headers() }));
    },
    async download(path) {
        const response = await this._fetch(`${this.BASE_URL}${path}`, {
            headers: this.headers(),
            cache: 'no-store',
        });
        if (!response.ok) return this.handle(response);
        const disposition = response.headers.get('Content-Disposition') || '';
        const utf8Name = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
        const fallbackName = /filename="?([^";]+)"?/i.exec(disposition);
        let filename = 'cuidadiario-export-institucional.zip';
        try {
            filename = decodeURIComponent(utf8Name?.[1] || fallbackName?.[1] || filename);
        } catch {}
        filename = filename.replace(/[\\/:*?"<>\r\n|]+/g, '-');
        return { blob: await response.blob(), filename };
    },
    // ---------- B2B writes (network-only) ----------
    // P0-3: any pre-existing cd_offline_queue value is intentionally quarantined.
    // This client never reads, writes, parses, migrates, deletes or transmits it.
    async post(path, body, options = {}) {
        const headers = { ...this.headers(), ...(options.headers || {}) };
        return this.handle(await this._fetch(`${this.BASE_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
    },
    createIdempotencyKey() {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
            return globalThis.crypto.randomUUID();
        }
        // Fallback only for older browsers; it remains a per-attempt opaque UUID.
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.floor(Math.random() * 16);
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
    },
    idempotencyOptions(key) {
        return { headers: { 'Idempotency-Key': key || this.createIdempotencyKey() } };
    },
    async patch(path, body) {
        return this.handle(await this._fetch(`${this.BASE_URL}${path}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(body) }));
    },
    async del(path) {
        return this.handle(await this._fetch(`${this.BASE_URL}${path}`, { method: 'DELETE', headers: this.headers() }));
    },
    async postNoAuth(path, body) { return this.handle(await this._fetch(`${this.BASE_URL}${path}`, { method:'POST', headers: this.headers(false), body: JSON.stringify(body) })); },

    // ============================================
    // AUTH
    // ============================================
    async register(data)          { const r = await this.postNoAuth('/api/b2b/auth/register', data); this.setToken(r.token); this.setUser(r.user); return r; },
    async login(email, password)  {
        const r = await this.postNoAuth('/api/b2b/auth/login', { email, password });
        this.setToken(r.token);
        this.setUser(r.user);
        // Sincronizar configuración de la institución al localStorage para persistencia cross-device
        if (r.user) {
            if (r.user.stock_modelo) localStorage.setItem('stock_modelo', r.user.stock_modelo);
            if (r.user.shared_mode) {
                localStorage.setItem('cd_shared_mode', '1');
            } else {
                localStorage.removeItem('cd_shared_mode');
            }
        }
        return r;
    },
    async getMe()                 { return this.get('/api/b2b/auth/me'); },
    async updateMe(data)          { return this.patch('/api/b2b/auth/me', data); },
    async forgotPassword(email)   { return this.postNoAuth('/api/b2b/auth/forgot-password', { email }); },
    async resetPassword(token, password) { return this.postNoAuth('/api/b2b/auth/reset-password', { token, password }); },
    logout() {
        const operatorToken = this.getOperatorToken();
        if (operatorToken && this.getToken()) {
            this._fetch(`${this.BASE_URL}/api/b2b/operators/end-shift`, {
                method: 'POST', headers: this.headers(true, true), body: '{}', keepalive: true,
            }).catch(() => {});
        }
        this.removeToken();
        window.location.href = (window.location.pathname.includes('/pages/') ? '../' : '') + 'login.html';
    },

    // ============================================
    // OPERADORES DE ESTACIÓN COMPARTIDA (P1-C)
    // ============================================
    async getOperators(administrative = false) {
        const suffix = administrative ? '?all=1' : '';
        return this.handle(await this._fetch(`${this.BASE_URL}/api/b2b/operators${suffix}`, { headers: this.headers(true, false) }));
    },
    async createOperator(data) {
        return this.handle(await this._fetch(`${this.BASE_URL}/api/b2b/operators`, {
            method: 'POST', headers: this.headers(true, false), body: JSON.stringify(data),
        }));
    },
    async updateOperator(id, data) {
        return this.handle(await this._fetch(`${this.BASE_URL}/api/b2b/operators/${id}`, {
            method: 'PATCH', headers: this.headers(true, false), body: JSON.stringify(data),
        }));
    },
    async activateOperator(operatorId, pin) {
        const rawResponse = await this._fetch(`${this.BASE_URL}/api/b2b/operators/activate`, {
            method: 'POST', headers: this.headers(true, false), body: JSON.stringify({ operator_id: operatorId, pin }),
        });
        if (rawResponse.status === 401) {
            let operatorError = null;
            try { operatorError = await rawResponse.clone().json(); } catch {}
            if (operatorError?.code === 'OPERATOR_PIN_INVALID') {
                const error = new Error(operatorError.error || 'Operador o PIN inválido');
                error.code = operatorError.code;
                throw error;
            }
        }
        const response = await this.handle(rawResponse);
        this.setOperatorContext(response.operator_token, response.operator, response.expires_at);
        return response.operator;
    },
    async validateOperatorContext() {
        if (!this.getOperatorToken()) return null;
        const response = await this.handle(await this._fetch(`${this.BASE_URL}/api/b2b/operators/context`, { headers: this.headers() }));
        return response.operator;
    },
    async endOperatorShift(reason = 'manual') {
        const hadToken = !!this.getOperatorToken();
        try {
            if (hadToken && this.getToken()) {
                await this._fetch(`${this.BASE_URL}/api/b2b/operators/end-shift`, {
                    method: 'POST', headers: this.headers(), body: JSON.stringify({ reason }),
                });
            }
        } catch {}
        this.clearOperatorContext(reason, true);
    },

    // ============================================
    // INSTITUCIÓN
    // ============================================
    async getInstitucion()        { return this.get('/api/b2b/institucion'); },
    async updateInstitucion(data) { return this.patch('/api/b2b/institucion', data); },

    // ============================================
    // STAFF
    // ============================================
    async getStaff()              { return this.get('/api/b2b/staff'); },
    async createStaff(data)       { return this.post('/api/b2b/staff', data); },
    async updateStaff(id, data)   { return this.patch(`/api/b2b/staff/${id}`, data); },
    async deleteStaff(id)         { return this.del(`/api/b2b/staff/${id}`); },

    // ============================================
    // PACIENTES
    // ============================================
    async getPacientes(params)    { const qs = params ? '?' + new URLSearchParams(params).toString() : ''; return this.get('/api/b2b/pacientes' + qs); },
    async getPaciente(id)         { return this.get(`/api/b2b/pacientes/${id}`); },
    async createPaciente(data)    { return this.post('/api/b2b/pacientes', data); },
    async updatePaciente(id, d)   { return this.patch(`/api/b2b/pacientes/${id}`, d); },
    async deletePaciente(id)      { return this.del(`/api/b2b/pacientes/${id}`); },

    // ============================================
    // ASIGNACIONES
    // ============================================
    async getAsignaciones()       { return this.get('/api/b2b/asignaciones'); },
    async createAsignacion(data)  { return this.post('/api/b2b/asignaciones', data); },
    async deleteAsignacion(id)    { return this.del(`/api/b2b/asignaciones/${id}`); },

    // ============================================
    // MEDICAMENTOS
    // ============================================
    async getMedicamentos(paciente_id)    { return this.get(`/api/b2b/medicamentos?paciente_id=${paciente_id}`); },
    async createMedicamento(data)         { return this.post('/api/b2b/medicamentos', data); },
    async updateMedicamento(id, data)     { return this.patch(`/api/b2b/medicamentos/${id}`, data); },
    async deleteMedicamento(id)           { return this.del(`/api/b2b/medicamentos/${id}`); },
    async registrarToma(id, notas, cantidad, idempotencyKey) {
        return this.post(`/api/b2b/medicamentos/${id}/toma`,
            { notas, cantidad: cantidad || 1 },
            this.idempotencyOptions(idempotencyKey));
    },
    async getHistorialMeds(paciente_id)   { return this.get(`/api/b2b/medicamentos/historial?paciente_id=${paciente_id}`); },

    // ============================================
    // CATÁLOGO DE INSUMOS (modelo híbrido)
    // getCatalogo()                  → insumos institucionales generales
    // getCatalogo({paciente_id: X})  → insumos específicos del paciente X
    // ============================================
    async getCatalogo(params = {}) {
        let url = '/api/b2b/catalogo';
        const qs = new URLSearchParams();
        if (params.paciente_id) qs.set('paciente_id', params.paciente_id);
        const q = qs.toString();
        if (q) url += '?' + q;
        return this.get(url);
    },
    async getCatalogoStockBajo()          { return this.get('/api/b2b/catalogo/stock-bajo'); },
    async createCatalogoItem(data)        { return this.post('/api/b2b/catalogo', data); },
    async updateCatalogoItem(id, data)    { return this.patch(`/api/b2b/catalogo/${id}`, data); },
    async deleteCatalogoItem(id)          { return this.del(`/api/b2b/catalogo/${id}`); },
    async getRestockHistorial(params = {}) {
        const qs = new URLSearchParams();
        if (params.catalogo_id) qs.set('catalogo_id', params.catalogo_id);
        if (params.paciente_id) qs.set('paciente_id', params.paciente_id);
        const q = qs.toString();
        return this.get('/api/b2b/catalogo/restock-historial' + (q ? '?' + q : ''));
    },

    // ============================================
    // NOTIFICACIONES (campana)
    // ============================================
    async getNotificaciones()      { return this.get('/api/b2b/notificaciones'); },
    async marcarNotifVistas()      { return this.post('/api/b2b/notificaciones/vistas', {}); },

    // ============================================
    // CITAS
    // ============================================
    async getCitas(paciente_id)          { return this.get(`/api/b2b/citas?paciente_id=${paciente_id}`); },
    async createCita(data)               { return this.post('/api/b2b/citas', data); },
    async updateCita(id, data)           { return this.patch(`/api/b2b/citas/${id}`, data); },
    async deleteCita(id)                 { return this.del(`/api/b2b/citas/${id}`); },
    async getCitasHistorial(paciente_id) { return this.get(`/api/b2b/citas/historial?paciente_id=${paciente_id}`); },

    // ============================================
    // TAREAS
    // ============================================
    async getTareas(paciente_id)  { return this.get(`/api/b2b/tareas?paciente_id=${paciente_id}`); },
    async createTarea(data)       { return this.post('/api/b2b/tareas', data); },
    async updateTarea(id, data)   { return this.patch(`/api/b2b/tareas/${id}`, data); },
    async deleteTarea(id)         { return this.del(`/api/b2b/tareas/${id}`); },
    async completarTarea(id, notas, idempotencyKey) {
        return this.post(`/api/b2b/tareas/${id}/completar`,
            { notas },
            this.idempotencyOptions(idempotencyKey));
    },
    async getHistorialTareas(pid) { return this.get(`/api/b2b/tareas/historial?paciente_id=${pid}`); },

    // ============================================
    // SÍNTOMAS
    // ============================================
    async getSintomas(paciente_id)  { return this.get(`/api/b2b/sintomas?paciente_id=${paciente_id}`); },
    async createSintoma(data)       { return this.post('/api/b2b/sintomas', data); },
    async updateSintoma(id, data)   { return this.patch(`/api/b2b/sintomas/${id}`, data); },
    async deleteSintoma(id)         { return this.del(`/api/b2b/sintomas/${id}`); },

    // ============================================
    // SIGNOS VITALES
    // ============================================
    async getSignos(paciente_id, tipo) {
        let url = `/api/b2b/signos-vitales?paciente_id=${paciente_id}`;
        if (tipo) url += `&tipo=${encodeURIComponent(tipo)}`;
        return this.get(url);
    },
    async createSigno(data)  { return this.post('/api/b2b/signos-vitales', data); },
    async deleteSigno(id)    { return this.del(`/api/b2b/signos-vitales/${id}`); },

    // ============================================
    // CONTACTOS
    // ============================================
    async getContactos(paciente_id) { return this.get(`/api/b2b/contactos?paciente_id=${paciente_id}`); },
    async createContacto(data)      { return this.post('/api/b2b/contactos', data); },
    async updateContacto(id, data)  { return this.patch(`/api/b2b/contactos/${id}`, data); },
    async deleteContacto(id)        { return this.del(`/api/b2b/contactos/${id}`); },

    // ============================================
    // NOTAS INTERNAS
    // ============================================
    async getNotas(paciente_id) { return this.get(`/api/b2b/notas?paciente_id=${paciente_id}`); },
    async createNota(data)      { return this.post('/api/b2b/notas', data); },
    async updateNota(id, data)  { return this.patch(`/api/b2b/notas/${id}`, data); },
    async deleteNota(id)        { return this.del(`/api/b2b/notas/${id}`); },

    // ============================================
    // DASHBOARD & REPORTES
    // ============================================
    async getDashboard()                              { return this.get('/api/b2b/dashboard'); },
    async getReporte(paciente_id, params = {})        {
        let url = `/api/b2b/reportes?paciente_id=${paciente_id}`;
        if (params.desde) url += `&desde=${encodeURIComponent(params.desde)}`;
        if (params.hasta) url += `&hasta=${encodeURIComponent(params.hasta)}`;
        return this.get(url);
    },

    // ============================================
    // ALERTAS DEL DASHBOARD (notif prefs)
    // ============================================
    async getNotifPrefs()       { return this.get('/api/b2b/me/notif-prefs'); },
    async saveNotifPrefs(prefs) { return this.patch('/api/b2b/me/notif-prefs', prefs); },

    // ============================================
    // SUSCRIPCIÓN / PLAN (MercadoPago)
    // ============================================
    async createSubscription(plan = 'pro', testMode = false) {
        return this.post('/api/b2b/create-subscription', { plan, test_mode: testMode });
    },
    async verifySubscription(preapprovalId = null) {
        const url = preapprovalId
            ? `/api/b2b/verify-subscription?preapproval_id=${encodeURIComponent(preapprovalId)}`
            : '/api/b2b/verify-subscription';
        return this.get(url);
    },
    async cancelSubscription() {
        return this.post('/api/b2b/cancel-subscription', {});
    },

    // ============================================
    // DOCUMENTOS ADJUNTOS
    // ============================================
    async getDocumentos(paciente_id)  { return this.get(`/api/b2b/documentos?paciente_id=${paciente_id}`); },
    async uploadDocumento(data, idempotencyKey) {
        return this.post('/api/b2b/documentos', data, this.idempotencyOptions(idempotencyKey));
    },
    async deleteDocumento(id)         { return this.del(`/api/b2b/documentos/${id}`); },
    // Descarga con auth header → blob → dispara descarga en el navegador
    async downloadDocumento(id, nombre_archivo) {
        const url = `${this.BASE_URL}/api/b2b/documentos/${id}/download`;
        const res = await this._fetch(url, { headers: this.headers() });
        if (!res.ok) {
            let msg = `Error ${res.status}`;
            try { const e = await res.json(); msg = e.error || msg; } catch {}
            throw new Error(msg);
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nombre_archivo || 'documento';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
};

// P0-2: retire the legacy offline identity. A locally usable B2B token is required
// to keep the active identity; authenticity remains enforced by the backend.
(function _enforceAuthenticatedSession() {
    try {
        if (!API_B2B.isAuth()) API_B2B.removeToken();
        else localStorage.removeItem(API_B2B.LAST_USER_KEY);
    } catch {}
})();

// P0-1 remains active: remove only legacy /api/b2b GET responses.
API_B2B.purgeLegacyGetCache();
API_B2B.initOperatorLifecycle();

// ============================================
// SERVICE WORKER REGISTRATION
// ============================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Detect path depth to find sw.js root
        const isInSubdir = window.location.pathname.includes('/pages/');
        const swPath = isInSubdir ? '../sw.js' : './sw.js';
        const scope  = isInSubdir ? '../'      : './';
        navigator.serviceWorker.register(swPath, { scope })
            .then(reg => {
                // Check for SW updates
                reg.addEventListener('updatefound', () => {
                    const newSW = reg.installing;
                    if (newSW) {
                        newSW.addEventListener('statechange', () => {
                            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                                console.log('[SW] Nueva versión disponible');
                            }
                        });
                    }
                });
            })
            .catch(err => console.warn('[SW] Registro fallido:', err));
    });
}

