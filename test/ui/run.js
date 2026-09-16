'use strict';
// Browser tests. Run with `npm run test:ui` (needs `npx playwright install chromium`
// once, or BLSR_BROWSER_PATH pointing at a Chromium/Chrome binary).
const assert = require('assert');
const { test, run, selectInInput } = require('./harness');

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
  await page.click('#btn-delete-workspace');
  await wait(page, 200);
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
  assert.strictEqual(stored.version, 2, 'old state is re-saved with the current schema version');
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
});

// ---------- Selection popup ----------
test('selection popup adds plain keywords and suggested wildcard rules', async (page) => {
  await page.click('#btn-add-workspace');
  await page.fill('#io-in', 'Order 4711 for Anna Berger: price 21.0, sku BB12345678, ip 192.168.178.42');
  await selectInInput(page, 'Anna Berger');
  assert.ok(await page.isVisible('#sel-popup'));
  assert.strictEqual(await page.textContent('#sel-popup-kw'), 'Anna Berger');
  assert.strictEqual(await page.inputValue('#sel-popup-rp'), 'ANON_1');
  assert.ok(await page.isHidden('#sel-popup-pt'), 'no wildcard toggle for names');
  await page.fill('#sel-popup-rp', 'PERSON_1');
  await page.press('#sel-popup-rp', 'Enter');
  await wait(page, 200);
  assert.ok(await page.isHidden('#sel-popup'));
  assert.ok((await page.inputValue('#io-out')).includes('PERSON_1'));

  const cases = [['21.0', '%d'], ['BB12345678', 'BB%i'], ['192.168.178.42', '%i.%i.%i.%i'], ['4711', '%i']];
  for (const [needle, tpl] of cases) {
    await selectInInput(page, needle);
    assert.strictEqual(await page.inputValue('#sel-popup-rp'), tpl, needle);
    assert.ok(await page.evaluate(() => document.getElementById('sel-popup-pt').classList.contains('on')));
    await page.click('#sel-popup-add');
    await wait(page, 150);
  }
  const rules = await page.evaluate(() => activeWorkspace().rules.map((r) => (r.pattern ? '%' : '') + r.keyword + '->' + r.replacement));
  assert.deepStrictEqual(rules, ['Anna Berger->PERSON_1', '%21.0->%d', '%BB12345678->BB%i', '%192.168.178.42->%i.%i.%i.%i', '%4711->%i']);
  assert.ok(/^Order \d{4} for PERSON_1: price \d\d\.\d, sku BB\d{8}, ip [\d.]+$/.test(await page.inputValue('#io-out')));

  // Toggle to a plain keyword, duplicate protection, Esc, no popup in de-anonymize mode.
  await selectInInput(page, '4711');
  await page.click('#sel-popup-pt');
  assert.strictEqual(await page.inputValue('#sel-popup-rp'), 'ANON_1', 'no ANON_ rule exists yet');
  await page.keyboard.press('Escape');
  assert.ok(await page.isHidden('#sel-popup'));
  await selectInInput(page, 'Anna Berger');
  await page.click('#sel-popup-add');
  await wait(page, 100);
  assert.ok((await page.textContent('#toast')).includes('already a keyword'));
  assert.strictEqual(await page.evaluate(() => activeWorkspace().rules.length), 5);
  await page.click('#mode-deanon');
  await page.fill('#io-in', 'PERSON_1 hello');
  await selectInInput(page, 'PERSON_1');
  assert.ok(await page.isHidden('#sel-popup'));
});

// ---------- Dialogs, export/import ----------
test('help and privacy dialogs open and close', async (page) => {
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

test('export contains seed and mappings; import strips the demo flag', async (page) => {
  await page.click('#workspace-list li:nth-child(2)');
  await wait(page, 1800);
  const exported = await page.evaluate(() => JSON.stringify({ version: 1, workspaces: visibleWorkspaces() }));
  const parsed = JSON.parse(exported);
  const demo2 = parsed.workspaces.find((w) => w.id === 'demo-2-wildcards');
  assert.strictEqual(demo2.seed, 'demo2-wildcards-seed');
  assert.ok(demo2.mappings.length > 0);
  await page.evaluate((json) => {
    const file = new File([json], 'ws.json', { type: 'application/json' });
    importJson(file);
  }, exported);
  await wait(page, 300);
  const names = await page.locator('#workspace-list li').evaluateAll((ls) => ls.map((l) => l.querySelector('.ws-list-name').textContent + (l.querySelector('.demo-badge') ? ' [demo]' : '')));
  assert.strictEqual(names.length, 6);
  assert.strictEqual(names.filter((n) => !n.includes('[demo]')).length, 3, 'imported copies are ordinary workspaces');
  const ids = await page.evaluate(() => state.workspaces.map((w) => w.id));
  assert.strictEqual(new Set(ids).size, ids.length, 'ids stay unique');
});

run();
