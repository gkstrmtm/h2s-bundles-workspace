// Custom Select Injection
const customSelectStyle = document.createElement('style');
customSelectStyle.innerHTML = `
/* Custom Select overriding */
.custom-select-wrapper {
    position: relative;
    display: inline-block;
    min-width: 140px;
    font-family: inherit;
    font-size: 13px;
    user-select: none;
    -webkit-user-select: none;
}
.custom-select-trigger {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    padding: 6px 14px;
    color: #475569;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    transition: all 0.2s ease;
    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
}
.custom-select-trigger:hover {
    background: #f8fafc;
    border-color: #cbd5e1;
}
.custom-select-caret {
    width: 14px;
    height: 14px;
    stroke: #94a3b8;
    transition: transform 0.2s ease;
}
.custom-select-wrapper.open .custom-select-caret {
    transform: rotate(180deg);
}
.custom-select-wrapper.open .custom-select-trigger {
    border-color: var(--azure, #007aff);
    box-shadow: 0 0 0 3px rgba(0,122,255,0.1);
}
.custom-select-options {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    border: 1px solid #e2e8f0;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(-8px) scale(0.95);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    z-index: 9999;
    padding: 6px;
    min-width: 100%;
}
.custom-select-wrapper.open .custom-select-options {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateY(0) scale(1);
}
.custom-select-option {
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    color: #334155;
    font-weight: 500;
    transition: background 0.15s ease, color 0.15s ease;
    white-space: nowrap;
}
.custom-select-option:hover {
    background: #f1f5f9;
    color: #0f172a;
}
.custom-select-option.selected {
    background: rgba(0, 122, 255, 0.08);
    color: var(--azure, #007aff);
    font-weight: 600;
}
  /* Mac style indicator for gallery tiles */
.mac-select-ring {
    position: absolute;
    top: 12px;
    left: 12px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.8);
    background: rgba(0,0,0,0.2);
    cursor: pointer;
    z-index: 10;
    transition: all 0.2s ease;
    box-shadow: 0 2px 5px rgba(0,0,0,0.15);
}
.gallery-tile:hover .mac-select-ring {
    border-color: #fff;
    background: rgba(255,255,255,0.3);
}
.gallery-tile.selected .mac-select-ring {
    background: var(--azure, #007aff);
    border-color: var(--azure, #007aff);
}
.gallery-tile.selected .mac-select-ring::after {
    content: '';
    position: absolute;
    top: 4px;
    left: 7px;
    width: 4px;
    height: 8px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
}
`;
document.head.appendChild(customSelectStyle);

function initializeCustomSelects() {
    document.querySelectorAll('select:not(.customized)').forEach(select => {
        if (select.style.display === 'none' || select.multiple) return;
        select.classList.add('customized');
        select.style.display = 'none';

        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        if (select.id) wrapper.id = select.id + '-wrapper';
        if (select.style.float) wrapper.style.float = select.style.float;
        
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        
        const updateTriggerText = () => {
            const opt = select.options[select.selectedIndex];
            trigger.innerHTML = \`<span>\${opt ? opt.text : ''}</span><svg class="custom-select-caret" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M6 9l6 6 6-6"/></svg>\`;
        };
        updateTriggerText();

        const optionsMenu = document.createElement('div');
        optionsMenu.className = 'custom-select-options';

        const renderOptions = () => {
            optionsMenu.innerHTML = '';
            Array.from(select.options).forEach((opt, idx) => {
                if (opt.value === "" && !opt.text.trim()) return;
                
                const optDiv = document.createElement('div');
                optDiv.className = 'custom-select-option';
                optDiv.textContent = opt.text;
                if (select.selectedIndex === idx) optDiv.classList.add('selected');
                
                optDiv.onclick = (e) => {
                    e.stopPropagation();
                    select.selectedIndex = idx;
                    select.dispatchEvent(new Event('change'));
                    updateTriggerText();
                    wrapper.classList.remove('open');
                    Array.from(optionsMenu.children).forEach(c => c.classList.remove('selected'));
                    optDiv.classList.add('selected');
                };
                optionsMenu.appendChild(optDiv);
            });
        };
        renderOptions();

        trigger.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
                if (w !== wrapper) w.classList.remove('open');
            });
            renderOptions();
            wrapper.classList.toggle('open');
            
            if (wrapper.classList.contains('open')) {
                const rect = optionsMenu.getBoundingClientRect();
                if (rect.right > window.innerWidth) {
                    optionsMenu.style.left = 'auto';
                    optionsMenu.style.right = '0';
                } else {
                    optionsMenu.style.left = '0';
                    optionsMenu.style.right = 'auto';
                }
            }
        };

        select.addEventListener('change', updateTriggerText);

        wrapper.appendChild(trigger);
        wrapper.appendChild(optionsMenu);
        select.parentNode.insertBefore(wrapper, select.nextSibling);
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select-wrapper.open').forEach(w => w.classList.remove('open'));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initializeCustomSelects();
    const observer = new MutationObserver((mutations) => {
        let shouldInit = false;
        for (let m of mutations) {
            if (m.addedNodes.length) {
                for (let n of m.addedNodes) {
                    if (n.nodeType === 1 && (n.tagName === 'SELECT' || n.querySelector('select'))) {
                        shouldInit = true;
                        break;
                    }
                }
            }
            if (shouldInit) break;
        }
        if (shouldInit) initializeCustomSelects();
    });
    observer.observe(document.body, { childList: true, subtree: true });
});
