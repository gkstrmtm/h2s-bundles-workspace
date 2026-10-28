(function (root) {
  'use strict';

  const bundlesFallbackAssetId = 'de955df6-d4d9-4603-be3a-90ed2fb25e45';
  const pages = {
    residential: { title: 'Residential', area: 'residential_tv_proof', page: 'residential.html',
      areas: { residential_tv_proof: 'TV installation proof', residential_camera_proof: 'Camera installation proof' } },
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
    const all = [...usable(sections.commercial_security_rail?.items).slice(0, 4),
      ...usable(sections.commercial_display_rail?.items).slice(0, 4)].slice(0, 6);
    return all.filter(item => item.media_kind !== 'video').concat(all.filter(item => item.media_kind === 'video'));
  }

  function commercialSelection(sections) {
    const heroCandidates = commercialCandidates(sections);
    const asset = heroCandidates[0] || null;
    return { asset, mode: !asset ? 'empty' : asset.media_placement ? 'override' : 'automatic', heroCandidates, areas: {
      commercial_hero: asset ? [asset] : [],
      commercial_security_rail: usable(sections.commercial_security_rail?.items).slice(0, 4),
      commercial_display_rail: usable(sections.commercial_display_rail?.items).slice(0, 4),
    } };
  }

  function selectedUses(selections) {
    const uses = [];
    for (const [surface, selected] of Object.entries(selections || {})) {
      const page = pages[surface];
      if (!page || selected.mode === 'unavailable') continue;
      const areas = selected.areas || { [page.area]: selected.asset ? [selected.asset] : [] };
      for (const [area, items] of Object.entries(areas)) {
        if (!page.areas[area]) continue;
        for (const asset of items) uses.push({ surface, area, asset,
          source: asset.source || asset.media_placement?.asset_source || 'proof_asset',
          label: `${page.title} / ${page.areas[area]}` });
      }
    }
    return uses;
  }

  function usesForAsset(selections, source, assetId) {
    return selectedUses(selections).filter(use => use.asset.asset_id === assetId && use.source === source);
  }

  function destinationLinks(surface, area, currentUrl) {
    const page = pages[surface];
    if (!page?.areas[area]) throw new Error('Unsupported media destination');
    const local = new URL(page.page, currentUrl);
    const deployed = new URL(surface === 'bundles' ? '/bundles' : surface === 'residential' ? '/residential' : '/commercial', 'https://shop.home2smart.com');
    const anchor = { commercial_hero: 'heroMediaStage', commercial_security_rail: 'cameraProofRail', commercial_display_rail: 'tvProofRail',
      residential_tv_proof: 'residential_tv_proof', residential_camera_proof: 'residential_camera_proof' }[area];
    if (anchor) { local.hash = anchor; deployed.hash = anchor; }
    return { local: local.href, deployed: deployed.href };
  }

  function describeUse(asset, source, surface, area, selections, inspection) {
    const selected = usesForAsset(selections, source, asset.asset_id).some(use => use.surface === surface && use.area === area);
    const alternative = area === pages[surface]?.area && (selections?.[surface]?.heroCandidates || []).slice(1)
      .some(item => item.asset_id === asset.asset_id && (item.source || item.media_placement?.asset_source || 'proof_asset') === source);
    const placement = inspection?.placements?.find(row => row.surface === surface && row.area === area);
    const service = ['commercial_security_rail', 'residential_camera_proof'].includes(area) ? 'cameras'
      : ['commercial_display_rail', 'residential_tv_proof'].includes(area) ? 'tv_mounting' : null;
    const assetService = asset.service || asset.service_type;
    const serviceEligible = ['cameras', 'tv_mounting'].includes(assetService) && (!service || assetService === service)
      && (surface !== 'residential' || asset.media_kind === 'photo');
    const eligible = source === 'proof_asset' && typeof asset.is_visible === 'boolean' ? asset.is_visible && serviceEligible
      : source === 'owner_media' && typeof asset.qa_hold === 'boolean' && asset.review_state && asset.usage_rights_status
        ? asset.review_state === 'published' && asset.usage_rights_status === 'social_allowed' && !asset.qa_hold
          && asset.customer_media_opt_in !== 'declined' && serviceEligible : null;
    return {
      selected,
      selection: !selections?.[surface] || selections[surface].mode === 'unavailable' ? 'Selection unverified'
        : selected ? 'Selected by this frontend' : alternative ? 'Hero load-error alternative' : 'Not selected by this frontend',
      setting: !inspection ? 'Saved setting unverified' : placement
        ? placement.enabled ? 'Explicitly included; not proof of display' : 'Excluded from this area'
        : 'No explicit assignment',
      eligibility: eligible === null ? 'Eligibility unverified'
        : eligible ? 'Eligible for placement; not proof of selection' : 'Not eligible for placement',
      placement,
    };
  }

  async function read(surface, get) {
    const checked = async path => {
      const result = await get(path);
      if (!result?.ok) throw new Error(result?.error || 'Page media could not be loaded.');
      return result;
    };
    if (surface === 'residential') {
      const renderer = typeof module === 'object' && module.exports ? require('./residential-media.js') : root.H2SResidentialMedia;
      return renderer.read(checked);
    }
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
    return { ...commercialSelection(sections), reason };
  }

  const api = { pages, bundlesFallbackAssetId, bundlesSelection, commercialCandidates, commercialSelection, selectedUses, usesForAsset, destinationLinks, describeUse, read };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.H2SPageHeroes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
