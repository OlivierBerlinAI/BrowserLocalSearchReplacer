'use strict';
/* global Replacer */

// ---------- Persistence (localStorage only) ----------
const STORAGE_KEY = 'blsr.state.v1';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultState() {
  return { version: 1, activeWorkspaceId: null, workspaces: [], mode: 'anonymize', rulesCollapsed: false, liveUpdate: true, rulesHeight: null };
}

function normalizeRule(r) {
  return {
    id: typeof r?.id === 'string' ? r.id : uid(),
    keyword: typeof r?.keyword === 'string' ? r.keyword : '',
    replacement: typeof r?.replacement === 'string' ? r.replacement : '',
    caseInsensitive: !!r?.caseInsensitive,
    wholeWord: !!r?.wholeWord,
  };
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
  };
  // Texts are only kept in storage when the workspace opts in.
  if (ws.persistTexts && w?.texts) ws.texts = normalizeTexts(w.texts);
  return ws;
}

function normalizeState(raw) {
  const s = defaultState();
  if (raw && Array.isArray(raw.workspaces)) {
    s.workspaces = raw.workspaces.map(normalizeWorkspace);
  }
  if (raw?.mode === 'deanonymize') s.mode = 'deanonymize';
  s.rulesCollapsed = raw?.rulesCollapsed === true;
  s.liveUpdate = raw?.liveUpdate !== false;
  s.rulesHeight = Number.isFinite(raw?.rulesHeight) && raw.rulesHeight > 0 ? raw.rulesHeight : null;
  if (typeof raw?.activeWorkspaceId === 'string' && s.workspaces.some((w) => w.id === raw.activeWorkspaceId)) {
    s.activeWorkspaceId = raw.activeWorkspaceId;
  } else if (s.workspaces.length) {
    s.activeWorkspaceId = s.workspaces[0].id;
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

function activeWorkspace() {
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId) || null;
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
  const opts = { longestFirst: ws ? ws.longestFirst : false };
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
  for (const ws of state.workspaces) {
    const li = document.createElement('li');
    li.dataset.id = ws.id;
    li.textContent = ws.name || 'Untitled';
    if (ws.id === state.activeWorkspaceId) li.classList.add('active');
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `(${ws.rules.length})`;
    li.appendChild(count);
    li.addEventListener('click', () => selectWorkspace(ws.id));
    ul.appendChild(li);
  }
}

function renderWorkspace() {
  const ws = activeWorkspace();
  $('#empty-state').hidden = !!ws;
  $('#workspace-view').hidden = !ws;
  if (!ws) return;

  $('#ws-name').value = ws.name;
  $('#ws-longest-first').checked = ws.longestFirst;
  $('#ws-persist-texts').checked = ws.persistTexts;
  renderRules();
  renderRulesCollapsed();
  applyRulesHeight();
  restoreIo();
  updateHighlights();
  liveRun();
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
  const row = box.querySelector('tbody tr');
  const head = box.querySelector('thead');
  if (!row || row.offsetHeight === 0) { box.style.maxHeight = ''; return; }
  const border = box.offsetHeight - box.clientHeight;
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
      <td class="col-del"><button class="btn btn-icon del" title="Remove keyword">✕</button></td>
    `;
    const kw = tr.querySelector('.kw');
    const rp = tr.querySelector('.rp');
    const ci = tr.querySelector('.ci');
    const ww = tr.querySelector('.ww');
    kw.value = rule.keyword;
    rp.value = rule.replacement;
    ci.checked = rule.caseInsensitive;
    ww.checked = rule.wholeWord;
    tr.classList.toggle('invalid', rule.keyword.trim() === '');

    kw.addEventListener('keydown', overwriteKeydown);
    rp.addEventListener('keydown', overwriteKeydown);
    kw.addEventListener('input', () => { rule.keyword = kw.value; tr.classList.toggle('invalid', kw.value.trim() === ''); saveState(); liveRun(); });
    rp.addEventListener('input', () => { rule.replacement = rp.value; saveState(); liveRun(); });
    ci.addEventListener('change', () => { rule.caseInsensitive = ci.checked; saveState(); liveRun(); });
    ww.addEventListener('change', () => { rule.wholeWord = ww.checked; saveState(); liveRun(); });
    tr.querySelector('.del').addEventListener('click', () => {
      ws.rules = ws.rules.filter((r) => r.id !== rule.id);
      saveState();
      renderRules();
      renderSidebar();
      liveRun();
    });
    // Enter in the replacement field adds a new row for quick data entry.
    rp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addRule(); }
    });
    tbody.appendChild(tr);
  }
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
  state.activeWorkspaceId = id;
  saveState();
  renderAll();
}

function addWorkspace() {
  stashIo();
  flushPersist();
  const n = state.workspaces.length + 1;
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
  if (!confirm(`Delete workspace "${ws.name}" and its ${ws.rules.length} keyword(s)? This cannot be undone.`)) return;
  state.workspaces = state.workspaces.filter((w) => w.id !== ws.id);
  ioBuffers.delete(ws.id);
  state.activeWorkspaceId = state.workspaces[0]?.id || null;
  saveState();
  renderAll();
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
  const res = fn($('#io-in').value, ws.rules, { longestFirst: ws.longestFirst });
  $('#io-out').value = res.text;
  $('#io-count').textContent = `${res.count} replacement${res.count === 1 ? '' : 's'}`;
  stashIo();
  schedulePersist();
  updateHighlights();
  syncScroll($('#io-in'), $('#io-out'));
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

function exportJson() {
  const blob = new Blob([JSON.stringify({ version: 1, workspaces: state.workspaces }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `workspaces-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
    const incoming = Array.isArray(parsed) ? parsed : parsed?.workspaces;
    if (!Array.isArray(incoming)) {
      toast('Import failed: no "workspaces" array found.');
      return;
    }
    const existingIds = new Set(state.workspaces.map((w) => w.id));
    let added = 0;
    for (const raw of incoming) {
      const ws = normalizeWorkspace(raw);
      if (existingIds.has(ws.id)) ws.id = uid(); // never overwrite existing workspaces
      ws.rules.forEach((r) => { r.id = uid(); });
      state.workspaces.push(ws);
      added++;
    }
    if (added && !activeWorkspace()) state.activeWorkspaceId = state.workspaces[0].id;
    saveState();
    renderAll();
    toast(`Imported ${added} workspace${added === 1 ? '' : 's'}.`);
  };
  reader.onerror = () => toast('Import failed: could not read file.');
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('Delete ALL workspaces and keywords stored in this browser? This cannot be undone.')) return;
  state = defaultState();
  ioBuffers.clear();
  clearTimeout(persistTimer);
  persistTimer = null;
  localStorage.removeItem(STORAGE_KEY);
  renderAll();
  toast('All data cleared.');
}

