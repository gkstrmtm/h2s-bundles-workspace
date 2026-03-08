$ErrorActionPreference = "Stop"
$path = "frontend\dash.js"
Write-Host "Reading $path..."
$content = Get-Content $path -Raw

if (-not ($content -match "initSidebarGroupToggles")) {
    Write-Host "Force-injecting initSidebarGroupToggles..." -ForegroundColor Yellow
    
    $anchor = "const DASH_SESSION_TOKEN_KEY = 'h2s_dashboard_session_token_v1';"
    
    if ($content.Contains($anchor)) {
        $inject = @"
        // Sidebar group collapse/expand (dash.html uses inline onclick handlers)
        // IMPORTANT: This must exist immediately (before boot/login), or clicking the sidebar
        // throws: "toggleSidebarGroup is not defined".
        (function initSidebarGroupToggles() {
            try {
                if (typeof window !== 'undefined' && typeof window.toggleSidebarGroup === 'function') { return; }

                const setSidebarGroupOpen = (groupEl, open, opts = {}) => {
                    try {
                        if (!groupEl) return;
                        const groupId = String(groupEl.getAttribute('data-group-id') || '').trim();
                        groupEl.classList.toggle('open', !!open);
                        const headerBtn = groupEl.querySelector('.app-sidebar-group-header');
                        if (headerBtn) headerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
                        if (opts && opts.persist && groupId) {
                            try { localStorage.setItem(`h2s_sidebar_group_${groupId}`, open ? 'open' : 'closed'); } catch (_) {}
                        }
                    } catch (_) {}
                };

                const findGroupElById = (groupId) => {
                    const gid = String(groupId || '').trim();
                    if (!gid) return null;
                    const groups = document.querySelectorAll('.app-sidebar-group[data-group-id]');
                    for (const g of groups) {
                        if (String(g.getAttribute('data-group-id') || '').trim() === gid) return g;
                    }
                    return null;
                };

                window.toggleSidebarGroup = (groupId) => {
                    try {
                        const groupEl = findGroupElById(groupId);
                        if (!groupEl) return;
                        const isOpen = groupEl.classList.contains('open');
                        setSidebarGroupOpen(groupEl, !isOpen, { persist: true });
                    } catch (e) { console.warn('toggleSidebarGroup failed:', e); }
                };

                const restoreSidebarGroups = () => {
                    try {
                        document.querySelectorAll('.app-sidebar-group[data-group-id]').forEach((groupEl) => {
                            const gid = String(groupEl.getAttribute('data-group-id') || '').trim();
                            if (!gid) return;
                            let saved = null;
                            try { saved = localStorage.getItem(`h2s_sidebar_group_${gid}`); } catch (_) {}
                            if (saved === 'open') setSidebarGroupOpen(groupEl, true, { persist: false });
                            if (saved === 'closed') setSidebarGroupOpen(groupEl, false, { persist: false });
                        });
                    } catch (_) {}
                };

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', restoreSidebarGroups);
                } else {
                    restoreSidebarGroups();
                }
            } catch (_) {}
        })();
"@
        
        $newContent = $content.Replace($anchor, "$inject`n$anchor")
        Set-Content $path -Value $newContent -NoNewline
        Write-Host "DONE: Injected code into $path" -ForegroundColor Green
    } else {
        Write-Host "Could not find simple anchor: $anchor" -ForegroundColor Red
    }
} else {
    Write-Host "Already patched." -ForegroundColor Green
}


