(function (root) {
  'use strict';
  const areas = { residential_tv_proof: 'TV mounted by Home2Smart', residential_camera_proof: 'Camera installed by Home2Smart' };
  function selection(sections) {
    const selected = Object.fromEntries(Object.keys(areas).map(area => [area,
      (sections?.[area]?.items || []).filter(asset => asset.media_kind !== 'video'
        && (asset.media_url || asset.public_url)).slice(0, 1)]));
    return { mode: Object.values(selected).some(items => items.length) ? 'automatic' : 'empty',
      asset: selected.residential_tv_proof[0] || selected.residential_camera_proof[0] || null, areas: selected };
  }
  async function read(get) {
    const result = await get('/api/owner-media/public?surface=residential&limit=1');
    if (!result?.ok || result.surface !== 'residential') throw new Error(result?.error || 'Residential installation photos are unavailable.');
    return selection(result.sections);
  }
  function image(asset, doc) {
    const url = new URL(asset.media_url || asset.public_url, doc.baseURI);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported installation photo URL.');
    const img = doc.createElement('img');
    img.src = url.href;
    img.alt = asset.service === 'cameras' || asset.service_type === 'cameras'
      ? 'Security camera installation by Home2Smart' : 'TV installation by Home2Smart';
    img.decoding = 'async';
    img.width = 640; img.height = 480;
    const placementStyle = typeof module === 'object' && module.exports
      ? require('./media-placement-style.js').style : root.H2SMediaPlacements?.style;
    if (!placementStyle) throw new Error('Residential photo framing did not load.');
    img.style.cssText = placementStyle(asset.media_placement);
    return img;
  }
  function createFrame(area, asset, doc) {
    if (!Object.hasOwn(areas, area)) throw new Error('Unsupported residential photo area.');
    const figure = doc.createElement('figure'), frame = doc.createElement('div');
    figure.id = area; frame.className = 'residential-proof-frame';
    const media = image(asset, doc), caption = doc.createElement('figcaption');
    caption.textContent = areas[area];
    frame.append(media); figure.append(frame, caption);
    return { figure, frame, media };
  }
  function render(container, selected, status) {
    container.replaceChildren();
    for (const [area, items] of Object.entries(selected.areas)) {
      if (!items[0]) continue;
      const { figure, media: img } = createFrame(area, items[0], container.ownerDocument);
      img.addEventListener('error', () => {
        figure.remove();
        status.textContent = 'An installation photo could not load. You can still send your request.';
      }, { once: true });
      container.append(figure);
    }
    status.textContent = container.children.length ? '' : 'Installation photos are unavailable. You can still send your request.';
  }
  const api = { areas, selection, read, image, createFrame, render };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.H2SResidentialMedia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
