(function (root) {
  'use strict';

  const bundlesFallbackAssetId = 'de955df6-d4d9-4603-be3a-90ed2fb25e45';
  const pages = {
    bundles: { title: 'Bundles', area: 'hero', page: 'bundles.html', areas: { hero: 'Hero background' } },
    commercial_intake: { title: 'Commercial', area: 'commercial_hero', page: 'commercial.html', areas: {
      commercial_hero: 'Hero photo', commercial_security_rail: 'Security camera rail', commercial_display_rail: 'Display and TV rail',
    } },
  };
  const usable = items => (Array.isArray(items) ? items : []).filter(item =>
    String(item?.media_url || item?.public_url || item?.direct_url || '').trim());

  function bundlesSelection(items, exclusions) {
    const asset = items?.[0];
    if (asset) return { asset, mode: asset.media_placement ? 'override' : 'automatic' };
    const excluded = exclusions?.some(row => row.asset_source === 'proof_asset' && row.asset_id === bundlesFallbackAssetId);
    return { asset: null, mode: excluded ? 'empty' : 'automatic', fallbackAssetId: excluded ? null : bundlesFallbackAssetId };
  }

  function commercialCandidates(sections) {
    if (sections.commercial_hero) return usable(sections.commercial_hero.items).slice(0, 6);
    const all = usable([...(sections.commercial_security_rail?.items || []), ...(sections.commercial_display_rail?.items || [])]).slice(0, 6);
    return all.filter(item => item.media_kind !== 'video').concat(all.filter(item => item.media_kind === 'video'));
  }

  function usesForAsset(selections, source, assetId) {
    const uses = [];
    for (const [surface, selected] of Object.entries(selections || {})) {
      const page = pages[surface];
      if (!page || selected.mode === 'unavailable') continue;
      const areas = selected.areas || { [page.area]: selected.asset ? [selected.asset] : [] };
      for (const [area, items] of Object.entries(areas)) {
        if (page.areas[area] && items.some(item => item.asset_id === assetId
          && (item.source || item.media_placement?.asset_source || 'proof_asset') === source)) {
          uses.push({ surface, area, label: `${page.title} / ${page.areas[area]}` });
        }
      }
    }
    return uses;
  }

  async function read(surface, get) {
    const checked = async path => {
      const result = await get(path);
      if (!result?.ok) throw new Error(result?.error || 'Page media could not be loaded.');
      return result;
    };
    if (surface === 'bundles') {
      const payload = await checked('/api/proof-slots?surface=bundles&limit=6');
      const selected = bundlesSelection(payload.hero_media || [], payload.hero_exclusions || []);
      if (selected.fallbackAssetId) {
        const result = await checked(`/api/proof-asset?asset_id=${bundlesFallbackAssetId}`);
        if (!result.asset || result.asset.asset_id !== bundlesFallbackAssetId) throw new Error('The curated Bundles hero is unavailable.');
        selected.asset = result.asset;
      }
      return { ...selected, areas: { hero: selected.asset ? [selected.asset] : [] } };
    }
    if (surface !== 'commercial_intake') throw new Error('This page has no registered hero reader.');
    let sections;
    let reason = '';
    try {
      sections = (await checked('/api/owner-media/public?surface=commercial_intake&limit=4')).sections || {};
    } catch (error) {
      console.warn('[Page heroes] Commercial uses its proof-gallery fallback:', error);
      reason = 'Public media feed unavailable; using the customer page fallback.';
    }
    if (!sections || (!sections.commercial_hero && !commercialCandidates(sections).length)) {
      const fallback = await checked('/api/proof-gallery');
      sections = {
        commercial_security_rail: { items: usable(fallback.categories?.cameras?.items).slice(0, 4) },
        commercial_display_rail: { items: usable(fallback.categories?.tv_mounting?.items).slice(0, 4) },
      };
    }
    const asset = commercialCandidates(sections)[0] || null;
    return { asset, mode: !asset ? 'empty' : asset.media_placement ? 'override' : 'automatic', reason, areas: {
      commercial_hero: asset ? [asset] : [],
      commercial_security_rail: usable(sections.commercial_security_rail?.items).slice(0, 4),
      commercial_display_rail: usable(sections.commercial_display_rail?.items).slice(0, 4),
    } };
  }

  const api = { pages, bundlesFallbackAssetId, bundlesSelection, commercialCandidates, usesForAsset, read };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.H2SPageHeroes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
