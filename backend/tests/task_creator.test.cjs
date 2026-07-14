const test = require('node:test');
const assert = require('node:assert/strict');

const {
  countWords,
  canGenerateTaskDetails,
  missingOutcomeQuestion,
  validateGeneratedTaskDetails,
  normalizeTaskSourceAnalysis
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

test('validateGeneratedTaskDetails rejects vague fragments and underspecified steps', () => {
  const res = validateGeneratedTaskDetails({
    description: 'Build the rollout plan. Sequence of activities, deliverables, email themes, and nurturing flow.',
    checklist: [
      'Sequence of activities',
      'Deliverables',
      'Email themes',
      'Nurturing flow'
    ],
    acceptance: ['Plan complete'],
    dependencies: []
  });

  assert.equal(res.ok, false);
  assert.ok(res.issues.some(issue => issue.includes('Description')));
  assert.ok(res.issues.some(issue => issue.includes('Checklist item 1')));
  assert.ok(res.issues.some(issue => issue.includes('Acceptance')));
});

test('validateGeneratedTaskDetails allows detailed, action-oriented task output', () => {
  const res = validateGeneratedTaskDetails({
    description: 'Review the PureStay campaign brief and turn it into a rollout plan a new operator could execute without extra explanation. Explain what must be prepared first, what dependencies need to be confirmed, and how the email and nurture pieces connect to the launch schedule.',
    checklist: [
      'Identify the main campaign promise, target audience, and conversion goal so the plan has one clear direction.',
      'List every asset, approval, and system setup the team needs before emails or ads can go live.',
      'Break the 30-day rollout into phases and explain what work happens in each phase and who owns it.',
      'Define the email sequence, including the purpose of each message and the trigger that moves a lead to the next step.'
    ],
    acceptance: [
      'The final plan explains the launch order, required inputs, and deliverables in plain language that a new team member can follow.',
      'The PDF or handoff document shows the 30-day sequence, email flow, and build priorities without major gaps or placeholder language.'
    ],
    dependencies: [
      'Confirm the approved offer, audience, and conversion goal before finalizing the rollout plan.',
      'Gather any existing brand assets, prior campaign data, and platform access notes that inform the sequence.'
    ]
  });

  assert.equal(res.ok, true);
  assert.equal(res.issues.length, 0);
});

test('normalizeTaskSourceAnalysis clips and sanitizes uploaded source analysis payloads', () => {
  const res = normalizeTaskSourceAnalysis({
    source_type: 'beta_guide',
    confidence: 'HIGH',
    title: '  Business Services Beta QuickStart  ',
    summary: '  Convert the beta quickstart into a task draft for a tester.  ',
    business_context: '  This is for the next beta cohort.  ',
    assignee_guidance: '  Route this to the assigned beta operator.  ',
    objective: '  Review the guide and confirm the setup path, customer messaging, and evidence capture steps.  ',
    instructions: [' Review the pre-flight checklist ', 'Review the pre-flight checklist', 'Capture setup blockers'],
    checklist: ['Confirm the account prerequisites', 'Capture screenshots for each critical step'],
    safety_rules: ['Do not contact live customers', 'Never change billing without approval'],
    expected_output: ['A reviewed checklist with blocker notes'],
    validation_proof: ['Attach screenshots for each completed milestone'],
    links: ['example.com/guide', 'https://example.com/guide', 'notaurl'],
    missing_fields: ['Owner not specified', 'Due date not specified'],
    suggested: {
      category: 'Ops',
      priority: 'high',
      due_date: '2026-04-03',
      due_time: '09:30'
    }
  });

  assert.equal(res.sourceType, 'beta_guide');
  assert.equal(res.confidence, 'high');
  assert.equal(res.title, 'Business Services Beta QuickStart');
  assert.equal(res.instructions.length, 2);
  assert.deepEqual(res.links, ['https://example.com/guide']);
  assert.equal(res.suggested.category, 'Ops');
  assert.equal(res.suggested.priority, 'HIGH');
  assert.equal(res.suggested.dueDate, '2026-04-03');
  assert.equal(res.suggested.dueTime, '09:30');
});

test('normalizeTaskSourceAnalysis falls back safely on invalid values', () => {
  const res = normalizeTaskSourceAnalysis({
    source_type: 'mystery_doc',
    confidence: 'certain',
    links: ['javascript:alert(1)'],
    suggested: {
      category: 'Finance',
      priority: 'urgent',
      due_date: 'soon',
      due_time: 'later'
    }
  });

  assert.equal(res.sourceType, 'reference_doc');
  assert.equal(res.confidence, 'medium');
  assert.equal(res.links.length, 0);
  assert.equal(res.suggested.category, null);
  assert.equal(res.suggested.priority, null);
  assert.equal(res.suggested.dueDate, null);
  assert.equal(res.suggested.dueTime, null);
});
