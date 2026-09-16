'use strict';
/* global Replacer */

// ---------- Persistence (localStorage only) ----------
const STORAGE_KEY = 'blsr.state.v1';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultState() {
  return { version: Migrations.SCHEMA_VERSION, activeWorkspaceId: null, workspaces: [], mode: 'anonymize', rulesCollapsed: false, mappingsCollapsed: false, liveUpdate: true, rulesHeight: null, rulesView: 'table' };
}

function normalizeRule(r) {
  return {
    id: typeof r?.id === 'string' ? r.id : uid(),
    keyword: typeof r?.keyword === 'string' ? r.keyword : '',
    replacement: typeof r?.replacement === 'string' ? r.replacement : '',
    caseInsensitive: !!r?.caseInsensitive,
    wholeWord: !!r?.wholeWord,
    pattern: !!r?.pattern,               // keyword/replacement are wildcard templates
    seedIncludesText: !!r?.seedIncludesText, // fixed text of the pattern feeds the random seed
  };
}

function normalizeMapping(m) {
  if (typeof m?.from !== 'string' || typeof m?.to !== 'string' || m.to.length === 0) return null;
  return { from: m.from, to: m.to };
}

function emptyBuf() {
  return { input: '', output: '', count: '' };
}

function normalizeBuf(b) {
  return {
    input: typeof b?.input === 'string' ? b.input : '',
    output: typeof b?.output === 'string' ? b.output : '',
    count: typeof b?.count === 'string' ? b.count : '',
  };
}

function normalizeTexts(t) {
  return { anonymize: normalizeBuf(t?.anonymize), deanonymize: normalizeBuf(t?.deanonymize) };
}

function normalizeWorkspace(w) {
  const ws = {
    id: typeof w?.id === 'string' ? w.id : uid(),
    name: typeof w?.name === 'string' ? w.name : 'Untitled',
    longestFirst: w?.longestFirst !== false,
    persistTexts: w?.persistTexts === true,
    rules: Array.isArray(w?.rules) ? w.rules.map(normalizeRule) : [],
    // Seed for wildcard values and the mappings recorded from them. Both travel
    // with the workspace (localStorage and JSON export), so de-anonymizing works
    // wherever the workspace is.
    seed: typeof w?.seed === 'string' && w.seed.trim() ? w.seed.trim() : Replacer.randomSeed(),
    mappings: Array.isArray(w?.mappings) ? w.mappings.map(normalizeMapping).filter(Boolean) : [],
  };
  // Demo workspaces ship with the app; "deleting" one only hides it.
  if (w?.demo === true) {
    ws.demo = true;
    ws.hidden = w.hidden === true;
    if (Array.isArray(w.help)) ws.help = w.help.filter((h) => typeof h === 'string');
  }
  // Texts are only kept in storage when the workspace opts in.
  if (ws.persistTexts && w?.texts) ws.texts = normalizeTexts(w.texts);
  return ws;
}

// Warnings collected while loading (e.g. data from a newer app version); shown
// once the UI is up.
const loadWarnings = [];
let loadedFromVersion = Migrations.SCHEMA_VERSION;

function normalizeState(input) {
  const { data: raw, warnings, from } = Migrations.migrate(input);
  loadWarnings.push(...warnings);
  loadedFromVersion = from;
  const s = defaultState();
  if (raw && Array.isArray(raw.workspaces)) {
    s.workspaces = raw.workspaces.map(normalizeWorkspace);
  }
  // Add demo workspaces that this browser has never seen (hidden ones stay hidden).
  for (const demo of Demos.demoWorkspaces()) {
    if (!s.workspaces.some((w) => w.id === demo.id)) s.workspaces.push(normalizeWorkspace(demo));
  }
  if (raw?.mode === 'deanonymize') s.mode = 'deanonymize';
  s.rulesCollapsed = raw?.rulesCollapsed === true;
  s.mappingsCollapsed = raw?.mappingsCollapsed === true;
  s.liveUpdate = raw?.liveUpdate !== false;
  s.rulesHeight = Number.isFinite(raw?.rulesHeight) && raw.rulesHeight > 0 ? raw.rulesHeight : null;
  s.rulesView = raw?.rulesView === 'compact' ? 'compact' : 'table';
  const visible = s.workspaces.filter((w) => !w.hidden);
  if (typeof raw?.activeWorkspaceId === 'string' && visible.some((w) => w.id === raw.activeWorkspaceId)) {
    s.activeWorkspaceId = raw.activeWorkspaceId;
  } else if (visible.length) {
    s.activeWorkspaceId = visible[0].id;
  }
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeState(raw ? JSON.parse(raw) : null);
  } catch (e) {
    console.warn('Could not read saved state, starting fresh.', e);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error(e);
    toast('Could not save to localStorage (quota exceeded or disabled).');
  }
  // Rules or options may have changed; keep the highlights in step.
  if (typeof updateHighlights === 'function' && document.readyState !== 'loading') updateHighlights();
}

let state = loadState();

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);

// Inline SVG icon from the sprite embedded in index.html (Material Design Icons).
function svgIcon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', '#mdi-' + name);
  svg.appendChild(use);
  return svg;
}

function activeWorkspace() {
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId) || null;
}

function visibleWorkspaces() {
  return state.workspaces.filter((w) => !w.hidden);
}

