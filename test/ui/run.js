'use strict';
// Browser tests. Run with `npm run test:ui` (needs `npx playwright install chromium`
// once, or BLSR_BROWSER_PATH pointing at a Chromium/Chrome binary).
const assert = require('assert');
const { test, run, selectInInput, clickInInput } = require('./harness');

const wait = (page, ms) => page.waitForTimeout(ms);

// ---------- Loading, demos, security ----------
test('loads with three demo workspaces and no external requests', async (page, url) => {
  const names = await page.locator('#workspace-list li .ws-list-name').allTextContents();
  assert.deepStrictEqual(names, ['Demo 1 – Basics', 'Demo 2 – Wildcards (JSON)', 'Demo 3 – Log file']);
  assert.ok(await page.isVisible('#demo-note'));
  assert.strictEqual(await page.textContent('#btn-delete-workspace'), 'Hide demo');
  assert.ok((await page.inputValue('#io-out')).startsWith('Hi PERSON_1_FIRSTNAME,'));
  const external = page.requests.filter((u) => !u.startsWith(url));
  assert.deepStrictEqual(external, []);
  assert.ok(await page.evaluate(() => document.querySelectorAll('.btn-icon .icon use').length > 0), 'icons rendered');
  const colors = await page.evaluate(() => ['#btn-privacy', '.legal-links a:nth-child(1)', '.legal-links a:nth-child(2)'].map((s) => getComputedStyle(document.querySelector(s)).color + '/' + getComputedStyle(document.querySelector(s)).textDecorationLine));
  assert.deepStrictEqual(colors, ['rgb(147, 197, 253)/underline', 'rgb(147, 197, 253)/underline', 'rgb(147, 197, 253)/underline'], 'all footer links share one style');
  const legal = await page.locator('.sidebar-footer .legal-links a').evaluateAll((as) => as.map((a) => a.textContent + '=' + a.href + '|' + a.target + '|' + a.rel));
  assert.deepStrictEqual(legal, [
    'Source Code=https://github.com/OlivierBerlinAI/BrowserLocalSearchReplacer|_blank|noopener',
    'Imprint=https://olivier.berlin/imprint/|_blank|noopener',
    'Privacy Policy=https://olivier.berlin/privacy-policy/|_blank|noopener',
  ]);
});

test('security headers and CSP block every outgoing channel', async (page, url) => {
  const res = await page.request.get(url);
  const csp = res.headers()['content-security-policy'];
  assert.ok(csp.includes("connect-src 'none'") && csp.includes("form-action 'none'"), csp);
  assert.strictEqual(res.headers()['x-content-type-options'], 'nosniff');
  const notFound = await page.request.get(url + 'does-not-exist');
  assert.strictEqual(notFound.status(), 404);
  assert.ok(notFound.headers()['content-security-policy']);
  // Typing must not trigger any request.
  const before = page.requests.length;
  await page.fill('#io-in', 'password: "secret" id: "1234454"');
  await wait(page, 1800);
  assert.strictEqual(page.requests.length, before);
  // Attempts to send data are refused by the browser and reported as violations.
  const violations = await page.evaluate(async () => {
    const v = [];
    document.addEventListener('securitypolicyviolation', (e) => v.push(e.violatedDirective));
    try { await fetch(location.origin + '/app.js'); } catch {}
    try { await fetch('https://example.com/'); } catch {}
    try { const x = new XMLHttpRequest(); x.open('POST', location.origin + '/'); x.send('d'); } catch {}
    try { navigator.sendBeacon(location.origin + '/', 'x'); } catch {}
    const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.body.appendChild(s);
    await new Promise((r) => setTimeout(r, 300));
    return { v, inline: !!window.__inline };
  });
  assert.ok(violations.v.filter((d) => d === 'connect-src').length >= 4, JSON.stringify(violations));
  assert.strictEqual(violations.inline, false);
  page.errors.length = 0; // the CSP reports are the expected console errors here
});

