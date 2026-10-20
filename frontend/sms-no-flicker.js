// Preserve conversation rows and focus when polling returns the same visible data.
(function () {
    if (window.__smsNoFlickerInstalled) return;
    let lastSignature = '';
    let lastNode = null;
    let lastCount = 0;

    function getSignature() {
        const groups = Array.isArray(window.__smsGroups) ? window.__smsGroups : [];
        const threads = Array.isArray(window.__smsThreads) ? window.__smsThreads : [];
        const visibleThreads = typeof window.smsShouldSuppressThreadRow === 'function'
            ? threads.filter(thread => !window.smsShouldSuppressThreadRow(thread))
            : threads;
        return JSON.stringify([
            document.getElementById('smsThreadSearch')?.value || '',
            window.__smsActiveGroupId || '',
            window.__smsActiveThreadId || '',
            groups.map(group => [
                group.group_id, group.title || group.name, group.unread_count || group.unreadCount,
                group.last_message_at || group.lastMessageAt,
                group.last_message_preview || group.lastMessagePreview,
                group.member_count || group.memberCount,
            ]),
            visibleThreads.map(thread => [
                thread.conversation_id || thread.conversationId || thread.thread_id,
                thread.title || thread.contact_name, thread.contact_phone,
                thread.unread_count || thread.unreadCount,
                thread.last_message_at || thread.lastMessageAt,
                thread.last_message_preview || thread.lastMessagePreview,
            ]),
        ]);
    }

    function install() {
        if (window.__smsNoFlickerInstalled) return true;
        const originalRender = window.renderSmsConversations;
        if (typeof originalRender !== 'function') return false;
        window.renderSmsConversations = function () {
            const list = document.getElementById('smsThreadsList');
            const signature = getSignature();
            if (list && signature === lastSignature && list.firstChild === lastNode && list.childNodes.length === lastCount) return;
            const result = originalRender.apply(this, arguments);
            lastSignature = signature;
            lastNode = list && list.firstChild;
            lastCount = list ? list.childNodes.length : 0;
            return result;
        };
        window.__smsNoFlickerInstalled = true;
        return true;
    }

    const start = Date.now();
    const tick = () => {
        if (install()) return;
        if (Date.now() - start >= 10000) {
            console.error('[sms-no-flicker] Messaging renderer did not become available');
            if (typeof window.showToast === 'function') window.showToast('Messaging could not finish loading. Reload the dashboard.', 'error');
            return;
        }
        setTimeout(tick, 100);
    };
    tick();
})();
