'use strict';
const assert = require('assert');
const R = require('../public/replacer.js');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

t('basic replace', () => {
  const r = R.anonymize('Hello Acme', [{ keyword: 'Acme', replacement: 'COMPANY_1' }]);
  assert.deepStrictEqual(r, { text: 'Hello COMPANY_1', count: 1 });
});

t('case sensitive by default', () => {
  const r = R.anonymize('acme ACME Acme', [{ keyword: 'Acme', replacement: 'X' }]);
  assert.strictEqual(r.text, 'acme ACME X');
});

t('case insensitive', () => {
  const r = R.anonymize('acme ACME Acme', [{ keyword: 'Acme', replacement: 'X', caseInsensitive: true }]);
  assert.strictEqual(r.text, 'X X X');
  assert.strictEqual(r.count, 3);
});

t('whole word', () => {
  const r = R.anonymize('Ann Annual Ann.', [{ keyword: 'Ann', replacement: 'P', wholeWord: true }]);
  assert.strictEqual(r.text, 'P Annual P.');
});

t('whole word with unicode', () => {
  const r = R.anonymize('Müller Müllerstraße', [{ keyword: 'Müller', replacement: 'P', wholeWord: true }]);
  assert.strictEqual(r.text, 'P Müllerstraße');
});

t('whole word with punctuation edges', () => {
  const r = R.anonymize('Firma GmbH & Co. KG hier', [{ keyword: 'GmbH & Co.', replacement: 'C', wholeWord: true }]);
  assert.strictEqual(r.text, 'Firma C KG hier');
});

t('longest first', () => {
  const rules = [{ keyword: 'John', replacement: 'P1' }, { keyword: 'John Smith', replacement: 'P2' }];
  assert.strictEqual(R.anonymize('John Smith and John', rules, { longestFirst: true }).text, 'P2 and P1');
  assert.strictEqual(R.anonymize('John Smith and John', rules, { longestFirst: false }).text, 'P1 Smith and P1');
});

t('no chained replacement', () => {
  const rules = [{ keyword: 'A', replacement: 'B' }, { keyword: 'B', replacement: 'C' }];
  assert.strictEqual(R.anonymize('A B', rules).text, 'B C');
});

t('regex special chars are literal', () => {
  const r = R.anonymize('a.b a-b (x)', [{ keyword: 'a.b', replacement: 'Y' }, { keyword: '(x)', replacement: 'Z' }]);
  assert.strictEqual(r.text, 'Y a-b Z');
});

t('replacement $ sequences are literal', () => {
  const r = R.anonymize('foo', [{ keyword: 'foo', replacement: '$& $1 $$' }]);
  assert.strictEqual(r.text, '$& $1 $$');
});

t('deanonymize round trip', () => {
  const rules = [
    { keyword: 'Olivier', replacement: 'PERSON_1', wholeWord: true },
    { keyword: 'Acme GmbH', replacement: 'COMPANY_1' },
  ];
  const src = 'Olivier works at Acme GmbH.';
  const anon = R.anonymize(src, rules, { longestFirst: true }).text;
  assert.strictEqual(anon, 'PERSON_1 works at COMPANY_1.');
  assert.strictEqual(R.deanonymize(anon, rules, { longestFirst: true }).text, src);
});

t('empty keywords are skipped', () => {
  const r = R.anonymize('abc', [{ keyword: '', replacement: 'X' }, { keyword: 'b', replacement: 'Y' }]);
  assert.strictEqual(r.text, 'aYc');
});

t('empty replacement removes text', () => {
  const r = R.anonymize('abc', [{ keyword: 'b', replacement: '' }]);
  assert.strictEqual(r.text, 'ac');
});

console.log(`\n${passed} tests passed`);