test('hiding and restoring demo workspaces', async (page) => {
  const confirms = [];
  page.on('dialog', (d) => confirms.push(d.message())); // harness listener accepts
  await page.click('#btn-delete-workspace');
  await wait(page, 200);
  assert.ok(confirms[0].includes('can be restored'), 'first hide shows the restore hint');
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('blsr.demoRestoreHintShown.v1')), '1');
  let names = await page.locator('#workspace-list li .ws-list-name').allTextContents();
  assert.deepStrictEqual(names, ['Demo 2 – Wildcards (JSON)', 'Demo 3 – Log file']);
  assert.ok(await page.isVisible('#btn-restore-demos'));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('blsr.state.v1')).workspaces.map((w) => w.id + ':' + !!w.hidden));
  assert.deepStrictEqual(stored, ['demo-1-basics:true', 'demo-2-wildcards:false', 'demo-3-logfile:false']);
  await page.reload();
  await wait(page, 200);
  names = await page.locator('#workspace-list li .ws-list-name').allTextContents();
  assert.strictEqual(names.length, 2, 'hidden state survives reload');
  assert.deepStrictEqual(await page.evaluate(() => visibleWorkspaces().map((w) => w.id)), ['demo-2-wildcards', 'demo-3-logfile'], 'export excludes hidden');
  await page.click('#btn-add-workspace');
  assert.strictEqual(await page.inputValue('#ws-name'), 'Workspace 1', 'numbering ignores demos');
  await page.click('#btn-restore-demos');
  await wait(page, 200);
  names = await page.locator('#workspace-list li .ws-list-name').allTextContents();
  assert.strictEqual(names.length, 4);
  assert.ok(await page.isHidden('#btn-restore-demos'));
  // Restoring keeps the flag, so a second hide asks without the restore hint.
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('blsr.demoRestoreHintShown.v1')), '1', 'flag survives restore');
  await page.click('#workspace-list li:nth-child(1)'); // Demo 1
  await wait(page, 100);
  confirms.length = 0;
  await page.click('#btn-delete-workspace');
  await wait(page, 200);
  assert.strictEqual(confirms.length, 1);
  assert.ok(!confirms[0].includes('can be restored'), 'second hide omits the restore hint');
});

test('reset all brings the demo workspaces back', async (page) => {
  await page.click('#btn-delete-workspace'); // hide demo 1
  await page.click('#btn-add-workspace');
  await wait(page, 200);
  await page.click('#btn-reset'); // confirm dialog is auto-accepted
  await wait(page, 200);
  const names = await page.locator('#workspace-list li .ws-list-name').allTextContents();
  assert.deepStrictEqual(names, ['Demo 1 – Basics', 'Demo 2 – Wildcards (JSON)', 'Demo 3 – Log file']);
  assert.strictEqual(await page.inputValue('#ws-name'), 'Demo 1 – Basics');
  assert.ok((await page.inputValue('#io-out')).startsWith('Hi PERSON_1_FIRSTNAME,'), 'demo text and result are shown again');
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('blsr.demoRestoreHintShown.v1')), null, 'reset all also clears the hint flag');
  await page.reload();
  await wait(page, 200);
  assert.strictEqual((await page.locator('#workspace-list li').count()), 3);
});

test('existing state without demos gets them appended, active workspace kept', async (page) => {
  await wait(page, 500); // let the demo's delayed text persistence finish before replacing the state
  await page.evaluate(() => localStorage.setItem('blsr.state.v1', JSON.stringify({ version: 1, workspaces: [{ id: 'mine', name: 'Mine', rules: [] }], activeWorkspaceId: 'mine' })));
  await page.reload();
  await wait(page, 200);
  const names = await page.locator('#workspace-list li .ws-list-name').allTextContents();
  assert.deepStrictEqual(names, ['Mine', 'Demo 1 – Basics', 'Demo 2 – Wildcards (JSON)', 'Demo 3 – Log file']);
  assert.strictEqual(await page.inputValue('#ws-name'), 'Mine');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('blsr.state.v1')));
  assert.strictEqual(stored.version, 3, 'old state is re-saved with the current schema version');
  // Data from a newer version loads with a warning toast.
  await page.evaluate(() => localStorage.setItem('blsr.state.v1', JSON.stringify({ version: 99, workspaces: [{ id: 'n', name: 'Newer', rules: [] }] })));
  await page.reload();
  await wait(page, 200);
  assert.ok((await page.textContent('#toast')).includes('newer version'));
  assert.strictEqual(await page.inputValue('#ws-name'), 'Newer');
});

