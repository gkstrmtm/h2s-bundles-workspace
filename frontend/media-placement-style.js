(function (root) {
  'use strict';

  const bounded = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  function style(settings) {
    if (!settings) return '';
    const x = bounded(settings.focal_x, 0, 100, 50);
    const y = bounded(settings.focal_y, 0, 100, 50);
    const zoom = bounded(settings.zoom, 1, 3, 1);
    const fit = settings.fit === 'contain' ? 'contain' : 'cover';
    return `object-fit:${fit};object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;transform:scale(${zoom});`;
  }

  const api = { style };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.H2SMediaPlacements = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
