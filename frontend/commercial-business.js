(function (global) {
    'use strict';
    const models = new Map();
    const pendingComposer = new Set();
    let authKey = '';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const date = value => value ? new Date(value).toLocaleString() : 'Not recorded';
    const label = value => String(value || '').replace(/_/g, ' ');
    const money = cents => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(cents / 100);
    const input = (name, title, value = '', type = 'text', extra = '') =>
        `<label>${escape(title)}<input class="form-input" name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
    const area = (name, title, value = '', max = 2000, required = true) =>
        `<label class="commercial-operations-wide">${escape(title)}<textarea class="form-input" name="${name}" rows="3" maxlength="${max}"${required ? ' required' : ''}>${escape(value)}</textarea></label>`;
    const select = (name, title, choices, selected) =>
        `<label>${escape(title)}<select class="form-select" name="${name}" required>${choices.map(([value, text]) =>
            `<option value="${value}"${value === selected ? ' selected' : ''}>${escape(text)}</option>`).join('')}</select></label>`;
    const emailLabels = { pending:'Pending', accepted:'Accepted by SendGrid - delivery not confirmed',
        delivered:'Delivered - not proof of reading or acknowledgement', failed:'Email delivery/send failed', needs_review:'Status unavailable / needs review' };
    function status(model, value) { model.root.querySelector('[data-business-status]').textContent = value; }
    function amount(value) {
        const raw = String(value).trim();
        if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) throw new Error('Use a dollar amount with no more than two decimal places.');
        return Math.round(Number(raw) * 100);
    }
    async function request(model, body, files = false) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(),20000);
        try {
        const response = await fetch(`${model.options.apiBase}/api/${files ? 'commercial-business-files' : 'commercial-business'}?${new URLSearchParams({ leadId:model.id })}`, {
            method:body ? 'POST' : 'GET', cache:'no-store',
            signal:controller.signal,
            headers:{ Authorization:`Bearer ${model.options.getToken()}`, ...(body ? { 'Content-Type':'application/json' } : {}) },
            ...(body ? { body:JSON.stringify(body) } : {}),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
            const error = new Error(result.error || 'Business records unavailable. Your draft is retained.');
            error.email = result.email;
            throw error;
        }
        return result;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('Request timed out. Retain this draft and review saved records before another send.');
            throw error;
        } finally { clearTimeout(timer); }
    }
    async function reload(model, discard = false) {
        if (model.saving || (model.dirty && !discard)) return;
        try {
            const next = await request(model);
            model.data = next;
            model.dirty = false;
            model.options.onDirty(false);
            render(model);
            return true;
        } catch (error) {
            status(model, error.message);
            if (!model.data && !model.root.querySelector('[data-business-retry]')) {
                const retry = document.createElement('button');
                retry.type = 'button'; retry.className = 'commercial-operations-review'; retry.dataset.businessRetry = '';
                retry.textContent = 'Retry loading business records'; retry.onclick = () => reload(model);
                model.root.appendChild(retry);
            }
            return false;
        }
    }
    function render(model) {
        const data = model.data, quote = data.quote || {}, payments = data.payments || [];
        const received = payments.filter(p => p.state === 'confirmed').reduce((sum, p) => sum + p.amountCents, 0);
        const remaining = Math.max(0, (quote.amountCents || 0) - received);
        const expanded = new Set([...model.root.querySelectorAll('details[open]')].map(node => node.dataset.businessSection));
        const emailEnabled = data.emailConfiguration.enabled;
        const ready = emailEnabled && data.emailConfiguration.configured && !data.emailSuppression && !!data.lead.email;
        const files = data.files.filter(file => file.state === 'ready');
        model.root.innerHTML = `<h5>${emailEnabled ? 'Email, quote and payment records' : 'Quote, payment and private records'}</h5>
            <p data-business-status role="status"></p>
            <p class="commercial-operations-note">Payment collection stays with staff. These records do not charge or refund anyone, verify Stripe, confirm an appointment or change installation status.</p>
            ${emailEnabled ? `<details data-business-section="email"><summary>Send customer email</summary>
                <p class="commercial-operations-note">Saved contact preference: ${escape(label(data.lead.contactPreference))}. ${data.lead.contactPreference === 'email' ? 'Keep this customer on email; no customer texts or calls are automated here.' : 'This is an explicit staff email, not an automatic contact sequence.'}</p>
                ${!ready ? `<p class="commercial-operations-note">${escape(data.emailSuppression ? `Sending blocked: ${label(data.emailSuppression)}. Resolve address/consent before another email.` : !data.lead.email ? 'No saved customer email.' : 'Commercial email setup is not enabled/complete. No email will be sent.')}</p>` : ''}
                <form data-business-action="email" class="commercial-operations-form">
                    ${input('recipient','To (saved customer email)',data.lead.email || '', 'email','readonly')}
                    ${input('subject','Subject','Home2Smart - your commercial project','text','required maxlength="200"')}
                    ${area('body','Email to customer','',20000)}
                    ${files.length ? `<fieldset class="commercial-operations-wide"><legend>Optional attachments (up to 3 MB total)</legend>${files.map(file =>
                        `<label><input type="checkbox" name="attachmentIds" value="${escape(file.id)}"> ${escape(file.filename)} - ${escape(label(file.purpose))}</label>`).join('')}</fieldset>` : ''}
                    <p class="commercial-operations-note commercial-operations-wide">Replies go to the configured Home2Smart mailbox. This sends an actual email; recording a contact attempt elsewhere does not.</p>
                    <button class="btn btn-tonal" type="submit"${!ready ? ' disabled' : ''}>Send email</button>
                </form>
            </details>` : ''}
            <details data-business-section="quote"><summary>Quote and payment terms${quote.amountCents ? ` - ${escape(money(quote.amountCents))}` : ''}</summary>
                <p class="commercial-operations-note">Record the agreed all-in total, including any applicable tax. No prices or taxes are calculated. Approval is staff-recorded evidence, not online customer approval.</p>
                <form data-business-action="quote" class="commercial-operations-form">
                    ${input('amount','Quote total (USD)',quote.amountCents ? (quote.amountCents/100).toFixed(2) : '', 'number','min="0.01" max="1000000" step="0.01" required')}
                    ${select('terms','Collection terms',[['full','Full payment'],['deposit','Deposit and balance']],quote.terms || 'full')}
                    ${input('deposit','Deposit (USD)',quote.depositCents ? (quote.depositCents/100).toFixed(2) : '', 'number','min="0.01" max="1000000" step="0.01"')}
                    ${select('status','Quote status',[['draft','Draft'],['sent','Staff records quote sent'],['accepted','Staff records customer approval'],['declined','Declined']],quote.status || 'draft')}
                    ${input('reference','Quote/reference number',quote.reference || '', 'text','maxlength="160"')}
                    ${area('approvalNote','Approval evidence: who, when and how',quote.approvalNote || '',2000,false)}
                    ${area('note','Scope and quote notes',quote.note || '',6000)}
                    <button class="btn btn-tonal" type="submit">Save quote record</button>
                </form>
            </details>
            <details data-business-section="payments"><summary>Manual payment records${quote.amountCents ? ` - ${escape(money(remaining))} remaining` : ''}</summary>
                ${quote.amountCents ? `<p class="commercial-operations-note">Staff-confirmed receipt: ${escape(money(received))}. Remaining: ${escape(money(remaining))}.${received > quote.amountCents ? ` Recorded excess: ${escape(money(received-quote.amountCents))}; reconcile manually.` : ''}
                    ${quote.terms === 'deposit' ? `${quote.status === 'accepted' ? 'Staff-recorded agreed' : 'Proposed'} deposit: ${escape(money(quote.depositCents))}.` : 'Full-payment terms.'} This is separate from Stripe verification above.</p>` : '<p class="commercial-operations-note">Save a quote before recording payment against it.</p>'}
                <ul class="commercial-operations-timeline">${payments.map(p => `<li><strong>${escape(money(p.amountCents))} - ${escape(p.state === 'confirmed' ? 'Receipt checked by staff (not Stripe-verified)' : label(p.state))}</strong>
                    <span>${escape(label(p.method))} - ${escape(date(p.receivedAt))}${p.reference ? ` - ${escape(p.reference)}` : ''}</span><span>${escape(p.note)}</span>
                    ${p.state === 'voided' ? `<span>Record corrected: ${escape(p.voidReason)}. No refund was issued by this action.</span>` : `<details data-business-section="void-${escape(p.id)}"><summary>Correct this record</summary>
                        <form class="commercial-operations-form" data-business-action="payment_void" data-payment-id="${escape(p.id)}">${area('reason','Reason for correction')}
                        <p class="commercial-operations-note commercial-operations-wide">Keeps the original audit record. Does not refund money.</p><button class="btn btn-tonal" type="submit">Void record only</button></form></details>`}</li>`).join('') || '<li>No manual payment records.</li>'}</ul>
                <form data-business-action="payment" class="commercial-operations-form">
                    ${input('amount','Amount (USD)','', 'number','min="0.01" max="1000000" step="0.01" required')}
                    ${select('method','Collection method',[['cash','Cash'],['check','Check'],['bank_transfer','Bank transfer'],['external_card','Card collected outside this tool'],['stripe_reference','Stripe reference (manual record only)'],['other','Other']],'cash')}
                    ${model.options.dateInput('receivedAt',`Receipt time (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,new Date().toISOString(),'required')}
                    ${select('state','Evidence',[['reported','Reported - receipt not verified'],['confirmed','I checked actual receipt']],'reported')}
                    ${input('reference','Receipt / transaction reference only','','text','maxlength="160"')}
                    ${area('note','How payment was checked / what remains unverified')}
                    <p class="commercial-operations-note commercial-operations-wide">Do not enter card numbers, bank details or credentials. Upload appropriate redacted evidence below.</p>
                    <button class="btn btn-tonal" type="submit"${!quote.amountCents ? ' disabled' : ''}>Record payment facts</button>
                </form>
            </details>
            <details data-business-section="files"><summary>Private attachments and work proof (${files.length})</summary>
                <p class="commercial-operations-note">Admin-only JPEG, PNG, WebP or PDF, up to 3 MB. Links expire after five minutes; refresh records to renew them. Uploading proof does not complete installation.</p>
                <ul class="commercial-operations-timeline">${data.files.map(file => `<li><strong>${escape(label(file.purpose))}</strong>
                    ${file.url ? `<a href="${escape(file.url)}" target="_blank" rel="noopener noreferrer">${escape(file.filename)}</a>` : `<span>${escape(file.filename)} - pending.</span><button class="btn btn-tonal" type="button" data-resume-file="${escape(file.id)}">Resume this upload</button>`}
                    <span>${escape(file.note)} - ${escape(date(file.createdAt))}${file.jobId ? ' - linked to its recorded installation' : ''}</span></li>`).join('') || '<li>No private attachments.</li>'}</ul>
                <form data-business-action="file" class="commercial-operations-form">
                    ${select('purpose','Purpose',[['contact_note','Contact note'],['quote_document','Quote document'],['payment_evidence','Payment evidence'],['installation_proof','Installation proof']],'contact_note')}
                    <label>Recorded contact attempt (optional)<select name="contactId" class="form-select"><option value="">New contact note - use note below</option>${data.contactAttempts.map(contact =>
                        `<option value="${escape(contact.id)}">${escape(label(contact.channel))} - ${escape(date(contact.createdAt))} - ${escape(contact.actor)}</option>`).join('')}</select></label>
                    ${input('file','Choose file','','file','accept="image/jpeg,image/png,image/webp,application/pdf" required')}
                    ${area('note','Attachment note','',2000,false)}
                    <button class="btn btn-tonal" type="submit">Upload private attachment</button>
                </form>
            </details>
            ${emailEnabled || data.emails.length ? `<details data-business-section="email-history"><summary>Recorded email evidence (${data.emails.length})</summary>
                <p class="commercial-operations-note">${data.emailConfiguration.deliveryTracking ? 'Delivery is based on validated SendGrid events.' : 'Signed delivery callbacks are not configured; provider acceptance alone does not prove delivery.'} Delivered never means read, approved or acknowledged.</p>
                <ol class="commercial-operations-timeline">${data.emails.map(email => `<li><strong>${escape(emailLabels[email.state])}</strong>
                    <span>${escape(email.recipient)} - ${escape(email.purpose === 'receipt' ? 'Initial request receipt' : 'Staff follow-up')} - ${escape(date(email.timestamp))}</span>
                    <details data-business-section="message-${escape(email.id)}"><summary>${escape(email.subject)}</summary><p>${escape(email.body).replace(/\n/g,'<br>')}</p>
                    <p>Send reference: <code>${escape(email.id)}</code></p>
                    ${email.errorCode ? `<p>${escape(email.errorCode)}</p>` : ''}</details>
                    ${email.deliveryReason ? `<p>${escape(email.deliveryReason)}</p>` : ''}
                    ${email.attachments?.length ? `<span>Attached: ${email.attachments.map(file => escape(file.filename)).join(', ')}</span>` : ''}
                    ${email.retrySafe && ready ? `<button class="btn btn-tonal" type="button" data-retry-email="${escape(email.id)}">Retry rejected email</button>` : ''}</li>`).join('') || '<li>No commercial email send recorded. Staff contact logs are not email delivery evidence.</li>'}</ol>
            </details>` : ''}
            <details data-business-section="history"><summary>Business record activity</summary><ol class="commercial-operations-timeline">${data.history.map(event =>
                `<li><strong>${escape(label(event.action))}</strong><span>${escape(event.actor.name)} - ${escape(date(event.created_at))}</span>
                <span>${escape(event.payload.note || event.payload.reason || event.payload.reference || '')}</span></li>`).join('') || '<li>No business record changes.</li>'}</ol></details>
            <button class="commercial-operations-review" type="button" data-business-reload>Refresh business records / discard this draft</button>`;
        model.root.querySelectorAll('details').forEach(node => { node.open = expanded.has(node.dataset.businessSection); });
        model.root.querySelectorAll('form').forEach(form => {
            const sync = () => {
                if (form.dataset.businessAction === 'file') {
                    form.elements.contactId.disabled = form.elements.purpose.value !== 'contact_note';
                    form.elements.note.required = !form.elements.contactId.disabled && !form.elements.contactId.value;
                    return;
                }
                if (form.dataset.businessAction !== 'quote') return;
                form.elements.deposit.disabled = form.elements.terms.value !== 'deposit';
                form.elements.deposit.required = !form.elements.deposit.disabled;
                form.elements.approvalNote.required = form.elements.status.value === 'accepted';
            };
            form.oninput = form.onchange = () => { model.dirty = true; model.options.onDirty(true); sync(); };
            form.onsubmit = event => { event.preventDefault(); save(model, form); };
            sync();
        });
        model.root.querySelector('[data-business-reload]').onclick = () => {
            if (model.dirty && !confirm('Discard this business draft and load saved records?')) return;
            reload(model, true);
        };
        model.root.querySelectorAll('[data-retry-email]').forEach(button => { button.onclick = () => {
            if (confirm('Retry this definitely rejected email to the saved customer address?')) save(model, null, button.dataset.retryEmail);
        }; });
        model.root.querySelectorAll('[data-resume-file]').forEach(button => { button.onclick = () => {
            const file = data.files.find(item => item.id === button.dataset.resumeFile);
            const form = model.root.querySelector('[data-business-action="file"]');
            form.dataset.operationId = file.id;
            form.elements.purpose.value = file.purpose;
            form.elements.purpose.dispatchEvent(new Event('change',{bubbles:true}));
            form.elements.note.value = file.note;
            form.elements.contactId.value = file.contactId || '';
            form.elements.contactId.dispatchEvent(new Event('change',{bubbles:true}));
            form.elements.file.click();
            status(model, `Choose the same original ${file.filename} to safely resume its pending upload.`);
        }; });
        status(model, 'Saved records loaded. No messages or charges are triggered by viewing.');
        if (model.composeRequested) openComposer(model);
    }
    function openComposer(model) {
        if (model.data && !model.data.emailConfiguration.enabled) {
            model.composeRequested = false;
            status(model, 'Commercial email is paused. Contact customers by phone; respect the saved preference and texting consent.');
            return;
        }
        const details = model.root.querySelector('[data-business-section="email"]');
        if (!details) { model.composeRequested = true; return; }
        model.composeRequested = false;
        details.open = true;
        details.scrollIntoView({ block:'start', behavior:global.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        details.querySelector('[name="body"]').focus({ preventScroll:true });
    }
    async function save(model, form, retryEmailId) {
        if (model.saving) return;
        const action = form?.dataset.businessAction || 'email';
        model.saving = true;
        const buttons = [...model.root.querySelectorAll('button')].map(node => [node,node.disabled]);
        buttons.forEach(([node]) => { node.disabled = true; });
        try {
            const operationId = form ? (form.dataset.operationId ||= crypto.randomUUID()) : crypto.randomUUID();
            const values = form ? Object.fromEntries(new FormData(form)) : {};
            const body = { ...values, action, operationId, leadId:model.id, revision:model.data.revision, ...(retryEmailId ? { retryEmailId } : {}) };
            if (action === 'email' && form) body.attachmentIds = new FormData(form).getAll('attachmentIds');
            if (action === 'quote' || action === 'payment') body.amountCents = amount(values.amount);
            if (action === 'quote') body.depositCents = values.terms === 'deposit' ? amount(values.deposit) : 0;
            if (action === 'payment') body.receivedAt = model.options.instantValue(form,'receivedAt');
            if (action === 'payment_void') body.paymentId = form.dataset.paymentId;
            if (action === 'file') {
                const file = form.elements.file.files[0];
                if (!file || !file.size || file.size > 3145728) throw new Error('Choose a file up to 3 MB.');
                body.filename = file.name;
                body.data = await new Promise((resolve,reject) => {
                    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('File could not be read.')); reader.readAsDataURL(file);
                });
                delete body.file;
            }
            status(model, action === 'email' ? 'Submitting email once. Do not resend while waiting…' : 'Saving…');
            const result = await request(model,body,action === 'file');
            model.dirty = false; model.options.onDirty(false);
            model.saving = false;
            const loaded = await reload(model,true);
            if (loaded) status(model, action === 'email' ? `${emailLabels[result.email.state]}. No reading or acknowledgement is implied.` : 'Saved. Payment collection, scheduling and installation remain independent.');
            if (action === 'email') model.options.onActivity();
        } catch (error) {
            status(model, error.message);
            if (error.email && form) {
                form.querySelector('button[type="submit"]').dataset.outcomeHeld = 'true';
                const button = document.createElement('button');
                button.type = 'button'; button.className = 'btn btn-tonal'; button.textContent = 'Review saved email evidence';
                button.onclick = () => { if (confirm('Discard this composer draft and review the saved send outcome?')) reload(model,true); };
                form.appendChild(button);
            }
        } finally {
            model.saving = false;
            buttons.forEach(([node,disabled]) => { node.disabled = disabled || node.dataset.outcomeHeld === 'true'; });
        }
    }
    global.H2SCommercialBusiness = {
        mount(host,id,options) {
            const token = options.getToken();
            if (authKey !== token) {
                const requested = pendingComposer.has(id);
                models.clear(); pendingComposer.clear(); authKey = token;
                if (requested) pendingComposer.add(id);
            }
            const existing = models.get(id);
            if (existing) { existing.options = options; if (existing.root !== host) host.replaceWith(existing.root); return; }
            const model = { id, root:host, options, dirty:false, saving:false, composeRequested:pendingComposer.delete(id) };
            models.set(id,model);
            host.innerHTML = '<h5>Email, quote and payment records</h5><p data-business-status role="status">Loading saved business records…</p>';
            reload(model);
        },
        compose(id) {
            const model = models.get(id);
            if (model) openComposer(model); else pendingComposer.add(id);
            return true;
        },
        discard(id) { models.delete(id); },
    };
})(window);