// ---------- Rules: table and compact views ----------
test('wildcard rules in the table: mirroring, hits, mappings, round trip, new seed', async (page) => {
  await page.click('#btn-add-workspace');
  await page.click('#view-table');
  await page.click('#btn-add-rule');
  const rows = page.locator('#rules-body tr');
  await rows.nth(0).locator('.pt').check();
  await rows.nth(0).locator('.kw').fill('"price": %d');
  assert.strictEqual(await rows.nth(0).locator('.rp').inputValue(), '"price": %d', 'replacement mirrors keyword');
  await page.click('#btn-add-rule');
  await rows.nth(1).locator('.kw').fill('BB%i');
  await rows.nth(1).locator('.pt').check();
  await rows.nth(1).locator('.sc').check();
  await page.click('#btn-add-rule');
  await rows.nth(2).locator('.kw').fill('Olivier');
  await rows.nth(2).locator('.rp').fill('PERSON_1');

  const input = 'Olivier bought {"price": 21.0} and {"price": 21.0}, id BB12345678, other BB00099';
  await page.fill('#io-in', input);
  await wait(page, 200);
  const out = await page.inputValue('#io-out');
  assert.ok(/^PERSON_1 bought \{"price": (\d\d\.\d)\} and \{"price": \1\}, id BB\d{8}, other BB\d{5}$/.test(out), out);
  assert.strictEqual(await page.textContent('#io-count'), '5 replacements');
  assert.deepStrictEqual(await rows.evaluateAll((trs) => trs.map((t) => t.querySelector('.hits').textContent)), ['2', '2', '1']);
  assert.strictEqual(await page.textContent('#mappings-count'), '(0)', 'mappings are written only once the text settled');
  await wait(page, 1800);
  assert.strictEqual(await page.textContent('#mappings-count'), '(3)');

  // Deterministic, and de-anonymize restores the original via mappings.
  await page.fill('#io-in', '');
  await page.fill('#io-in', input);
  await wait(page, 200);
  assert.strictEqual(await page.inputValue('#io-out'), out);
  await page.click('#mode-deanon');
  await page.fill('#io-in', out);
  await wait(page, 200);
  assert.strictEqual(await page.inputValue('#io-out'), input);

  // New seed changes future values; old text still restores.
  const seed = await page.inputValue('#ws-seed');
  await page.click('#mode-anon');
  await page.click('#btn-new-seed');
  await wait(page, 200);
  assert.notStrictEqual(await page.inputValue('#ws-seed'), seed);
  assert.notStrictEqual(await page.inputValue('#io-out'), out);
  await page.click('#mode-deanon');
  await page.fill('#io-in', out);
  await wait(page, 200);
  assert.strictEqual(await page.inputValue('#io-out'), input);

  // State survives a reload; the run with the new seed added three more mappings.
  await page.reload();
  await wait(page, 200);
  assert.strictEqual(await page.textContent('#mappings-count'), '(6)');
  const rule0 = await page.evaluate(() => activeWorkspace().rules[0]);
  assert.strictEqual(rule0.pattern, true);
});

test('example -> template rule and non-fitting example warning', async (page) => {
  await page.click('#btn-add-workspace');
  await page.click('#view-table');
  const text = '{\n  password: "MySecretPassword",\n  anImportantId: "1234454"\n}';
  await page.fill('#io-in', text);
  await page.click('#btn-add-rule');
  const row = page.locator('#rules-body tr').first();
  await row.locator('.kw').fill('anImportantId: "1234454"');
  await row.locator('.rp').fill('anImportantId: "%i"');
  await row.locator('.pt').check();
  await wait(page, 200);
  assert.ok(/anImportantId: "\d{7}"/.test(await page.inputValue('#io-out')));
  assert.ok((await row.getAttribute('class')).includes('derived'));
  assert.ok((await row.locator('.kw').getAttribute('title')).includes('anImportantId: "%i"'));
  await page.click('#btn-add-rule');
  const row2 = page.locator('#rules-body tr').nth(1);
  await row2.locator('.kw').fill('password: "MySecretPassword"');
  await row2.locator('.rp').fill('password: "%i"');
  await row2.locator('.pt').check();
  await wait(page, 100);
  assert.ok((await row2.getAttribute('class')).includes('warn'));
});

