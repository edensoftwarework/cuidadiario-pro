/**
 * api-b2b.js — Cliente API para CuidaDiario PRO (B2B)
 * by EDEN SoftWork
 *
 * Todas las comunicaciones con /api/b2b/* del backend
 */

const API_B2B = {
    BASE_URL: 'https://cuidadiario-backend-production.up.railway.app',
    TOKEN_KEY: 'cd_pro_token',
    USER_KEY:  'cd_pro_user',

    // ---------- Auth storage ----------
    getToken()  { return localStorage.getItem(this.TOKEN_KEY); },
    setToken(t) { localStorage.setItem(this.TOKEN_KEY, t); },
    removeToken(){ localStorage.removeItem(this.TOKEN_KEY); localStorage.removeItem(this.USER_KEY); },
    getUser()   { const u = localStorage.getItem(this.USER_KEY); return u ? JSON.parse(u) : null; },
    setUser(u)  { localStorage.setItem(this.USER_KEY, JSON.stringify(u)); },
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
            this.removeToken();
            window.location.href = '../index.html';
            throw new Error('Sesión expirada');
        }
        if (!res.ok) {
            let msg = `Error ${res.status}`;
            try { const e = await res.json(); msg = e.error || msg; } catch {}
            throw new Error(msg);
        }
        return res.json();
    },

    async get(path)         { return this.handle(await fetch(`${this.BASE_URL}${path}`, { headers: this.headers() })); },
    async post(path, body)  { return this.handle(await fetch(`${this.BASE_URL}${path}`, { method:'POST',   headers: this.headers(), body: JSON.stringify(body) })); },
    async patch(path, body) { return this.handle(await fetch(`${this.BASE_URL}${path}`, { method:'PATCH',  headers: this.headers(), body: JSON.stringify(body) })); },
    async del(path)         { return this.handle(await fetch(`${this.BASE_URL}${path}`, { method:'DELETE', headers: this.headers() })); },
    async postNoAuth(path, body) { return this.handle(await fetch(`${this.BASE_URL}${path}`, { method:'POST', headers: this.headers(false), body: JSON.stringify(body) })); },

    // ============================================
    // AUTH
    // ============================================
    async register(data)          { const r = await this.postNoAuth('/api/b2b/auth/register', data); this.setToken(r.token); this.setUser(r.user); return r; },
    async login(email, password)  { const r = await this.postNoAuth('/api/b2b/auth/login', { email, password }); this.setToken(r.token); this.setUser(r.user); return r; },
    async getMe()                 { return this.get('/api/b2b/auth/me'); },
    async updateMe(data)          { return this.patch('/api/b2b/auth/me', data); },
    async forgotPassword(email)   { return this.postNoAuth('/api/b2b/auth/forgot-password', { email }); },
    async resetPassword(token, password) { return this.postNoAuth('/api/b2b/auth/reset-password', { token, password }); },
    logout() { this.removeToken(); window.location.href = '../index.html'; },

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
    async registrarToma(id, notas)        { return this.post(`/api/b2b/medicamentos/${id}/toma`, { notas }); },
    async getHistorialMeds(paciente_id)   { return this.get(`/api/b2b/medicamentos/historial?paciente_id=${paciente_id}`); },

    // ============================================
    // CITAS
    // ============================================
    async getCitas(paciente_id)   { return this.get(`/api/b2b/citas?paciente_id=${paciente_id}`); },
    async createCita(data)        { return this.post('/api/b2b/citas', data); },
    async updateCita(id, data)    { return this.patch(`/api/b2b/citas/${id}`, data); },
    async deleteCita(id)          { return this.del(`/api/b2b/citas/${id}`); },

    // ============================================
    // TAREAS
    // ============================================
    async getTareas(paciente_id)  { return this.get(`/api/b2b/tareas?paciente_id=${paciente_id}`); },
    async createTarea(data)       { return this.post('/api/b2b/tareas', data); },
    async updateTarea(id, data)   { return this.patch(`/api/b2b/tareas/${id}`, data); },
    async deleteTarea(id)         { return this.del(`/api/b2b/tareas/${id}`); },
    async completarTarea(id, notas) { return this.post(`/api/b2b/tareas/${id}/completar`, { notas }); },
    async getHistorialTareas(pid) { return this.get(`/api/b2b/tareas/historial?paciente_id=${pid}`); },

    // ============================================
    // SÍNTOMAS
    // ============================================
    async getSintomas(paciente_id)  { return this.get(`/api/b2b/sintomas?paciente_id=${paciente_id}`); },
    async createSintoma(data)       { return this.post('/api/b2b/sintomas', data); },
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
};

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