// ---------- Wire up ----------
$('#btn-add-workspace').addEventListener('click', addWorkspace);
$('#btn-delete-workspace').addEventListener('click', deleteWorkspace);
$('#btn-add-rule').addEventListener('click', addRule);
$('#btn-toggle-rules').addEventListener('click', () => setRulesCollapsed(!state.rulesCollapsed));
$('#btn-rules-height-reset').addEventListener('click', () => setRulesHeight(null));

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
$('#btn-run').addEventListener('click', run);
$('#btn-copy').addEventListener('click', () => copyText($('#io-out').value));
$('#btn-clear').addEventListener('click', clearIo);

$('#btn-export').addEventListener('click', exportJson);
$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) importJson(file);
  e.target.value = '';
});
$('#btn-reset').addEventListener('click', resetAll);

// Ctrl/Cmd+Enter inside the input runs the current mode.
$('#io-in').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') run(); });
$('#io-in').addEventListener('input', () => {
  if (state.liveUpdate) { run(); return; }
  stashIo();
  schedulePersist();
  updateHighlights();
});
$('#live-update').addEventListener('change', (e) => setLiveUpdate(e.target.checked));
$('#ws-persist-texts').addEventListener('change', (e) => setPersistTexts(e.target.checked));
window.addEventListener('pagehide', flushPersist);

setupSync($('#io-in'), $('#io-out'));
renderLive();
renderMode();
renderAll();