test('compact view: entry row, pills show only active options, toggling off', async (page) => {
  await page.click('#btn-add-workspace');
  await page.click('#view-compact');
  const add = async (kw, rp, opts) => {
    await page.fill('#ce-kw', kw);
    await page.fill('#ce-rp', rp);
    for (const id of ['ce-ci', 'ce-ww', 'ce-pt', 'ce-sc']) await page.setChecked('#' + id, !!opts[id]);
    await page.press('#ce-kw', 'Enter');
  };
  await add('BB%i', '', { 'ce-pt': true, 'ce-sc': true });
  await add('Olivier', 'PERSON_1', {});
  await add('acme', 'COMPANY', { 'ce-ci': true, 'ce-ww': true });
  assert.strictEqual(await page.evaluate(() => activeWorkspace().rules[0].replacement), 'BB%i', 'empty replacement pre-filled for wildcard rules');
  const icons = await page.locator('#rules-pills .pill').evaluateAll((ps) => ps.map((p) => Array.from(p.querySelectorAll('use')).map((u) => u.getAttribute('href')).join(' ')));
  assert.deepStrictEqual(icons, [
    '#mdi-regex #mdi-seed #mdi-close',
    '#mdi-close',
    '#mdi-format-letter-case #mdi-format-letter-matches #mdi-close',
  ]);
  await page.locator('#rules-pills .pill').nth(2).locator('.ci').click();
  await wait(page, 100);
  assert.strictEqual(await page.evaluate(() => activeWorkspace().rules[2].caseInsensitive), false);
  // Editing via the pill text loads the entry row.
  await page.locator('#rules-pills .pill').nth(1).locator('.pill-main').click();
  assert.strictEqual(await page.inputValue('#ce-kw'), 'Olivier');
  assert.strictEqual(await page.textContent('#ce-add'), 'Save');
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.textContent('#ce-add'), 'Add');
});

test('collapsed sections hide their actions and rotate the chevron', async (page) => {
  await page.click('#workspace-list li:nth-child(2)');
  await wait(page, 1800);
  await page.click('#btn-toggle-rules');
  await page.click('#btn-toggle-mappings');
  await wait(page, 100);
  for (const sel of ['#view-table', '#btn-add-rule', '#btn-help', '#ws-seed', '#btn-new-seed', '#btn-clear-mappings']) {
    assert.ok(await page.isHidden(sel), sel + ' hidden');
  }
  const rot = await page.evaluate(() => [getComputedStyle(document.querySelector('#btn-toggle-rules .chevron')).transform, getComputedStyle(document.querySelector('#btn-toggle-mappings .chevron')).transform]);
  assert.ok(rot[0] !== 'none' && rot[0] === rot[1]);
  await page.reload();
  await wait(page, 200);
  assert.ok(await page.isHidden('#btn-add-rule'), 'collapsed state persisted');
  // View state is per workspace: another workspace keeps its own.
  await page.click('#workspace-list li:nth-child(3)');
  await wait(page, 100);
  assert.ok(await page.isVisible('#btn-add-rule'), 'other workspace not collapsed');
  await page.click('#view-compact');
  await page.click('#workspace-list li:nth-child(2)');
  await wait(page, 100);
  assert.ok(await page.isHidden('#btn-add-rule') && await page.isHidden('#compact-entry'), 'first workspace still collapsed, table view');
  await page.click('#workspace-list li:nth-child(3)');
  await wait(page, 100);
  assert.ok(await page.isVisible('#compact-entry'), 'third workspace remembers compact view');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('blsr.state.v1')));
  assert.strictEqual(stored.workspaces[1].rulesCollapsed, true);
  assert.strictEqual(stored.workspaces[2].rulesView, 'compact');
  assert.ok(!('rulesView' in stored), 'no global view state any more');
});

