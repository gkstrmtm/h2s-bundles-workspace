const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHttpsTrainingLink,
  sanitizeTrainingVideoAssets,
  validateCreateTrainingPayload
} = require('../lib/training_admin_create.js');

test('sanitizeTrainingVideoAssets keeps canonical YouTube and Loom links only', () => {
  const assets = sanitizeTrainingVideoAssets([
    'https://youtu.be/abc123DEF45',
    'https://www.youtube.com/watch?v=abc123DEF45',
    'https://www.loom.com/share/9f4a1e3b2c4d4a6bbf3f2d1c0a9e8b7c',
    'https://example.com/not-video'
  ]);

  assert.deepEqual(assets, [
    'https://www.youtube.com/watch?v=abc123DEF45',
    'https://www.loom.com/share/9f4a1e3b2c4d4a6bbf3f2d1c0a9e8b7c'
  ]);
});

test('validateCreateTrainingPayload accepts VIDEO payloads with assets and no top-level url', () => {
  const result = validateCreateTrainingPayload({
    type: 'VIDEO',
    assets: [
      'https://www.youtube.com/watch?v=abc123DEF45',
      'https://www.loom.com/share/9f4a1e3b2c4d4a6bbf3f2d1c0a9e8b7c'
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.typeUpper, 'VIDEO');
  assert.equal(result.primaryUrl, 'https://www.youtube.com/watch?v=abc123DEF45');
  assert.equal(result.assets.length, 2);
});

test('validateCreateTrainingPayload rejects VIDEO payloads without valid YouTube or Loom assets', () => {
  const result = validateCreateTrainingPayload({
    type: 'VIDEO',
    assets: ['https://example.com/not-video']
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'VIDEO training requires at least one valid YouTube or Loom link.');
});

test('normalizeHttpsTrainingLink accepts only https links', () => {
  assert.equal(normalizeHttpsTrainingLink('https://example.com/training.pdf'), 'https://example.com/training.pdf');
  assert.equal(normalizeHttpsTrainingLink('http://example.com/training.pdf'), '');
  assert.equal(normalizeHttpsTrainingLink('not-a-link'), '');
});

test('validateCreateTrainingPayload accepts PDF and SOP payloads with one https url', () => {
  const pdf = validateCreateTrainingPayload({
    type: 'PDF',
    url: 'https://example.com/training.pdf'
  });
  const sop = validateCreateTrainingPayload({
    type: 'SOP',
    url: 'https://example.com/training-sop'
  });

  assert.equal(pdf.ok, true);
  assert.equal(pdf.typeUpper, 'PDF');
  assert.equal(pdf.primaryUrl, 'https://example.com/training.pdf');
  assert.deepEqual(pdf.assets, []);

  assert.equal(sop.ok, true);
  assert.equal(sop.typeUpper, 'SOP');
  assert.equal(sop.primaryUrl, 'https://example.com/training-sop');
  assert.deepEqual(sop.assets, []);
});

test('validateCreateTrainingPayload returns type-specific errors for PDF and SOP', () => {
  const pdf = validateCreateTrainingPayload({ type: 'PDF', url: 'http://example.com/training.pdf' });
  const sop = validateCreateTrainingPayload({ type: 'SOP', url: '' });

  assert.equal(pdf.ok, false);
  assert.equal(pdf.error, 'PDF training requires exactly one HTTPS link.');

  assert.equal(sop.ok, false);
  assert.equal(sop.error, 'SOP training requires exactly one HTTPS link.');
});