function hiddenDemos() {
  return state.workspaces.filter((w) => w.demo && w.hidden);
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

async function copyText(text) {
  if (!text) { toast('Nothing to copy.'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard.');
  } catch {
    // Clipboard API needs a secure context (https or localhost). Fall back to execCommand.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    toast(ok ? 'Copied to clipboard.' : 'Copy failed. Select the text and copy manually.');
  }
}

// ---------- Overwrite (Insert key) mode ----------
// Browsers never overwrite in <input> fields, so the Insert key is emulated here
// for the keyword/replacement inputs: a typed character replaces the one under
// the cursor instead of being inserted before it.
let overwriteMode = false;

function setOverwrite(on) {
  overwriteMode = on;
  document.body.classList.toggle('overwrite', on);
  $('#ovr-badge').hidden = !on;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Insert' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  setOverwrite(!overwriteMode);
  toast(overwriteMode ? 'Overwrite mode on (Insert)' : 'Overwrite mode off');
});

function overwriteKeydown(e) {
  if (!overwriteMode || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (e.key.length !== 1) return; // only printable characters
  const el = e.target;
  const start = el.selectionStart;
  if (start === null || start !== el.selectionEnd) return; // a selection is replaced anyway
  if (start >= el.value.length) return; // at the end: plain append
  e.preventDefault();
  el.setRangeText(e.key, start, start + 1, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------- Keyword highlighting ----------
// A textarea cannot colour parts of its text, so each one is transparent and
// stacked over a backdrop that renders the same text with <mark> elements.
function escapeHtml(str) {
  return str.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function highlightHtml(text, regex) {
  let out = '';
  if (regex && text) {
    let last = 0;
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m[0].length === 0) { regex.lastIndex++; continue; }
      out += escapeHtml(text.slice(last, m.index)) + '<mark>' + escapeHtml(m[0]) + '</mark>';
      last = m.index + m[0].length;
    }
    out += escapeHtml(text.slice(last));
  } else {
    out = escapeHtml(text);
  }
  // Trailing newline so a final empty line keeps its height, like in the textarea.
  return out + '\n';
}

function backdropOf(ta) {
  return ta.parentElement.querySelector('.io-backdrop');
}

// Make the backdrop cover exactly the textarea's padding box (excludes border
// and scrollbar) so wrapping and positions line up.
function sizeBackdrop(ta) {
  const bd = backdropOf(ta);
  bd.style.width = ta.clientWidth + 'px';
  bd.style.height = ta.clientHeight + 'px';
  bd.scrollTop = ta.scrollTop;
  bd.scrollLeft = ta.scrollLeft;
}

function updateHighlights() {
  const ws = activeWorkspace();
  const anon = isAnon();
  const opts = ws ? engineOpts(ws) : {};
  // Input holds keywords in anonymize mode and replacements in de-anonymize mode; output the reverse.
  const inRe = ws ? Replacer.compile(ws.rules, Object.assign({}, opts, { reverse: !anon })).regex : null;
  const outRe = ws ? Replacer.compile(ws.rules, Object.assign({}, opts, { reverse: anon })).regex : null;
  const inHl = $('#io-in-hl');
  const outHl = $('#io-out-hl');
  inHl.innerHTML = highlightHtml($('#io-in').value, inRe);
  outHl.innerHTML = highlightHtml($('#io-out').value, outRe);
  // Original text -> yellow, anonymized text -> blue, whichever side it is on.
  inHl.classList.toggle('hl-out', !anon);
  outHl.classList.toggle('hl-out', anon);
  sizeBackdrop($('#io-in'));
  sizeBackdrop($('#io-out'));
}

// ---------- Rendering ----------
function renderSidebar() {
  const ul = $('#workspace-list');
  ul.innerHTML = '';
  for (const ws of visibleWorkspaces()) {
    const li = document.createElement('li');
    li.dataset.id = ws.id;
    const name = document.createElement('span');
    name.className = 'ws-list-name';
    name.textContent = ws.name || 'Untitled';
    li.appendChild(name);
    if (ws.id === state.activeWorkspaceId) li.classList.add('active');
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `(${ws.rules.length})`;
    li.appendChild(count);
    if (ws.demo) {
      const badge = document.createElement('span');
      badge.className = 'demo-badge';
      badge.textContent = 'demo';
      badge.title = 'Demo workspace shipped with the app. Deleting it only hides it.';
      li.appendChild(badge);
    }
    li.addEventListener('click', () => selectWorkspace(ws.id));
    ul.appendChild(li);
  }
  const hidden = hiddenDemos().length;
  $('#btn-restore-demos').hidden = hidden === 0;
  $('#btn-restore-demos').textContent = `Restore demo workspace${hidden === 1 ? '' : 's'} (${hidden})`;
}

function renderWorkspace() {
  const ws = activeWorkspace();
  $('#empty-state').hidden = !!ws;
  $('#workspace-view').hidden = !ws;
  if (!ws) return;

  $('#ws-name').value = ws.name;
  $('#ws-longest-first').checked = ws.longestFirst;
  $('#ws-persist-texts').checked = ws.persistTexts;
  $('#btn-delete-workspace').textContent = ws.demo ? 'Hide demo' : 'Delete workspace';
  $('#btn-delete-workspace').title = ws.demo ? 'Hide this demo workspace (it can be restored from the sidebar)' : '';
  renderDemoNote(ws);
  cancelEdit();
  renderRules();
  renderRulesCollapsed();
  renderRulesView();
  renderMappings();
  renderMappingsCollapsed();
  restoreIo();
  updateHighlights();
  liveRun();
}

function renderDemoNote(ws) {
  const box = $('#demo-note');
  const lines = ws.demo && ws.help ? ws.help : [];
  box.hidden = lines.length === 0;
  const ul = box.querySelector('ul');
  ul.innerHTML = '';
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.appendChild(li);
  }
}

function renderRulesCollapsed() {
  const collapsed = state.rulesCollapsed;
  $('.rules').classList.toggle('collapsed', collapsed);
  $('#rules-content').hidden = collapsed;
  $('#btn-toggle-rules').setAttribute('aria-expanded', String(!collapsed));
  if (!collapsed) applyRulesHeight();
}

// The keyword table shows at most this many rows before it scrolls, unless the
// user dragged the container's resize handle (then that height is kept).
const MAX_VISIBLE_RULES = 10;

function applyRulesHeight() {
  const box = $('#rules-scroll');
  const manual = state.rulesHeight;
  $('#rules-height-hint').hidden = !manual;
  if (manual) {
    box.style.maxHeight = 'none';
    box.style.height = manual + 'px';
    return;
  }
  box.style.height = '';
  const border = box.offsetHeight - box.clientHeight;
  if (isCompact()) {
    // Pills wrap into lines; limit to roughly MAX_VISIBLE_RULES lines of pills.
    const pill = box.querySelector('.pill');
    if (!pill || pill.offsetHeight === 0) { box.style.maxHeight = ''; return; }
    const gap = 6, pad = 16;
    box.style.maxHeight = (pad + MAX_VISIBLE_RULES * (pill.offsetHeight + gap) - gap + border) + 'px';
    return;
  }
  const row = box.querySelector('tbody tr');
  const head = box.querySelector('thead');
  if (!row || row.offsetHeight === 0) { box.style.maxHeight = ''; return; }
  box.style.maxHeight = (head.offsetHeight + MAX_VISIBLE_RULES * row.offsetHeight + border) + 'px';
}

function setRulesHeight(px) {
  state.rulesHeight = px;
  saveState();
  applyRulesHeight();
}

// A drag on the resize handle is the only thing that sets an inline height on
// the container that differs from the one we applied ourselves.
new ResizeObserver(() => {
  const box = $('#rules-scroll');
  if (box.hidden || box.offsetHeight === 0) return;
  const inline = parseInt(box.style.height, 10);
  if (!Number.isFinite(inline)) return;
  if (inline !== state.rulesHeight) setRulesHeight(inline);
}).observe($('#rules-scroll'));

function setRulesCollapsed(collapsed) {
  state.rulesCollapsed = collapsed;
  saveState();
  renderRulesCollapsed();
}

function renderRules() {
  const ws = activeWorkspace();
  const tbody = $('#rules-body');
  tbody.innerHTML = '';
  $('#rules-empty').hidden = ws.rules.length > 0;
  $('#rules-count').textContent = `(${ws.rules.length})`;
  $('#rules-scroll').hidden = ws.rules.length === 0;

  for (const rule of ws.rules) {
    const tr = document.createElement('tr');
    tr.dataset.id = rule.id;
    tr.innerHTML = `
      <td class="col-kw"><input type="text" class="kw" placeholder="Keyword" spellcheck="false"></td>
      <td class="col-rp"><input type="text" class="rp" placeholder="Replacement" spellcheck="false"></td>
      <td class="col-opt"><input type="checkbox" class="ci" title="Case-insensitive"></td>
      <td class="col-opt"><input type="checkbox" class="ww" title="Whole word only"></td>
      <td class="col-opt"><input type="checkbox" class="pt" title="Wildcards (%d %i %s %a %x)"></td>
      <td class="col-opt"><input type="checkbox" class="sc" title="Text in seed"></td>
      <td class="col-hits"><span class="hits"></span></td>
      <td class="col-del"><button class="btn btn-icon del" title="Remove keyword"></button></td>
    `;
    tr.querySelector('.del').appendChild(svgIcon('close'));
    const kw = tr.querySelector('.kw');
    const rp = tr.querySelector('.rp');
    const ci = tr.querySelector('.ci');
    const ww = tr.querySelector('.ww');
    const pt = tr.querySelector('.pt');
    const sc = tr.querySelector('.sc');
    kw.value = rule.keyword;
    rp.value = rule.replacement;
    ci.checked = rule.caseInsensitive;
    ww.checked = rule.wholeWord;
    pt.checked = rule.pattern;
    sc.checked = rule.seedIncludesText;
    sc.disabled = !rule.pattern;
    tr.classList.toggle('invalid', rule.keyword.trim() === '');
    tr.classList.toggle('is-pattern', rule.pattern);
    tr.querySelector('.hits').textContent = hitsText(rule.id);
    applyRuleStatus(rule, tr, kw, rp);

    kw.addEventListener('keydown', overwriteKeydown);
    rp.addEventListener('keydown', overwriteKeydown);
    kw.addEventListener('input', () => {
      setKeyword(rule, kw.value);
      if (rp.value !== rule.replacement) rp.value = rule.replacement;
      tr.classList.toggle('invalid', kw.value.trim() === '');
      applyRuleStatus(rule, tr, kw, rp);
      saveState(); liveRun();
    });
    rp.addEventListener('input', () => { rule.replacement = rp.value; applyRuleStatus(rule, tr, kw, rp); saveState(); liveRun(); });
    ci.addEventListener('change', () => { rule.caseInsensitive = ci.checked; saveState(); liveRun(); });
    ww.addEventListener('change', () => { rule.wholeWord = ww.checked; saveState(); liveRun(); });
    pt.addEventListener('change', () => {
      setPattern(rule, pt.checked);
      rp.value = rule.replacement;
      sc.disabled = !rule.pattern;
      tr.classList.toggle('is-pattern', rule.pattern);
      applyRuleStatus(rule, tr, kw, rp);
      saveState(); renderWildcardHint(); liveRun();
    });
    sc.addEventListener('change', () => { rule.seedIncludesText = sc.checked; saveState(); liveRun(); });
    tr.querySelector('.del').addEventListener('click', () => deleteRule(rule.id));
    // Enter in the replacement field adds a new row for quick data entry.
    rp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addRule(); }
    });
    tbody.appendChild(tr);
  }
  renderPills();
  renderWildcardHint();
}

