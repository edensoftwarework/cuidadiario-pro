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
    LAST_USER_KEY: 'cd_pro_last_user',   // survives token expiry — used for offline login recovery

    // ---------- Auth storage ----------
    getToken()  { return localStorage.getItem(this.TOKEN_KEY); },
    setToken(t) { localStorage.setItem(this.TOKEN_KEY, t); },
    // removeToken: clears active session but keeps LAST_USER_KEY so offline login can recover
    removeToken(){ localStorage.removeItem(this.TOKEN_KEY); localStorage.removeItem(this.USER_KEY); },
    getUser()      { const u = localStorage.getItem(this.USER_KEY);      return u ? JSON.parse(u) : null; },
    // Falls back to USER_KEY for backward compat (sessions created before LAST_USER_KEY existed)
    getLastUser()  {
        const u = localStorage.getItem(this.LAST_USER_KEY) || localStorage.getItem(this.USER_KEY);
        return u ? JSON.parse(u) : null;
    },
    setUser(u)  {
        const s = JSON.stringify(u);
        localStorage.setItem(this.USER_KEY, s);
        localStorage.setItem(this.LAST_USER_KEY, s); // always keep a persistent copy
    },
    isAuth()    { return !!this.getToken(); },

    // ---------- Headers ----------
    headers(auth = true) {
        const h = { 'Content-Type': 'application/json' };
        if (auth) { const t = this.getToken(); if (t) h['Authorization'] = `Bearer ${t}`; }
        return h;
    },

    // ---------- Error handler ----------
    async handle(res) {
        if (res.status === 401) {
            // Always preserve the user for offline recovery before clearing the session.
            const currUser = localStorage.getItem(this.USER_KEY);
            if (currUser) localStorage.setItem(this.LAST_USER_KEY, currUser);
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

    // ---------- Offline cache (localStorage) ----------
    _offlineCache: {
        _key(path) { return 'cd_api_' + path.replace(/[^a-z0-9_/-]/gi, '_'); },
        get(path)        { try { const v = localStorage.getItem(this._key(path)); return v ? JSON.parse(v) : null; } catch { return null; } },
        set(path, data)  { try { localStorage.setItem(this._key(path), JSON.stringify(data)); } catch {} }
    },

    async get(path) {
        try {
            const data = await this.handle(await this._fetch(`${this.BASE_URL}${path}`, { headers: this.headers() }));
            this._offlineCache.set(path, data); // guardar para uso offline
            return data;
        } catch (err) {
            const isOffline = !navigator.onLine || (err.message && err.message.includes('Sin conexi'));
            if (isOffline) {
                const cached = this._offlineCache.get(path);
                if (cached !== null) {
                    console.info('[API offline] Sirviendo desde caché local:', path);
                    return cached;
                }
            }
            throw err;
        }
    },
    // ---------- Offline Write Queue ----------
    _offlineQueue: {
        _key: 'cd_offline_queue',
        get()       { try { return JSON.parse(localStorage.getItem(this._key) || '[]'); } catch { return []; } },
        add(op)     { const q = this.get(); q.push({ ...op, _qid: Date.now() + '_' + Math.random().toString(36).slice(2), _queued_at: new Date().toISOString() }); try { localStorage.setItem(this._key, JSON.stringify(q)); } catch {} },
        remove(qid) { try { const q = this.get().filter(o => o._qid !== qid); localStorage.setItem(this._key, JSON.stringify(q)); } catch {} },
        count()     { return this.get().length; },
    },

    async _syncOfflineQueue() {
        const queue = this._offlineQueue.get();
        if (!queue.length) return;
        let synced = 0, failed = 0;
        for (const op of queue) {
            try {
                // Call _fetch directly — avoids re-triggering the navigator.onLine check inside
                // post/patch/del which would re-queue the item and cause duplication.
                const url  = `${this.BASE_URL}${op.path}`;
                const opts = { method: op.method, headers: this.headers() };
                if (op.body && op.method !== 'DELETE') {
                    // Inject the original registration timestamp so the backend
                    // can store when the action was actually performed offline,
                    // not when the sync request arrives at the server.
                    const bodyWithTs = op._queued_at
                        ? { ...op.body, _offline_ts: op._queued_at }
                        : op.body;
                    opts.body = JSON.stringify(bodyWithTs);
                }
                const res = await this._fetch(url, opts);
                // 401 mid-sync → token expired — stop without redirecting; items stay in queue.
                // The user will see a toast and can re-login to trigger sync again.
                if (res.status === 401) {
                    if (typeof showToast === 'function') showToast('⚠️ Sesión expirada. Iniciá sesión para sincronizar los cambios pendientes.', 'warning');
                    return;
                }
                // 404 on DELETE → item already gone from server, treat as success
                if (op.method === 'DELETE' && res.status === 404) {
                    this._offlineQueue.remove(op._qid); synced++; continue;
                }
                await this.handle(res);
                this._offlineQueue.remove(op._qid);
                synced++;
            } catch (e) {
                // Network still down → stop immediately and schedule retry
                if (e.message && e.message.includes('Sin conexi')) {
                    setTimeout(() => { if (navigator.onLine) this._syncOfflineQueue(); }, 30_000);
                    return;
                }
                failed++; // server-side error (4xx/5xx) — log and continue with next item
            }
        }
        if (synced > 0 && typeof showToast === 'function') showToast(`✅ ${synced} ${synced > 1 ? 'acciones sincronizadas' : 'acción sincronizada'} correctamente`, 'success');
        if (failed > 0) {
            if (typeof showToast === 'function') showToast(`⚠️ ${failed} ${failed > 1 ? 'acciones no pudieron' : 'acción no pudo'} sincronizarse. Reintentando en 30s…`, 'warning');
            setTimeout(() => { if (navigator.onLine) this._syncOfflineQueue(); }, 30_000);
        }
    },

    async post(path, body) {
        if (!navigator.onLine) {
            this._offlineQueue.add({ method: 'POST', path, body });
            const e = new Error('Sin conexión — guardado localmente, se enviará al reconectarse.');
            e.queued = true; throw e;
        }
        try {
            return await this.handle(await this._fetch(`${this.BASE_URL}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) }));
        } catch (err) {
            // navigator.onLine can report true while DNS is not yet resolved — queue anyway
            if (err.message && err.message.includes('Sin conexi')) {
                this._offlineQueue.add({ method: 'POST', path, body });
                const e = new Error('Sin conexión — guardado localmente, se enviará al reconectarse.');
                e.queued = true; throw e;
            }
            throw err;
        }
    },
    async patch(path, body) {
        if (!navigator.onLine) {
            this._offlineQueue.add({ method: 'PATCH', path, body });
            const e = new Error('Sin conexión — cambio guardado localmente, se enviará al reconectarse.');
            e.queued = true; throw e;
        }
        try {
            return await this.handle(await this._fetch(`${this.BASE_URL}${path}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(body) }));
        } catch (err) {
            if (err.message && err.message.includes('Sin conexi')) {
                this._offlineQueue.add({ method: 'PATCH', path, body });
                const e = new Error('Sin conexión — cambio guardado localmente, se enviará al reconectarse.');
                e.queued = true; throw e;
            }
            throw err;
        }
    },
    async del(path) {
        if (!navigator.onLine) {
            this._offlineQueue.add({ method: 'DELETE', path, body: null });
            const e = new Error('Sin conexión — acción guardada localmente, se enviará al reconectarse.');
            e.queued = true; throw e;
        }
        try {
            return await this.handle(await this._fetch(`${this.BASE_URL}${path}`, { method: 'DELETE', headers: this.headers() }));
        } catch (err) {
            if (err.message && err.message.includes('Sin conexi')) {
                this._offlineQueue.add({ method: 'DELETE', path, body: null });
                const e = new Error('Sin conexión — acción guardada localmente, se enviará al reconectarse.');
                e.queued = true; throw e;
            }
            throw err;
        }
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
    logout() { this.removeToken(); window.location.href = (window.location.pathname.includes('/pages/') ? '../' : '') + 'login.html'; },

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
    async getPacientes()          { return this.get('/api/b2b/pacientes'); },
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
    async registrarToma(id, notas, quien) { return this.post(`/api/b2b/medicamentos/${id}/toma`, { notas, _quien: quien || '' }); },
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
    async completarTarea(id, notas, quien) { return this.post(`/api/b2b/tareas/${id}/completar`, { notas, _quien: quien || '' }); },
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

    // ============================================
    // DOCUMENTOS ADJUNTOS
    // ============================================
    async getDocumentos(paciente_id)  { return this.get(`/api/b2b/documentos?paciente_id=${paciente_id}`); },
    async uploadDocumento(data)       { return this.post('/api/b2b/documentos', data); },
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

// ============================================
// ONE-TIME MIGRATION: populate LAST_USER_KEY from USER_KEY
// Runs on every page load — if the user logged in with an older version of the code that
// didn't set LAST_USER_KEY, we copy the current session user so offline login can work.
// ============================================
(function _migrateLastUser() {
    try {
        if (!localStorage.getItem(API_B2B.LAST_USER_KEY)) {
            const curr = localStorage.getItem(API_B2B.USER_KEY);
            if (curr) localStorage.setItem(API_B2B.LAST_USER_KEY, curr);
        }
    } catch {}
})();

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

