// Internal Messages Patch
// Purpose: enforce internal (account-based) conversations in the Messages pane.
// Loaded after dash.js; overrides SMS inbox functions to use messages* endpoints.

(function () {
    try {
        if (window.__h2sDashMessagesPatchV1) return;
        window.__h2sDashMessagesPatchV1 = true;
    } catch (_) {}

    const safeTrim = (v) => String(v || '').trim();
    const safeUpper = (v) => safeTrim(v).toUpperCase();

    const syncLegacyWindowState = () => {
        try {
            if (typeof window.__h2sSyncMessagesState === 'function') window.__h2sSyncMessagesState();
        } catch (_) {}
    };

    const escapeHtml = (s) => {
        try {
            if (typeof smsEscapeHtml === 'function') return smsEscapeHtml(s);
        } catch (_) {}
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    const isUuidLike = (value) => {
        const s = safeTrim(value);
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    };

    let __messagesMyUserId = '';
    let __messagesUsersCache = [];
    let __messagesUsersById = {};
    let __messagesUsersLoadedAt = 0;
    let __messagesActiveMembers = [];
    let __messagesDraftTitle = '';
    let __messagesLastUnreadTotal = 0;
    let __messagesUnreadInitialized = false;
    let __messagesPolishInFlight = false;
    let __messagesThreadsRequestSeq = 0;
    let __messagesOpenThreadRequestSeq = 0;
    let __messagesRefreshThreadRequestSeq = 0;
    let __messagesAuthKnown = false;
    let __messagesAuthBlocked = false;
    let __messagesAuthGeneration = 0;
    let __messagesSendInFlight = false;

    function handleMessagesAuthFailure(response) {
        if (response.status !== 401 && response.status !== 403) return;
        __messagesAuthKnown = true;
        __messagesAuthBlocked = true;
        __messagesAuthGeneration += 1;
        stopSmsAutoRefresh();
        syncMessagesComposerAvailability();
    }

    function syncMessagesComposerAvailability() {
        const blocked = !__messagesAuthKnown || __messagesAuthBlocked;
        const reason = blocked ? 'Messaging sign-in required.' : '';

        try {
            if (typeof smsSetComposerEnabled === 'function') smsSetComposerEnabled(!blocked);
        } catch (_) {}

        try {
            const newChatBtn = document.querySelector('#sms-pane .sms-new-btn');
            if (newChatBtn) {
                newChatBtn.disabled = blocked;
                if (reason) newChatBtn.title = reason;
                else newChatBtn.removeAttribute('title');
            }
        } catch (_) {}

        try {
            const micBtn = document.getElementById('smsMicBtn');
            if (micBtn) {
                micBtn.disabled = blocked;
                if (reason) micBtn.title = reason;
                else if (!window.__smsDictationActive) micBtn.title = 'Dictate (AI Voice)';
            }
        } catch (_) {}
    }

    window.messagesCanStartConversation = function () {
        return !!__messagesAuthKnown && !__messagesAuthBlocked;
    };

    function getMessagesSeenStorageKey() {
        try {
            const who = safeUpper(typeof currentUser !== 'undefined' ? currentUser : '') || safeUpper(__messagesMyUserId) || 'ANON';
            return `h2s_messages_seen_v1:${who}`;
        } catch (_) {
            return 'h2s_messages_seen_v1:ANON';
        }
    }

    function loadMessagesSeenState() {
        try {
            const raw = window.localStorage.getItem(getMessagesSeenStorageKey());
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function saveMessagesSeenState(state) {
        try {
            window.localStorage.setItem(getMessagesSeenStorageKey(), JSON.stringify(state && typeof state === 'object' ? state : {}));
        } catch (_) {
            // ignore
        }
    }

    function getConversationMessageSignature(row) {
        const id = safeTrim(row && (row.conversation_id || row.conversationId));
        if (!id) return '';
        const lastAt = safeTrim(row && (row.last_message_at || row.lastMessageAt));
        const preview = safeTrim(row && (row.last_message_preview || row.lastMessagePreview));
        if (!lastAt && !preview) return '';
        return `${id}|${lastAt}|${preview}`;
    }

    function getConversationPayloadSignature(conversation, messages) {
        const id = safeTrim(conversation && (conversation.conversation_id || conversation.conversationId || __smsActiveThreadId));
        if (!id) return '';
        const rows = Array.isArray(messages) ? messages : [];
        const lastMessage = rows.length ? rows[rows.length - 1] : null;
        const lastAt = safeTrim((lastMessage && lastMessage.created_at) || (conversation && (conversation.last_message_at || conversation.lastMessageAt)));
        const preview = safeTrim((lastMessage && lastMessage.body) || (conversation && (conversation.last_message_preview || conversation.lastMessagePreview)));
        if (!lastAt && !preview) return '';
        return `${id}|${lastAt}|${preview}`;
    }

    function markConversationSeen(conversationId, signature) {
        const id = safeTrim(conversationId);
        const sig = safeTrim(signature);
        if (!id || !sig) return;
        const state = loadMessagesSeenState();
        if (state[id] === sig) return;
        state[id] = sig;
        saveMessagesSeenState(state);
    }

    function markConversationSeenFromPayload(conversation, messages) {
        const id = safeTrim(conversation && (conversation.conversation_id || conversation.conversationId || __smsActiveThreadId));
        const sig = getConversationPayloadSignature(conversation, messages);
        if (!id || !sig) return;
        markConversationSeen(id, sig);
    }

    function normalizeEmail(value) {
        const s = safeTrim(value);
        if (!s) return '';
        if (s.includes(' ') || s.includes('<') || s.includes('>')) return '';
        if (!s.includes('@')) return '';
        return s;
    }

    function isMessagesTabActive() {
        try {
            if (typeof window.isSmsTabActive === 'function' && window.isSmsTabActive !== isMessagesTabActive) return !!window.isSmsTabActive();
        } catch (_) { }
        try {
            if (typeof smsIsTabActive === 'function') return !!smsIsTabActive();
        } catch (_) { }
        try {
            return document.querySelector('.app-sidebar-nav-item.active')?.dataset?.tab === 'sms'
                || document.querySelector('.tab.active')?.dataset?.tab === 'sms';
        } catch (_) {
            return false;
        }
    }

    try {
        if (typeof window.isSmsTabActive !== 'function') window.isSmsTabActive = isMessagesTabActive;
    } catch (_) { }

    function getEmailFromUserObject(u) {
        try {
            if (!u || typeof u !== 'object') return '';

            // Prefer explicit fields.
            const direct = normalizeEmail(u.email || u.emailAddress || u.email_address || u.mail || u.workEmail || u.work_email);
            if (direct) return direct;

            // Heuristic: any property name containing email/mail.
            for (const k of Object.keys(u)) {
                const key = safeUpper(k);
                if (!key.includes('EMAIL') && !key.includes('MAIL')) continue;
                const hit = normalizeEmail(u[k]);
                if (hit) return hit;
            }

            // Last resort: scan for an email-like string.
            for (const k of Object.keys(u)) {
                const v = u[k];
                if (typeof v !== 'string') continue;
                const hit = normalizeEmail(v);
                if (hit) return hit;
            }
        } catch (_) {
            // ignore
        }
        return '';
    }

    function buildGmailComposeUrl({ to = [], subject = '', body = '' }) {
        const params = new URLSearchParams();
        params.set('view', 'cm');
        params.set('fs', '1');
        params.set('tf', '1');
        if (to.length) params.set('to', to.join(','));
        if (subject) params.set('su', subject);
        if (body) params.set('body', body);
        return `https://mail.google.com/mail/?${params.toString()}`;
    }

    async function openMessagesGmailComposer() {
        try {
            const convId = safeTrim(typeof __smsActiveThreadId !== 'undefined' ? __smsActiveThreadId : '');
            await ensureUsersLoaded();

            const emails = new Set();

            // If a conversation is open, prefill to: its members.
            if (convId) {
                const members = Array.isArray(__messagesActiveMembers) ? __messagesActiveMembers : [];
                for (const m of members) {
                    const memberId = safeTrim(m && (m.user_id || m.userId || m.member_user_id));
                    if (!memberId) continue;
                    const u = (__messagesUsersById && typeof __messagesUsersById === 'object') ? __messagesUsersById[memberId] : null;
                    const e = getEmailFromUserObject(u);
                    if (e) emails.add(e);
                }
            } else {
                // Otherwise, if we have draft recipients (new chat flow), prefill to: those.
                const draft = Array.isArray(__smsDraftRecipients) ? __smsDraftRecipients : [];
                for (const uid of draft) {
                    const memberId = safeTrim(uid);
                    if (!memberId) continue;
                    const u = (__messagesUsersById && typeof __messagesUsersById === 'object') ? __messagesUsersById[memberId] : null;
                    const e = getEmailFromUserObject(u);
                    if (e) emails.add(e);
                }
            }

            // Subject: use current thread header title if present.
            let subject = 'Home2Smart';
            try {
                const header = document.getElementById('smsThreadHeader');
                const titleEl = header ? header.querySelector('.sms-thread-header__title') : null;
                const title = safeTrim(titleEl && titleEl.textContent);
                if (title) subject = title;
            } catch (_) { }

            // Body: start with current draft if present.
            let body = '';
            try {
                const draftEl = document.getElementById('smsSendInput');
                body = safeTrim(draftEl && draftEl.value);
            } catch (_) { }

            const url = buildGmailComposeUrl({
                to: Array.from(emails),
                subject,
                body,
            });
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err) {
            console.error('[dash-messages] openMessagesGmailComposer failed', err);
            try { if (typeof showToast === 'function') showToast('Failed to open Gmail compose', 'error'); } catch (_) { }
        }
    }

    window.openMessagesGmailComposer = openMessagesGmailComposer;

    async function messagesOpenNewConversationModal() {
        try {
            await ensureMeLoaded();
            await ensureUsersLoaded();

            const meId = safeTrim(__messagesMyUserId);
            const users = Array.isArray(__messagesUsersCache) ? __messagesUsersCache : [];
            const options = users
                .map((u) => ({
                    id: safeTrim(u && (u.userId || u.user_id)),
                    name: safeTrim(u && (u.displayName || u.display_name)) || safeTrim(u && u.username) || safeTrim(u && (u.userId || u.user_id)),
                    sub: safeTrim(u && u.username)
                }))
                .filter((u) => u.id && isUuidLike(u.id) && (!meId || u.id !== meId));

            const rows = options.map((u) => {
                return `
                    <label style="display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:10px; cursor:pointer;">
                        <input class="msg-newconv-user" type="checkbox" value="${escapeHtml(u.id)}" style="width:16px; height:16px;" />
                        <div style="display:flex; flex-direction:column;">
                            <div style="font-weight:700; color:#0f172a;">${escapeHtml(u.name || u.id)}</div>
                            ${u.sub ? `<div style="font-size:12px; color:#64748b;">${escapeHtml(u.sub)}</div>` : ''}
                        </div>
                    </label>
                `;
            }).join('');

            const html = `
                <div style="padding: 18px 0;">
                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <div>
                            <div style="font-size:12px; color:#64748b; font-weight:700; margin-bottom:6px;">CHAT NAME</div>
                            <input id="messagesNewConvTitle" class="form-input" type="text" placeholder="e.g. Admin + VA" style="width:100%;" />
                        </div>
                        <div>
                            <div style="font-size:12px; color:#64748b; font-weight:700; margin-bottom:6px;">PEOPLE</div>
                            <div id="messagesNewConvUsers" style="display:flex; flex-direction:column; gap:8px; max-height: 280px; overflow:auto;">
                                ${rows || `<div class="u-muted" style="padding: 8px;">No other accounts found.</div>`}
                            </div>
                        </div>
                        <div class="u-text-xs u-muted" style="opacity:0.9;">You’re automatically included.</div>
                    </div>
                </div>
            `;

            if (typeof showModal !== 'function') {
                try { if (typeof showToast === 'function') showToast('Modal system not available', 'error'); } catch (_) { }
                return;
            }

            showModal('New Conversation', html, {
                width: '560px',
                confirmText: 'Create Chat',
                backdropClose: true,
            });

            try {
                const confirmBtn = document.getElementById('modalConfirmBtn');
                const cancelBtn = document.querySelector('.modal-btn-cancel');
                if (cancelBtn) cancelBtn.textContent = 'Cancel';
                if (!confirmBtn) return;

                confirmBtn.onclick = async () => {
                    try {
                        const titleEl = document.getElementById('messagesNewConvTitle');
                        const rawTitle = safeTrim(titleEl && titleEl.value);
                        const picked = Array.from(document.querySelectorAll('.msg-newconv-user:checked'))
                            .map((el) => safeTrim(el && el.value))
                            .filter((x) => x && isUuidLike(x));

                        if (!picked.length) {
                            try { if (typeof showToast === 'function') showToast('Pick at least one person', 'warning'); } catch (_) { }
                            return;
                        }

                        const fallbackTitle = picked
                            .map((id) => {
                                const u = (__messagesUsersById && typeof __messagesUsersById === 'object') ? __messagesUsersById[id] : null;
                                const dn = safeTrim(u && (u.displayName || u.display_name));
                                const un = safeTrim(u && u.username);
                                return dn || un || id;
                            })
                            .filter(Boolean)
                            .slice(0, 3)
                            .join(', ') || 'Conversation';

                        const title = rawTitle || fallbackTitle;

                        confirmBtn.disabled = true;
                        confirmBtn.textContent = 'Creating…';

                        const res = await fetch(`${API_URL}?action=messagesConversationUpsert`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title, member_user_ids: picked })
                        });
                        handleMessagesAuthFailure(res);
                        const data = await res.json().catch(() => null);
                        if (!data || !data.ok || !data.messagesConversationUpsert) {
                            const msg = (data && data.error) ? String(data.error) : 'Failed to create conversation';
                            try { if (typeof showToast === 'function') showToast(msg, 'error'); } catch (_) { }
                            return;
                        }

                        const conv = data.messagesConversationUpsert;
                        const conversationId = safeTrim(conv && (conv.conversation_id || conv.conversationId));
                        if (!conversationId) {
                            try { if (typeof showToast === 'function') showToast('Failed to create conversation', 'error'); } catch (_) { }
                            return;
                        }

                        // Close + open.
                        try { closeModal(true); } catch (_) { }
                        try { window.loadSmsThreads(true); } catch (_) { }
                        try { await window.openSmsThread(conversationId); } catch (_) { }
                    } catch (err) {
                        console.error('[dash-messages] create chat failed', err);
                        try { if (typeof showToast === 'function') showToast('Failed to create conversation', 'error'); } catch (_) { }
                    } finally {
                        try {
                            confirmBtn.disabled = false;
                            confirmBtn.textContent = 'Create Chat';
                        } catch (_) { }
                    }
                };
            } catch (_) {
                // ignore
            }

            try {
                setTimeout(() => {
                    try { document.getElementById('messagesNewConvTitle')?.focus?.(); } catch (_) { }
                }, 50);
            } catch (_) { }
        } catch (err) {
            console.error('[dash-messages] messagesOpenNewConversationModal failed', err);
            try { if (typeof showToast === 'function') showToast('Failed to open new conversation', 'error'); } catch (_) { }
        }
    }

    window.messagesOpenNewConversationModal = messagesOpenNewConversationModal;

    function getActiveMemberUserIds() {
        try {
            const fromMembers = Array.isArray(__messagesActiveMembers) ? __messagesActiveMembers : [];
            const ids = fromMembers
                .map((m) => safeTrim(m && (m.user_id || m.userId || m.member_user_id || m.memberUserId)))
                .filter((x) => x && isUuidLike(x));
            const uniq = Array.from(new Set(ids));
            if (uniq.length) return uniq;
        } catch (_) { }

        try {
            const draft = Array.isArray(__smsDraftRecipients) ? __smsDraftRecipients : [];
            const ids = draft.map((x) => safeTrim(x)).filter((x) => x && isUuidLike(x));
            return Array.from(new Set(ids));
        } catch (_) { }

        return [];
    }

    async function renameConversationFromUi() {
        const conversationId = safeTrim(typeof __smsActiveThreadId !== 'undefined' ? __smsActiveThreadId : '');
        const isNewDraft = !conversationId;

        let currentTitle = '';
        try {
            const header = document.getElementById('smsThreadHeader');
            const titleEl = header ? header.querySelector('.sms-thread-header__title') : null;
            currentTitle = safeTrim(titleEl && titleEl.textContent);
        } catch (_) { }

        const proposed = safeTrim(prompt(isNewDraft ? 'Name this conversation (optional)' : 'Rename conversation', currentTitle || ''));
        if (!proposed) {
            if (isNewDraft) __messagesDraftTitle = '';
            return;
        }

        if (isNewDraft) {
            __messagesDraftTitle = proposed;
            try {
                const header = document.getElementById('smsThreadHeader');
                const titleEl = header ? header.querySelector('.sms-thread-header__title') : null;
                if (titleEl) titleEl.textContent = proposed;
            } catch (_) { }
            return;
        }

        if (typeof __smsThreadIsLoading !== 'undefined' && __smsThreadIsLoading) {
            try { if (typeof showToast === 'function') showToast('Conversation is still loading…', 'warning'); } catch (_) { }
            return;
        }

        const memberIds = getActiveMemberUserIds();
        if (!memberIds.length) {
            try { if (typeof showToast === 'function') showToast('Cannot rename: members not loaded', 'error'); } catch (_) { }
            return;
        }

        const res = await fetch(`${API_URL}?action=messagesConversationUpsert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_id: conversationId, title: proposed, member_user_ids: memberIds })
        });
        handleMessagesAuthFailure(res);
        const data = await res.json().catch(() => null);
        if (!data || !data.ok || !data.messagesConversationUpsert) {
            const msg = (data && data.error) ? String(data.error) : 'Failed to rename conversation';
            try { if (typeof showToast === 'function') showToast(msg, 'error'); } catch (_) { }
            return;
        }

        try {
            const header = document.getElementById('smsThreadHeader');
            const titleEl = header ? header.querySelector('.sms-thread-header__title') : null;
            if (titleEl) titleEl.textContent = proposed;
        } catch (_) { }

        try { if (typeof showToast === 'function') showToast('Conversation renamed', 'success'); } catch (_) { }
        try { window.loadSmsThreads(true); } catch (_) { }
    }

    function bindConversationTitleRenameOnce() {
        try {
            const header = document.getElementById('smsThreadHeader');
            const titleEl = header ? header.querySelector('.sms-thread-header__title') : null;
            if (!titleEl) return;
            if (titleEl.dataset && titleEl.dataset.renameBound === '1') return;
            if (titleEl.dataset) titleEl.dataset.renameBound = '1';

            titleEl.title = 'Click to name/rename';
            titleEl.style.cursor = 'pointer';
            titleEl.addEventListener('click', () => {
                renameConversationFromUi().catch((err) => {
                    console.error('[dash-messages] rename failed', err);
                    try { if (typeof showToast === 'function') showToast('Rename failed', 'error'); } catch (_) { }
                });
            });
        } catch (_) {
            // ignore
        }
    }

    async function ensureMeLoaded() {
        if (__messagesMyUserId) return;
        const res = await fetch(`${API_URL}?action=dashboardMe`, { cache: 'no-store' });
        handleMessagesAuthFailure(res);
        const data = await res.json();
        if (!res.ok || !data || !data.ok || !data.me) throw new Error(data && data.error || 'Failed to load messaging account');
        __messagesMyUserId = safeTrim(data.me.userId || '');
    }

    async function ensureUsersLoaded() {
        const now = Date.now();
        if (__messagesUsersLoadedAt && (now - __messagesUsersLoadedAt) < 30000 && Array.isArray(__messagesUsersCache) && __messagesUsersCache.length) {
            return;
        }
        const res = await fetch(`${API_URL}?action=messagesUsers`, { cache: 'no-store' });
        handleMessagesAuthFailure(res);
        const data = await res.json();
        if (!res.ok || !data || !data.ok || !Array.isArray(data.messagesUsers)) throw new Error(data && data.error || 'Failed to load messaging accounts');

        const list = data.messagesUsers;
        const byId = {};
        for (const u of list) {
            const id = safeTrim(u && u.userId);
            if (!id) continue;
            byId[id] = u;
        }
        __messagesUsersCache = list;
        __messagesUsersById = byId;
        __messagesUsersLoadedAt = now;
    }

    function getUserLabelById(userId) {
        const id = safeTrim(userId);
        if (!id) return '';
        const u = (__messagesUsersById && typeof __messagesUsersById === 'object') ? __messagesUsersById[id] : null;
        if (!u) return id;
        const dn = safeTrim(u.displayName);
        const un = safeTrim(u.username);
        return dn || un || id;
    }

    function deriveMemberSummary(members) {
        try {
            const rows = Array.isArray(members) ? members : [];
            const labels = rows
                .map((m) => safeTrim(m && (m.display_name || m.displayName || m.username)))
                .filter(Boolean);
            const uniq = Array.from(new Set(labels));
            const shown = uniq.slice(0, 3);
            const extra = Math.max(0, uniq.length - shown.length);
            if (!shown.length) return '';
            return extra > 0 ? `${shown.join(', ')} + ${extra} more` : shown.join(', ');
        } catch {
            return '';
        }
    }

    function updateMessagesUnreadUi(conversations, opts) {
        try {
            const rows = Array.isArray(conversations) ? conversations : [];
            const activeId = safeTrim(typeof __smsActiveThreadId !== 'undefined' ? __smsActiveThreadId : '');
            const seenState = loadMessagesSeenState();

            if (!__messagesUnreadInitialized) {
                let seeded = false;
                for (const row of rows) {
                    const id = safeTrim(row && (row.conversation_id || row.conversationId));
                    const sig = getConversationMessageSignature(row);
                    if (!id || !sig || seenState[id]) continue;
                    seenState[id] = sig;
                    seeded = true;
                }
                if (seeded) saveMessagesSeenState(seenState);
            }

            const normalizedRows = rows.map((row) => {
                const id = safeTrim(row && (row.conversation_id || row.conversationId));
                const sig = getConversationMessageSignature(row);
                const backendUnread = Number(row && (row.unread_count || row.unreadCount)) || 0;
                const derivedUnread = (!backendUnread && id && sig && seenState[id] && seenState[id] !== sig && id !== activeId) ? 1 : 0;
                const unread = backendUnread || derivedUnread;
                return {
                    ...(row || {}),
                    unread_count: unread,
                    unreadCount: unread
                };
            });

            if (activeId) {
                const activeRow = normalizedRows.find((row) => safeTrim(row && (row.conversation_id || row.conversationId)) === activeId);
                if (activeRow) {
                    const sig = getConversationMessageSignature(activeRow);
                    if (sig) markConversationSeen(activeId, sig);
                    activeRow.unread_count = 0;
                    activeRow.unreadCount = 0;
                }
            }

            const total = normalizedRows.reduce((sum, row) => sum + (Number(row && (row.unread_count || row.unreadCount)) || 0), 0);

            const badge = document.getElementById('smsNavUnreadBadge');
            if (badge) {
                if (total > 0) {
                    badge.style.display = 'inline-flex';
                    badge.textContent = total > 99 ? '99+' : String(total);
                } else {
                    badge.style.display = 'none';
                    badge.textContent = '';
                }
            }

            const allowToast = !!(opts && opts.allowToast);
            const isActive = isMessagesTabActive();
            if (allowToast && __messagesUnreadInitialized && total > __messagesLastUnreadTotal && !isActive) {
                const bumped = normalizedRows.find((row) => (Number(row && (row.unread_count || row.unreadCount)) || 0) > 0);
                const title = safeTrim(bumped && bumped.title) || 'Messages';
                try {
                    if (typeof showToast === 'function') showToast(`New message in ${title}`, 'info');
                } catch (_) { }
            }

            __messagesLastUnreadTotal = total;
            __messagesUnreadInitialized = true;
            return normalizedRows;
        } catch (_) {
            // ignore
        }
        return Array.isArray(conversations) ? conversations : [];
    }

    function setMessagesPolishStatus(text, tone) {
        try {
            const el = document.getElementById('smsPolishStatus');
            if (!el) return;
            el.textContent = safeTrim(text);
            if (tone) el.setAttribute('data-tone', tone);
            else el.removeAttribute('data-tone');
        } catch (_) {
            // ignore
        }
    }

    function setMessagesPolishBusy(isBusy) {
        try {
            const btn = document.getElementById('smsPolishBtn');
            if (!btn) return;
            btn.classList.toggle('is-busy', !!isBusy);
            btn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
        } catch (_) {
            // ignore
        }
    }

    function getActiveConversationContext() {
        const title = (() => {
            try {
                const titleEl = document.querySelector('#smsThreadHeader .sms-thread-header__title');
                return safeTrim(titleEl && titleEl.textContent);
            } catch (_) {
                return '';
            }
        })();

        const teammates = (() => {
            const active = Array.isArray(__messagesActiveMembers) ? __messagesActiveMembers : [];
            if (active.length) {
                return active
                    .map((m) => safeTrim(m && (m.display_name || m.displayName || m.username)))
                    .filter(Boolean);
            }
            const draft = Array.isArray(__smsDraftRecipients) ? __smsDraftRecipients : [];
            return draft.map(getUserLabelById).filter(Boolean);
        })();

        const recentMessages = (Array.isArray(__smsActiveMessages) ? __smsActiveMessages : [])
            .slice(-6)
            .map((m) => ({
                sent_by: safeTrim(m && (m.sent_by_display_name || m.sent_by_username)) || 'Teammate',
                body: safeTrim(m && m.body)
            }))
            .filter((m) => m.body);

        return {
            conversation_title: title || safeTrim(__messagesDraftTitle) || 'Internal chat',
            teammate_names: teammates,
            recent_messages: recentMessages
        };
    }

    window.messagesPolishDraft = function () {
        (async () => {
            try {
                const input = document.getElementById('smsSendInput');
                const btn = document.getElementById('smsPolishBtn');
                if (!input || input.disabled || !btn || btn.disabled) return;
                if (__messagesPolishInFlight) return;

                const current = String(input.value || '');
                if (!safeTrim(current)) {
                    setMessagesPolishStatus('Add a draft first. The polish pass reviews tone, context, and clarity before rewriting it.', 'warn');
                    return;
                }

                __messagesPolishInFlight = true;
                btn.disabled = true;
                setMessagesPolishBusy(true);
                setMessagesPolishStatus('Reviewing this draft for intent, tone, and teammate context…', 'progress');

                const ctx = getActiveConversationContext();
                const res = await fetch(`${API_URL}?action=messagesPolishDraft`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        draft: current,
                        conversation_title: ctx.conversation_title,
                        teammate_names: ctx.teammate_names,
                        recent_messages: ctx.recent_messages
                    })
                });
                handleMessagesAuthFailure(res);
                const data = await res.json().catch(() => null);

                if (!data || !data.ok || !data.messagesPolishDraft || !safeTrim(data.messagesPolishDraft.polished_text || data.messagesPolishDraft.polishedText)) {
                    const msg = safeTrim(data && data.error) || 'Unable to polish this draft right now';
                    setMessagesPolishStatus(msg, 'warn');
                    return;
                }

                const payload = data.messagesPolishDraft;
                const polished = safeTrim(payload.polished_text || payload.polishedText);
                const summary = safeTrim(payload.summary || 'Rewritten for a clearer internal message.');
                const changes = Array.isArray(payload.changes) ? payload.changes.map((v) => safeTrim(v)).filter(Boolean) : [];

                input.value = polished;
                try { input.focus(); } catch (_) { }
                try { input.setSelectionRange(polished.length, polished.length); } catch (_) { }

                const feedback = [summary, changes.slice(0, 2).join(' • ')].filter(Boolean).join(' — ');
                setMessagesPolishStatus(feedback || 'Draft repurposed for a clearer, more context-aware internal message.', 'ok');
            } catch (err) {
                const msg = safeTrim(err && err.message) || 'Unable to polish this draft right now';
                setMessagesPolishStatus(msg, 'warn');
            } finally {
                __messagesPolishInFlight = false;
                setMessagesPolishBusy(false);
                try {
                    const btn = document.getElementById('smsPolishBtn');
                    const input = document.getElementById('smsSendInput');
                    if (btn) btn.disabled = !input || !!input.disabled;
                } catch (_) { }
            }
        })();
    };

    function addRecipientId(userId) {
        const id = safeTrim(userId);
        if (!id) return false;
        if (!Array.isArray(__smsDraftRecipients)) __smsDraftRecipients = [];
        if (__smsDraftRecipients.includes(id)) return false;
        __smsDraftRecipients.push(id);
        try { smsRenderRecipientsBar(); } catch (_) {}
        return true;
    }

    // --- Recipient UI overrides (To: teammates) ---

    window.smsMaybeAutoCreateGroupFromDraftRecipients = function () {
        // Disabled in internal mode.
        return;
    };

    window.smsRenderRecipientsBar = function () {
        const chips = document.getElementById('smsToChips');
        if (!chips) return;

        const rows = Array.isArray(__smsDraftRecipients) ? __smsDraftRecipients : [];
        const html = rows.map((id, idx) => {
            const label = getUserLabelById(id);
            return `
                <span class="sms-to-chip">
                    <span class="sms-to-chip__label" style="cursor: default;">${escapeHtml(label)}</span>
                    <button type="button" class="sms-to-chip__x" onclick="smsRemoveRecipient(${idx})">×</button>
                </span>
            `;
        }).join('');

        chips.innerHTML = html;
    };

    window.smsRenderToSuggestions = function (items) {
        const wrap = document.getElementById('smsToSuggest');
        if (!wrap) return;
        const rows = Array.isArray(items) ? items : [];
        if (!rows.length) {
            wrap.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }
        wrap.style.display = 'block';
        wrap.innerHTML = rows.map((u) => {
            const id = safeTrim(u && (u.userId || u.user_id));
            const title = safeTrim(u && (u.displayName || u.display_name)) || safeTrim(u && u.username) || id;
            const sub = safeTrim(u && u.username);
            return `
                <button type="button" class="sms-to-suggest__row" onclick="smsPickRecipientSuggestion('${escapeHtml(id)}')">
                    <div class="sms-to-suggest__title">${escapeHtml(title)}</div>
                    ${sub ? `<div class="sms-to-suggest__sub">${escapeHtml(sub)}</div>` : ''}
                </button>
            `;
        }).join('');
    };

    window.smsPickRecipientSuggestion = function (userId) {
        const id = safeTrim(userId);
        if (!id) return;
        addRecipientId(id);
        try {
            const input = document.getElementById('smsToInput');
            if (input) input.value = '';
        } catch (_) { }
        try {
            __smsRecipientSuggest = [];
        } catch (_) { }
        try { window.smsRenderToSuggestions([]); } catch (_) { }
        try { document.getElementById('smsToInput')?.focus?.(); } catch (_) { }
    };

    window.smsAddRecipientsFromText = function (text) {
        const raw = safeTrim(text);
        if (!raw) return 0;

        // Allow comma/semicolon separation.
        const parts = raw.split(/[\s,;\n\r\t]+/g).map((p) => safeTrim(p)).filter(Boolean);
        let added = 0;

        const users = Array.isArray(__messagesUsersCache) ? __messagesUsersCache : [];
        for (const p of parts) {
            if (isUuidLike(p)) {
                if (addRecipientId(p)) added++;
                continue;
            }
            const key = safeUpper(p);
            const hit = users.find((u) => safeUpper(u && u.username) === key || safeUpper(u && u.displayName) === key);
            if (hit && hit.userId) {
                if (addRecipientId(hit.userId)) added++;
            }
        }
        return added;
    };

    window.smsHandleToInputInput = async function (ev) {
        try {
            const input = ev && ev.target;
            const value = safeTrim(input && input.value);
            if (!value) {
                __smsRecipientSuggest = [];
                window.smsRenderToSuggestions([]);
                return;
            }

            await ensureUsersLoaded();
            const q = safeUpper(value);
            const all = Array.isArray(__messagesUsersCache) ? __messagesUsersCache : [];
            const picked = new Set(Array.isArray(__smsDraftRecipients) ? __smsDraftRecipients : []);

            const rows = all
                .filter((u) => {
                    const id = safeTrim(u && u.userId);
                    if (!id) return false;
                    if (picked.has(id)) return false;
                    const dn = safeUpper(u && u.displayName);
                    const un = safeUpper(u && u.username);
                    return dn.includes(q) || un.includes(q);
                })
                .slice(0, 10);

            __smsRecipientSuggest = rows;
            window.smsRenderToSuggestions(rows);
        } catch (_) {
            // ignore
        }
    };

    window.smsHandleToInputKeydown = function (ev) {
        try {
            if (!ev) return;
            const key = String(ev.key || '');
            if (key === 'Escape') {
                __smsRecipientSuggest = [];
                window.smsRenderToSuggestions([]);
                return;
            }
            if (key === 'Enter' || key === ',' || key === ';') {
                ev.preventDefault();
                const input = ev.target;
                const value = safeTrim(input && input.value);
                if (!value) return;

                const added = window.smsAddRecipientsFromText(value);
                if (added > 0) {
                    if (input) input.value = '';
                    __smsRecipientSuggest = [];
                    window.smsRenderToSuggestions([]);
                    return;
                }

                try {
                    if (typeof showToast === 'function') showToast('Pick a teammate from the list', 'warning');
                } catch (_) { }
            }
        } catch (_) {
            // ignore
        }
    };

    window.smsMaybePromptContactForSingleRecipient = function () {
        // Disabled in internal mode.
        return;
    };

    // --- Conversation list overrides (internal conversations) ---

    function formatThreadTime(ts) {
        try {
            if (typeof formatSmsThreadTime === 'function') return formatSmsThreadTime(ts);
        } catch (_) { }
        try {
            if (!ts) return '';
            const d = new Date(String(ts));
            if (isNaN(d.getTime())) return '';
            return d.toLocaleDateString();
        } catch {
            return '';
        }
    }

    window.smsShouldSuppressThreadRow = function () {
        return false;
    };

    window.loadSmsGroups = async function (silent) {
        try {
            __smsGroups = [];
        } catch (_) { }
        try {
            __smsPhoneToGroup = new Map();
        } catch (_) { }
        syncLegacyWindowState();
        if (!silent) {
            try { window.renderSmsConversations(); } catch (_) { }
        }
    };

    window.loadSmsThreads = async function (silent) {
        const list = document.getElementById('smsThreadsList');
        const requestSeq = ++__messagesThreadsRequestSeq;
        const authGeneration = __messagesAuthGeneration;
        if (list && !silent) list.innerHTML = '<div class="spinner"></div>';

        try {
            const res = await fetch(`${API_URL}?action=messagesConversations`, { cache: 'no-store' });
            const data = await res.json().catch(() => null);
            if (requestSeq !== __messagesThreadsRequestSeq || authGeneration !== __messagesAuthGeneration) return;
            handleMessagesAuthFailure(res);
            if (!res.ok || !data || !data.ok || !Array.isArray(data.messagesConversations)) {
                const msg = (data && data.error) ? String(data.error) : 'Failed to load conversations';
                __messagesAuthBlocked = __messagesAuthBlocked || res.status === 401 || res.status === 403 || /not authenticated|unauthorized|401/i.test(msg);
                syncMessagesComposerAvailability();
                if (list) list.innerHTML = `<div class="sms-error" style="padding: 10px;">${escapeHtml(msg)}</div>`;
                return;
            }

            __messagesAuthKnown = true;
            __messagesAuthBlocked = false;
            syncMessagesComposerAvailability();
            __smsThreads = updateMessagesUnreadUi(data.messagesConversations, { allowToast: !!silent });
            __smsGroups = [];
            syncLegacyWindowState();
            try { window.renderSmsConversations(); } catch (_) { }
        } catch (e) {
            if (requestSeq !== __messagesThreadsRequestSeq || authGeneration !== __messagesAuthGeneration) return;
            const msg = (e && e.message) ? e.message : 'Failed to load conversations';
            __messagesAuthBlocked = __messagesAuthBlocked || /not authenticated|unauthorized|401/i.test(msg);
            syncMessagesComposerAvailability();
            if (list) list.innerHTML = `<div class="sms-error" style="padding: 10px;">${escapeHtml(msg)}</div>`;
        }
    };

    window.smsFilterThreads = function () {
        try { window.renderSmsConversations(); } catch (_) { }
    };

    window.renderSmsConversations = function () {
        const list = document.getElementById('smsThreadsList');
        if (!list) return;

        const threads = Array.isArray(__smsThreads) ? __smsThreads : [];
        const q = safeUpper(document.getElementById('smsThreadSearch')?.value || '');

        const visible = !q
            ? threads
            : threads.filter((c) => {
                const title = safeUpper(c && c.title);
                const prev = safeUpper(c && (c.last_message_preview || c.lastMessagePreview));
                return title.includes(q) || prev.includes(q);
            });

        if (!visible.length) {
            list.innerHTML = '<div class="sms-empty" style="padding: 10px;">No conversations yet.</div>';
            return;
        }

        const activeId = safeTrim(__smsActiveThreadId);

        list.innerHTML = visible.map((c) => {
            const id = safeTrim(c && (c.conversation_id || c.conversationId));
            const title = safeTrim(c && c.title) || 'Conversation';
            const preview = safeTrim(c && (c.last_message_preview || c.lastMessagePreview)) || '';
            const time = formatThreadTime(c && (c.last_message_at || c.lastMessageAt));
            const unread = Number(c && (c.unread_count || c.unreadCount)) || 0;
            const activeClass = (id && id === activeId) ? 'is-active' : '';

            return `
                <div class="sms-thread-row ${activeClass}" onclick="openSmsThread('${escapeHtml(id)}')">
                    <div class="sms-thread-row__top">
                        <div class="sms-thread-row__name">${escapeHtml(title)}</div>
                        <div style="display:flex; align-items:center; gap:8px; flex:0 0 auto;">
                            ${time ? `<span class="sms-thread-row__time">${escapeHtml(time)}</span>` : ''}
                            ${unread > 0 ? `<span class="sms-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
                        </div>
                    </div>
                    <div class="sms-thread-row__preview">${escapeHtml(preview)}</div>
                </div>
            `;
        }).join('');
    };

    // --- Thread open/refresh/pagination ---

    function computePageFromMessages(messages, limit) {
        const rows = Array.isArray(messages) ? messages : [];
        const oldest = rows.length ? safeTrim(rows[0] && rows[0].created_at) : '';
        return {
            limit: Number(limit || 120) || 120,
            has_more: rows.length >= (Number(limit || 120) || 120),
            next_before: oldest || null,
            before: null
        };
    }

    function renderNoConversationSelected() {
        const header = document.getElementById('smsThreadHeader');
        if (header) {
            header.innerHTML = `
                <div class="sms-thread-header__row">
                    <div style="min-width: 220px;">
                        <div class="sms-thread-header__title">Select a conversation</div>
                        <div class="sms-thread-header__subtitle">Choose a teammate conversation on the left, or start a new internal chat</div>
                    </div>
                </div>
            `;
        }

        const messagesWrap = document.getElementById('smsMessagesList');
        if (messagesWrap) messagesWrap.innerHTML = '<div class="sms-empty">No conversation selected.</div>';
    }

    window.openSmsGroup = async function () {
        try {
            if (typeof showToast === 'function') showToast('Groups are not used for internal messages', 'warning');
        } catch (_) { }
    };

    window.refreshActiveSmsGroup = async function () {
        return;
    };

    window.renderSmsThreadHeader = function (conversation) {
        const header = document.getElementById('smsThreadHeader');
        if (!header) return;

        const title = safeTrim(conversation && (conversation.title || conversation.name)) || 'Conversation';
        const sub = deriveMemberSummary(__messagesActiveMembers);
        const conversationId = safeTrim(conversation && (conversation.conversation_id || conversation.conversationId || __smsActiveThreadId));
        const canDelete = !!conversationId && (typeof isAdminRole === 'function' ? !!isAdminRole() : false);

        header.innerHTML = `
            <div class="sms-thread-header__row">
                <div style="min-width: 220px;">
                    <div class="sms-thread-header__title">${escapeHtml(title)}</div>
                    <div class="sms-thread-header__subtitle">${escapeHtml(sub || 'Internal conversation')}</div>
                </div>
                ${canDelete ? `
                    <div class="sms-thread-header__actions">
                        <button id="messagesDeleteConversationBtn" class="sms-thread-header__action is-danger" type="button">Delete chat</button>
                    </div>
                ` : ''}
            </div>
        `;

        try { bindConversationTitleRenameOnce(); } catch (_) { }
        if (canDelete) {
            try {
                const deleteBtn = document.getElementById('messagesDeleteConversationBtn');
                if (deleteBtn) {
                    deleteBtn.onclick = () => {
                        try { window.messagesDeleteConversation(conversationId, title); } catch (_) { }
                    };
                }
            } catch (_) { }
        }
    };

    window.renderSmsMessages = function (messages, opts) {
        const wrap = document.getElementById('smsMessagesList');
        if (!wrap) return;

        const autoScroll = !!(opts && opts.autoScroll);
        const rows = Array.isArray(messages) ? messages : [];
        if (!rows.length) {
            wrap.innerHTML = '<div class="sms-empty">No messages yet.</div>';
            return;
        }

        const myUsername = safeUpper(typeof currentUser !== 'undefined' ? currentUser : '');
        const myUserId = safeTrim(__messagesMyUserId);

        const html = rows.map((m) => {
            const body = safeTrim(m && m.body);
            const createdAt = m && m.created_at ? new Date(String(m.created_at)) : null;
            const ts = createdAt && !isNaN(createdAt.getTime())
                ? (typeof formatSmsRelative === 'function' ? formatSmsRelative(createdAt.toISOString(), 'thread') : createdAt.toLocaleString())
                : '';

            const sentById = safeTrim(m && m.sent_by_user_id);
            const sentByUsername = safeUpper(m && m.sent_by_username);
            const sentByName = safeTrim(m && (m.sent_by_display_name || m.sent_by_username));

            const isOut = (!!myUserId && sentById && sentById === myUserId) || (!!myUsername && sentByUsername && sentByUsername === myUsername);
            const who = isOut ? 'You' : (sentByName || 'Teammate');

            const meta = `${escapeHtml(who)}${ts ? ` • ${escapeHtml(ts)}` : ''}`;
            const sender = !isOut && who ? `<div class="sms-sender">${escapeHtml(who)}</div>` : '';

            return `
                <div class="sms-msg has-stack ${isOut ? 'is-outbound' : 'is-inbound'}">
                    <div class="sms-msg__stack">
                        ${sender}
                        <div class="sms-bubble ${isOut ? 'is-outbound' : 'is-inbound'}">${escapeHtml(body)}</div>
                        <div class="sms-meta ${isOut ? 'is-outbound' : 'is-inbound'}">${meta}</div>
                    </div>
                </div>
            `;
        }).join('');

        wrap.innerHTML = html;
        if (autoScroll) {
            try { wrap.scrollTop = wrap.scrollHeight; } catch (_) { }
        }
    };

    window.openSmsThread = async function (conversationId) {
        const id = safeTrim(conversationId);
        if (!id) return;
        const requestSeq = ++__messagesOpenThreadRequestSeq;
        const authGeneration = __messagesAuthGeneration;

        __smsActiveThreadId = id;
        __smsActiveGroupId = '';
        __smsActiveGroupMembers = [];
        __smsActiveContactPhone = '';
        __smsActiveContactName = '';
        __smsThreadIsLoading = true;
        __smsDraftRecipients = [];
        __smsActiveMessages = [];
        __smsMessagesPage = { limit: 120, has_more: false, before: null, next_before: null };
        syncLegacyWindowState();

        try { smsSetComposerEnabled(false); } catch (_) { }
        try { window.renderSmsConversations(); } catch (_) { }

        const messagesWrap = document.getElementById('smsMessagesList');
        if (messagesWrap) messagesWrap.innerHTML = '<div class="spinner"></div>';

        try {
            await ensureMeLoaded();

            const limit = Number(__smsMessagesPage && __smsMessagesPage.limit || 120) || 120;
            const res = await fetch(`${API_URL}?action=messagesConversation&conversation_id=${encodeURIComponent(id)}&limit=${encodeURIComponent(String(limit))}`, { cache: 'no-store' });
            const data = await res.json().catch(() => null);
            if (requestSeq !== __messagesOpenThreadRequestSeq || safeTrim(__smsActiveThreadId) !== id || authGeneration !== __messagesAuthGeneration) return;
            handleMessagesAuthFailure(res);
            if (!res.ok || !data || !data.ok || !data.messagesConversation) {
                const msg = (data && data.error) ? String(data.error) : 'Failed to load conversation';
                if (messagesWrap) messagesWrap.innerHTML = `<div class="sms-error">${escapeHtml(msg)}</div>`;
                return;
            }

            const payload = data.messagesConversation;
            const conv = payload.conversation || {};
            const members = Array.isArray(payload.members) ? payload.members : [];
            const msgs = Array.isArray(payload.messages) ? payload.messages : [];
            const viewerId = safeTrim(payload.viewer_user_id || payload.viewerUserId);
            if (viewerId) __messagesMyUserId = viewerId;

            __messagesActiveMembers = members;
            __smsActiveMessages = (typeof smsClampKeepNewest === 'function') ? smsClampKeepNewest(msgs) : msgs;
            __smsMessagesPage = computePageFromMessages(__smsActiveMessages, limit);
            syncLegacyWindowState();

            try {
                __smsActiveLastMessageId = (msgs && msgs.length) ? safeTrim(msgs[msgs.length - 1].message_id) : '';
            } catch (_) {
                __smsActiveLastMessageId = '';
            }
            syncLegacyWindowState();

            markConversationSeenFromPayload(conv, __smsActiveMessages);

            window.renderSmsThreadHeader(conv);
            window.renderSmsMessages(__smsActiveMessages, { autoScroll: true });
            try { if (typeof smsBindMessagesScrollOnce === 'function') smsBindMessagesScrollOnce(); } catch (_) { }

            __smsThreadIsLoading = false;
            try { smsSetComposerEnabled(true); } catch (_) { }
            try { document.getElementById('smsSendInput')?.focus?.(); } catch (_) { }

            try { window.loadSmsThreads(true); } catch (_) { }
        } catch (e) {
            if (requestSeq !== __messagesOpenThreadRequestSeq || safeTrim(__smsActiveThreadId) !== id) return;
            const msg = (e && e.message) ? e.message : 'Failed to load conversation';
            if (messagesWrap) messagesWrap.innerHTML = `<div class="sms-error">${escapeHtml(msg)}</div>`;
        } finally {
            if (requestSeq === __messagesOpenThreadRequestSeq && safeTrim(__smsActiveThreadId) === id) {
                __smsThreadIsLoading = false;
            }
        }
    };

    window.refreshActiveSmsThread = async function (options = {}) {
        const id = safeTrim(__smsActiveThreadId);
        if (!id) return;
        if (__smsThreadIsLoading) return;
        const requestSeq = ++__messagesRefreshThreadRequestSeq;
        const authGeneration = __messagesAuthGeneration;

        const messagesWrap = document.getElementById('smsMessagesList');
        const previousTop = messagesWrap ? messagesWrap.scrollTop : 0;
        const wasNearBottom = !messagesWrap || messagesWrap.scrollHeight - previousTop - messagesWrap.clientHeight <= 80;

        try {
            const limit = Number(__smsMessagesPage && __smsMessagesPage.limit || 120) || 120;
            const res = await fetch(`${API_URL}?action=messagesConversation&conversation_id=${encodeURIComponent(id)}&limit=${encodeURIComponent(String(limit))}`, { cache: 'no-store' });
            const data = await res.json().catch(() => null);
            if (requestSeq !== __messagesRefreshThreadRequestSeq || safeTrim(__smsActiveThreadId) !== id || authGeneration !== __messagesAuthGeneration) return;
            handleMessagesAuthFailure(res);
            if (!res.ok || !data || !data.ok || !data.messagesConversation) {
                throw new Error(data && data.error || 'Failed to refresh conversation');
            }

            const payload = data.messagesConversation;
            const conv = payload.conversation || {};
            const members = Array.isArray(payload.members) ? payload.members : [];
            const msgs = Array.isArray(payload.messages) ? payload.messages : [];
            const viewerId = safeTrim(payload.viewer_user_id || payload.viewerUserId);
            if (viewerId) __messagesMyUserId = viewerId;
            const lastId = msgs.length ? safeTrim(msgs[msgs.length - 1].message_id) : '';

            const changed = (lastId && lastId !== __smsActiveLastMessageId) || (!__smsActiveLastMessageId && msgs.length);
            if (!changed) return;

            __smsActiveLastMessageId = lastId;
            __messagesActiveMembers = members;

            // Replace with latest set; keep page cursor consistent.
            __smsActiveMessages = (typeof smsClampKeepNewest === 'function') ? smsClampKeepNewest(msgs) : msgs;
            __smsMessagesPage = computePageFromMessages(__smsActiveMessages, limit);
            syncLegacyWindowState();

            markConversationSeenFromPayload(conv, __smsActiveMessages);

            window.renderSmsThreadHeader(conv);
            window.renderSmsMessages(__smsActiveMessages, { autoScroll: !!wasNearBottom });
            if (messagesWrap && !wasNearBottom) messagesWrap.scrollTop = previousTop;
            try { if (typeof smsBindMessagesScrollOnce === 'function') smsBindMessagesScrollOnce(); } catch (_) { }

            if (options.refreshList !== false) await window.loadSmsThreads(true);
        } catch (error) {
            console.error('[dash-messages] Conversation refresh failed', error);
        }
    };

    window.smsLoadOlderMessages = async function () {
        try {
            if (__smsThreadIsLoading) return;
            if (__smsMessagesLoadingOlder) return;
            if (!__smsMessagesPage || !__smsMessagesPage.has_more || !__smsMessagesPage.next_before) return;

            const before = safeTrim(__smsMessagesPage.next_before);
            if (!before) return;

            const wrap = document.getElementById('smsMessagesList');
            const prevHeight = wrap ? wrap.scrollHeight : 0;
            const prevTop = wrap ? wrap.scrollTop : 0;

            __smsMessagesLoadingOlder = true;
            const limit = Number(__smsMessagesPage.limit || 120) || 120;
            const id = safeTrim(__smsActiveThreadId);
            if (!id) return;

            const res = await fetch(`${API_URL}?action=messagesConversation&conversation_id=${encodeURIComponent(id)}&before=${encodeURIComponent(before)}&limit=${encodeURIComponent(String(limit))}`, { cache: 'no-store' });
            handleMessagesAuthFailure(res);
            const data = await res.json().catch(() => null);
            if (!data || !data.ok || !data.messagesConversation) return;

            const payload = data.messagesConversation;
            const older = Array.isArray(payload.messages) ? payload.messages : [];

            if (typeof smsMergeMessages === 'function') {
                __smsActiveMessages = smsMergeMessages(older, __smsActiveMessages);
            } else {
                const byId = new Map();
                for (const m of ([]).concat(older || [], __smsActiveMessages || [])) {
                    const mid = safeTrim(m && m.message_id);
                    if (!mid) continue;
                    byId.set(mid, m);
                }
                __smsActiveMessages = Array.from(byId.values()).sort((a, b) => {
                    const ta = a && a.created_at ? new Date(String(a.created_at)).getTime() : 0;
                    const tb = b && b.created_at ? new Date(String(b.created_at)).getTime() : 0;
                    return ta - tb;
                });
            }

            if (typeof smsClampKeepOldest === 'function') {
                __smsActiveMessages = smsClampKeepOldest(__smsActiveMessages);
            }

            __smsMessagesPage = computePageFromMessages(__smsActiveMessages, limit);
            syncLegacyWindowState();

            window.renderSmsMessages(__smsActiveMessages, { autoScroll: false });
            try { if (typeof smsBindMessagesScrollOnce === 'function') smsBindMessagesScrollOnce(); } catch (_) { }

            if (wrap) {
                const newHeight = wrap.scrollHeight;
                const delta = Math.max(0, newHeight - prevHeight);
                wrap.scrollTop = prevTop + delta;
            }
        } catch (_) {
            // ignore
        } finally {
            __smsMessagesLoadingOlder = false;
        }
    };

    // --- Send flow (internal) ---

    async function createConversationIfNeeded() {
        if (__smsActiveThreadId) return safeTrim(__smsActiveThreadId);

        const rec = Array.isArray(__smsDraftRecipients) ? __smsDraftRecipients.slice(0) : [];
        const clean = rec.map((x) => safeTrim(x)).filter((x) => x && isUuidLike(x));
        if (!clean.length) return '';

        await ensureUsersLoaded();
        const fallbackTitle = clean.map(getUserLabelById).filter(Boolean).slice(0, 3).join(', ') || 'Conversation';
        const title = safeTrim(__messagesDraftTitle) || fallbackTitle;

        const res = await fetch(`${API_URL}?action=messagesConversationUpsert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, member_user_ids: clean })
        });
        handleMessagesAuthFailure(res);

        const data = await res.json().catch(() => null);
        if (!data || !data.ok || !data.messagesConversationUpsert) {
            const msg = (data && data.error) ? String(data.error) : 'Failed to create conversation';
            throw new Error(msg);
        }

        const conv = data.messagesConversationUpsert;
        const id = safeTrim(conv && (conv.conversation_id || conv.conversationId));
        if (!id) throw new Error('Failed to create conversation');
        __messagesDraftTitle = '';
        return id;
    }

    window.messagesDeleteConversation = async function (conversationId, conversationTitle) {
        const id = safeTrim(conversationId || __smsActiveThreadId);
        if (!id) return;

        if (!(typeof isAdminRole === 'function' && isAdminRole())) {
            try { if (typeof showToast === 'function') showToast('Only admins can delete chats', 'warning'); } catch (_) { }
            return;
        }

        const title = safeTrim(conversationTitle) || 'this conversation';
        let confirmed = false;
        try {
            if (typeof showConfirm === 'function') {
                confirmed = await showConfirm(
                    'Delete chat?',
                    `This will permanently remove ${title} and all of its messages for everyone.`,
                    { confirmText: 'Delete chat', cancelText: 'Cancel', danger: true, width: '520px' }
                );
            }
        } catch (error) {
            console.error('[dash-messages] Delete confirmation failed', error);
            showToast('Could not confirm chat deletion. Nothing was deleted.', 'error');
        }
        if (!confirmed) return;

        const deleteBtn = document.getElementById('messagesDeleteConversationBtn');

        try {
            if (deleteBtn) {
                deleteBtn.disabled = true;
                deleteBtn.textContent = 'Deleting…';
            }

            const res = await fetch(`${API_URL}?action=messagesDeleteConversation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation_id: id })
            });
            handleMessagesAuthFailure(res);
            const data = await res.json().catch(() => null);
            if (!data || !data.ok || !data.messagesDeleteConversation) {
                const msg = (data && data.error) ? String(data.error) : 'Failed to delete chat';
                throw new Error(msg);
            }

            if (safeTrim(__smsActiveThreadId) === id) {
                __smsActiveThreadId = '';
                __smsActiveGroupId = '';
                __smsActiveGroupMembers = [];
                __smsActiveContactPhone = '';
                __smsActiveContactName = '';
                __smsDraftRecipients = [];
                __smsActiveMessages = [];
                __smsActiveLastMessageId = '';
                __messagesActiveMembers = [];
                __smsMessagesPage = { limit: 120, has_more: false, before: null, next_before: null };
                syncLegacyWindowState();
                renderNoConversationSelected();
                try { smsSetComposerEnabled(false); } catch (_) { }
            }

            try { if (typeof showToast === 'function') showToast('Chat deleted', 'success'); } catch (_) { }
            try { await window.loadSmsThreads(true); } catch (_) { }
        } catch (e) {
            const msg = (e && e.message) ? e.message : 'Failed to delete chat';
            try { if (typeof showToast === 'function') showToast(msg, 'error'); } catch (_) { }
        } finally {
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.textContent = 'Delete chat';
            }
        }
    };

    window.smsSendFromComposer = async function (ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        if (__messagesSendInFlight) return;
        if (!__messagesAuthKnown || __messagesAuthBlocked) {
            showToast('Messaging sign-in required.', 'error');
            return;
        }

        const input = document.getElementById('smsSendInput');
        const toInput = document.getElementById('smsToInput');
        const btn = document.getElementById('smsSendBtn');

        const text = safeTrim(input && input.value);
        if (__smsThreadIsLoading) {
            try { if (typeof showToast === 'function') showToast('Conversation is still loading…', 'warning'); } catch (_) { }
            return;
        }

        try {
            __messagesSendInFlight = true;
            if (btn) btn.disabled = true;

            // Resolve typed recipients inside the same submission guard as the send.
            const manualToText = safeTrim(toInput && toInput.value);
            if (!__smsActiveThreadId) {
                if (manualToText) {
                    await ensureUsersLoaded();
                    const added = window.smsAddRecipientsFromText(manualToText);
                    if (added > 0 && toInput) toInput.value = '';
                }
                if (!Array.isArray(__smsDraftRecipients) || __smsDraftRecipients.length === 0) {
                    showToast('Add at least one teammate', 'warning');
                    return;
                }
            }
            if (!text) {
                showToast('Message required', 'warning');
                return;
            }

            const conversationId = await createConversationIfNeeded();
            if (!conversationId) {
                try { if (typeof showToast === 'function') showToast('Add at least one teammate', 'warning'); } catch (_) { }
                return;
            }

            const res = await fetch(`${API_URL}?action=messagesSend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation_id: conversationId, body: text })
            });
            handleMessagesAuthFailure(res);

            const data = await res.json().catch(() => null);
            if (!res.ok || !data || !data.ok || !data.messagesSend) {
                const msg = (data && data.error) ? String(data.error) : 'Send failed';
                try { if (typeof showToast === 'function') showToast(msg, 'error'); } catch (_) { }
                return;
            }

            if (input && safeTrim(input.value) === text) input.value = '';

            // Ensure we are in the conversation view.
            if (__smsActiveThreadId !== conversationId) {
                await window.openSmsThread(conversationId);
            } else {
                await window.refreshActiveSmsThread({ refreshList: false });
            }

            try { window.loadSmsThreads(true); } catch (_) { }
        } catch (e) {
            const msg = (e && e.message) ? e.message : 'Send failed';
            try { if (typeof showToast === 'function') showToast(msg, 'error'); } catch (_) { }
        } finally {
            __messagesSendInFlight = false;
            if (btn) btn.disabled = __messagesAuthBlocked;
            try { input && input.focus && input.focus(); } catch (_) { }
        }
    };

    // --- New message UX copy ---

    const originalSmsStartNewMessage = window.smsStartNewMessage;
    window.smsStartNewMessage = function (prefill) {
        try {
            if (typeof window.messagesCanStartConversation === 'function' && !window.messagesCanStartConversation()) {
                syncMessagesComposerAvailability();
                return;
            }
        } catch (_) { }

        try {
            if (typeof window.messagesOpenNewConversationModal === 'function') {
                window.messagesOpenNewConversationModal();
                return;
            }
        } catch (_) { }

        // Fallback to legacy inline compose flow if the modal isn't available.
        try {
            if (typeof originalSmsStartNewMessage === 'function') {
                originalSmsStartNewMessage(prefill);
            }
        } catch (_) { }
    };

    // --- Auto refresh ---

    window.startSmsAutoRefresh = function () {
        try {
            if (typeof stopSmsAutoRefresh === 'function') stopSmsAutoRefresh();
        } catch (_) { }

        try {
            if (!isMessagesTabActive()) return;
        } catch (_) { }

        const generation = __smsAutoRefreshGeneration;
        const loop = async () => {
            try {
                if (generation !== __smsAutoRefreshGeneration || !isMessagesTabActive() || document.hidden) return;
                if (__smsActiveThreadId) {
                    await window.refreshActiveSmsThread({ refreshList: false });
                }
                if (generation !== __smsAutoRefreshGeneration || !isMessagesTabActive()) return;
                await window.loadSmsThreads(true);
            } catch (error) {
                console.error('[dash-messages] Poll failed', error);
            } finally {
                if (generation === __smsAutoRefreshGeneration && isMessagesTabActive()) {
                    __smsAutoRefreshTimer = setTimeout(loop, 2500);
                }
            }
        };

        try {
            __smsAutoRefreshTimer = setTimeout(loop, 1200);
        } catch (_) { }
    };

    // --- One-time UI tweaks ---

    function initUiOnce() {
        try {
            // Ensure sidebar tab label reads "Messages".
            const nav = document.querySelector('.app-sidebar-nav-item[data-tab="sms"]');
            if (nav) {
                const labelEl = nav.querySelector('.app-sidebar-nav-item__label');
                if (labelEl) labelEl.textContent = 'Messages';
            }

            const topTab = document.querySelector('.tab[data-tab="sms"]');
            if (topTab) topTab.textContent = 'Messages';

            const paneTitle = document.querySelector('#sms-pane .sms-inbox__title');
            if (paneTitle) paneTitle.textContent = 'Messages';

            const paneSub = document.querySelector('#sms-pane .sms-inbox__subtitle');
            if (paneSub) paneSub.textContent = 'Internal conversations';

            const headerSub = document.querySelector('#sms-pane .sms-thread-header__subtitle');
            if (headerSub && !safeTrim(typeof __smsActiveThreadId !== 'undefined' ? __smsActiveThreadId : '')) {
                headerSub.textContent = 'Choose a teammate conversation on the left, or start a new internal chat';
            }
        } catch (_) { }

        try {
            const hidden = document.getElementById('smsHiddenEntry');
            if (hidden) hidden.style.display = 'none';
        } catch (_) { }

        try { bindConversationTitleRenameOnce(); } catch (_) { }
    }

    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initUiOnce);
        } else {
            initUiOnce();
        }
    } catch (_) { }
})();
