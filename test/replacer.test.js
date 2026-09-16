'use strict';
const assert = require('assert');
const R = require('../public/replacer.js');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

t('basic replace', () => {
  const r = R.anonymize('Hello Acme', [{ keyword: 'Acme', replacement: 'COMPANY_1' }]);
  assert.deepStrictEqual(r, { text: 'Hello COMPANY_1', count: 1, counts: [1], mappings: [] });
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

// ---------- Wildcard (pattern) rules ----------
const SEED = 'testseed';

t('parseTemplate', () => {
  assert.deepStrictEqual(R.parseTemplate('BB%i'), [{ type: 'lit', text: 'BB' }, { type: 'ph', kind: 'i' }]);
  assert.deepStrictEqual(R.parseTemplate('100%% %z %'), [{ type: 'lit', text: '100% %z %' }]);
  assert.deepStrictEqual(R.parseTemplate('%d-%s'), [{ type: 'ph', kind: 'd' }, { type: 'lit', text: '-' }, { type: 'ph', kind: 's' }]);
});

t('pattern %i keeps length and is deterministic', () => {
  const rules = [{ keyword: 'BB%i', replacement: 'BB%i', pattern: true }];
  const a = R.anonymize('id BB12345678 and BB12345678', rules, { seed: SEED });
  const m = /^id BB(\d{8}) and BB(\d{8})$/.exec(a.text);
  assert.ok(m, a.text);
  assert.strictEqual(m[1], m[2]);
  assert.notStrictEqual(m[1], '12345678');
  assert.strictEqual(a.count, 2);
  assert.deepStrictEqual(a.counts, [2]);
  assert.deepStrictEqual(a.mappings, [{ from: 'BB12345678', to: 'BB' + m[1] }]);
  // Same seed -> same output on a fresh run; other seed -> other output.
  assert.strictEqual(R.anonymize('BB12345678', rules, { seed: SEED }).text, 'BB' + m[1]);
  assert.notStrictEqual(R.anonymize('BB12345678', rules, { seed: 'other' }).text, 'BB' + m[1]);
});

t('pattern %d keeps sign, decimals and separator', () => {
  const rules = [{ keyword: '"price": %d', replacement: '"price": %d', pattern: true }];
  const r = R.anonymize('{"price": 21.0, "x": -3,50, "y": 0.5}', [rules[0], { keyword: '"x": %d', replacement: '"x": %d', pattern: true }, { keyword: '"y": %d', replacement: '"y": %d', pattern: true }], { seed: SEED });
  const m = /^\{"price": ([1-9]\d\.\d), "x": (-[1-9],\d\d), "y": (0\.\d)\}$/.exec(r.text);
  assert.ok(m, r.text);
  assert.notStrictEqual(m[1], '21.0');
  assert.notStrictEqual(m[3], '0.5');
});

t('pattern replacement may rename the fixed text', () => {
  const rules = [{ keyword: '"price": %d', replacement: '"amount": %d', pattern: true }];
  const r = R.anonymize('"price": 21.0', rules, { seed: SEED });
  assert.ok(/^"amount": \d\d\.\d$/.test(r.text), r.text);
});

t('%s, %a, %x keep character classes', () => {
  const r = R.anonymize('Name: Smith Code: X7k2 Hash: 3fA9', [
    { keyword: 'Name: %s', replacement: 'Name: %s', pattern: true },
    { keyword: 'Code: %a', replacement: 'Code: %a', pattern: true },
    { keyword: 'Hash: %x', replacement: 'Hash: %x', pattern: true },
  ], { seed: SEED });
  assert.ok(/^Name: [A-Z][a-z]{4} Code: [A-Z]\d[a-z]\d Hash: [0-9A-F]{4}$/.test(r.text), r.text);
});

t('%% is a literal percent in pattern rules', () => {
  const r = R.anonymize('rate 5% done', [{ keyword: 'rate %i%%', replacement: 'rate %i%%', pattern: true }], { seed: SEED });
  assert.ok(/^rate \d% done$/.test(r.text), r.text);
  assert.notStrictEqual(r.text, 'rate 5% done');
});

t('seedIncludesText makes BB and CC differ; without it they share digits', () => {
  const text = 'BB12345678 CC12345678';
  const shared = R.anonymize(text, [
    { keyword: 'BB%i', replacement: 'BB%i', pattern: true },
    { keyword: 'CC%i', replacement: 'CC%i', pattern: true },
  ], { seed: SEED }).text;
  const m1 = /^BB(\d+) CC(\d+)$/.exec(shared);
  assert.strictEqual(m1[1], m1[2]);
  const separate = R.anonymize(text, [
    { keyword: 'BB%i', replacement: 'BB%i', pattern: true, seedIncludesText: true },
    { keyword: 'CC%i', replacement: 'CC%i', pattern: true, seedIncludesText: true },
  ], { seed: SEED }).text;
  const m2 = /^BB(\d+) CC(\d+)$/.exec(separate);
  assert.notStrictEqual(m2[1], m2[2]);
});

t('multiple wildcards in one pattern are independent', () => {
  const rules = [{ keyword: 'p=%d q=%i', replacement: 'p=%d q=%i', pattern: true }];
  const r = R.anonymize('p=42 q=42', rules, { seed: SEED }).text;
  const m = /^p=(\d\d) q=(\d\d)$/.exec(r);
  assert.ok(m, r);
  assert.strictEqual(m[1], m[2]); // same value + same seed -> same random value
});

t('literal rules win over pattern rules', () => {
  const rules = [
    { keyword: 'BB%i', replacement: 'BB%i', pattern: true },
    { keyword: 'BB000', replacement: 'FIXED' },
  ];
  assert.strictEqual(R.anonymize('BB000', rules, { seed: SEED }).text, 'FIXED');
});

t('pattern rule with whole word and case-insensitive', () => {
  const rules = [{ keyword: 'bb%i', replacement: 'XX%i', pattern: true, wholeWord: true, caseInsensitive: true }];
  const r = R.anonymize('BB123 xBB123 BB123x', rules, { seed: SEED }).text;
  assert.ok(/^XX\d{3} xBB123 BB123x$/.test(r), r);
});

t('pattern rule without wildcards acts as a literal (and %% unescapes)', () => {
  const rules = [{ keyword: '100%%', replacement: 'all', pattern: true }];
  assert.strictEqual(R.anonymize('100% sure', rules).text, 'all sure');
  assert.strictEqual(R.deanonymize('all sure', rules).text, '100% sure');
});

t('de-anonymize via mappings', () => {
  const rules = [
    { keyword: 'BB%i', replacement: 'BB%i', pattern: true },
    { keyword: 'Olivier', replacement: 'PERSON_1' },
  ];
  const src = 'Olivier has BB12345678 and BB99';
  const a = R.anonymize(src, rules, { seed: SEED });
  assert.strictEqual(a.mappings.length, 2);
  const back = R.deanonymize(a.text, rules, { seed: SEED, mappings: a.mappings });
  assert.strictEqual(back.text, src);
  assert.strictEqual(back.count, 3);
  assert.deepStrictEqual(back.counts, [0, 1]); // mapping hits are not attributed to a rule
  // Without mappings the random values stay as they are.
  assert.strictEqual(R.deanonymize(a.text, rules, { seed: SEED }).text, a.text.replace('PERSON_1', 'Olivier'));
});

t('generate never returns the input when an alternative exists', () => {
  for (let i = 0; i < 10; i++) {
    assert.notStrictEqual(R.generate('i', String(i), 'k' + i), String(i));
  }
  assert.strictEqual(R.generate('i', '7', 'a'), R.generate('i', '7', 'a'));
});

t('randomSeed is 16 hex chars', () => {
  const s = R.randomSeed();
  assert.ok(/^[0-9a-f]{16}$/.test(s), s);
  assert.notStrictEqual(s, R.randomSeed());
});

t('example keyword + template replacement is read as a pattern', () => {
  const rules = [{ keyword: 'anImportantId: "1234454"', replacement: 'anImportantId: "%i"', pattern: true }];
  const text = '{\n  password: "x",\n  anImportantId: "1234454",\n  other: "999"\n}';
  const r = R.anonymize(text, rules, { seed: SEED });
  const m = /anImportantId: "(\d{7})"/.exec(r.text);
  assert.ok(m, r.text);
  assert.notStrictEqual(m[1], '1234454');
  assert.ok(r.text.includes('other: "999"'));
  // ...and it generalizes to other values of the same shape.
  assert.ok(/anImportantId: "\d{3}"/.test(R.anonymize('anImportantId: "555"', rules, { seed: SEED }).text));
  assert.deepStrictEqual(R.describeRule(rules[0]), { matches: 'anImportantId: "%i"', derived: true, warning: null });
});

t('example keyword that does not fit the replacement stays literal, with a warning', () => {
  const rule = { keyword: 'id: "AB12"', replacement: 'id: "%i"', pattern: true };
  assert.strictEqual(R.anonymize('id: "AB12"', [rule], { seed: SEED }).text, 'id: "%i"');
  const d = R.describeRule(rule);
  assert.strictEqual(d.matches, null);
  assert.ok(d.warning && d.warning.includes('id: "%i"'));
  assert.deepStrictEqual(R.describeRule({ keyword: 'BB%i', replacement: 'BB%i', pattern: true }), { matches: 'BB%i', derived: false, warning: null });
  assert.deepStrictEqual(R.describeRule({ keyword: 'a', replacement: 'b' }), { matches: null, derived: false, warning: null });
});

t('suggestTemplate guesses the shape of a selection', () => {
  const cases = {
    '21.0': '%d', '-3,50': '%d', '-7': '%d', '12345678': '%i', '3fa9c0de': '%x', 'C0FFEE': '%x', 'deadbeef': null, // letters-only hex could be a word
    'BB12345678': 'BB%i', 'A7K2-99X': '%a-%a', '192.168.178.42': '%i.%i.%i.%i',
    'anna.berger@example.com': '%s.%s@%s.%s', 'support@acme.de': '%s@%s.%s',
    'order-2026-09-15': 'order-%i-%i-%i', '10:12:01': '%i:%i:%i',
    'Anna': null, 'Anna Berger': null, 'Acme GmbH & Co': null, 'abcd': null, '': null, '100%': null,
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.strictEqual(R.suggestTemplate(input), expected, input);
  }
  // Every suggestion must actually match the value it was derived from (example -> template).
  for (const [input, tpl] of Object.entries(cases)) {
    if (!tpl) continue;
    const d = R.describeRule({ keyword: input, replacement: tpl, pattern: true });
    assert.strictEqual(d.matches, tpl, 'derived: ' + input);
  }
});

// ---------- Schema migrations ----------
const M = require('../public/migrations.js');

t('migrate: bare array and version 1 come out as the current version', () => {
  assert.strictEqual(M.SCHEMA_VERSION, 2);
  const a = M.migrate([{ id: 'x', name: 'X', rules: [] }]);
  assert.deepStrictEqual(a, { data: { workspaces: [{ id: 'x', name: 'X', rules: [] }], version: 2 }, from: 1, warnings: [] });
  const b = M.migrate({ version: 1, workspaces: [{ id: 'y' }], mode: 'deanonymize' });
  assert.strictEqual(b.data.version, 2);
  assert.strictEqual(b.data.mode, 'deanonymize');
  assert.deepStrictEqual(b.data.workspaces, [{ id: 'y' }]);
  assert.strictEqual(b.from, 1);
});

t('migrate: current version passes through, newer version warns, garbage is tolerated', () => {
  const cur = M.migrate({ version: 2, workspaces: [] });
  assert.deepStrictEqual(cur.warnings, []);
  assert.strictEqual(cur.from, 2);
  const newer = M.migrate({ version: 99, workspaces: [{ id: 'z', futureField: true }] });
  assert.strictEqual(newer.warnings.length, 1);
  assert.ok(newer.warnings[0].includes('newer version'));
  assert.strictEqual(newer.data.version, 2);
  assert.strictEqual(newer.data.workspaces[0].futureField, true, 'unknown fields are kept for the normalizer to decide');
  for (const junk of [null, undefined, 42, 'str', {}, { version: 'abc' }]) {
    const r = M.migrate(junk);
    assert.deepStrictEqual(r.data.workspaces, []);
    assert.strictEqual(r.data.version, 2);
  }
});

console.log(`\n${passed} tests passed`);