// ---------- Rule helpers shared by both views ----------
// While a wildcard rule's replacement simply mirrors its keyword (the common
// case: same fixed text, random values), keep it mirrored as the keyword is typed.
function setKeyword(rule, value) {
  if (rule.pattern && rule.replacement === rule.keyword) rule.replacement = value;
  rule.keyword = value;
}

function setPattern(rule, on) {
  rule.pattern = on;
  if (on && rule.replacement === '') rule.replacement = rule.keyword;
  if (!on) rule.seedIncludesText = false;
}

// Wildcard rules can be written "template -> template" or "example -> template"
// (keyword holds a concrete value, only the replacement has wildcards). Show how
// the rule is read, and warn when the two sides do not fit together.
function applyRuleStatus(rule, container, kwEl, rpEl) {
  const d = Replacer.describeRule(rule);
  container.classList.toggle('warn', !!d.warning);
  container.classList.toggle('derived', d.derived);
  const note = d.warning ? d.warning : d.derived ? 'Keyword is read as an example. Matches as: ' + d.matches : '';
  kwEl.title = note;
  rpEl.title = note;
}

function hasPatternRules(ws) {
  return ws.rules.some((r) => r.pattern);
}

function renderWildcardHint() {
  renderMappingsVisibility(); // the mappings section appears with the first wildcard rule
}

// Per-rule match counts of the last run, shown next to each rule.
let lastHits = new Map(); // rule id -> count

function hitsText(id) {
  const n = lastHits.get(id);
  return n === undefined ? '' : String(n); // "0" makes a non-matching rule visible
}

function renderHits() {
  for (const tr of $('#rules-body').querySelectorAll('tr')) {
    tr.querySelector('.hits').textContent = hitsText(tr.dataset.id);
  }
  for (const pill of $('#rules-pills').querySelectorAll('.pill')) {
    const el = pill.querySelector('.pill-hits');
    const text = hitsText(pill.dataset.id);
    el.textContent = text;
    el.hidden = !text;
  }
}

// ---------- Compact view: entry row + pills ----------
let editingRuleId = null;

function isCompact() { return state.rulesView === 'compact'; }

function renderRulesView() {
  const compact = isCompact();
  $('#view-table').classList.toggle('active', !compact);
  $('#view-table').setAttribute('aria-checked', String(!compact));
  $('#view-compact').classList.toggle('active', compact);
  $('#view-compact').setAttribute('aria-checked', String(compact));
  $('#btn-add-rule').hidden = compact;
  $('#compact-entry').hidden = !compact;
  $('#rules-table').hidden = compact;
  $('#rules-pills').hidden = !compact;
  if (!compact) cancelEdit();
  applyRulesHeight();
}

function setRulesView(view) {
  state.rulesView = view;
  saveState();
  renderRules(); // table edits do not re-render live, so sync both views now
  renderRulesView();
}

