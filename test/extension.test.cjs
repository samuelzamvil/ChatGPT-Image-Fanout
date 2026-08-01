// End-to-end checks against the built Chrome extension.
//
// These exist because Chrome and Firefox disagree on extension APIs in ways that
// are invisible until you run them — most notably runtime.onMessage, where a
// returned Promise works in Firefox and silently fails in Chrome. Run after a
// build: `npm run build && npm test`.
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXT = path.join(__dirname, '..', 'dist', 'chrome');
let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    // Set CHROMIUM_PATH to use a preinstalled binary instead of Playwright's own.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox', '--headless=new'],
  });

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;

  const openPopup = async (detached) => {
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e.message)));
    await p.goto(`chrome-extension://${extId}/popup.html${detached ? '?detached=1' : ''}`);
    await p.waitForFunction(() => document.querySelectorAll('#variances textarea').length > 0);
    return { page: p, errs };
  };

  // Form tests run against the detached page, which is designed to stay open.
  const { page, errs } = await openPopup(true);
  check('popup loads with no page errors', errs.length === 0, errs.join('; '));

  // --- 1. The Chrome messaging bug (the headline regression) ---
  const msg = await page.evaluate(async () => {
    const api = globalThis.browser ?? globalThis.chrome;
    try {
      const r = await api.runtime.sendMessage({
        type: 'launch-fanout', prompts: ['a', 'b'], mode: 'tabs',
        screenBounds: { left: 0, top: 0, width: 1440, height: 900 },
      });
      return { threw: false, response: r };
    } catch (e) { return { threw: true, error: String(e.message || e) }; }
  });
  check('launch-fanout returns {ok:true} on Chrome', msg.response?.ok === true, JSON.stringify(msg));

  // --- 2. a11y ---
  const labels = await page.$$eval('#variances textarea', (els) => els.map((e) => e.getAttribute('aria-label')));
  check('all variance textareas have aria-label', labels.length === 4 && labels.every(Boolean), JSON.stringify(labels));

  // --- 3. Incremental render preserves DOM nodes (undo history / focus) ---
  const preserved = await page.evaluate(async () => {
    const first = document.querySelector('#variances textarea');
    first.value = 'sentinel';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    first[Symbol.for('probe')] = true;
    const c = document.querySelector('#count');
    c.value = '7'; c.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 50));
    const after = document.querySelector('#variances textarea');
    return { sameNode: after[Symbol.for('probe')] === true, value: after.value, rows: document.querySelectorAll('#variances textarea').length };
  });
  check('count change reuses existing textarea nodes', preserved.sameNode, JSON.stringify(preserved));
  check('count change grows the list to 7', preserved.rows === 7);

  // --- 4. Blank-variance guard ---
  const guard = await page.evaluate(async () => {
    const c = document.querySelector('#count');
    c.value = '2'; c.dispatchEvent(new Event('change'));
    const bp = document.querySelector('#basePrompt');
    bp.value = 'a cat'; bp.dispatchEvent(new Event('input', { bubbles: true }));
    const areas = document.querySelectorAll('#variances textarea');
    areas[0].value = 'only this one'; areas[0].dispatchEvent(new Event('input', { bubbles: true }));
    areas[1].value = ''; areas[1].dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));

    document.querySelector('#launch').click();
    await new Promise((r) => setTimeout(r, 150));
    const firstClick = document.querySelector('#status').textContent;
    const marked = document.querySelectorAll('#variances textarea.blank').length;

    document.querySelector('#launch').click();
    await new Promise((r) => setTimeout(r, 1200));
    return { firstClick, marked, secondClick: document.querySelector('#status').textContent };
  });
  check('blank variance warns before launching', /identical/.test(guard.firstClick), guard.firstClick);
  check('blank field is visually marked', guard.marked === 1, `marked=${guard.marked}`);
  check('second click proceeds to launch', /Opened 2/.test(guard.secondClick), guard.secondClick);

  // --- 5. Bounds rejection degrades instead of aborting ---
  check('tiling failure reported, not fatal', /could not be tiled|independent sessions/.test(guard.secondClick), guard.secondClick);

  // --- 6. "Fill empty" gives distinct presets ---
  const filled = await page.evaluate(async () => {
    const c = document.querySelector('#count');
    c.value = '5'; c.dispatchEvent(new Event('change'));
    for (const a of document.querySelectorAll('#variances textarea')) {
      a.value = ''; a.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('#suggest').click();
    await new Promise((r) => setTimeout(r, 60));
    return [...document.querySelectorAll('#variances textarea')].map((a) => a.value);
  });
  check('Fill empty populates all 5', filled.length === 5 && filled.every((v) => v.trim()), `n=${filled.length}`);
  check('presets are all distinct', new Set(filled).size === 5, `unique=${new Set(filled).size}`);

  // --- 7. Detached UI ---
  const detachedUi = await page.evaluate(() => ({
    hasDetachButton: !!document.querySelector('#detach'),
    detachedClass: document.body.classList.contains('detached'),
    width: getComputedStyle(document.body).width,
  }));
  check('detached page hides the detach button', detachedUi.hasDetachButton === false);
  check('detached page sets .detached', detachedUi.detachedClass === true);
  check('detached page drops the fixed 520px width', detachedUi.width !== '520px', `width=${detachedUi.width}`);

  // --- 8. open-detached reuses rather than stacking ---
  const first = await page.evaluate(() => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ type: 'open-detached' }));
  await new Promise((r) => setTimeout(r, 700));
  const second = await page.evaluate(() => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ type: 'open-detached' }));
  await new Promise((r) => setTimeout(r, 700));
  const detachedTabs = await sw.evaluate(async () =>
    (await chrome.tabs.query({ url: chrome.runtime.getURL('popup.html?detached=1') })).length);
  check('open-detached succeeds', first?.ok === true && second?.ok === true, JSON.stringify({ first, second }));
  check('second open reuses the window', second?.reused === true && detachedTabs === 1, `tabs=${detachedTabs}`);

  // --- 9. Ctrl+Enter, and detached window survives launch ---
  const hotkey = await page.evaluate(async () => {
    const bp = document.querySelector('#basePrompt');
    bp.value = 'a dog'; bp.dispatchEvent(new Event('input', { bubbles: true }));
    for (const a of document.querySelectorAll('#variances textarea')) {
      a.value = 'x'; a.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 30));
    document.querySelector('#status').textContent = '';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 1500));
    return { status: document.querySelector('#status').textContent, launchEnabled: !document.querySelector('#launch').disabled };
  });
  check('Ctrl+Enter launches', /Opened/.test(hotkey.status), hotkey.status);
  check('detached window stays usable after launch', hotkey.launchEnabled === true);

  // --- 10. The ATTACHED popup still self-closes on success ---
  const { page: attached } = await openPopup(false);
  await attached.evaluate(async () => {
    const bp = document.querySelector('#basePrompt');
    bp.value = 'a bird'; bp.dispatchEvent(new Event('input', { bubbles: true }));
    for (const a of document.querySelectorAll('#variances textarea')) {
      a.value = 'y'; a.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 30));
    document.querySelector('#launch').click();
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  check('attached popup closes itself after a successful launch', attached.isClosed(), `closed=${attached.isClosed()}`);

  // --- 11. Draft survives teardown (the debounce-loss bug) ---
  const { page: draft } = await openPopup(true);
  await draft.evaluate(async () => {
    const bp = document.querySelector('#basePrompt');
    bp.value = 'DRAFT-SENTINEL';
    bp.dispatchEvent(new Event('input', { bubbles: true }));
    // Immediately simulate dismissal, well inside the 250ms debounce window.
    window.dispatchEvent(new Event('pagehide'));
  });
  await new Promise((r) => setTimeout(r, 400));
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('fanoutSettings')).fanoutSettings?.basePrompt);
  check('draft flushed on teardown inside debounce window', saved === 'DRAFT-SENTINEL', `saved=${JSON.stringify(saved)}`);

  // --- 12. cleanupOldJobs runs on launch ---
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ 'fanoutJob:STALE:0': { prompt: 'old', createdAt: Date.now() - 60 * 60 * 1000 } });
  });
  const before = await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.includes('STALE')).length);
  await draft.evaluate(async () => {
    const api = globalThis.browser ?? globalThis.chrome;
    await api.runtime.sendMessage({ type: 'launch-fanout', prompts: ['a', 'b'], mode: 'tabs', screenBounds: {} });
  });
  const after = await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.includes('STALE')).length);
  check('stale jobs purged on launch', before === 1 && after === 0, `before=${before} after=${after}`);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  await ctx.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
