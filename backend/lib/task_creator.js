/**
 * Task Creator helpers (no AI guessing guardrails).
 * Keep this file JS (allowJs) so it can be unit-tested with node:test.
 */

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const ACTION_VERBS = new Set([
  'identify', 'define', 'review', 'confirm', 'gather', 'collect', 'map', 'outline', 'document', 'write', 'draft',
  'create', 'build', 'prepare', 'compile', 'organize', 'prioritize', 'sequence', 'break', 'assign', 'estimate',
  'compare', 'analyze', 'audit', 'research', 'summarize', 'capture', 'list', 'clarify', 'verify', 'validate',
  'set', 'setup', 'configure', 'load', 'update', 'revise', 'deliver', 'finalize', 'present', 'share', 'send',
  'schedule', 'launch', 'test', 'check', 'align', 'coordinate', 'plan', 'segment', 'tag', 'publish', 'record'
]);

const VAGUE_FRAGMENT_PATTERNS = [
  /\bsequence of activities\b/i,
  /\bactivities and deliverables\b/i,
  /\bdeliverables,? email themes,? and nurturing flow\b/i,
  /\bemail themes\b/i,
  /\bnurtur(?:e|ing) flow\b/i,
  /\bwhat needs to be built first\b/i,
  /\bprioritiz(?:e|ing) what needs to be built first\b/i,
  /\bmake sure .* smooth execution\b/i,
  /\bcome true\b/i
];

function splitWords(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(' ')
    .map(part => part.trim())
    .filter(Boolean);
}

function includesActionVerb(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return false;
  if (/\bset up\b|\bfollow up\b|\bwrite up\b|\bbreak down\b/.test(normalized)) return true;
  return splitWords(normalized).some(word => ACTION_VERBS.has(word));
}

function hasVagueFragment(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return VAGUE_FRAGMENT_PATTERNS.some(pattern => pattern.test(normalized));
}

function sentenceCount(text) {
  return String(text || '')
    .split(/[.!?]+/)
    .map(part => normalizeText(part))
    .filter(Boolean).length;
}

function validateNarrativeItem(item, options = {}) {
  const text = normalizeText(item);
  const words = countWords(text);
  const minWords = Number(options.minWords || 0) || 0;
  const requireActionVerb = !!options.requireActionVerb;
  const issues = [];

  if (!text) {
    issues.push('is empty');
    return { ok: false, text, words, issues };
  }

  if (minWords && words < minWords) {
    issues.push(`needs at least ${minWords} words`);
  }

  if (hasVagueFragment(text)) {
    issues.push('uses vague placeholder language');
  }

  if (requireActionVerb && !includesActionVerb(text)) {
    issues.push('does not clearly say what action to take');
  }

  return { ok: issues.length === 0, text, words, issues };
}

function validateGeneratedTaskDetails(payload) {
  const description = normalizeText(payload?.description);
  const checklist = Array.isArray(payload?.checklist) ? payload.checklist.map(normalizeText).filter(Boolean) : [];
  const acceptance = Array.isArray(payload?.acceptance) ? payload.acceptance.map(normalizeText).filter(Boolean) : [];
  const dependencies = Array.isArray(payload?.dependencies) ? payload.dependencies.map(normalizeText).filter(Boolean) : [];
  const issues = [];

  if (countWords(description) < 28) {
    issues.push('Description is too short and does not explain the work clearly enough.');
  }
  if (sentenceCount(description) < 2) {
    issues.push('Description must use full explanatory sentences, not a short fragment.');
  }
  if (hasVagueFragment(description)) {
    issues.push('Description contains vague placeholder language.');
  }

  if (checklist.length < 4) {
    issues.push('Checklist needs at least 4 concrete action steps.');
  }
  checklist.forEach((item, index) => {
    const result = validateNarrativeItem(item, { minWords: 7, requireActionVerb: true });
    if (!result.ok) {
      issues.push(`Checklist item ${index + 1} ${result.issues.join(' and ')}.`);
    }
  });

  if (acceptance.length < 2) {
    issues.push('Acceptance needs at least 2 concrete done-state checks.');
  }
  acceptance.forEach((item, index) => {
    const result = validateNarrativeItem(item, { minWords: 8, requireActionVerb: false });
    if (!result.ok) {
      issues.push(`Acceptance item ${index + 1} ${result.issues.join(' and ')}.`);
    }
  });

  dependencies.forEach((item, index) => {
    const result = validateNarrativeItem(item, { minWords: 4, requireActionVerb: false });
    if (!result.ok) {
      issues.push(`Dependency item ${index + 1} ${result.issues.join(' and ')}.`);
    }
  });

  return {
    ok: issues.length === 0,
    issues,
    feedback: issues.join(' ')
  };
}

function countWords(text) {
  const s = normalizeText(text);
  if (!s) return 0;
  return s.split(' ').filter(Boolean).length;
}

function getMinWords() {
  const raw = String(process.env.TASK_CREATOR_MIN_WORDS || '').trim();
  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 30;
}

function getTaskCategories() {
  return ['Ads', 'Offers', 'Hiring', 'Ops', 'Product', 'Other'];
}

function missingOutcomeQuestion() {
  return 'What is the desired outcome / definition of done for this task?';
}

