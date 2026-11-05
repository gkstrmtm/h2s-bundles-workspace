(function (global) {
    'use strict';
    const records = new Map();
    function register(options) {
        records.get(options.id)?.destroy();
        let disposed = false, pending = null, invalidated = true, lastAttempt = -Infinity, updatedAt = null;
        const interval = Math.max(30000, options.intervalMs || 60000);
        const minimum = Math.max(1000, options.minIntervalMs || 15000);
        const active = () => !disposed && document.visibilityState !== 'hidden' && options.isActive();
        const notify = (status, reason, error) => options.onState?.({status, reason, error, updatedAt});
        function invalidate() { invalidated = true; }
        function request(reason = 'return', {force = false} = {}) {
            if (!active()) return Promise.resolve(false);
            if (options.isDirty?.()) { notify('stale', reason); return Promise.resolve(false); }
            if (pending) return pending;
            if (!force && !invalidated && Date.now() - lastAttempt < minimum) return Promise.resolve(false);
            lastAttempt = Date.now(); invalidated = false;
            notify('loading', reason);
            pending = Promise.resolve().then(() => options.refresh(reason)).then(result => {
                if (disposed) return false;
                if (result === false) { notify('stale', reason); return false; }
                updatedAt = Date.now();
                if (!invalidated) notify('current', reason);
                return true;
            }).catch(error => {
                if (!disposed) { console.error('Automatic data synchronization failed:', options.id, error.message); notify('error', reason, error); }
                return false;
            }).finally(() => {
                pending = null;
                if (invalidated && active()) request('mutation');
            });
            return pending;
        }
        const focus = () => request('focus');
        const visible = () => { if (document.visibilityState === 'visible') request('visible'); };
        global.addEventListener('focus', focus);
        document.addEventListener('visibilitychange', visible);
        const timer = global.setInterval(() => request('poll'), interval);
        const result = {request, invalidate, destroy() {
            disposed = true; global.clearInterval(timer);
            global.removeEventListener('focus', focus);
            document.removeEventListener('visibilitychange', visible);
            if (records.get(options.id) === result) records.delete(options.id);
        }};
        records.set(options.id, result);
        return result;
    }
    function preserveView(root, render) {
        const tabs = [...root.querySelectorAll('[role="tablist"]')].map(list =>
            list.querySelector('[aria-selected="true"]')?.textContent);
        const scroll = global.scrollY;
        render();
        root.querySelectorAll('[role="tablist"]').forEach((list, index) => {
            const tab = [...list.querySelectorAll('[role="tab"]')].find(item => item.textContent === tabs[index]);
            if (tab) tab.click();
        });
        if (global.scrollY !== scroll) global.scrollTo?.({top:scroll,left:global.scrollX,behavior:'instant'});
    }
    function interacting(root) {
        return !!root.querySelector('[aria-haspopup][aria-expanded="true"],[role="combobox"][aria-expanded="true"]') ||
            root.contains(document.activeElement) && document.activeElement.matches('input,textarea,select');
    }
    function feedback(root, selector, state, retry) {
        const target = root.querySelector(selector);
        if (!target) return;
        const messages = {
            loading: 'Checking for updates…',
            stale: 'Updates paused while you edit. Your input is retained.',
            current: 'Updated ' + (state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString() : 'just now'),
            error: 'Could not update: ' + (state.error?.message || 'Data unavailable') + '. Previously loaded records may be stale.'
        };
        target.textContent = messages[state.status];
        target.setAttribute('role', state.status === 'error' ? 'alert' : 'status');
        if (state.status === 'error') {
            const button = document.createElement('button');
            button.type = 'button'; button.textContent = 'Retry';
            button.addEventListener('click', retry);
            target.append(' ', button);
        }
    }
    function signal(parent = new global.AbortController().signal) {
        const controller = new global.AbortController();
        const abort = () => controller.abort();
        const timer = global.setTimeout(abort, 15000);
        controller.signal.addEventListener('abort', () => {
            global.clearTimeout(timer); parent.removeEventListener('abort', abort);
        }, {once:true});
        if (parent.aborted) abort();
        else parent.addEventListener('abort', abort, {once:true});
        return controller.signal;
    }
    global.H2SDataSync = {register, preserveView, interacting, feedback, signal};
})(window);