function renderPills() {
  const ws = activeWorkspace();
  const box = $('#rules-pills');
  box.innerHTML = '';
  if (!ws) return;
  if (editingRuleId && !ws.rules.some((r) => r.id === editingRuleId)) cancelEdit();
  for (const rule of ws.rules) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.dataset.id = rule.id;
    pill.classList.toggle('invalid', rule.keyword.trim() === '');
    pill.classList.toggle('editing', rule.id === editingRuleId);

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'pill-main';
    main.title = 'Click to edit';
    const status = Replacer.describeRule(rule);
    if (status.warning) { pill.classList.add('warn'); main.title = status.warning + ' Click to edit.'; }
    else if (status.derived) { pill.classList.add('derived'); main.title = 'Matches as: ' + status.matches + '. Click to edit.'; }
    const kw = document.createElement('span');
    kw.className = rule.keyword ? 'pill-kw' : 'pill-empty';
    kw.textContent = rule.keyword || '(empty)';
    const arrow = document.createElement('span');
    arrow.className = 'pill-arrow';
    arrow.textContent = '→';
    const rp = document.createElement('span');
    rp.className = rule.replacement ? 'pill-rp' : 'pill-empty';
    rp.textContent = rule.replacement || '(empty)';
    const hits = document.createElement('span');
    hits.className = 'pill-hits';
    hits.title = 'Matches in the current text';
    hits.textContent = hitsText(rule.id);
    hits.hidden = !hits.textContent;
    main.append(kw, arrow, rp, hits);
    main.addEventListener('click', () => startEdit(rule.id));

    const ci = document.createElement('button');
    ci.type = 'button';
    ci.className = 'pill-opt ci' + (rule.caseInsensitive ? ' on' : '');
    ci.appendChild(svgIcon('format-letter-case'));
    ci.title = 'Case-insensitive: ' + (rule.caseInsensitive ? 'on' : 'off') + ' (click to toggle)';
    ci.addEventListener('click', () => { rule.caseInsensitive = !rule.caseInsensitive; saveState(); renderRules(); liveRun(); });

    const ww = document.createElement('button');
    ww.type = 'button';
    ww.className = 'pill-opt ww' + (rule.wholeWord ? ' on' : '');
    ww.appendChild(svgIcon('format-letter-matches'));
    ww.title = 'Whole word: ' + (rule.wholeWord ? 'on' : 'off') + ' (click to toggle)';
    ww.addEventListener('click', () => { rule.wholeWord = !rule.wholeWord; saveState(); renderRules(); liveRun(); });

    const pt = document.createElement('button');
    pt.type = 'button';
    pt.className = 'pill-opt pt' + (rule.pattern ? ' on' : '');
    pt.appendChild(svgIcon('regex'));
    pt.title = 'Wildcards: ' + (rule.pattern ? 'on' : 'off') + ' (click to toggle)';
    pt.addEventListener('click', () => { setPattern(rule, !rule.pattern); saveState(); renderRules(); liveRun(); });

    const sc = document.createElement('button');
    sc.type = 'button';
    sc.className = 'pill-opt sc' + (rule.seedIncludesText ? ' on' : '');
    sc.appendChild(svgIcon('seed'));
    sc.disabled = !rule.pattern;
    sc.title = rule.pattern
      ? 'Text in seed: ' + (rule.seedIncludesText ? 'on' : 'off') + ' (click to toggle)'
      : 'Text in seed (only for wildcard rules)';
    sc.addEventListener('click', () => { rule.seedIncludesText = !rule.seedIncludesText; saveState(); renderRules(); liveRun(); });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pill-del';
    del.appendChild(svgIcon('close'));
    del.title = 'Remove keyword';
    del.addEventListener('click', () => deleteRule(rule.id));

    // Only active options are shown, so pills stay short. Click one to turn it
    // off; options are turned on in the entry row (click the pill text to edit).
    pill.append(main);
    for (const [opt, on] of [[ci, rule.caseInsensitive], [ww, rule.wholeWord], [pt, rule.pattern], [sc, rule.seedIncludesText]]) {
      if (on) pill.append(opt);
    }
    pill.append(del);
    box.appendChild(pill);
  }
}

function deleteRule(id) {
  const ws = activeWorkspace();
  if (!ws) return;
  ws.rules = ws.rules.filter((r) => r.id !== id);
  if (editingRuleId === id) cancelEdit();
  saveState();
  renderRules();
  renderSidebar();
  applyRulesHeight();
  liveRun();
}

function startEdit(id) {
  const ws = activeWorkspace();
  const rule = ws?.rules.find((r) => r.id === id);
  if (!rule) return;
  editingRuleId = id;
  $('#ce-kw').value = rule.keyword;
  $('#ce-rp').value = rule.replacement;
  $('#ce-ci').checked = rule.caseInsensitive;
  $('#ce-ww').checked = rule.wholeWord;
  $('#ce-pt').checked = rule.pattern;
  $('#ce-sc').checked = rule.seedIncludesText;
  $('#ce-sc').disabled = !rule.pattern;
  $('#ce-add').textContent = 'Save';
  $('#ce-cancel').hidden = false;
  renderPills();
  $('#ce-kw').focus();
  $('#ce-kw').select();
}

function cancelEdit() {
  if (editingRuleId === null && $('#ce-add').textContent === 'Add') return;
  editingRuleId = null;
  $('#ce-kw').value = '';
  $('#ce-rp').value = '';
  $('#ce-add').textContent = 'Add';
  $('#ce-cancel').hidden = true;
  renderPills();
}

// Add a new rule from the entry row, or save the rule being edited.
// The option checkboxes keep their state so several similar entries go fast.
function submitEntry() {
  const ws = activeWorkspace();
  if (!ws) return;
  const keyword = $('#ce-kw').value;
  if (keyword.trim() === '') { toast('Keyword must not be empty.'); $('#ce-kw').focus(); return; }
  const pattern = $('#ce-pt').checked;
  const values = {
    keyword,
    replacement: $('#ce-rp').value,
    caseInsensitive: $('#ce-ci').checked,
    wholeWord: $('#ce-ww').checked,
    pattern,
    seedIncludesText: pattern && $('#ce-sc').checked,
  };
  if (pattern && values.replacement === '') values.replacement = keyword;
  if (editingRuleId) {
    const rule = ws.rules.find((r) => r.id === editingRuleId);
    if (rule) Object.assign(rule, values);
    editingRuleId = null;
    $('#ce-add').textContent = 'Add';
    $('#ce-cancel').hidden = true;
  } else {
    ws.rules.push(normalizeRule(values));
  }
  $('#ce-kw').value = '';
  $('#ce-rp').value = '';
  saveState();
  renderRules();
  renderSidebar();
  applyRulesHeight();
  liveRun();
  $('#ce-kw').focus();
}

function renderAll() {
  renderSidebar();
  renderWorkspace();
}

// ---------- Actions ----------
function selectWorkspace(id) {
  if (id === state.activeWorkspaceId) return;
  stashIo();
  flushPersist();
  commitMappings();
  state.activeWorkspaceId = id;
  saveState();
  renderAll();
}

function addWorkspace() {
  stashIo();
  flushPersist();
  commitMappings();
  const n = visibleWorkspaces().filter((w) => !w.demo).length + 1;
  const ws = normalizeWorkspace({ name: `Workspace ${n}` });
  state.workspaces.push(ws);
  state.activeWorkspaceId = ws.id;
  saveState();
  renderAll();
  $('#ws-name').focus();
  $('#ws-name').select();
}

function deleteWorkspace() {
  const ws = activeWorkspace();
  if (!ws) return;
  if (ws.demo) {
    if (!confirm(`Hide demo workspace "${ws.name}"? It is only hidden in this browser and can be restored from the sidebar.`)) return;
    stashIo();
    flushPersist();
    commitMappings();
    ws.hidden = true;
  } else {
    if (!confirm(`Delete workspace "${ws.name}" and its ${ws.rules.length} keyword(s)? This cannot be undone.`)) return;
    commitMappings();
    state.workspaces = state.workspaces.filter((w) => w.id !== ws.id);
    ioBuffers.delete(ws.id);
  }
  state.activeWorkspaceId = visibleWorkspaces()[0]?.id || null;
  saveState();
  renderAll();
}

function restoreDemos() {
  const hidden = hiddenDemos();
  if (hidden.length === 0) return;
  for (const ws of hidden) ws.hidden = false;
  if (!activeWorkspace()) state.activeWorkspaceId = hidden[0].id;
  saveState();
  renderAll();
  toast(`Restored ${hidden.length} demo workspace${hidden.length === 1 ? '' : 's'}.`);
}