// ---------- Selection popup ----------
test('selection popup adds plain keywords and suggested wildcard rules', async (page) => {
  await page.click('#btn-add-workspace');
  await page.fill('#io-in', 'Order 4711 for Anna Berger: price 21.0, sku BB12345678, ip 192.168.178.42');
  await selectInInput(page, 'Anna Berger');
  assert.ok(await page.isVisible('#sel-popup'));
  assert.strictEqual(await page.inputValue('#sel-popup-kw'), 'Anna Berger');
  assert.strictEqual(await page.inputValue('#sel-popup-rp'), 'ANON_1');
  assert.ok(await page.isHidden('#sel-popup-pt'), 'no wildcard toggle for names');
  await page.fill('#sel-popup-rp', 'PERSON_1');
  await page.press('#sel-popup-rp', 'Enter');
  await wait(page, 200);
  assert.ok(await page.isHidden('#sel-popup'));
  assert.ok((await page.inputValue('#io-out')).includes('PERSON_1'));

  // Toggle between wildcard suggestion and plain keyword (before any rule matches the number).
  await selectInInput(page, '4711');
  assert.strictEqual(await page.inputValue('#sel-popup-rp'), '%i');
  await page.click('#sel-popup-pt');
  assert.strictEqual(await page.inputValue('#sel-popup-rp'), 'ANON_1', 'no ANON_ rule exists yet');
  await page.click('#sel-popup-pt');
  assert.strictEqual(await page.inputValue('#sel-popup-rp'), '%i');
  await page.keyboard.press('Escape');
  assert.ok(await page.isHidden('#sel-popup'));

  // 4711 first: once a %d rule exists it would match 4711 and open edit mode instead.
  const cases = [['4711', '%i'], ['21.0', '%d'], ['BB12345678', 'BB%i'], ['192.168.178.42', '%i.%i.%i.%i']];
  for (const [needle, tpl] of cases) {
    await selectInInput(page, needle);
    assert.strictEqual(await page.inputValue('#sel-popup-rp'), tpl, needle);
    assert.ok(await page.evaluate(() => document.getElementById('sel-popup-pt').classList.contains('on')));
    await page.click('#sel-popup-add');
    await wait(page, 150);
  }
  const rules = await page.evaluate(() => activeWorkspace().rules.map((r) => (r.pattern ? '%' : '') + r.keyword + '->' + r.replacement));
  assert.deepStrictEqual(rules, ['Anna Berger->PERSON_1', '%4711->%i', '%21.0->%d', '%BB12345678->BB%i', '%192.168.178.42->%i.%i.%i.%i']);
  assert.ok(/^Order \d{4} for PERSON_1: price \d\d\.\d, sku BB\d{8}, ip [\d.]+$/.test(await page.inputValue('#io-out')));

  // Selecting exactly a highlighted match opens edit mode for its rule.
  await selectInInput(page, '4711');
  assert.strictEqual(await page.textContent('#sel-popup-add'), 'Save');
  assert.strictEqual(await page.inputValue('#sel-popup-kw'), '4711');
  await page.keyboard.press('Escape');
  // Selecting an existing keyword edits it instead of adding a duplicate; no popup in de-anonymize mode.
  await selectInInput(page, 'Anna Berger');
  assert.strictEqual(await page.textContent('#sel-popup-add'), 'Save');
  await page.click('#sel-popup-add');
  await wait(page, 100);
  assert.ok((await page.textContent('#toast')).includes('updated'));
  assert.strictEqual(await page.evaluate(() => activeWorkspace().rules.length), 5);
  await page.click('#mode-deanon');
  await page.fill('#io-in', 'PERSON_1 hello');
  await selectInInput(page, 'PERSON_1');
  assert.ok(await page.isHidden('#sel-popup'));
});

