const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'commercial.js'), 'utf8');
const ast = ts.createSourceFile('commercial.js', source, ts.ScriptTarget.Latest, true);
const names = ['scrollPanelBelowHeader', 'scrollWizardStepIntoView', 'moveToStep', 'bindWizard'];
const functions = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) functions.push(node.getText(ast));
  else ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(functions.length, names.length);

function setup(t, reducedMotion = false) {
  const dom = new JSDOM(`<header class="site-header"></header><input id="phone">
    <button data-step-action="next">Continue</button><button data-step-action="prev">Back</button>
    <button class="wizard-step" data-step-target="4">Step 4</button>
    ${[1, 2, 3, 4, 5].map(step => `<section class="wizard-card" data-step="${step}"><p class="card-step">Step ${step}</p><h2>Heading</h2></section>`).join('')}
    <section id="receipt"></section>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, frames = [], calls = [];
  let headerHeight = 64;
  w.requestAnimationFrame = callback => frames.push(callback);
  w.matchMedia = () => ({ matches: reducedMotion });
  Object.defineProperty(w, 'scrollY', { value: 500 });
  w.scrollTo = options => calls.push(options);
  w.document.querySelector('.site-header').getBoundingClientRect = () => ({ bottom: headerHeight });
  for (const card of w.document.querySelectorAll('.wizard-card')) {
    card.getBoundingClientRect = () => ({ top: 200 });
    card.querySelector('.card-step').getBoundingClientRect = () => ({ top: 228 });
  }
  w.document.getElementById('receipt').getBoundingClientRect = () => ({ top: 300 });
  w.eval(`const WIZARD_STEPS = [1, 2, 3, 4, 5];
    const state = { currentStep: 2, maxStepVisited: 5 };
    let valid = true;
    function qsa(selector) { return [...document.querySelectorAll(selector)]; }
    function validateStep() { return valid; }
    function showStep(step) { state.currentStep = step; }
    function persistDraft() {}
    ${functions.join('\n')}
    window.testState = state;
    window.invalidateStep = () => { valid = false; };
    bindWizard();`);
  return { w, calls, setHeader: height => { headerHeight = height; }, flush() { while (frames.length) frames.shift()(); } };
}

for (const reduced of [false, true]) test(`Continue aligns the step number using the current header; reduced motion ${reduced}`, t => {
  const f = setup(t, reduced), { w } = f;
  w.document.getElementById('phone').focus();
  w.document.querySelector('[data-step-action="next"]').click();
  f.setHeader(104);
  f.flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].top, 500 + 228 - 104 - 16);
  assert.equal(f.calls[0].behavior, reduced ? 'instant' : 'smooth');
  assert.equal(w.testState.currentStep, 3);
  assert.equal(w.document.activeElement.id, 'phone');
});

test('Back, step selection and confirmation retain their existing targets', t => {
  const f = setup(t), { w } = f;
  w.document.querySelector('[data-step-action="prev"]').click(); f.flush();
  w.document.querySelector('.wizard-step').click(); f.flush();
  w.scrollPanelBelowHeader(w.document.getElementById('receipt')); f.flush();
  assert.deepEqual(f.calls.map(call => call.top), [500 + 200 - 64 - 16, 500 + 200 - 64 - 16, 500 + 300 - 64 - 16]);
  assert.equal(w.testState.currentStep, 4);
});

test('invalid Continue does not move or scroll; a missing step label falls back to its card', t => {
  const f = setup(t), { w } = f;
  w.invalidateStep();
  w.document.querySelector('[data-step-action="next"]').click(); f.flush();
  assert.equal(w.testState.currentStep, 2);
  assert.equal(f.calls.length, 0);
  w.document.querySelector('.wizard-card[data-step="3"] .card-step').remove();
  w.scrollWizardStepIntoView(3, true); f.flush();
  assert.equal(f.calls[0].top, 500 + 200 - 64 - 16);
});
