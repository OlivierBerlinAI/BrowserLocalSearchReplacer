'use strict';
// Minimal harness for the browser tests: starts the static server on a free
// port, launches headless Chromium via Playwright and runs the registered tests
// one after another in fresh pages. No test framework, same style as the unit
// tests (`node test/ui/run.js`).
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.includes('Local:')) resolve(); });
    child.on('exit', (code) => reject(new Error('server exited with ' + code)));
    setTimeout(() => reject(new Error('server did not start')), 5000);
  });
  return { url: `http://127.0.0.1:${port}/`, stop: () => child.kill() };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Opens a fresh page with a clean localStorage. `page.errors` collects page
// errors and console errors; `page.requests` every request URL.
async function newPage(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.errors = [];
  page.requests = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  page.on('request', (r) => page.requests.push(r.url()));
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(200);
  page.closeAll = () => context.close();
  return page;
}

// Select `needle` inside the Original textarea by keyboard so the selection
// popup logic (which listens to keyup/select) runs like for a real user.
async function selectInInput(page, needle) {
  const text = await page.inputValue('#io-in');
  const i = text.indexOf(needle);
  if (i < 0) throw new Error('needle not in input: ' + needle);
  await page.evaluate(([s, n]) => { const t = document.getElementById('io-in'); t.focus(); t.setSelectionRange(s, s + n); }, [i, needle.length]);
  // A no-op shift+arrow pair fires keyup with shift held, which shows the popup.
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
}

// Click into the Original textarea at the first character of `needle` (a
// caret, no selection); a click on a highlighted match opens the edit popup.
async function clickInInput(page, needle) {
  const text = await page.inputValue('#io-in');
  const i = text.indexOf(needle);
  if (i < 0) throw new Error('needle not in input: ' + needle);
  await page.evaluate((s) => {
    const t = document.getElementById('io-in');
    t.focus();
    t.setSelectionRange(s + 1, s + 1);
    t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, i);
  await page.waitForTimeout(100);
}

async function run() {
  const launchOpts = { headless: true };
  if (process.env.BLSR_BROWSER_PATH) launchOpts.executablePath = process.env.BLSR_BROWSER_PATH;
  const server = await startServer();
  const browser = await chromium.launch(launchOpts);
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    const page = await newPage(browser, server.url);
    try {
      await fn(page, server.url);
      if (page.errors.length && !fn.allowErrors) throw new Error('page errors: ' + page.errors.join(' | '));
      passed++;
      console.log('ok -', name);
    } catch (e) {
      failed++;
      console.log('not ok -', name);
      console.log('   ', String(e.stack || e).split('\n').slice(0, 14).join('\n    '));
    } finally {
      await page.closeAll();
    }
  }
  await browser.close();
  server.stop();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

module.exports = { test, run, selectInInput, clickInInput };