function addRule() {
  const ws = activeWorkspace();
  if (!ws) return;
  if (state.rulesCollapsed) setRulesCollapsed(false);
  ws.rules.push(normalizeRule({}));
  saveState();
  renderRules();
  renderSidebar();
  applyRulesHeight();
  const rows = $('#rules-body').querySelectorAll('tr');
  const last = rows[rows.length - 1];
  last?.scrollIntoView({ block: 'nearest' });
  last?.querySelector('.kw')?.focus();
}

function isAnon() { return state.mode !== 'deanonymize'; }

// Text in the input/output fields is kept per workspace and per mode. By default
// it lives in memory only: switching modes or workspaces restores it, a page
// reload clears it. A workspace with "Keep texts across reload" enabled stores
// its buffers inside the workspace object, so they end up in localStorage too.
const ioBuffers = new Map(); // workspace id -> { anonymize, deanonymize }

function buffersFor(ws) {
  let b = ioBuffers.get(ws.id);
  if (!b) {
    b = ws.persistTexts && ws.texts ? ws.texts : { anonymize: emptyBuf(), deanonymize: emptyBuf() };
    ioBuffers.set(ws.id, b);
  }
  // Keep the stored reference identical to the live buffers while persisting.
  if (ws.persistTexts) ws.texts = b;
  else delete ws.texts;
  return b;
}

function currentBuf() {
  const ws = activeWorkspace();
  if (!ws) return emptyBuf();
  return buffersFor(ws)[isAnon() ? 'anonymize' : 'deanonymize'];
}

let persistTimer = null;
function schedulePersist() {
  const ws = activeWorkspace();
  if (!ws || !ws.persistTexts) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistTimer = null; saveState(); }, 300);
}

function flushPersist() {
  if (persistTimer === null) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  saveState();
}

function stashIo() {
  const ws = activeWorkspace();
  if (!ws) return;
  const buf = currentBuf();
  buf.input = $('#io-in').value;
  buf.output = $('#io-out').value;
  buf.count = $('#io-count').textContent;
}

function restoreIo() {
  const buf = currentBuf();
  $('#io-in').value = buf.input;
  $('#io-out').value = buf.output;
  $('#io-count').textContent = buf.count;
}

function setPersistTexts(on) {
  const ws = activeWorkspace();
  if (!ws) return;
  ws.persistTexts = on;
  stashIo();
  buffersFor(ws); // attaches or detaches ws.texts
  flushPersist();
  saveState();
}

function setMode(mode) {
  if (mode === state.mode) return;
  stashIo();
  flushPersist();
  commitMappings();
  state.mode = mode;
  saveState();
  renderMode();
}

function renderMode() {
  const anon = isAnon();
  $('#mode-anon').classList.toggle('active', anon);
  $('#mode-anon').setAttribute('aria-checked', String(anon));
  $('#mode-deanon').classList.toggle('active', !anon);
  $('#mode-deanon').setAttribute('aria-checked', String(!anon));
  $('#btn-run').textContent = anon ? 'Anonymize →' : 'De-anonymize →';
  $('#label-in').textContent = anon ? 'Original' : 'Anonymized';
  $('#label-out').textContent = anon ? 'Anonymized' : 'Original';
  $('#io-in').placeholder = anon ? 'Paste original text here…' : 'Paste anonymized text here…';
  $('#io-out').placeholder = anon ? 'Anonymized text appears here…' : 'Restored text appears here…';
  restoreIo();
  updateHighlights();
  liveRun();
}

function run() {
  const ws = activeWorkspace();
  if (!ws) return;
  const fn = isAnon() ? Replacer.anonymize : Replacer.deanonymize;
  const res = fn($('#io-in').value, ws.rules, engineOpts(ws));
  $('#io-out').value = res.text;
  $('#io-count').textContent = `${res.count} replacement${res.count === 1 ? '' : 's'}`;
  lastHits = new Map(ws.rules.map((r, i) => [r.id, res.counts[i]]));
  renderHits();
  if (isAnon()) queueMappings(ws, res.mappings);
  stashIo();
  schedulePersist();
  updateHighlights();
  syncScroll($('#io-in'), $('#io-out'));
}

function engineOpts(ws) {
  return { longestFirst: ws.longestFirst, seed: ws.seed, mappings: allMappings(ws) };
}

// ---------- Wildcard mappings ----------
// Every replacement made by a wildcard rule is remembered as { from, to } so the
// original can be restored when de-anonymizing. With live update the text is
// re-run on every keystroke, so new mappings are collected first and only
// written to the workspace once the text has settled (or on an explicit action).
let pendingMappings = new Map(); // to -> from
let pendingWsId = null;
let mappingsTimer = null;

function allMappings(ws) {
  if (pendingWsId !== ws.id || pendingMappings.size === 0) return ws.mappings;
  const extra = [];
  for (const [to, from] of pendingMappings) extra.push({ from, to });
  return ws.mappings.concat(extra);
}

function queueMappings(ws, found) {
  if (pendingWsId !== ws.id) { commitMappings(); pendingWsId = ws.id; }
  const known = new Set(ws.mappings.map((m) => m.to));
  let changed = false;
  for (const m of found) {
    if (m.from === m.to || known.has(m.to) || pendingMappings.has(m.to)) continue;
    pendingMappings.set(m.to, m.from);
    changed = true;
  }
  if (!changed && mappingsTimer === null) return;
  clearTimeout(mappingsTimer);
  mappingsTimer = setTimeout(commitMappings, 1500);
}

function commitMappings() {
  clearTimeout(mappingsTimer);
  mappingsTimer = null;
  const ws = state.workspaces.find((w) => w.id === pendingWsId);
  const pending = pendingMappings;
  pendingMappings = new Map();
  pendingWsId = null;
  if (!ws || pending.size === 0) return;
  const known = new Set(ws.mappings.map((m) => m.to));
  for (const [to, from] of pending) {
    if (known.has(to)) continue; // first mapping for an anonymized value wins
    ws.mappings.push({ from, to });
    known.add(to);
  }
  saveState();
  if (ws === activeWorkspace()) renderMappings();
}

function renderMappingsVisibility() {
  const ws = activeWorkspace();
  $('#mappings').hidden = !ws || (!hasPatternRules(ws) && ws.mappings.length === 0);
}

function renderMappings() {
  const ws = activeWorkspace();
  if (!ws) return;
  renderMappingsVisibility();
  $('#ws-seed').value = ws.seed;
  $('#mappings-count').textContent = `(${ws.mappings.length})`;
  $('#mappings-empty').hidden = ws.mappings.length > 0;
  $('#mappings-scroll').hidden = ws.mappings.length === 0;
  $('#btn-clear-mappings').disabled = ws.mappings.length === 0;
  const tbody = $('#mappings-body');
  tbody.innerHTML = '';
  for (const m of ws.mappings) {
    const tr = document.createElement('tr');
    const from = document.createElement('td');
    from.className = 'map-from';
    from.textContent = m.from;
    const to = document.createElement('td');
    to.className = 'map-to';
    to.textContent = m.to;
    const del = document.createElement('td');
    del.className = 'col-del';
    const btn = document.createElement('button');
    btn.className = 'btn btn-icon';
    btn.title = 'Forget this mapping';
    btn.appendChild(svgIcon('close'));
    btn.addEventListener('click', () => {
      ws.mappings = ws.mappings.filter((x) => x !== m);
      saveState();
      renderMappings();
      liveRun();
    });
    del.appendChild(btn);
    tr.append(from, to, del);
    tbody.appendChild(tr);
  }
}

