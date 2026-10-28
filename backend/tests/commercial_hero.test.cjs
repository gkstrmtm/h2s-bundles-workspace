const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const frontend = path.resolve(__dirname, '..', '..', 'frontend');

function fixture(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(frontend, 'commercial.html'), 'utf8'));
  t.after(() => dom.window.close());
  const style = dom.window.document.createElement('style');
  style.textContent = fs.readFileSync(path.join(frontend, 'commercial.css'), 'utf8');
  dom.window.document.head.append(style);
  const rules = Array.from(style.sheet.cssRules);
  const media = condition => Array.from(rules.find(rule => rule.conditionText === condition).cssRules);
  const declaration = (group, selector, name) => group.find(rule => rule.selectorText === selector).style.getPropertyValue(name);
  return { document: dom.window.document, rules, media, declaration };
}

test('Commercial hero retains canonical copy, CTA and independent media frame', t => {
  const { document } = fixture(t);
  assert.ok(document.querySelector('link[href="/commercial.css"]'));
  assert.equal(document.querySelector('.hero > .hero__copy h1').textContent, 'Commercial Installations, Done Right.');
  assert.equal(document.querySelector('.hero__actions a').getAttribute('href'), '#assessmentWorkbench');
  assert.ok(document.querySelector('.hero > .hero__visual #heroMediaStage'));
});

test('Commercial hero does not inherit the 1100px gallery and form stack', t => {
  const { rules, media, declaration } = fixture(t);
  assert.equal(declaration(rules, '.hero', 'grid-template-columns'), 'minmax(0, 1.04fr) minmax(360px, 0.96fr)');
  assert.ok(media('(max-width: 1100px)').every(rule => !rule.selectorText.split(',').some(selector => selector.trim().startsWith('.hero'))));
  assert.equal(declaration(media('(min-width: 521px) and (max-width: 1100px)'), '.hero__visual', 'align-self'), 'center');
  assert.equal(declaration(media('(min-width: 521px) and (max-width: 1100px)'), '.media-stage', 'min-height'), '0');
});

test('stacked hero widens the text and constrains proof before compact-phone styling', t => {
  const { media, declaration } = fixture(t);
  const stacked = media('(max-width: 799px)');
  assert.equal(declaration(stacked, '.hero', 'grid-template-columns'), 'minmax(0, 1fr)');
  assert.equal(declaration(stacked, '.hero__copy', 'max-width'), 'none');
  assert.equal(declaration(stacked, '.hero h1', 'max-width'), '22ch');
  assert.equal(declaration(stacked, '.hero__lede', 'max-width'), '60ch');
  assert.equal(declaration(stacked, '.hero__visual', 'width'), 'min(100%, 480px)');
  assert.ok(media('(max-width: 720px)').every(rule => !rule.selectorText.split(',').some(selector => selector.trim().startsWith('.hero'))));
  assert.equal(declaration(media('(max-width: 520px)'), '.hero h1', 'max-width'), '9.4ch');
  assert.equal(declaration(media('(max-width: 430px)'), '.hero h1', 'max-width'), '8.2ch');
});

test('Commercial hero image hint follows the narrow, stacked and two-column ranges', () => {
  const source = fs.readFileSync(path.join(frontend, 'commercial.js'), 'utf8');
  assert.match(source, /mediaEl\.sizes = '\(max-width: 430px\) calc\(100vw - 44px\), \(max-width: 520px\) calc\(100vw - 40px\), \(max-width: 799px\) 480px, \(max-width: 1100px\) 48vw, 42vw'/);
});
