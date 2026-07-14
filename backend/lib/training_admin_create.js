function safeTrim(value) {
  return String(value == null ? '' : value).trim();
}

function extractUrl(raw) {
  const value = safeTrim(raw);
  if (!value) return '';
  const match = value.match(/https?:\/\/[^\s)"']+/i);
  return match ? safeTrim(match[0]) : value;
}

function extractYoutubeId(rawUrl) {
  try {
    const normalized = extractUrl(rawUrl);
    if (!normalized) return '';
    const url = new URL(normalized);
    const host = String(url.hostname || '').toLowerCase();
    if (!host.includes('youtube.com') && host !== 'youtu.be') return '';

    if (host === 'youtu.be') {
      const parts = String(url.pathname || '').split('/').filter(Boolean);
      return safeTrim(parts[0] || '');
    }

    const directId = safeTrim(url.searchParams.get('v') || '');
    if (directId) return directId;

    const parts = String(url.pathname || '').split('/').filter(Boolean);
    const embedIndex = parts.indexOf('embed');
    if (embedIndex >= 0 && parts[embedIndex + 1]) return safeTrim(parts[embedIndex + 1]);
    const shortsIndex = parts.indexOf('shorts');
    if (shortsIndex >= 0 && parts[shortsIndex + 1]) return safeTrim(parts[shortsIndex + 1]);
    const liveIndex = parts.indexOf('live');
    if (liveIndex >= 0 && parts[liveIndex + 1]) return safeTrim(parts[liveIndex + 1]);
    return '';
  } catch {
    return '';
  }
}

function extractLoomId(rawUrl) {
  try {
    const normalized = extractUrl(rawUrl);
    if (!normalized) return '';
    const url = new URL(normalized);
    const host = String(url.hostname || '').toLowerCase();
    if (!host.includes('loom.com')) return '';

    const parts = String(url.pathname || '').split('/').filter(Boolean);
    const shareIndex = parts.indexOf('share');
    if (shareIndex >= 0 && parts[shareIndex + 1]) return safeTrim(parts[shareIndex + 1]);
    const embedIndex = parts.indexOf('embed');
    if (embedIndex >= 0 && parts[embedIndex + 1]) return safeTrim(parts[embedIndex + 1]);
    return '';
  } catch {
    return '';
  }
}

function canonicalizeTrainingVideoUrl(rawUrl) {
  try {
    const normalized = extractUrl(rawUrl);
    if (!normalized) return null;

    const youtubeId = extractYoutubeId(normalized);
    if (youtubeId) {
      return {
        provider: 'youtube',
        url: `https://www.youtube.com/watch?v=${youtubeId}`
      };
    }

    const loomId = extractLoomId(normalized);
    if (loomId) {
      return {
        provider: 'loom',
        url: `https://www.loom.com/share/${loomId}`
      };
    }

    return null;
  } catch {
    return null;
  }
}

function sanitizeTrainingVideoAssets(raw) {
  try {
    const tokens = [];
    if (Array.isArray(raw)) {
      tokens.push(...raw);
    } else {
      const value = safeTrim(raw);
      if (value) {
        tokens.push(...value.split(/[\s\n\r\t]+/g).filter(Boolean));
      }
    }

    const seen = new Set();
    const out = [];
    for (const token of tokens) {
      const canonical = canonicalizeTrainingVideoUrl(token);
      if (!canonical || !canonical.url) continue;
      if (seen.has(canonical.url)) continue;
      seen.add(canonical.url);
      out.push(canonical.url);
      if (out.length >= 50) break;
    }
    return out;
  } catch {
    return [];
  }
}

function normalizeHttpsTrainingLink(rawUrl) {
  try {
    const normalized = extractUrl(rawUrl);
    if (!normalized) return '';
    const url = new URL(normalized);
    if (String(url.protocol || '').toLowerCase() !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeTrainingType(rawType) {
  const upper = safeTrim(rawType || 'VIDEO').toUpperCase();
  return upper === 'PDF' || upper === 'SOP' ? upper : 'VIDEO';
}

function validateCreateTrainingPayload(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const typeUpper = normalizeTrainingType(payload.type);
  const isVideo = typeUpper === 'VIDEO';

  if (isVideo) {
    const assets = sanitizeTrainingVideoAssets(payload.assets ?? payload.urls ?? payload.url);
    if (!assets.length) {
      return {
        ok: false,
        error: 'VIDEO training requires at least one valid YouTube or Loom link.'
      };
    }

    return {
      ok: true,
      typeUpper,
      isVideo,
      primaryUrl: assets[0],
      assets
    };
  }

  const primaryUrl = normalizeHttpsTrainingLink(payload.url);
  if (!primaryUrl) {
    return {
      ok: false,
      error: `${typeUpper} training requires exactly one HTTPS link.`
    };
  }

  return {
    ok: true,
    typeUpper,
    isVideo,
    primaryUrl,
    assets: []
  };
}

module.exports = {
  canonicalizeTrainingVideoUrl,
  normalizeHttpsTrainingLink,
  normalizeTrainingType,
  sanitizeTrainingVideoAssets,
  validateCreateTrainingPayload
};