test('clicking a highlighted match opens the popup in edit mode', async (page) => {
  // Demo 1 is active: "Anna Berger" -> PERSON_1, "Berlin" -> CITY_1 (whole word)
  await clickInInput(page, 'Anna Berger');
  assert.ok(await page.isVisible('#sel-popup'));
  assert.strictEqual(await page.textContent('#sel-popup-add'), 'Save');
  assert.strictEqual(await page.inputValue('#sel-popup-kw'), 'Anna Berger');
  assert.strictEqual(await page.inputValue('#sel-popup-rp'), 'PERSON_1');
  assert.ok(await page.isVisible('#sel-popup-del'));
  assert.ok(await page.isVisible('#sel-popup-pt'), 'wildcard toggle always available when editing');
  // Change the replacement and the keyword, save.
  await page.fill('#sel-popup-rp', 'CUSTOMER_1');
  await page.press('#sel-popup-rp', 'Enter');
  await wait(page, 200);
  assert.ok(await page.isHidden('#sel-popup'));
  assert.ok((await page.inputValue('#io-out')).includes('CUSTOMER_1'));
  const rule = await page.evaluate(() => activeWorkspace().rules.find((r) => r.keyword === 'Anna Berger'));
  assert.strictEqual(rule.replacement, 'CUSTOMER_1');
  // Turn a plain keyword into a wildcard rule and edit its pattern
  // ("Acme GmbH" -> COMPANY_1 becomes "Acme %s" -> "Acme %s", still case-insensitive).
  await clickInInput(page, 'Acme GmbH');
  assert.strictEqual(await page.inputValue('#sel-popup-kw'), 'Acme GmbH');
  await page.click('#sel-popup-pt');
  await page.fill('#sel-popup-kw', 'Acme %s');
  await page.fill('#sel-popup-rp', 'Acme %s');
  await page.click('#sel-popup-add');
  await wait(page, 200);
  const rule2 = await page.evaluate(() => activeWorkspace().rules.find((r) => r.keyword === 'Acme %s'));
  assert.strictEqual(rule2.pattern, true);
  assert.strictEqual(rule2.caseInsensitive, true, 'other options are kept');
  assert.ok(/at Acme [A-Z][a-z][a-z][A-Z] yesterday/.test(await page.inputValue('#io-out')), 'letter case kept per character: ' + await page.inputValue('#io-out'));
  // A click outside any match shows nothing; a plain selection still adds.
  await clickInInput(page, 'thanks');
  assert.ok(await page.isHidden('#sel-popup'));
  await selectInInput(page, 'thanks');
  assert.strictEqual(await page.textContent('#sel-popup-add'), 'Anonymize');
  await page.keyboard.press('Escape');
  // Remove via the popup.
  const before = await page.evaluate(() => activeWorkspace().rules.length);
  await clickInInput(page, 'Berlin office');
  assert.strictEqual(await page.inputValue('#sel-popup-kw'), 'Berlin');
  await page.click('#sel-popup-del');
  await wait(page, 200);
  assert.strictEqual(await page.evaluate(() => activeWorkspace().rules.length), before - 1);
  assert.ok(!(await page.inputValue('#io-out')).includes('CITY_1'));
});

// ---------- Dialogs, export/import ----------
test('help and how-it\'s-done dialogs open and close', async (page) => {
  assert.strictEqual(await page.textContent('#btn-privacy'), "How it's done");
  assert.strictEqual(await page.textContent('#privacy-dialog h2'), "How it's done");
  for (const [btn, dlg] of [['#btn-help', '#help-dialog'], ['#btn-privacy', '#privacy-dialog']]) {
    await page.click(btn);
    assert.ok(await page.evaluate((s) => document.querySelector(s).open, dlg));
    await page.keyboard.press('Escape');
    assert.ok(!(await page.evaluate((s) => document.querySelector(s).open, dlg)));
    await page.click(btn);
    await page.locator(dlg + ' .dialog-close').click();
    assert.ok(!(await page.evaluate((s) => document.querySelector(s).open, dlg)));
  }
});

test('export dialog: select all / subset; file has seed and mappings', async (page) => {
  await page.click('#workspace-list li:nth-child(2)');
  await wait(page, 1800);
  await page.click('#btn-export');
  assert.ok(await page.evaluate(() => document.getElementById('export-dialog').open));
  const boxes = page.locator('#export-list input[type="checkbox"]');
  assert.strictEqual(await boxes.count(), 3);
  assert.deepStrictEqual(await boxes.evaluateAll((bs) => bs.map((b) => b.checked)), [false, true, false], 'active workspace preselected');
  assert.strictEqual(await page.textContent('#export-confirm'), 'Export 1 workspace');
  await boxes.nth(1).uncheck();
  assert.deepStrictEqual(await boxes.evaluateAll((bs) => bs.map((b) => b.checked)), [false, false, false]);
  assert.ok(await page.isDisabled('#export-confirm'), 'nothing selected -> button disabled');
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('export-confirm')).opacity), '0.45');
  await page.check('#export-all');
  assert.deepStrictEqual(await boxes.evaluateAll((bs) => bs.map((b) => b.checked)), [true, true, true]);
  assert.ok(await page.isEnabled('#export-confirm'));
  await boxes.nth(0).uncheck();
  assert.ok(await page.evaluate(() => document.getElementById('export-all').indeterminate));
  assert.strictEqual(await page.textContent('#export-confirm'), 'Export 2 workspaces');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-confirm')]);
  const content = JSON.parse(require('fs').readFileSync(await download.path(), 'utf8'));
  assert.strictEqual(content.version, 3);
  assert.deepStrictEqual([content.workspaces[0].rulesView, content.workspaces[0].rulesCollapsed, content.workspaces[0].mappingsCollapsed], ['table', false, false], 'view state is exported');
  assert.deepStrictEqual(content.workspaces.map((w) => w.id), ['demo-2-wildcards', 'demo-3-logfile']);
  const demo2 = content.workspaces[0];
  assert.strictEqual(demo2.seed, 'demo2-wildcards-seed');
  assert.ok(demo2.mappings.length > 0);
  assert.ok(!(await page.evaluate(() => document.getElementById('export-dialog').open)), 'dialog closes after export');
});

