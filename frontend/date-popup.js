(function () {
  'use strict';
  const watchers = new WeakMap();
  function position(instance, anchor) {
    const field = (anchor || instance.altInput || instance._input || instance.input).getBoundingClientRect();
    const popup = instance.calendarContainer, viewport = window.visualViewport;
    const leftEdge = viewport ? viewport.offsetLeft : 0, topEdge = viewport ? viewport.offsetTop : 0;
    const width = viewport ? viewport.width : window.innerWidth, height = viewport ? viewport.height : window.innerHeight;
    popup.style.boxSizing = 'border-box';
    popup.style.maxWidth = `${Math.max(0, width - 16)}px`;
    popup.style.maxHeight = `${Math.max(0, height - 16)}px`;
    popup.style.overflowY = 'auto';
    popup.style.overflowX = 'hidden';
    const above = field.bottom + popup.offsetHeight + 8 > topEdge + height
      && field.top - popup.offsetHeight - 8 >= topEdge;
    const left = Math.max(leftEdge + 8, Math.min(field.left, leftEdge + width - popup.offsetWidth - 8));
    const desiredTop = above ? field.top - popup.offsetHeight - 8 : field.bottom + 8;
    const top = Math.max(topEdge + 8, Math.min(desiredTop, topEdge + height - popup.offsetHeight - 8));
    const parent = popup.offsetParent;
    const local = parent && parent !== document.body && parent !== document.documentElement;
    const origin = local ? parent.getBoundingClientRect() : null;
    popup.style.left = `${local ? left - origin.left + parent.scrollLeft - parent.clientLeft : window.scrollX + left}px`;
    popup.style.right = 'auto';
    popup.style.top = `${local ? top - origin.top + parent.scrollTop - parent.clientTop : window.scrollY + top}px`;
    popup.classList.toggle('arrowTop', !above);
    popup.classList.toggle('arrowBottom', above);
  }
  function stop(_, __, instance) {
    const cleanup = watchers.get(instance);
    if (cleanup) { cleanup(); watchers.delete(instance); }
  }
  function watch(_, __, instance) {
    stop(_, __, instance);
    const viewport = window.visualViewport, reposition = () => position(instance);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
    if (viewport) {
      viewport.addEventListener('resize', reposition);
      viewport.addEventListener('scroll', reposition);
    }
    watchers.set(instance, () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      if (viewport) {
        viewport.removeEventListener('resize', reposition);
        viewport.removeEventListener('scroll', reposition);
      }
    });
  }
  window.h2sDatePopupOptions = { position, onOpen: watch, onClose: stop, onDestroy: stop };
})();
