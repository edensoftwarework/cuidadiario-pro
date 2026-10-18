/* Apertura no bloqueante del lector contractual para el administrador principal. */
(function () {
    'use strict';
    const DISMISS_PREFIX = 'cd_contract_notice_seen:';
    const EXPECTED_TYPES = ['terms', 'privacy', 'dpa'];
    let requestGeneration = 0;

    function principalSnapshot() {
        const user = API_B2B.getPrincipalUser?.() || API_B2B.getUser?.();
        if (!user || user.rol !== 'admin_institucion' || !user.id || !user.institucion_id) return null;
        if (API_B2B.getOperatorToken?.() || API_B2B.getOperatorContext?.()) return null;
        return { userId: String(user.id), institutionId: String(user.institucion_id), token: API_B2B.getToken?.() || '' };
    }
    function samePrincipal(snapshot) {
        const current = principalSnapshot();
        return Boolean(current && current.userId === snapshot.userId && current.institutionId === snapshot.institutionId && current.token === snapshot.token);
    }
    function seenKey(snapshot, version) { return `${DISMISS_PREFIX}${snapshot.institutionId}:${snapshot.userId}:${version}`; }
    function isEligibleStatus(status) {
        const bundle = status?.current_bundle;
        const docs = Array.isArray(bundle?.documents) ? bundle.documents : [];
        return Boolean(bundle && bundle.status === 'active' && bundle.requires_acceptance === true && status.accepted !== true
            && status.can_accept === true && typeof bundle.version === 'string'
            && EXPECTED_TYPES.every(type => docs.some(documentInfo => documentInfo?.type === type)));
    }
    function markSeen(key) { try { sessionStorage.setItem(key, '1'); } catch {} }
    function wasSeen(key) { try { return sessionStorage.getItem(key) === '1'; } catch { return false; } }

    async function init() {
        const generation = ++requestGeneration;
        const snapshot = principalSnapshot();
        if (!snapshot) return { shown: false, reason: 'ineligible-principal' };
        try {
            if (globalThis.B2B_MAINTENANCE_READY) {
                const maintenance = await globalThis.B2B_MAINTENANCE_READY;
                if (maintenance?.mode !== 'normal') return { shown: false, reason: 'maintenance' };
            }
            const status = await API_B2B.getContractStatus();
            if (generation !== requestGeneration || !samePrincipal(snapshot)) return { shown: false, reason: 'identity-changed' };
            if (!isEligibleStatus(status)) return { shown: false, reason: 'not-pending-active' };
            const key = seenKey(snapshot, status.current_bundle.version);
            if (wasSeen(key)) return { shown: false, reason: 'already-seen' };
            markSeen(key);
            await ContractReaderB2B.open(status.current_bundle, { canAccept: true });
            return { shown: true, reason: 'pending-active' };
        } catch {
            return { shown: false, reason: 'network-or-auth-error' };
        }
    }
    function dismiss() { ContractReaderB2B.close(); }
    async function review() {
        const status = await API_B2B.getContractStatus();
        if (status?.current_bundle) await ContractReaderB2B.open(status.current_bundle, { canAccept: status.can_accept === true && !status.accepted });
    }
    function clearSessionState() {
        try {
            const keys = [];
            for (let index = 0; index < sessionStorage.length; index += 1) {
                const key = sessionStorage.key(index);
                if (key?.startsWith(DISMISS_PREFIX)) keys.push(key);
            }
            keys.forEach(key => sessionStorage.removeItem(key));
        } catch {}
        requestGeneration += 1;
    }
    globalThis.ContractNoticeB2B = Object.freeze({ init, dismiss, review, clearSessionState });
})();
