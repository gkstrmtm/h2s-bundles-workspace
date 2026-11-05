(function (global) {
    'use strict';
        let __dashboardCustomSelectBound = false;
        let __dashboardCustomSelectObserver = null;
        let __dashboardCustomSelectSyncQueued = false;
        let __dashboardCustomSelectIdCounter = 0;
        let __dashboardCustomSelectBooted = false;
        function h2sDispatchDateInputEvents(inputEl) {
            if (!inputEl) return;
            try { inputEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
            try { inputEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        }

        let h2sDatePopupCounter = 0;

        function h2sBuildDateInputOptions(inputEl) {
            const kind = inputEl.dataset.h2sDateType || inputEl.type;
            const isTimeOnly = kind === 'time';
            const isDateTime = kind === 'datetime-local';
            const shared = {
                allowInput: true,
                clickOpens: !inputEl.readOnly,
                disableMobile: true,
                monthSelectorType: 'static',
                minuteIncrement: 1,
                ...window.h2sDatePopupOptions,
                altInput: true,
                altInputClass: 'form-input h2s-flatpickr-alt-input',
                onReady: function(_, __, instance) {
                    const alt = instance.altInput;
                    alt.id = inputEl.id ? `${inputEl.id}DateDisplay` : '';
                    alt.placeholder = inputEl.getAttribute('placeholder') || (isTimeOnly ? 'Pick a time' : isDateTime ? 'Pick date and time' : 'Pick a date');
                    const labels = Array.from(inputEl.labels || [], node => {
                        const copy = node.cloneNode(true);
                        copy.querySelectorAll('input,button,select,textarea').forEach(child => child.remove());
                        return copy.textContent.trim();
                    }).filter(Boolean).join(' ');
                    alt.setAttribute('aria-label', inputEl.getAttribute('aria-label') || labels || alt.placeholder);
                    alt.setAttribute('aria-haspopup', 'dialog');
                    const popup = instance.calendarContainer;
                    if (popup) {
                        popup.id = `${alt.id || `h2sDatePopup${++h2sDatePopupCounter}`}Popup`;
                        popup.setAttribute('role', 'dialog');
                        popup.setAttribute('aria-label', alt.getAttribute('aria-label'));
                        alt.setAttribute('aria-controls', popup.id);
                        const clear = document.createElement('button');
                        clear.type = 'button';
                        clear.className = 'h2s-date-clear';
                        clear.textContent = 'Clear';
                        clear.addEventListener('click', () => { instance.clear(); instance.close(); alt.focus(); });
                        popup.appendChild(clear);
                    }
                    alt.addEventListener('keydown', event => {
                        if (event.key === 'ArrowDown' && !inputEl.readOnly && !inputEl.disabled) {
                            event.preventDefault();
                            instance.open();
                        }
                        if (event.key === 'Escape') { instance.close(); alt.focus(); }
                    });
                    alt.addEventListener('focus', () => h2sSyncDateInput(inputEl));
                },
                onOpen: function(_, __, instance) {
                    window.h2sDatePopupOptions.onOpen(_, __, instance);
                    h2sSyncDateInput(inputEl);
                    instance.altInput.setAttribute('aria-expanded', 'true');
                },
                onClose: function(_, __, instance) {
                    window.h2sDatePopupOptions.onClose(_, __, instance);
                    instance.altInput.setAttribute('aria-expanded', 'false');
                }
            };

            if (isTimeOnly) {
                return Object.assign({}, shared, {
                    enableTime: true,
                    noCalendar: true,
                    dateFormat: 'H:i',
                    altFormat: 'h:i K',
                    time_24hr: false
                });
            }

            return Object.assign({}, shared, {
                enableTime: isDateTime,
                dateFormat: isDateTime ? 'Y-m-d\\TH:i' : 'Y-m-d',
                altFormat: isDateTime ? 'M j, Y h:i K' : 'M j, Y'
            });
        }

        function h2sSyncDateInput(inputEl) {
            const instance = inputEl._flatpickr;
            if (!instance || !instance.altInput) return;
            const alt = instance.altInput;
            if (alt.disabled !== inputEl.disabled) alt.disabled = inputEl.disabled;
            if (alt.required !== inputEl.required) alt.required = inputEl.required;
            if (alt.readOnly !== inputEl.readOnly) alt.readOnly = inputEl.readOnly;
            if (instance.isOpen && (inputEl.readOnly || inputEl.disabled)) instance.close();
            const describedBy = inputEl.getAttribute('aria-describedby');
            if (describedBy) {
                if (alt.getAttribute('aria-describedby') !== describedBy) alt.setAttribute('aria-describedby', describedBy);
            } else if (alt.hasAttribute('aria-describedby')) alt.removeAttribute('aria-describedby');
            const constraints = JSON.stringify([inputEl.min, inputEl.max, inputEl.readOnly]);
            if (constraints !== inputEl.__h2sDateConstraints) {
                const timeOnly = inputEl.dataset.h2sDateType === 'time';
                instance.set(timeOnly ? 'minTime' : 'minDate', inputEl.getAttribute('min') || null);
                instance.set(timeOnly ? 'maxTime' : 'maxDate', inputEl.getAttribute('max') || null);
                instance.set('clickOpens', !inputEl.readOnly);
                inputEl.__h2sDateConstraints = constraints;
            }
            const selected = instance.selectedDates[0];
            const saved = selected ? instance.formatDate(selected, instance.config.dateFormat) : '';
            if (inputEl.value !== saved) instance.setDate(inputEl.value, false, instance.config.dateFormat);
        }

        function h2sInitDateInputs(rootEl) {
            if (typeof window.flatpickr !== 'function') return false;

            const root = rootEl && typeof rootEl.querySelectorAll === 'function' ? rootEl : document;
            const selector = 'input[type="date"], input[type="time"], input[type="datetime-local"], input[data-h2s-date-bound="1"]';
            const inputs = Array.from(root.querySelectorAll(selector));
            if (root.matches && root.matches(selector)) inputs.unshift(root);

            inputs.forEach((inputEl) => {
                if (!inputEl) return;
                if (inputEl._flatpickr?.config && inputEl._flatpickr.altInput?.isConnected) {
                    inputEl.dataset.h2sDateBound = '1';
                    h2sSyncDateInput(inputEl);
                    return;
                }

                if (inputEl._flatpickr) {
                    if (inputEl._flatpickr.config) inputEl._flatpickr.destroy();
                    delete inputEl._flatpickr;
                }
                inputEl.dataset.h2sDateType = inputEl.dataset.h2sDateType || inputEl.type;
                delete inputEl.__h2sDateConstraints;
                window.flatpickr(inputEl, h2sBuildDateInputOptions(inputEl));
                inputEl.dataset.h2sDateBound = '1';
                h2sSyncDateInput(inputEl);
                if (!inputEl.__h2sDateChangeBound) {
                    inputEl.addEventListener('change', () => h2sSyncDateInput(inputEl));
                    inputEl.__h2sDateChangeBound = true;
                }
            });

            return true;
        }

        function h2sDestroyDetachedDateInputs(node) {
            if (node.isConnected || !node.querySelectorAll) return;
            const removed = Array.from(node.querySelectorAll('input[data-h2s-date-bound]'));
            if (node.matches && node.matches('input[data-h2s-date-bound]')) removed.push(node);
            removed.forEach(input => {
                if (input._flatpickr?.config) input._flatpickr.destroy();
                delete input._flatpickr;
                delete input.__h2sDateConstraints;
            });
        }

        try { window.h2sInitDateInputs = h2sInitDateInputs; } catch (_) {}

        function dashboardShouldUseCustomSelect(selectEl) {
            if (!selectEl || !selectEl.matches || !selectEl.matches('select')) return false;
            if (selectEl.multiple) return false;
            const size = parseInt(selectEl.getAttribute('size') || '1', 10);
            if (Number.isFinite(size) && size > 1) return false;
            if (selectEl.hidden) return false;
            const inlineDisplay = String(selectEl.style && selectEl.style.display || '').trim().toLowerCase();
            if (inlineDisplay === 'none') return false;
            if (String(selectEl.dataset.customSelect || '').toLowerCase() === 'off') return false;
            if (String(selectEl.dataset.nativeSelect || '').toLowerCase() === 'false') return false;
            return true;
        }

        function dashboardEnsureCustomSelectId(selectEl) {
            if (!selectEl) return '';
            if (!selectEl.id) {
                __dashboardCustomSelectIdCounter += 1;
                selectEl.id = `dashboardCustomSelect${__dashboardCustomSelectIdCounter}`;
            }
            return String(selectEl.id || '');
        }

        function dashboardGetCustomSelects(container = null) {
            const scope = container && container.querySelectorAll ? container : document;
            return Array.from(scope.querySelectorAll('select')).filter(dashboardShouldUseCustomSelect);
        }

        function dashboardGetCustomSelectShell(selectEl) {
            const shell = selectEl && selectEl.nextElementSibling;
            return shell && shell.classList && shell.classList.contains('dashboard-custom-select-shell')
                ? shell
                : null;
        }

        function dashboardRemoveCustomSelect(selectEl) {
            if (!selectEl) return;
            const shell = dashboardGetCustomSelectShell(selectEl);
            if (shell) {
                try { shell.remove(); } catch (_) {}
            }
            selectEl.classList.remove('dashboard-custom-select-native');
        }

        function dashboardQueueCustomSelectSync() {
            if (__dashboardCustomSelectSyncQueued) return;
            __dashboardCustomSelectSyncQueued = true;
            const run = () => {
                __dashboardCustomSelectSyncQueued = false;
                dashboardSyncAllCustomSelects(document);
                h2sInitDateInputs(document);
            };
            try {
                window.requestAnimationFrame(run);
            } catch (_) {
                window.setTimeout(run, 0);
            }
        }

        function dashboardApplyCustomSelectMetrics(selectEl, shell) {
            if (!selectEl || !shell) return;
            const computed = window.getComputedStyle(selectEl);
            const rect = selectEl.getBoundingClientRect();
            const inlineWidth = String(selectEl.style && selectEl.style.width || '').trim();
            const computedDisplay = String(computed.display || '').trim().toLowerCase();
            const shouldFillWidth = inlineWidth === '100%'
                || computedDisplay === 'block'
                || selectEl.classList.contains('form-select')
                || selectEl.classList.contains('deliverables-select')
                || selectEl.classList.contains('editor-select')
                || selectEl.classList.contains('user-gate-select')
                || selectEl.classList.contains('deliverables-field__control');

            shell.style.display = shouldFillWidth ? 'block' : 'inline-block';
            shell.style.width = rect.width > 0
                ? `${Math.round(rect.width)}px`
                : (inlineWidth || (shouldFillWidth ? '100%' : ''));

            const shadow = computed.boxShadow && computed.boxShadow !== 'none'
                ? computed.boxShadow
                : 'inset 0 1px 0 rgba(255, 255, 255, 0.85)';
            const lineHeight = computed.lineHeight && computed.lineHeight !== 'normal'
                ? computed.lineHeight
                : '1.35';

            shell.style.setProperty('--dash-select-height', parseFloat(computed.height) > 0 ? computed.height : '46px');
            shell.style.setProperty('--dash-select-padding-top', computed.paddingTop || '10px');
            shell.style.setProperty('--dash-select-padding-right', computed.paddingRight || '12px');
            shell.style.setProperty('--dash-select-padding-bottom', computed.paddingBottom || '10px');
            shell.style.setProperty('--dash-select-padding-left', computed.paddingLeft || '12px');
            shell.style.setProperty('--dash-select-border-width', computed.borderTopWidth || '1px');
            shell.style.setProperty('--dash-select-border-style', computed.borderTopStyle || 'solid');
            shell.style.setProperty('--dash-select-border-color', computed.borderTopColor || 'rgba(148, 163, 184, 0.34)');
            shell.style.setProperty('--dash-select-radius', computed.borderRadius || '10px');
            shell.style.setProperty('--dash-select-background', computed.backgroundColor || '#ffffff');
            shell.style.setProperty('--dash-select-color', computed.color || 'var(--cobalt)');
            shell.style.setProperty('--dash-select-font-size', computed.fontSize || '13px');
            shell.style.setProperty('--dash-select-font-weight', computed.fontWeight || '500');
            shell.style.setProperty('--dash-select-line-height', lineHeight);
            shell.style.setProperty('--dash-select-letter-spacing', computed.letterSpacing || 'normal');
            shell.style.setProperty('--dash-select-shadow', shadow);
        }

        function dashboardPositionCustomSelect(trigger, menu) {
            const field = trigger.getBoundingClientRect(), viewport = window.visualViewport;
            const leftEdge = (viewport ? viewport.offsetLeft : 0) + 8;
            const topEdge = (viewport ? viewport.offsetTop : 0) + 8;
            const rightEdge = leftEdge + (viewport ? viewport.width : window.innerWidth) - 16;
            const bottomEdge = topEdge + (viewport ? viewport.height : window.innerHeight) - 16;
            const width = Math.min(field.width, Math.max(0, rightEdge - leftEdge));
            menu.style.width = `${width}px`;
            menu.style.maxHeight = '240px';
            const height = menu.getBoundingClientRect().height;
            const below = Math.max(0, bottomEdge - field.bottom - 4);
            const above = Math.max(0, field.top - topEdge - 4);
            const opensAbove = height > below && above > below;
            menu.style.maxHeight = `${Math.min(240, opensAbove ? above : below)}px`;
            menu.style.left = `${Math.max(leftEdge, Math.min(field.left, rightEdge - width))}px`;
            const fittedHeight = menu.getBoundingClientRect().height;
            menu.style.top = `${opensAbove ? field.top - fittedHeight - 4 : field.bottom + 4}px`;
        }

        function dashboardFocusCustomSelectOption(option, menu) {
            if (!option) return;
            option.focus({ preventScroll: true });
            const item = option.getBoundingClientRect(), box = menu.getBoundingClientRect();
            if (item.top < box.top) menu.scrollTop -= box.top - item.top;
            else if (item.bottom > box.bottom) menu.scrollTop += item.bottom - box.bottom;
        }

        function dashboardSetCustomSelectOpen(selectEl, shouldOpen) {
            if (!selectEl) return;
            const shell = dashboardGetCustomSelectShell(selectEl);
            if (!shell) return;
            const trigger = shell.querySelector('.dashboard-custom-select-trigger');
            const menu = shell.querySelector('.dashboard-custom-select-menu');
            if (!trigger || !menu) return;

            if (shouldOpen && selectEl.disabled) return;
            if (shouldOpen) dashboardCloseCustomSelects(selectEl);

            shell.classList.toggle('is-open', !!shouldOpen);
            trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            menu.hidden = !shouldOpen;

            if (shouldOpen) {
                menu.__search = '';
                menu.__searchAt = 0;
                if (typeof menu.showPopover === 'function' && !menu.matches(':popover-open')) menu.showPopover();
                dashboardPositionCustomSelect(trigger, menu);
                const activeOption = menu.querySelector('.dashboard-custom-select-option.is-selected:not([disabled])')
                    || menu.querySelector('.dashboard-custom-select-option:not([disabled])');
                dashboardFocusCustomSelectOption(activeOption, menu);
            } else if (typeof menu.hidePopover === 'function' && menu.matches(':popover-open')) {
                menu.hidePopover();
            }
        }

        function dashboardCloseCustomSelects(exceptSelect = null) {
            dashboardGetCustomSelects(document).forEach(selectEl => {
                if (!selectEl || selectEl === exceptSelect) return;
                const shell = dashboardGetCustomSelectShell(selectEl);
                if (!shell) return;
                dashboardSetCustomSelectOpen(selectEl, false);
            });
        }

        function dashboardFocusCustomSelectField(id) {
            const selectEl = document.getElementById(id);
            if (!selectEl) return;
            const shell = dashboardGetCustomSelectShell(selectEl);
            const trigger = shell ? shell.querySelector('.dashboard-custom-select-trigger') : null;
            try {
                if (trigger) {
                    trigger.focus();
                    return;
                }
                selectEl.focus();
            } catch (_) {}
        }

        function ensureDashboardCustomSelectBindings() {
            if (__dashboardCustomSelectBound) return;
            __dashboardCustomSelectBound = true;

            document.addEventListener('click', (event) => {
                const target = event && event.target && event.target.closest
                    ? event.target.closest('.dashboard-custom-select-shell')
                    : null;
                if (target) event.preventDefault();
                const label = event.target && event.target.closest ? event.target.closest('label') : null;
                const control = label && label.control;
                if (!target && control && control._flatpickr
                    && !event.target.closest('button,a,input,select,textarea')) {
                    event.preventDefault();
                    control._flatpickr.altInput.focus();
                    if (!control.readOnly && !control.disabled) control._flatpickr.open();
                }
                if (!target && control && control.matches('select.dashboard-custom-select-native')
                    && !event.target.closest('button,a,input,select,textarea')) {
                    event.preventDefault();
                    dashboardFocusCustomSelectField(control.id);
                }
                if (!target) dashboardCloseCustomSelects();
            }, true);

            document.addEventListener('keydown', (event) => {
                if (event && event.key === 'Escape') dashboardCloseCustomSelects();
            }, true);

            document.addEventListener('change', (event) => {
                const target = event && event.target;
                if (target && target.matches && target.matches('select')) dashboardSyncCustomSelect(target);
            }, true);

            document.addEventListener('input', (event) => {
                const target = event && event.target;
                if (target && target.matches && target.matches('select')) dashboardSyncCustomSelect(target);
            }, true);

            window.addEventListener('resize', () => {
                dashboardCloseCustomSelects();
                dashboardQueueCustomSelectSync();
            }, { passive: true });
            document.addEventListener('scroll', event => {
                const menu = document.querySelector('.dashboard-custom-select-shell.is-open .dashboard-custom-select-menu');
                if (menu && event.target !== menu && !menu.contains(event.target)) dashboardCloseCustomSelects();
            }, { passive: true, capture: true });
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', () => dashboardCloseCustomSelects(), { passive: true });
                window.visualViewport.addEventListener('scroll', () => dashboardCloseCustomSelects(), { passive: true });
            }

            if (window.MutationObserver && document.body && !__dashboardCustomSelectObserver) {
                __dashboardCustomSelectObserver = new MutationObserver(records => {
                    records.forEach(record => record.removedNodes.forEach(h2sDestroyDetachedDateInputs));
                    dashboardQueueCustomSelectSync();
                });
                __dashboardCustomSelectObserver.observe(document.body, {
                    subtree: true,
                    childList: true,
                    attributes: true,
                    attributeFilter: ['class', 'style', 'disabled', 'hidden', 'min', 'max', 'readonly', 'required',
                        'value', 'selected', 'label', 'size', 'multiple', 'aria-label', 'aria-describedby']
                });
            }
        }

        function dashboardSyncCustomSelect(selectEl) {
            if (!selectEl) return;
            ensureDashboardCustomSelectBindings();

            if (!dashboardShouldUseCustomSelect(selectEl)) {
                dashboardRemoveCustomSelect(selectEl);
                return;
            }

            const selectId = dashboardEnsureCustomSelectId(selectEl);
            const labelText = Array.from(selectEl.labels || [], label => {
                const copy = label.cloneNode(true);
                copy.querySelectorAll('select,input,textarea,button,.dashboard-custom-select-shell').forEach(node => node.remove());
                return copy.textContent.trim();
            }).filter(Boolean).join(' ');
            const selectSignature = JSON.stringify([
                selectEl.value, selectEl.selectedIndex, selectEl.disabled, selectEl.required, window.innerWidth,
                selectEl.style.cssText, labelText, selectEl.dataset.customSelectInvalid,
                selectEl.getAttribute('aria-label'), selectEl.getAttribute('aria-labelledby'),
                selectEl.getAttribute('aria-describedby'), selectEl.getAttribute('aria-invalid'), selectEl.title,
                Array.from(selectEl.options || [], option => [option.value, option.text, option.disabled])
            ]);
            // Unrelated DOM updates must not rebuild an open menu or steal its focus.
            if (selectEl.__dashboardSelectSignature === selectSignature && dashboardGetCustomSelectShell(selectEl)) return;
            if (!selectEl.dataset.customSelectBound) {
                selectEl.dataset.customSelectBound = 'true';
                selectEl.addEventListener('change', () => dashboardSyncCustomSelect(selectEl));
                selectEl.addEventListener('input', () => dashboardSyncCustomSelect(selectEl));
                selectEl.addEventListener('invalid', event => {
                    if (!dashboardGetCustomSelectShell(selectEl)) return;
                    event.preventDefault();
                    selectEl.dataset.customSelectInvalid = 'true';
                    dashboardSyncCustomSelect(selectEl);
                    dashboardFocusCustomSelectField(selectId);
                });
            }

            selectEl.classList.add('dashboard-custom-select-native');

            let shell = dashboardGetCustomSelectShell(selectEl);
            if (!shell) {
                shell = document.createElement('div');
                shell.className = 'dashboard-custom-select-shell';

                const trigger = document.createElement('button');
                trigger.type = 'button';
                trigger.className = 'dashboard-custom-select-trigger';
                trigger.setAttribute('aria-haspopup', 'listbox');
                trigger.setAttribute('aria-expanded', 'false');
                trigger.setAttribute('aria-controls', `${selectId}CustomMenu`);

                const textEl = document.createElement('span');
                textEl.className = 'dashboard-custom-select-trigger__text';
                trigger.appendChild(textEl);

                const menu = document.createElement('div');
                menu.className = 'dashboard-custom-select-menu';
                menu.id = `${selectId}CustomMenu`;
                menu.setAttribute('role', 'listbox');
                menu.setAttribute('popover', 'manual');
                menu.setAttribute('aria-label', labelText || 'Available options');
                menu.hidden = true;
                const error = document.createElement('span');
                error.className = 'dashboard-custom-select-error';
                error.id = `${selectId}CustomError`;
                error.setAttribute('role', 'alert');
                error.hidden = true;

                trigger.addEventListener('click', () => {
                    dashboardSetCustomSelectOpen(selectEl, !shell.classList.contains('is-open'));
                });

                trigger.addEventListener('keydown', (event) => {
                    if (!event) return;
                    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        dashboardSetCustomSelectOpen(selectEl, true);
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        dashboardSetCustomSelectOpen(selectEl, false);
                    }
                });

                menu.addEventListener('keydown', (event) => {
                    if (!event) return;
                    const items = Array.from(menu.querySelectorAll('.dashboard-custom-select-option:not([disabled])'));
                    const currentIndex = items.indexOf(document.activeElement);

                    if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, items.length - 1);
                        dashboardFocusCustomSelectOption(items[nextIndex], menu);
                    }

                    if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        const nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
                        dashboardFocusCustomSelectOption(items[nextIndex], menu);
                    }

                    if (event.key === 'Home') {
                        event.preventDefault();
                        dashboardFocusCustomSelectOption(items[0], menu);
                    }

                    if (event.key === 'End') {
                        event.preventDefault();
                        dashboardFocusCustomSelectOption(items[items.length - 1], menu);
                    }

                    if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                        event.preventDefault();
                        const now = Date.now();
                        menu.__search = now - (menu.__searchAt || 0) < 700 ? (menu.__search || '') + event.key.toLocaleLowerCase() : event.key.toLocaleLowerCase();
                        menu.__searchAt = now;
                        const match = items.find(item => item.textContent.trim().toLocaleLowerCase().startsWith(menu.__search))
                            || items.find(item => item.textContent.toLocaleLowerCase().includes(menu.__search));
                        dashboardFocusCustomSelectOption(match, menu);
                    }
                    if (event.key === 'Tab' || event.key === 'Escape') {
                        dashboardSetCustomSelectOpen(selectEl, false);
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            try { trigger.focus(); } catch (_) {}
                        }
                    }
                });

                shell.appendChild(trigger);
                shell.appendChild(menu);
                shell.appendChild(error);
                selectEl.insertAdjacentElement('afterend', shell);
            }

            dashboardApplyCustomSelectMetrics(selectEl, shell);

            const trigger = shell.querySelector('.dashboard-custom-select-trigger');
            const textEl = shell.querySelector('.dashboard-custom-select-trigger__text');
            const menu = shell.querySelector('.dashboard-custom-select-menu');
            if (!trigger || !textEl || !menu) return;

            const selectedOption = selectEl.options && selectEl.selectedIndex >= 0
                ? selectEl.options[selectEl.selectedIndex]
                : (selectEl.options && selectEl.options.length ? selectEl.options[0] : null);
            const selectedValue = selectedOption ? String(selectedOption.value || '') : '';
            const selectedLabel = selectedOption ? String(selectedOption.text || '').trim() : '';
            const isPlaceholder = !selectedValue && /select|choose/i.test(selectedLabel);

            textEl.textContent = selectedLabel || 'Select...';
            textEl.classList.toggle('is-placeholder', isPlaceholder);
            trigger.disabled = !!selectEl.disabled;
            trigger.title = selectedLabel || 'Select';
            trigger.setAttribute('aria-label', selectEl.getAttribute('aria-label') || labelText || selectEl.title || selectedLabel || 'Select');
            const labelledBy = selectEl.getAttribute('aria-labelledby');
            if (labelledBy) trigger.setAttribute('aria-labelledby', labelledBy);
            else trigger.removeAttribute('aria-labelledby');
            trigger.setAttribute('aria-required', String(selectEl.required));
            const error = shell.querySelector('.dashboard-custom-select-error');
            const invalid = selectEl.dataset.customSelectInvalid === 'true' && !selectEl.validity.valid;
            error.hidden = !invalid;
            error.textContent = invalid ? selectEl.validationMessage : '';
            trigger.setAttribute('aria-invalid', invalid ? 'true' : (selectEl.getAttribute('aria-invalid') || 'false'));
            const describedBy = [selectEl.getAttribute('aria-describedby'), invalid ? error.id : ''].filter(Boolean).join(' ');
            if (describedBy) trigger.setAttribute('aria-describedby', describedBy);
            else trigger.removeAttribute('aria-describedby');
            shell.classList.toggle('is-disabled', !!selectEl.disabled);

            menu.innerHTML = '';
            menu.setAttribute('aria-label', selectEl.getAttribute('aria-label') || labelText || 'Available options');
            Array.from(selectEl.options || []).forEach(option => {
                const optionBtn = document.createElement('button');
                optionBtn.type = 'button';
                optionBtn.className = 'dashboard-custom-select-option';
                optionBtn.setAttribute('role', 'option');
                optionBtn.dataset.value = String(option.value || '');
                optionBtn.textContent = String(option.text || '');
                optionBtn.setAttribute('aria-selected', option.selected ? 'true' : 'false');
                optionBtn.classList.toggle('is-selected', !!option.selected);
                if (option.disabled) optionBtn.disabled = true;

                optionBtn.addEventListener('click', () => {
                    if (option.disabled) return;
                    const previousValue = String(selectEl.value || '');
                    selectEl.value = String(option.value || '');
                    dashboardSyncCustomSelect(selectEl);
                    dashboardSetCustomSelectOpen(selectEl, false);
                    if (previousValue !== String(selectEl.value || '')) {
                        try { selectEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
                        try { selectEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
                    }
                    try { trigger.focus(); } catch (_) {}
                });

                menu.appendChild(optionBtn);
            });
            if (!Array.from(selectEl.options || []).some(option => option.value && !option.disabled)) {
                const empty = document.createElement('div');
                empty.className = 'dashboard-custom-select-empty';
                empty.setAttribute('role', 'option');
                empty.setAttribute('aria-disabled', 'true');
                empty.textContent = 'No options available';
                menu.appendChild(empty);
            }

            if (selectEl.disabled) dashboardSetCustomSelectOpen(selectEl, false);
            else if (shell.classList.contains('is-open')) dashboardPositionCustomSelect(trigger, menu);
            selectEl.__dashboardSelectSignature = selectSignature;
        }

        function dashboardSyncAllCustomSelects(container = null) {
            dashboardGetCustomSelects(container).forEach(dashboardSyncCustomSelect);
        }

        function bootstrapDashboardCustomSelects() {
            if (__dashboardCustomSelectBooted) {
                dashboardQueueCustomSelectSync();
                return;
            }
            __dashboardCustomSelectBooted = true;
            ensureDashboardCustomSelectBindings();
            dashboardSyncAllCustomSelects(document);
            h2sInitDateInputs(document);
        }

        global.H2SDashboardControls = { h2sDispatchDateInputEvents, h2sBuildDateInputOptions, h2sSyncDateInput, h2sInitDateInputs, h2sDestroyDetachedDateInputs, dashboardShouldUseCustomSelect, dashboardEnsureCustomSelectId, dashboardGetCustomSelects, dashboardGetCustomSelectShell, dashboardRemoveCustomSelect, dashboardQueueCustomSelectSync, dashboardApplyCustomSelectMetrics, dashboardSetCustomSelectOpen, dashboardCloseCustomSelects, dashboardFocusCustomSelectField, ensureDashboardCustomSelectBindings, dashboardSyncCustomSelect, dashboardSyncAllCustomSelects, bootstrapDashboardCustomSelects };
})(window);
