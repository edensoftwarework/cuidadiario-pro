/* Lector y aceptación contractual integrados. El Markdown siempre se escapa. */
(function () {
    'use strict';

    const TYPES = ['terms', 'privacy', 'dpa'];
    const LABELS = { terms: 'Términos del servicio', privacy: 'Política de privacidad', dpa: 'Acuerdo de tratamiento de datos' };
    const ACCEPTANCE_STATEMENT = 'Acepto los Términos del servicio, la Política de privacidad y el Anexo de tratamiento de datos en representación de esta institución';
    let bundle = null;
    let documents = new Map();
    let openOptions = {};
    let loadingGeneration = 0;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
    }

    function inline(value) {
        let safe = escapeHtml(value);
        safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        return safe;
    }

    function markdown(source) {
        const lines = String(source || '').replace(/\r/g, '').split('\n');
        const html = [];
        let list = null;
        const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
        for (const line of lines) {
            const heading = line.match(/^(#{1,4})\s+(.+)$/);
            const bullet = line.match(/^[-*]\s+(.+)$/);
            const numbered = line.match(/^\d+\.\s+(.+)$/);
            if (heading) {
                closeList();
                const level = Math.min(heading[1].length + 1, 5);
                html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            } else if (bullet || numbered) {
                const wanted = bullet ? 'ul' : 'ol';
                if (list !== wanted) { closeList(); list = wanted; html.push(`<${list}>`); }
                html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
            } else if (!line.trim()) {
                closeList();
            } else {
                closeList();
                html.push(`<p>${inline(line)}</p>`);
            }
        }
        closeList();
        return html.join('');
    }

    function publicVersion(version) {
        const date = String(version || '').match(/(20\d{2})-(\d{2})-(\d{2})/);
        return date ? `${date[3]}/${date[2]}/${date[1]}` : 'actual';
    }

    function publicVersionSlug(version) {
        return String(version || '').match(/20\d{2}-\d{2}-\d{2}/)?.[0] || 'vigente';
    }

    function ensureDialog() {
        if (document.getElementById('contractReaderModal')) return;
        const overlay = document.createElement('div');
        overlay.id = 'contractReaderModal';
        overlay.className = 'modal-overlay contract-reader-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'contractReaderTitle');
        overlay.setAttribute('aria-describedby', 'contractReaderIntro');
        overlay.innerHTML = `
            <div class="modal contract-reader-modal">
                <div class="modal-header contract-reader-header">
                    <div><span class="modal-title" id="contractReaderTitle">Documentación del servicio</span><span class="contract-reader-version" id="contractReaderVersion"></span></div>
                    <button class="modal-close" type="button" data-contract-close data-modal-initial-focus aria-label="Cerrar documentación">×</button>
                </div>
                <p class="contract-reader-intro" id="contractReaderIntro">Leé los tres documentos en este mismo lector. Podés guardar una copia y decidir más tarde.</p>
                <div class="contract-reader-status" id="contractReaderStatus" role="status">Cargando documentación…</div>
                <div class="contract-reader-scroll" id="contractReaderScroll" tabindex="0"></div>
                <div class="contract-reader-footer modal-footer">
                    <button class="btn btn-secondary" type="button" id="contractDownloadAll" disabled>Guardar copia completa</button>
                    <button class="btn btn-secondary" type="button" id="contractReaderLater">Más tarde</button>
                    <button class="btn btn-primary" type="button" id="contractReaderAccept" disabled>Aceptar documentación</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('[data-contract-close]').addEventListener('click', close);
        overlay.querySelector('#contractReaderLater').addEventListener('click', close);
        overlay.querySelector('#contractDownloadAll').addEventListener('click', downloadAll);
        overlay.querySelector('#contractReaderAccept').addEventListener('click', accept);
    }

    function safeDocumentInfo(type) {
        const info = bundle?.documents?.find(item => item?.type === type);
        if (!info?.url?.startsWith('/api/b2b/contracts/documents/')) return null;
        try {
            const url = new URL(info.url, API_B2B.BASE_URL);
            if (url.origin !== new URL(API_B2B.BASE_URL).origin) return null;
            return { ...info, absoluteUrl: url.href };
        } catch { return null; }
    }

    function safePdfUrl(type = null) {
        const relative = type
            ? bundle?.documents?.find(item => item?.type === type)?.pdf_url
            : bundle?.pdf_url;
        if (!relative?.startsWith('/api/b2b/contracts/documents')) return null;
        try {
            const url = new URL(relative, API_B2B.BASE_URL);
            return url.origin === new URL(API_B2B.BASE_URL).origin ? url.href : null;
        } catch { return null; }
    }

    function resetReadingPosition() {
        const scroll = document.getElementById('contractReaderScroll');
        if (!scroll) return;
        scroll.scrollTop = 0;
        requestAnimationFrame(() => { scroll.scrollTop = 0; });
    }

    function renderDocuments() {
        const scroll = document.getElementById('contractReaderScroll');
        scroll.replaceChildren();
        for (const type of TYPES) {
            const section = document.createElement('section');
            section.className = 'contract-reader-document';
            section.id = `contract-document-${type}`;
            section.innerHTML = `<div class="contract-reader-document-heading"><h2>${escapeHtml(LABELS[type])}</h2><button class="btn btn-secondary btn-sm" type="button" data-download-type="${type}">Guardar copia</button></div><div class="contract-reader-content">${markdown(documents.get(type))}</div>`;
            section.querySelector('[data-download-type]').addEventListener('click', () => downloadType(type));
            scroll.appendChild(section);
        }
        if (openOptions.canAccept) {
            const acceptance = document.createElement('section');
            acceptance.className = 'contract-reader-acceptance';
            acceptance.innerHTML = `
                <h2>Aceptación institucional</h2>
                <p>La aceptación se registrará para los tres documentos y para la versión documental ${escapeHtml(publicVersion(bundle.version))}.</p>
                <div class="form-group"><label class="form-label" for="contractReaderCapacity">Carácter con el que representás a la institución</label><input id="contractReaderCapacity" class="form-control" maxlength="160" autocomplete="organization-title" placeholder="Ej.: administrador autorizado"></div>
                <label class="contract-reader-confirmation"><input id="contractReaderConfirmed" type="checkbox"><span>Confirmo que estoy autorizado para aceptar esta documentación en nombre de la institución y que pude leer los tres documentos.</span></label>
                <div class="contract-reader-feedback" id="contractReaderFeedback" role="status" aria-live="polite"></div>`;
            scroll.appendChild(acceptance);
            const refresh = () => {
                const capacity = document.getElementById('contractReaderCapacity')?.value.trim() || '';
                const confirmed = document.getElementById('contractReaderConfirmed')?.checked === true;
                document.getElementById('contractReaderAccept').disabled = capacity.length < 2 || !confirmed;
            };
            acceptance.querySelector('#contractReaderCapacity').addEventListener('input', refresh);
            acceptance.querySelector('#contractReaderConfirmed').addEventListener('change', refresh);
        }
    }

    async function open(nextBundle, options = {}) {
        ensureDialog();
        const generation = ++loadingGeneration;
        bundle = nextBundle;
        openOptions = options;
        documents = new Map();
        const status = document.getElementById('contractReaderStatus');
        const scroll = document.getElementById('contractReaderScroll');
        document.getElementById('contractReaderVersion').textContent = `Versión documental ${publicVersion(bundle?.version)}`;
        const acceptButton = document.getElementById('contractReaderAccept');
        acceptButton.hidden = !options.canAccept;
        acceptButton.style.display = options.canAccept ? '' : 'none';
        acceptButton.disabled = true;
        document.getElementById('contractDownloadAll').disabled = true;
        status.hidden = false;
        status.textContent = 'Cargando documentación…';
        scroll.replaceChildren();
        openModal('contractReaderModal');
        resetReadingPosition();
        // openModal intenta enfocar el primer campo a los 60 ms; el lector debe
        // comenzar arriba, por eso la acción de cierre recibe el foco después.
        setTimeout(() => {
            document.querySelector('#contractReaderModal [data-contract-close]')?.focus({ preventScroll: true });
            resetReadingPosition();
        }, 100);
        try {
            const results = await Promise.all(TYPES.map(async type => {
                const info = safeDocumentInfo(type);
                if (!info) throw new Error('La referencia de uno de los documentos no es válida.');
                const response = await fetch(info.absoluteUrl, { headers: { Authorization: `Bearer ${API_B2B.getToken()}` }, cache: 'no-store' });
                if (!response.ok) throw new Error('No se pudo cargar la documentación. Intentá nuevamente.');
                return [type, await response.text()];
            }));
            if (generation !== loadingGeneration) return;
            documents = new Map(results);
            renderDocuments();
            resetReadingPosition();
            status.hidden = true;
            document.getElementById('contractDownloadAll').disabled = false;
        } catch (error) {
            if (generation === loadingGeneration) status.textContent = error.message || 'No se pudo cargar la documentación.';
        }
    }

    function close() { loadingGeneration += 1; closeModal('contractReaderModal'); }

    async function downloadPdf(type = null) {
        const url = safePdfUrl(type);
        if (!url) return;
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok || !String(response.headers.get('content-type')).includes('application/pdf')) {
            throw new Error('No se pudo generar la copia PDF. Intentá nuevamente.');
        }
        const blobUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = blobUrl;
        const names = { terms: 'terminos', privacy: 'privacidad', dpa: 'tratamiento-de-datos' };
        const version = publicVersionSlug(bundle.version);
        link.download = type ? `cuidadiario-${names[type]}-${version}.pdf` : `cuidadiario-documentacion-${version}.pdf`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    function downloadType(type) { return downloadPdf(type).catch(error => globalThis.showToast?.(error.message, 'error')); }
    function downloadAll() { return downloadPdf().catch(error => globalThis.showToast?.(error.message, 'error')); }

    async function accept() {
        const button = document.getElementById('contractReaderAccept');
        const feedback = document.getElementById('contractReaderFeedback');
        const capacity = document.getElementById('contractReaderCapacity')?.value.trim() || '';
        const confirmed = document.getElementById('contractReaderConfirmed')?.checked === true;
        if (!openOptions.canAccept || capacity.length < 2 || !confirmed || button.disabled) return;
        button.disabled = true; button.textContent = 'Registrando aceptación…'; feedback.textContent = '';
        try {
            const result = await API_B2B.acceptContract({ bundle_version: bundle.version, representative_capacity: capacity, representation_confirmed: true, acceptance_statement: ACCEPTANCE_STATEMENT });
            feedback.className = 'contract-reader-feedback success';
            feedback.textContent = 'La aceptación institucional quedó registrada correctamente.';
            button.textContent = 'Aceptación registrada';
            await openOptions.onAccepted?.(result);
            setTimeout(close, 900);
        } catch (error) {
            feedback.className = 'contract-reader-feedback error';
            feedback.textContent = error.message || 'No se pudo registrar la aceptación. Intentá nuevamente.';
            button.disabled = false; button.textContent = 'Aceptar documentación';
        }
    }

    globalThis.ContractReaderB2B = Object.freeze({ open, close, downloadType, downloadAll });
})();