test('import dialog: add, replace, skip and import as variant', async (page) => {
  const file = {
    version: 2,
    workspaces: [
      { id: 'fresh', name: 'Fresh', rules: [{ keyword: 'a', replacement: 'b' }] },
      { id: 'demo-1-basics', name: 'Demo 1 – Basics', rules: [{ keyword: 'replaced', replacement: 'R' }], seed: 'new-seed' },
      { id: 'other-id', name: 'Demo 2 – Wildcards (JSON)', rules: [] },
      { id: 'demo-3-logfile', name: 'Demo 3 – Log file', rules: [] },
    ],
  };
  const open = async () => {
    await page.evaluate((json) => importJson(new File([json], 'ws.json', { type: 'application/json' })), JSON.stringify(file));
    await wait(page, 300);
    assert.ok(await page.evaluate(() => document.getElementById('import-dialog').open));
  };
  await open();
  const rows = page.locator('#import-list tr');
  assert.deepStrictEqual(await rows.evaluateAll((trs) => trs.map((t) => t.children[2].textContent)), ['new', 'exists (same id)', 'exists (same name)', 'exists (same id)']);
  assert.ok(await page.isVisible('#import-conflicts-hint'));
  await rows.nth(1).locator('select').selectOption('replace');
  await rows.nth(2).locator('select').selectOption('variant');
  // row 3 stays on the default: skip
  await page.click('#import-confirm');
  await wait(page, 300);
  assert.ok((await page.textContent('#toast')).includes('1 added, 1 replaced, 1 imported as variant, 1 skipped'));
  const names = await page.locator('#workspace-list li').evaluateAll((ls) => ls.map((l) => l.querySelector('.ws-list-name').textContent + (l.querySelector('.demo-badge') ? ' [demo]' : '')));
  assert.deepStrictEqual(names, ['Demo 1 – Basics [demo]', 'Demo 2 – Wildcards (JSON) [demo]', 'Demo 3 – Log file [demo]', 'Fresh', 'Demo 2 – Wildcards (JSON) (2)']);
  const demo1 = await page.evaluate(() => state.workspaces.find((w) => w.id === 'demo-1-basics'));
  assert.strictEqual(demo1.rules[0].keyword, 'replaced', 'replace keeps the id, takes the content');
  assert.strictEqual(demo1.seed, 'new-seed');
  assert.strictEqual(demo1.demo, true, 'replace keeps the demo flag');
  const demo3 = await page.evaluate(() => state.workspaces.find((w) => w.id === 'demo-3-logfile'));
  assert.strictEqual(demo3.rules.length, 8, 'skipped workspace untouched');
  const ids = await page.evaluate(() => state.workspaces.map((w) => w.id));
  assert.strictEqual(new Set(ids).size, ids.length, 'ids stay unique');
  // "Set all: Skip" then Cancel changes nothing.
  await open();
  await page.click('.import-set-all[data-action="skip"]');
  assert.deepStrictEqual(await page.locator('#import-list select').evaluateAll((ss) => ss.map((x) => x.value)), ['skip', 'skip', 'skip', 'skip']);
  await page.locator('#import-dialog .dialog-actions .dialog-close').click();
  assert.strictEqual(await page.evaluate(() => state.workspaces.length), 5);
});

test('workspace can be renamed via the title field', async (page) => {
  await page.click('#btn-add-workspace');
  assert.strictEqual(await page.getAttribute('#ws-name', 'title'), 'Click to rename the workspace');
  await page.fill('#ws-name', 'My renamed workspace');
  await page.press('#ws-name', 'Enter');
  const names = await page.locator('#workspace-list li .ws-list-name').allTextContents();
  assert.ok(names.includes('My renamed workspace'));
  await page.reload();
  await wait(page, 200);
  assert.strictEqual(await page.inputValue('#ws-name'), 'My renamed workspace');
});

run();