function renderMappingsCollapsed() {
  const collapsed = state.mappingsCollapsed;
  $('#mappings').classList.toggle('collapsed', collapsed);
  $('#mappings-content').hidden = collapsed;
  $('#btn-toggle-mappings').setAttribute('aria-expanded', String(!collapsed));
}

function setMappingsCollapsed(collapsed) {
  state.mappingsCollapsed = collapsed;
  saveState();
  renderMappingsCollapsed();
}

function setSeed(seed) {
  const ws = activeWorkspace();
  if (!ws) return;
  ws.seed = seed;
  $('#ws-seed').value = seed;
  saveState();
  liveRun();
}

function newSeed() {
  const ws = activeWorkspace();
  if (!ws) return;
  if (!confirm('Generate a new seed? Wildcard values will differ from now on. Recorded mappings are kept, so earlier texts can still be de-anonymized.')) return;
  setSeed(Replacer.randomSeed());
  toast('New seed generated.');
}

function clearMappings() {
  const ws = activeWorkspace();
  if (!ws || ws.mappings.length === 0) return;
  if (!confirm(`Forget all ${ws.mappings.length} mapping(s) of "${ws.name}"? Texts anonymized with them can no longer be restored.`)) return;
  commitMappings();
  ws.mappings = [];
  saveState();
  renderMappings();
  liveRun();
}

// ---------- Selection popup: turn a selection in the original text into a keyword ----------
// A textarea gives no coordinates for its selection, so the text up to the
// selection end is mirrored into a hidden element with the same metrics and a
// marker span is measured there.
const selPopup = {
  el: null,
  text: '',
  template: null, // wildcard template suggested for the selection, if any
  pattern: false, // whether the rule will be added as a wildcard rule
  hide() { if (this.el && !this.el.hidden) this.el.hidden = true; },
};

// Reflect the wildcard toggle: replacement field shows the template or a literal name.
function renderSelPopupMode() {
  const ws = activeWorkspace();
  const btn = $('#sel-popup-pt');
  btn.classList.toggle('on', selPopup.pattern);
  btn.hidden = !selPopup.template;
  btn.title = selPopup.pattern
    ? 'Wildcard rule: matches every value of this shape (' + selPopup.template + '). Click for a plain keyword.'
    : 'Plain keyword: matches exactly this text. Click for a wildcard rule (' + selPopup.template + ').';
  $('#sel-popup-rp').value = selPopup.pattern ? selPopup.template : nextAutoReplacement(ws);
}

function selectionCoords(ta, index) {
  const m = $('#io-measure');
  m.style.width = ta.clientWidth + 'px';
  const text = ta.value;
  m.innerHTML = escapeHtml(text.slice(0, index)) + '<span class="io-measure-marker">\u200b</span>' + escapeHtml(text.slice(index)) + '\n';
  const marker = m.querySelector('.io-measure-marker');
  return { left: marker.offsetLeft, top: marker.offsetTop - ta.scrollTop, height: marker.offsetHeight || 18 };
}

function nextAutoReplacement(ws) {
  let n = 0;
  for (const r of ws.rules) {
    const mm = /^ANON_(\d+)$/.exec(r.replacement);
    if (mm) n = Math.max(n, Number(mm[1]));
  }
  return 'ANON_' + (n + 1);
}

function showSelPopup() {
  const ta = $('#io-in');
  const ws = activeWorkspace();
  if (!ws || !isAnon() || document.activeElement !== ta) { selPopup.hide(); return; }
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const raw = ta.value.slice(start, end);
  const text = raw.trim();
  if (!text || text.includes('\n') || text.length > 200) { selPopup.hide(); return; }
  const pop = $('#sel-popup');
  selPopup.el = pop;
  if (pop.hidden || selPopup.text !== text) {
    selPopup.text = text;
    $('#sel-popup-kw').textContent = text;
    // Numbers, ids, IPs, e-mails etc. get a wildcard suggestion; words stay literal.
    selPopup.template = Replacer.suggestTemplate(text);
    selPopup.pattern = !!selPopup.template;
    renderSelPopupMode();
  }
  // Place it under the end of the selection, kept inside the field.
  const c = selectionCoords(ta, end);
  pop.hidden = false;
  const field = ta.parentElement;
  const maxLeft = Math.max(0, field.clientWidth - pop.offsetWidth - 4);
  let top = c.top + c.height + 6;
  if (top + pop.offsetHeight > ta.clientHeight) top = Math.max(0, c.top - pop.offsetHeight - 6);
  pop.style.left = Math.min(Math.max(0, c.left), maxLeft) + 'px';
  pop.style.top = top + 'px';
}

function addSelectedKeyword() {
  const ws = activeWorkspace();
  const keyword = selPopup.text;
  if (!ws || !keyword) return;
  const replacement = $('#sel-popup-rp').value;
  const pattern = selPopup.pattern && !!selPopup.template;
  const duplicate = ws.rules.find((r) => r.keyword === keyword && (!pattern || (r.pattern && r.replacement === replacement)))
    || (pattern && ws.rules.find((r) => r.pattern && Replacer.describeRule(r).matches === Replacer.describeRule({ keyword, replacement, pattern }).matches));
  if (duplicate) {
    toast(pattern ? `A wildcard rule for this shape already exists.` : `"${keyword}" is already a keyword.`);
    selPopup.hide();
    return;
  }
  ws.rules.push(normalizeRule({ keyword, replacement, pattern }));
  selPopup.hide();
  saveState();
  renderRules();
  renderSidebar();
  applyRulesHeight();
  liveRun();
  toast(pattern ? `Wildcard rule added: matches ${Replacer.describeRule({ keyword, replacement, pattern }).matches}` : `Keyword "${keyword}" added.`);
  $('#io-in').focus();
}

// Live update: recompute the result after every change to text or keywords.
function liveRun() {
  if (state.liveUpdate && activeWorkspace()) run();
}

function renderLive() {
  $('#live-update').checked = state.liveUpdate;
  $('#btn-run').hidden = state.liveUpdate;
}

function setLiveUpdate(on) {
  state.liveUpdate = on;
  saveState();
  renderLive();
  liveRun();
}

function clearIo() {
  $('#io-in').value = '';
  $('#io-out').value = '';
  $('#io-count').textContent = '';
  stashIo();
  schedulePersist();
  updateHighlights();
}

// Keep the two textareas scrolled to the same relative position and at the same height.
function syncScroll(src, dst) {
  const max = src.scrollHeight - src.clientHeight;
  const ratio = max > 0 ? src.scrollTop / max : 0;
  const target = Math.round(ratio * (dst.scrollHeight - dst.clientHeight));
  if (Math.abs(dst.scrollTop - target) > 1) dst.scrollTop = target;
}

