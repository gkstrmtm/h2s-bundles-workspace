const test = require('node:test');
const assert = require('node:assert/strict');

const {
  countWords,
  canGenerateTaskDetails,
  missingOutcomeQuestion
} = require('../lib/task_creator.js');

test('countWords counts whitespace-delimited words', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords('one'), 1);
  assert.equal(countWords('one   two\nthree'), 3);
});

test('canGenerateTaskDetails blocks when outcome missing with exactly one question', () => {
  const res = canGenerateTaskDetails({
    rawInputText: 'do the thing',
    outcomeText: '',
    contextText: '',
    constraintsText: ''
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, 'MISSING_OUTCOME');
  assert.equal(typeof res.question, 'string');
  assert.equal(res.question, missingOutcomeQuestion());
});

test('canGenerateTaskDetails blocks when threshold not met', () => {
  const original = process.env.TASK_CREATOR_MIN_WORDS;
  process.env.TASK_CREATOR_MIN_WORDS = '10';

  const res = canGenerateTaskDetails({
    rawInputText: 'one two three',
    outcomeText: 'done looks like X',
    contextText: '',
    constraintsText: ''
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, 'THRESHOLD_NOT_MET');
  assert.equal(res.minWords, 10);
  assert.ok(res.words < 10);

  process.env.TASK_CREATOR_MIN_WORDS = original;
});

test('canGenerateTaskDetails allows when threshold met and outcome present', () => {
  const original = process.env.TASK_CREATOR_MIN_WORDS;
  process.env.TASK_CREATOR_MIN_WORDS = '5';

  const res = canGenerateTaskDetails({
    rawInputText: 'one two three',
    outcomeText: 'done is X',
    contextText: '',
    constraintsText: ''
  });

  assert.equal(res.ok, true);
  assert.equal(res.minWords, 5);
  assert.ok(res.words >= 5);

  process.env.TASK_CREATOR_MIN_WORDS = original;
});
