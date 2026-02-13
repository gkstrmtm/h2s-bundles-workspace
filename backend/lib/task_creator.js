/**
 * Task Creator helpers (no AI guessing guardrails).
 * Keep this file JS (allowJs) so it can be unit-tested with node:test.
 */

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

module.exports = {
  normalizeText,
  countWords,
  getMinWords,
  getTaskCategories,
  missingOutcomeQuestion,
  canGenerateTaskDetails
};