function setupSync(a, b) {
  let lock = false;
  const onScroll = (src, dst) => () => {
    if (lock) return;
    lock = true;
    syncScroll(src, dst);
    requestAnimationFrame(() => { lock = false; });
  };
  a.addEventListener('scroll', onScroll(a, b));
  b.addEventListener('scroll', onScroll(b, a));
  for (const ta of [a, b]) {
    ta.addEventListener('scroll', () => {
      const bd = backdropOf(ta);
      bd.scrollTop = ta.scrollTop;
      bd.scrollLeft = ta.scrollLeft;
    });
  }

  // ResizeObserver fires for window-driven layout too; only intervene when the
  // two heights actually diverge, i.e. after a manual drag on one resize handle.
  const ro = new ResizeObserver(() => {
    sizeBackdrop(a);
    sizeBackdrop(b);
    const ha = a.offsetHeight;
    const hb = b.offsetHeight;
    if (Math.abs(ha - hb) <= 1) return;
    const h = document.activeElement === b || b.matches(':hover') ? hb : ha;
    a.style.height = h + 'px';
    b.style.height = h + 'px';
  });
  ro.observe(a);
  ro.observe(b);
}

// ---------- Export: pick workspaces ----------
function openExportDialog() {
  const list = $('#export-list');
  list.innerHTML = '';
  for (const ws of visibleWorkspaces()) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = ws.id;
    cb.checked = ws.id === state.activeWorkspaceId;
    cb.addEventListener('change', updateExportAll);
    const name = document.createElement('span');
    name.textContent = ws.name || 'Untitled';
    label.append(cb, name);
    if (ws.demo) {
      const badge = document.createElement('span');
      badge.className = 'demo-badge';
      badge.textContent = 'demo';
      label.appendChild(badge);
    }
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${ws.rules.length} keyword${ws.rules.length === 1 ? '' : 's'}`;
    label.appendChild(count);
    li.appendChild(label);
    list.appendChild(li);
  }
  updateExportAll();
  openDialog('#export-dialog');
}

function exportChecked() {
  return Array.from($('#export-list').querySelectorAll('input[type="checkbox"]'));
}

function updateExportAll() {
  const boxes = exportChecked();
  const on = boxes.filter((b) => b.checked).length;
  const all = $('#export-all');
  all.checked = on > 0 && on === boxes.length;
  all.indeterminate = on > 0 && on < boxes.length;
  $('#export-confirm').disabled = on === 0;
  $('#export-confirm').textContent = on === 0 ? 'Export selected' : `Export ${on} workspace${on === 1 ? '' : 's'}`;
}

function exportJson() {
  const ids = new Set(exportChecked().filter((b) => b.checked).map((b) => b.value));
  const selected = visibleWorkspaces().filter((w) => ids.has(w.id));
  if (selected.length === 0) { toast('Select at least one workspace.'); return; }
  const blob = new Blob([JSON.stringify({ version: Migrations.SCHEMA_VERSION, workspaces: selected }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const base = selected.length === 1 ? (selected[0].name || 'workspace').replace(/[^\w.-]+/g, '_').slice(0, 40) : 'workspaces';
  a.href = url;
  a.download = `${base}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  $('#export-dialog').close();
  toast(`Exported ${selected.length} workspace${selected.length === 1 ? '' : 's'}.`);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch {
      toast('Import failed: file is not valid JSON.');
      return;
    }
    if (!Array.isArray(parsed) && !Array.isArray(parsed?.workspaces)) {
      toast('Import failed: no "workspaces" array found.');
      return;
    }
    const migrated = Migrations.migrate(parsed);
    for (const w of migrated.warnings) toast(w);
    // Imported copies of demo workspaces become ordinary workspaces.
    const incoming = migrated.data.workspaces.map((raw) => normalizeWorkspace(Object.assign({}, raw, { demo: false, hidden: false, help: undefined })));
    if (incoming.length === 0) { toast('The file contains no workspaces.'); return; }
    openImportDialog(incoming);
  };
  reader.onerror = () => toast('Import failed: could not read file.');
  reader.readAsText(file);
}

// ---------- Import: resolve conflicts ----------
// An incoming workspace "exists" when a stored workspace (hidden demos included)
// has the same id or the same name.
function findExisting(ws) {
  const name = (ws.name || '').trim();
  return state.workspaces.find((w) => w.id === ws.id) || state.workspaces.find((w) => (w.name || '').trim() === name) || null;
}

function uniqueName(base) {
  const names = new Set(state.workspaces.map((w) => (w.name || '').trim()));
  const clean = (base || 'Untitled').replace(/ \((\d+)\)$/, '');
  if (!names.has(clean)) return clean;
  let n = 2;
  while (names.has(`${clean} (${n})`)) n++;
  return `${clean} (${n})`;
}

let pendingImport = [];

function openImportDialog(incoming) {
  pendingImport = incoming;
  const tbody = $('#import-list');
  tbody.innerHTML = '';
  let conflicts = 0;
  incoming.forEach((ws, i) => {
    const existing = findExisting(ws);
    const tr = document.createElement('tr');
    tr.dataset.index = String(i);
    const name = document.createElement('td');
    name.textContent = ws.name || 'Untitled';
    const count = document.createElement('td');
    count.textContent = String(ws.rules.length);
    const status = document.createElement('td');
    const action = document.createElement('td');
    if (existing) {
      conflicts++;
      status.className = 'status-exists';
      status.textContent = existing.id === ws.id ? 'exists (same id)' : 'exists (same name)';
      const sel = document.createElement('select');
      sel.className = 'import-action';
      for (const [value, label] of [['skip', 'Skip'], ['replace', 'Replace existing'], ['variant', 'Import as variant']]) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        sel.appendChild(o);
      }
      action.appendChild(sel);
    } else {
      status.className = 'status-new';
      status.textContent = 'new';
      action.textContent = 'Add';
      tr.dataset.action = 'add';
    }
    tr.append(name, count, status, action);
    tbody.appendChild(tr);
  });
  $('#import-conflicts-hint').hidden = conflicts === 0;
  openDialog('#import-dialog');
}

