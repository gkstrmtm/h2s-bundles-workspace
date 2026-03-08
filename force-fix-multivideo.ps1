
$path = "frontend/dash.js"
if (-not (Test-Path $path)) {
    Write-Error "File not found: $path"
    exit 1
}

$content = Get-Content $path -Raw

# 1. Inject Helper if missing
if ($content -notmatch "window.selectVideoForResource = function") {
    $helperFn = @'
        // -- MULTI-VIDEO HELPER START --
        window.selectVideoForResource = function(resourceId, url, title, btnId) {
            const playerContainer = document.getElementById('player-' + resourceId);
            if (!playerContainer) return;

            // Highlight active button
            const listContainer = document.getElementById('list-' + resourceId);
            if (listContainer) {
                const btns = listContainer.querySelectorAll('.video-select-btn');
                btns.forEach(b => {
                    if (b.id === btnId) {
                        b.style.background = '#eef2ff';
                        b.style.borderColor = '#c7d2fe';
                        b.style.color = '#3730a3';
                    } else {
                        b.style.background = '#ffffff';
                        b.style.borderColor = '#e5e7eb';
                        b.style.color = '#374151';
                    }
                });
            }
            
            // Build embed HTML (reused logic)
            let embedHtml = '';
            let videoId = '';
            let platform = 'loom';

            if (url.includes('youtube.com') || url.includes('youtu.be')) {
                platform = 'youtube';
                const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                if (ytMatch) videoId = ytMatch[1];
            } else if (url.includes('loom.com/share/')) {
                videoId = url.split('loom.com/share/')[1].split('?')[0];
            } else if (url.includes('loom.com/embed/')) {
                videoId = url.split('loom.com/embed/')[1].split('?')[0];
            }

            if (videoId && platform === 'youtube') {
                embedHtml = `<div style="position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"><iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1" style="position: absolute; inset: 0; width: 100%; height: 100%; border: 0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
            } else if (videoId && platform === 'loom') {
                embedHtml = `<div style="position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"><iframe src="https://www.loom.com/embed/${videoId}?hide_title=true&hide_owner=true&autoplay=1" allow="fullscreen; picture-in-picture" style="position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block;"></iframe></div>`;
            } else {
                embedHtml = `<div style="padding: 32px; text-align: center; background: #f8f9fa; border-radius: 8px; border: 2px dashed #e0e0e0; display:flex; flex-direction:column; gap:12px; align-items:center; justify-content:center; aspect-ratio: 16/9;">
                    <div style="font-weight:700; color:#374151;">${title}</div>
                    <a href="${url}" target="_blank" style="display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; background: var(--cobalt); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px; transition: transform 0.2s;">Open Video Link</a>
                </div>`;
            }
            playerContainer.innerHTML = embedHtml;
        };
        // -- MULTI-VIDEO HELPER END --

        function formatDate(dateStr) {
'@
    $content = $content.Replace("function formatDate(dateStr) {", $helperFn)
}

# 2. Find block using Regex
$startRegex = "if\s*\(type\s*===\s*'VIDEO'\)\s*\{"
$endRegex = "\}\s*else\s*if\s*\(type\s*===\s*'PDF'\s*&&\s*resource\.URL\)\s*\{"

$startMatch = [regex]::Match($content, $startRegex)
if (-not $startMatch.Success) {
    Write-Error "Start marker not found"
    exit 1
}

# Search for end match starting from the start match position
$rest = $content.Substring($startMatch.Index)
$endMatch = [regex]::Match($rest, $endRegex)

if (-not $endMatch.Success) {
    Write-Error "End marker not found"
    exit 1
}

# The true end index (start of the end marker) relative to content
$endIndex = $startMatch.Index + $endMatch.Index

# Prefix and Suffix
$prefix = $content.Substring(0, $startMatch.Index)
$suffix = $content.Substring($endIndex)

# The new block (Video rendering logic)
$newBlock = @'
if (type === 'VIDEO') {
                    const videoList = (videos.length ? videos : (resource.URL ? [{ url: resource.URL, title: 'Main Video' }] : []));
                    const primary = videoList[0] || {};
                    const primaryUrl = String(primary.url || '').trim();
                    const playerId = 'player-' + resource.Resource_ID;
                    const listId = 'list-' + resource.Resource_ID;

                    // Initial Embed
                    let initialEmbed = '';
                    if (primaryUrl) {
                        let vId = '';
                        let plat = 'loom';
                        if (primaryUrl.includes('youtube.com') || primaryUrl.includes('youtu.be')) {
                            plat = 'youtube';
                            const m = primaryUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                            if (m) vId = m[1];
                        } else if (primaryUrl.includes('loom.com/share/')) {
                            vId = primaryUrl.split('loom.com/share/')[1].split('?')[0];
                        } else if (primaryUrl.includes('loom.com/embed/')) {
                            vId = primaryUrl.split('loom.com/embed/')[1].split('?')[0];
                        }

                        if (vId && plat === 'youtube') {
                            initialEmbed = `<div style="position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"><iframe src="https://www.youtube.com/embed/${vId}" style="position: absolute; inset: 0; width: 100%; height: 100%; border: 0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
                        } else if (vId && plat === 'loom') {
                            initialEmbed = `<div style="position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"><iframe src="https://www.loom.com/embed/${vId}?hide_title=true&hide_owner=true" allow="fullscreen; picture-in-picture" style="position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block;"></iframe></div>`;
                        } else {
                            initialEmbed = `<div style="padding: 32px; text-align: center; background: #f8f9fa; border-radius: 8px; border: 2px dashed #e0e0e0;"><a href="${primaryUrl}" target="_blank" style="display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; background: var(--cobalt); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px;">Open Video Link</a></div>`;
                        }
                    } else {
                        initialEmbed = '<div style="padding: 20px; text-align:center; color:#6b7280;">No video links available.</div>';
                    }

                    // Video List (Carousel/Selection)
                    const carouselHtml = videoList.length > 1 ? `
                        <div id="${listId}" style="margin-top: 16px; display:flex; flex-direction:column; gap:8px; max-height: 240px; overflow-y: auto; padding-right: 4px;">
                            <div style="font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">In this module (${videoList.length})</div>
                            ${videoList.map((v, idx) => {
                                const url = String(v.url || '').trim();
                                const title = String(v.title || `Part ${idx + 1}`).trim();
                                const isActive = idx === 0;
                                const btnId = 'vid-btn-' + resource.Resource_ID + '-' + idx;
                                const watched = isWatchedFor(v);
                                const urlEnc = encodeURIComponent(url);
                                const titleEscaped = title.replace(/'/g, "\\'");

                                return `
                                    <div class="video-select-btn" id="${btnId}" 
                                         style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid ${isActive ? '#c7d2fe' : '#e5e7eb'}; background:${isActive ? '#eef2ff' : '#ffffff'}; border-radius:8px; cursor:pointer; transition:all 0.2s;"
                                         onclick="window.selectVideoForResource('${resource.Resource_ID}', '${url}', '${titleEscaped}', '${btnId}')">
                                        
                                        <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                                            <div style="width:24px; height:24px; background:${isActive ? '#4338ca' : '#f3f4f6'}; color:${isActive ? 'white' : '#6b7280'}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; flex-shrink:0;">${idx + 1}</div>
                                            <div style="font-weight:600; font-size:13px; color:${isActive ? '#3730a3' : '#374151'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</div>
                                        </div>
                                        
                                        <div style="display:flex; align-items:center; gap:8px;" onclick="event.stopPropagation()">
                                            <label style="display:flex; align-items:center; gap:4px; font-size:11px; color:#6b7280; cursor:pointer;">
                                                <input type="checkbox" ${watched ? 'checked' : ''} onchange="setTrainingAssetWatched('${resource.Resource_ID}', '${urlEnc}', this.checked)" />
                                                Done
                                            </label>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : '';
                    
                    const singleCheckHtml = videoList.length === 1 ? `
                        <div style="margin-top:12px; display:flex; justify-content:flex-end;">
                             <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#374151; font-weight:700; user-select:none; background:#f9fafb; padding:6px 12px; border-radius:20px; border:1px solid #e5e7eb;">
                                <input type="checkbox" ${isWatchedFor(videoList[0]) ? 'checked' : ''} onchange="setTrainingAssetWatched('${resource.Resource_ID}', '${encodeURIComponent(String(videoList[0].url||''))}', this.checked)" />
                                Mark as Watched
                            </label>
                        </div>
                    ` : '';

                    content = `
                        <div id="${playerId}">
                            ${initialEmbed}
                        </div>
                        ${carouselHtml}
                        ${singleCheckHtml}
                    `;
                    
                
'@
    
$fullContent = $prefix + $newBlock + "`n                " + $suffix
Set-Content -Path $path -Value $fullContent -Encoding UTF8
Write-Host "Successfully patched renderTrainingResources"