function canGenerateTaskDetails(fields) {
  const outcomeText = normalizeText(fields?.outcomeText);
  if (!outcomeText) {
    return {
      ok: false,
      code: 'MISSING_OUTCOME',
      question: missingOutcomeQuestion(),
      minWords: getMinWords(),
      words: 0
    };
  }

  const allText = [
    fields?.rawInputText,
    fields?.outcomeText,
    fields?.contextText,
    fields?.constraintsText
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');

  const words = countWords(allText);
  const minWords = getMinWords();

  if (words < minWords) {
    return {
      ok: false,
      code: 'THRESHOLD_NOT_MET',
      minWords,
      words,
      message: `Add more detail to unlock generation (need ${minWords} words; currently ${words}).`
    };
  }

  return { ok: true, minWords, words };
}

function normalizeTaskSourceAnalysis(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const categories = new Set(getTaskCategories().map(item => normalizeText(item).toLowerCase()));
  const allowedSourceTypes = new Set([
    'task_assignment',
    'beta_guide',
    'checklist',
    'operating_plan',
    'meeting_notes',
    'reference_doc'
  ]);
  const allowedPriorities = new Set(['HIGH', 'MEDIUM', 'LOW']);
  const allowedConfidence = new Set(['high', 'medium', 'low']);

  const normalizeList = (value, limit = 8, itemMax = 280) => {
    const items = Array.isArray(value)
      ? value
      : String(value == null ? '' : value)
          .split(/\r?\n|\u2022|\u2023|\u25E6/)
          .map(item => String(item || '').replace(/^[-*\d.)\s]+/, '').trim())
          .filter(Boolean);

    const out = [];
    const seen = new Set();
    for (const item of items) {
      const cleaned = normalizeText(item);
      if (!cleaned) continue;
      const clipped = cleaned.length > itemMax ? cleaned.slice(0, itemMax).trim() : cleaned;
      if (!clipped || seen.has(clipped)) continue;
      seen.add(clipped);
      out.push(clipped);
      if (out.length >= limit) break;
    }
    return out;
  };

  const normalizeLinkList = (value, limit = 12) => {
    const items = Array.isArray(value)
      ? value
      : String(value == null ? '' : value)
          .split(/\s+/)
          .map(item => String(item || '').trim())
          .filter(Boolean);

    const out = [];
    const seen = new Set();
    for (const item of items) {
      let href = normalizeText(item);
      if (!href) continue;
      if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
      try {
        const parsed = new URL(href);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
        if (!parsed.hostname || !parsed.hostname.includes('.')) continue;
        const safe = parsed.toString();
        if (seen.has(safe)) continue;
        seen.add(safe);
        out.push(safe);
        if (out.length >= limit) break;
      } catch (_) {
      }
    }
    return out;
  };

  const pickText = (value, max = 400) => {
    const cleaned = normalizeText(value);
    if (!cleaned) return null;
    return cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned;
  };

  const sourceTypeRaw = normalizeText(source.source_type || source.sourceType || source.documentType || '').toLowerCase();
  const confidenceRaw = normalizeText(source.confidence || '').toLowerCase();
  const priorityRaw = normalizeText(source?.suggested?.priority || source.priority || '').toUpperCase();
  const dueDateRaw = normalizeText(source?.suggested?.due_date || source.due_date || source.dueDate || '');
  const dueTimeRaw = normalizeText(source?.suggested?.due_time || source.due_time || source.dueTime || '');
  const categoryRaw = pickText(source?.suggested?.category || source.category || '', 32);
  const categoryNormalized = categoryRaw && categories.has(categoryRaw.toLowerCase()) ? categoryRaw : null;

  return {
    sourceType: allowedSourceTypes.has(sourceTypeRaw) ? sourceTypeRaw : 'reference_doc',
    confidence: allowedConfidence.has(confidenceRaw) ? confidenceRaw : 'medium',
    title: pickText(source.title, 90),
    summary: pickText(source.summary, 280),
    businessContext: pickText(source.business_context || source.businessContext, 420),
    assigneeGuidance: pickText(source.assignee_guidance || source.assigneeGuidance, 320),
    objective: pickText(source.objective, 520),
    instructions: normalizeList(source.instructions, 8, 260),
    checklist: normalizeList(source.checklist, 10, 260),
    safetyRules: normalizeList(source.safety_rules || source.safetyRules, 8, 240),
    expectedOutput: normalizeList(source.expected_output || source.expectedOutput, 6, 240),
    validationProof: normalizeList(source.validation_proof || source.validationProof, 6, 240),
    links: normalizeLinkList(source.links, 12),
    missingFields: normalizeList(source.missing_fields || source.missingFields, 8, 220),
    suggested: {
      category: categoryNormalized,
      priority: allowedPriorities.has(priorityRaw) ? priorityRaw : null,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw) ? dueDateRaw : null,
      dueTime: /^\d{2}:\d{2}$/.test(dueTimeRaw) ? dueTimeRaw : null
    }
  };
}

module.exports = {
  normalizeText,
  countWords,
  getMinWords,
  getTaskCategories,
  missingOutcomeQuestion,
  canGenerateTaskDetails,
  validateGeneratedTaskDetails,
  normalizeTaskSourceAnalysis
};