function applyImport() {
  const rows = Array.from($('#import-list').querySelectorAll('tr'));
  const summary = { added: 0, replaced: 0, variants: 0, skipped: 0 };
  let firstId = null;
  for (const tr of rows) {
    const ws = pendingImport[Number(tr.dataset.index)];
    const action = tr.dataset.action || tr.querySelector('.import-action').value;
    ws.rules.forEach((r) => { r.id = uid(); });
    if (action === 'skip') { summary.skipped++; continue; }
    if (action === 'replace') {
      const existing = findExisting(ws);
      // Keep id, position and demo flag; everything else comes from the file.
      Object.assign(existing, {
        name: ws.name, longestFirst: ws.longestFirst, persistTexts: ws.persistTexts,
        rules: ws.rules, seed: ws.seed, mappings: ws.mappings, hidden: false,
      });
      if (ws.texts) existing.texts = ws.texts; else delete existing.texts;
      ioBuffers.delete(existing.id);
      firstId = firstId || existing.id;
      summary.replaced++;
      continue;
    }
    if (action === 'variant') {
      ws.id = uid();
      ws.name = uniqueName(ws.name);
      summary.variants++;
    } else {
      if (state.workspaces.some((w) => w.id === ws.id)) ws.id = uid();
      summary.added++;
    }
    state.workspaces.push(ws);
    firstId = firstId || ws.id;
  }
  pendingImport = [];
  $('#import-dialog').close();
  if (firstId) state.activeWorkspaceId = firstId;
  else if (!activeWorkspace()) state.activeWorkspaceId = visibleWorkspaces()[0]?.id || null;
  saveState();
  renderAll();
  const parts = [];
  if (summary.added) parts.push(`${summary.added} added`);
  if (summary.replaced) parts.push(`${summary.replaced} replaced`);
  if (summary.variants) parts.push(`${summary.variants} imported as variant`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped`);
  toast('Import: ' + (parts.join(', ') || 'nothing to do') + '.');
}

function resetAll() {
  if (!confirm('Delete ALL workspaces and keywords stored in this browser? This cannot be undone.')) return;
  state = defaultState();
  ioBuffers.clear();
  clearTimeout(persistTimer);
  persistTimer = null;
  clearTimeout(mappingsTimer);
  mappingsTimer = null;
  pendingMappings = new Map();
  pendingWsId = null;
  lastHits = new Map();
  localStorage.removeItem(STORAGE_KEY);
  renderAll();
  toast('All data cleared.');
}

// ---------- Wire up ----------
$('#btn-add-workspace').addEventListener('click', addWorkspace);
$('#btn-delete-workspace').addEventListener('click', deleteWorkspace);
$('#btn-restore-demos').addEventListener('click', restoreDemos);
$('#btn-add-rule').addEventListener('click', addRule);
$('#btn-toggle-rules').addEventListener('click', () => setRulesCollapsed(!state.rulesCollapsed));
$('#btn-toggle-mappings').addEventListener('click', () => setMappingsCollapsed(!state.mappingsCollapsed));

// ---------- Help / Privacy dialogs ----------
function openDialog(sel) {
  const dlg = $(sel);
  if (dlg.open) return;
  dlg.showModal();
  dlg.querySelector('.help-body').scrollTop = 0;
}
$('#btn-help').addEventListener('click', () => openDialog('#help-dialog'));
$('#btn-privacy').addEventListener('click', () => openDialog('#privacy-dialog'));
for (const dlg of document.querySelectorAll('dialog.help')) {
  for (const b of dlg.querySelectorAll('.dialog-close')) b.addEventListener('click', () => dlg.close());
  // A click on the backdrop (outside the dialog box) closes it, like Esc does.
  dlg.addEventListener('click', (e) => { if (e.target === e.currentTarget) dlg.close(); });
}
$('#btn-new-seed').addEventListener('click', newSeed);
$('#btn-clear-mappings').addEventListener('click', clearMappings);
$('#ws-seed').addEventListener('change', (e) => {
  const v = e.target.value.trim();
  if (!v) { toast('Seed must not be empty; kept the old one.'); e.target.value = activeWorkspace()?.seed || ''; return; }
  setSeed(v);
});
$('#ws-seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#ce-pt').addEventListener('change', (e) => {
  $('#ce-sc').disabled = !e.target.checked;
  if (!e.target.checked) $('#ce-sc').checked = false;
  if (e.target.checked && $('#ce-rp').value === '') $('#ce-rp').value = $('#ce-kw').value;
});
$('#btn-rules-height-reset').addEventListener('click', () => setRulesHeight(null));
$('#view-table').addEventListener('click', () => setRulesView('table'));
$('#view-compact').addEventListener('click', () => setRulesView('compact'));
$('#ce-add').addEventListener('click', submitEntry);
$('#ce-cancel').addEventListener('click', cancelEdit);
for (const id of ['#ce-kw', '#ce-rp']) {
  $(id).addEventListener('keydown', overwriteKeydown);
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitEntry(); }
    if (e.key === 'Escape' && editingRuleId) { e.preventDefault(); cancelEdit(); }
  });
}

$('#ws-name').addEventListener('input', (e) => {
  const ws = activeWorkspace();
  if (!ws) return;
  ws.name = e.target.value;
  saveState();
  renderSidebar();
});
$('#ws-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#ws-longest-first').addEventListener('change', (e) => {
  const ws = activeWorkspace();
  if (!ws) return;
  ws.longestFirst = e.target.checked;
  saveState();
  liveRun();
});

$('#mode-anon').addEventListener('click', () => setMode('anonymize'));
$('#mode-deanon').addEventListener('click', () => setMode('deanonymize'));
$('#btn-run').addEventListener('click', () => { run(); commitMappings(); });
$('#btn-copy').addEventListener('click', () => { commitMappings(); copyText($('#io-out').value); });
$('#btn-clear').addEventListener('click', clearIo);

$('#btn-export').addEventListener('click', openExportDialog);
$('#export-confirm').addEventListener('click', exportJson);
$('#export-all').addEventListener('change', (e) => { for (const b of exportChecked()) b.checked = e.target.checked; updateExportAll(); });
$('#import-confirm').addEventListener('click', applyImport);
for (const b of document.querySelectorAll('.import-set-all')) {
  b.addEventListener('click', () => { for (const s of $('#import-list').querySelectorAll('.import-action')) s.value = b.dataset.action; });
}
$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) importJson(file);
  e.target.value = '';
});
$('#btn-reset').addEventListener('click', resetAll);

// Ctrl/Cmd+Enter inside the input runs the current mode.
$('#io-in').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { run(); commitMappings(); } });
$('#io-in').addEventListener('input', () => {
  if (state.liveUpdate) { run(); return; }
  stashIo();
  schedulePersist();
  updateHighlights();
});
$('#live-update').addEventListener('change', (e) => setLiveUpdate(e.target.checked));

// Selection popup wiring
{
  const ta = $('#io-in');
  const pop = $('#sel-popup');
  ta.addEventListener('mouseup', () => setTimeout(showSelPopup, 0));
  ta.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') showSelPopup(); });
  ta.addEventListener('select', () => setTimeout(showSelPopup, 0));
  ta.addEventListener('input', () => selPopup.hide());
  ta.addEventListener('scroll', () => { if (!pop.hidden) showSelPopup(); });
  document.addEventListener('mousedown', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== ta) selPopup.hide();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { selPopup.hide(); ta.focus(); } });
  $('#sel-popup-add').addEventListener('click', addSelectedKeyword);
  $('#sel-popup-pt').addEventListener('click', () => { selPopup.pattern = !selPopup.pattern; renderSelPopupMode(); $('#sel-popup-rp').focus(); });
  $('#sel-popup-close').addEventListener('click', () => { selPopup.hide(); ta.focus(); });
  $('#sel-popup-rp').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSelectedKeyword(); } });
  $('#sel-popup-rp').addEventListener('keydown', overwriteKeydown);
}
$('#ws-persist-texts').addEventListener('change', (e) => setPersistTexts(e.target.checked));
window.addEventListener('pagehide', () => { flushPersist(); commitMappings(); });

setupSync($('#io-in'), $('#io-out'));
renderLive();
renderMode();
renderAll();
if (loadWarnings.length) toast(loadWarnings.join(' '));
// Migrated (or newer) data is written back in the current format right away.
if (loadedFromVersion !== Migrations.SCHEMA_VERSION && state.workspaces.length) saveState();
