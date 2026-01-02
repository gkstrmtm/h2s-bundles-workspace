    async function patchedUpdatePromoEstimate(){
      var promoMsg = null;
      var loadingSet = false;
      var clearLoadingState = function() {
        if (loadingSet && promoMsg && promoMsg.textContent === 'Checking cart…') {
          promoMsg.textContent = '';
          promoMsg.style.color = '';
          loadingSet = false;
        }
      };

      try {
        var promoLine = document.getElementById('promoLine');
        var promoAmount = document.getElementById('promoAmount');
        promoMsg = document.getElementById('promoMsg');
        var totalLabel = document.getElementById('totalLabel');
        var rawLine = document.getElementById('rawSubtotalLine');
        var rawAmount = document.getElementById('rawSubtotalAmount');
        if (!promoLine || !promoAmount) return;

        if (totalLabel) totalLabel.textContent = 'Subtotal';
        if (rawLine) rawLine.style.display = 'none';

        var code = '';
        try { code = localStorage.getItem('h2s_promo_code') || ''; } catch (_) { code = ''; }
        if (!code) { promoLine.style.display = 'none'; return; }

        var line_items = buildLineItems();
        if (!line_items.length) { promoLine.style.display = 'none'; return; }

        // If catalog is empty, buildLineItems() often falls back to price:'custom', which
        // can cause promo_check_cart to report non-applicable even for valid codes.
        // Force-load the fallback catalog and retry once.
        var needsCatalog = false;
        try {
          needsCatalog = line_items.some(function(li){ return !li || !li.price || li.price === 'custom'; });
        } catch (_) { needsCatalog = false; }
        if (needsCatalog) {
          await ensureCatalogPopulated();
          line_items = buildLineItems();
          try {
            needsCatalog = line_items.some(function(li){ return !li || !li.price || li.price === 'custom'; });
          } catch (_) { needsCatalog = false; }
        }

        // If we still can't construct real Stripe prices, don't flip the UI to "not applicable"
        // (that's misleading). Keep last-good UI if available.
        if (needsCatalog) {
          if (promoMsg) { promoMsg.textContent = 'Checking cart…'; promoMsg.style.color = '#666'; loadingSet = true; }
          if (rawLine) rawLine.style.display = 'none';
          return;
        }

        var cartSig = code + '|' + line_items.map(function(li){ return li.price + ':' + li.unit_amount + 'x' + li.quantity; }).join(',');
        var rid = window.__H2S_PROMO_REQ_ID__ = (window.__H2S_PROMO_REQ_ID__ || 0) + 1;

        // Set loading state with timeout protection
        if (promoMsg) { promoMsg.textContent = 'Checking cart…'; promoMsg.style.color = '#666'; loadingSet = true; }

        var controller = new AbortController();
        var timeoutId = setTimeout(function() {
          controller.abort();
          if (promoMsg) {
            promoMsg.textContent = 'Request timed out. Please try again.';
            promoMsg.style.color = '#c33';
            loadingSet = false;
          }
        }, 15000);

        var resp = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ __action: 'promo_check_cart', promotion_code: code, line_items: line_items }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        var data = await resp.json();
        if (rid !== window.__H2S_PROMO_REQ_ID__) { clearLoadingState(); return; }

        // If a stale non-applicable response comes back after an applicable one for the same cart, keep the good UI.
        if (!(data && data.ok && data.applicable && data.estimate)) {
          if (window.__H2S_PROMO_LAST_GOOD_SIG__ === cartSig && window.__H2S_PROMO_LAST_GOOD_CODE__ === code && window.__H2S_PROMO_LAST_GOOD_EST__) {
            var last = window.__H2S_PROMO_LAST_GOOD_EST__;
            applyEstimateToUI(code, last.promotion_code || code, last.savings_cents, last.subtotal_cents, last.total_cents);
            clearLoadingState();
            return;
          }
        }

        if (data && data.ok && data.applicable && data.estimate) {
          window.__H2S_PROMO_LAST_GOOD_SIG__ = cartSig;
          window.__H2S_PROMO_LAST_GOOD_CODE__ = code;

          var savingsCents = Number(data.estimate.savings_cents || 0);
          var totalCents = Number(data.estimate.total_cents || 0);
          var subtotalCents = Number(data.estimate.subtotal_cents || 0);

          window.__H2S_PROMO_LAST_GOOD_EST__ = {
            promotion_code: data.promotion_code || code,
            savings_cents: savingsCents,
            subtotal_cents: subtotalCents,
            total_cents: totalCents
          };

          applyEstimateToUI(code, data.promotion_code || code, savingsCents, subtotalCents, totalCents);
          clearLoadingState();
          return;
        }

        // Not applicable
        clearLoadingState();
        var cartSubtotalLine2 = document.getElementById('cartSubtotalLine');
        if (cartSubtotalLine2) cartSubtotalLine2.style.display = 'flex';
        promoLine.style.display = 'none';
        if (rawLine) rawLine.style.display = 'none';

        var cartSubtotal = document.getElementById('cartSubtotal');
        var grandTotal2 = document.getElementById('grandTotal');
        if (cartSubtotal && grandTotal2) { grandTotal2.textContent = cartSubtotal.textContent; grandTotal2.style.color = ''; grandTotal2.style.fontSize = ''; }
        if (totalLabel) totalLabel.textContent = 'Total';
        if (promoMsg) { promoMsg.textContent = 'This code does not apply to your current items.'; promoMsg.style.color = '#c33'; }
      } catch (err) {
        if (err.name === 'AbortError') {
          // Timeout message already set by setTimeout callback
          return;
        }
        clearLoadingState();
        if (promoMsg) {
          promoMsg.textContent = 'Could not validate promo. Please try again.';
          promoMsg.style.color = '#c33';
        }
        try {
          var promoLine2 = document.getElementById('promoLine');
          if (promoLine2) promoLine2.style.display = 'none';
          var rawLine2 = document.getElementById('rawSubtotalLine');
          if (rawLine2) rawLine2.style.display = 'none';
        } catch (_) {}
      } finally {
        clearLoadingState();
      }
    }
