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

  // --- 4. A blank variance launches on the first click, no confirmation step ---
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
    await new Promise((r) => setTimeout(r, 1600));
    return { status: document.querySelector('#status').textContent };
  });
  check('a blank variance launches on the first click', /Opened 2/.test(guard.status), guard.status);
  check('no second-click confirmation is demanded', !/Launch again/.test(guard.status), guard.status);

  // --- 5. Placement problems are reported, not fatal ---
  check('launch reports what actually happened', /Opened 2 sessions/.test(guard.status), guard.status);

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

  // --- 6b. Bulk paste fills rows and matches the session count ---
  const bulk = await page.evaluate(async () => {
    document.querySelector('#bulk').click();
    const box = document.querySelector('#bulkText');
    box.value = 'alpha line\nbeta line\ngamma line';
    document.querySelector('#applyBulk').click();
    await new Promise((r) => setTimeout(r, 60));
    return {
      values: [...document.querySelectorAll('#variances textarea')].map((a) => a.value),
      count: document.querySelector('#count').value,
      panelHidden: document.querySelector('#bulkPanel').hidden,
    };
  });
  check('bulk paste fills one row per line', bulk.values.join('|') === 'alpha line|beta line|gamma line', JSON.stringify(bulk.values));
  check('bulk paste sets the session count to the list length', bulk.count === '3', `count=${bulk.count}`);
  check('bulk panel closes after applying', bulk.panelHidden === true);

  // `---` rules let a single variance span multiple lines.
  const bulkRules = await page.evaluate(async () => {
    document.querySelector('#bulk').click();
    const box = document.querySelector('#bulkText');
    box.value = 'first line one\nfirst line two\n---\nsecond entry';
    document.querySelector('#applyBulk').click();
    await new Promise((r) => setTimeout(r, 60));
    return [...document.querySelectorAll('#variances textarea')].map((a) => a.value);
  });
  check('--- separator keeps multi-line entries together',
    bulkRules.length === 2 && bulkRules[0] === 'first line one\nfirst line two' && bulkRules[1] === 'second entry',
    JSON.stringify(bulkRules));

  // --- 6c. Saved sets round-trip through storage ---
  const sets = await page.evaluate(async () => {
    document.querySelector('#basePrompt').value = 'SET-CONCEPT';
    document.querySelector('#basePrompt').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#saveSet').click();
    document.querySelector('#setName').value = 'my set';
    document.querySelector('#confirmSaveSet').click();
    await new Promise((r) => setTimeout(r, 120));

    const options = [...document.querySelectorAll('#savedSets option')].map((o) => o.value);

    // Wipe the form, then load the set back.
    document.querySelector('#clear').click();
    await new Promise((r) => setTimeout(r, 120));
    const cleared = document.querySelector('#basePrompt').value;

    const select = document.querySelector('#savedSets');
    select.value = 'my set';
    select.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 120));

    return {
      options,
      cleared,
      restored: document.querySelector('#basePrompt').value,
      variances: [...document.querySelectorAll('#variances textarea')].map((a) => a.value),
    };
  });
  const persisted = await sw.evaluate(async () => (await chrome.storage.local.get('fanoutSets')).fanoutSets);
  check('saving adds the set to the picker', sets.options.includes('my set'), JSON.stringify(sets.options));
  check('sets persist to storage', Array.isArray(persisted) && persisted.some((s) => s.name === 'my set'), JSON.stringify(persisted));
  check('clear empties the form', sets.cleared === '');
  check('loading a set restores the concept', sets.restored === 'SET-CONCEPT', `restored=${sets.restored}`);
  check('loading a set restores the variances', sets.variances.join('|') === 'first line one\nfirst line two|second entry', JSON.stringify(sets.variances));

  const deleted = await page.evaluate(async () => {
    document.querySelector('#deleteSet').click();
    await new Promise((r) => setTimeout(r, 120));
    return [...document.querySelectorAll('#savedSets option')].map((o) => o.value);
  });
  check('deleting removes the set', !deleted.includes('my set'), JSON.stringify(deleted));

  // --- 6d. Layout controls hide in tabs mode and reach the background ---
  const layout = await page.evaluate(async () => {
    const tabs = document.querySelector('input[name="mode"][value="tabs"]');
    tabs.checked = true; tabs.dispatchEvent(new Event('change'));
    const hiddenInTabs = document.querySelector('#layoutRow').hidden;

    const windows = document.querySelector('input[name="mode"][value="windows"]');
    windows.checked = true; windows.dispatchEvent(new Event('change'));
    const shownInWindows = document.querySelector('#layoutRow').hidden;

    document.querySelector('#columns').value = '3';
    document.querySelector('#columns').dispatchEvent(new Event('change'));
    document.querySelector('#tileTarget').value = 'window';
    document.querySelector('#tileTarget').dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 350));
    return { hiddenInTabs, shownInWindows };
  });
  const layoutSaved = await sw.evaluate(async () => {
    const s = (await chrome.storage.local.get('fanoutSettings')).fanoutSettings;
    return { columns: s?.columns, tileTarget: s?.tileTarget };
  });
  check('layout row hides in tabs mode', layout.hiddenInTabs === true);
  check('layout row returns in windows mode', layout.shownInWindows === false);
  check('layout choices persist', layoutSaved.columns === '3' && layoutSaved.tileTarget === 'window', JSON.stringify(layoutSaved));

  // Grid math, straight from the worker.
  const grid = await sw.evaluate(() => {
    const big = { left: 0, top: 0, width: 1920, height: 1080 };
    const small = { left: 0, top: 0, width: 1280, height: 720 };
    return {
      explicit: gridFor(6, 2, big),
      clamped: gridFor(2, 4, big),
      auto2: gridFor(2, undefined, big),
      auto4: gridFor(4, undefined, big),
      auto6: gridFor(6, undefined, big),
      auto8: gridFor(8, undefined, big),
      cramped: gridFor(8, undefined, small),
      partial: tileBounds(4, 5, big, gridFor(5, 2, big)),
    };
  });
  check('explicit column count is honoured', grid.explicit.columns === 2 && grid.explicit.rows === 3, JSON.stringify(grid.explicit));
  check('columns never exceed the session count', grid.clamped.columns === 2, JSON.stringify(grid.clamped));
  check('auto keeps 2 columns for 2 sessions', grid.auto2.columns === 2 && grid.auto2.rows === 1, JSON.stringify(grid.auto2));
  check('auto keeps 2×2 for 4 sessions', grid.auto4.columns === 2 && grid.auto4.rows === 2, JSON.stringify(grid.auto4));
  check('auto keeps 3×2 for 6 sessions', grid.auto6.columns === 3 && grid.auto6.rows === 2, JSON.stringify(grid.auto6));
  // 4×2 on a 1920 screen gives 480px-wide tiles, under the minimum window width,
  // so the grid that actually fits is 3×3.
  check('auto avoids a grid narrower than the browser minimum',
    grid.auto8.columns === 3 && grid.auto8.rows === 3 && grid.auto8.slack >= 1, JSON.stringify(grid.auto8));
  check('a screen too small to tile is flagged rather than faked',
    grid.cramped.slack < 1, JSON.stringify(grid.cramped));
  check('trailing window of a partial row spans the width', grid.partial.width === 1920 && grid.partial.left === 0, JSON.stringify(grid.partial));

  // Placement is verified after the fact, since windows.create neither throws
  // nor reports the bounds the window actually settles at.
  const verified = await sw.evaluate(async () => {
    const win = await chrome.windows.create({ url: 'about:blank', type: 'popup', left: 0, top: 0, width: 400, height: 300 });
    const asked = { left: 0, top: 0, width: 400, height: 300 };
    const misplaced = await countMisplaced([{ id: win.id, bounds: asked }]);
    const ghost = await countMisplaced([{ id: 999999, bounds: asked }]);
    await chrome.windows.remove(win.id).catch(() => {});
    return { misplaced, ghost };
  });
  check('drift from the requested bounds is detected', verified.misplaced === 1, `misplaced=${verified.misplaced}`);
  check('an already-closed window is not counted as misplaced', verified.ghost === 0, `ghost=${verified.ghost}`);

  // --- 6e. Labels ride along with the job records ---
  const labelled = await page.evaluate(async () => {
    const api = globalThis.browser ?? globalThis.chrome;
    return api.runtime.sendMessage({
      type: 'launch-fanout',
      prompts: ['p1', 'p2'],
      labels: ['tactile handmade collage', ''],
      mode: 'tabs',
      screenBounds: {},
    });
  });
  const jobRecords = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([k]) => k.startsWith('fanoutJob:'))
      .map(([, v]) => ({ label: v.label, slot: v.slot }));
  });
  check('labelled launch succeeds', labelled?.ok === true, JSON.stringify(labelled));
  check('job records carry label and slot',
    jobRecords.some((r) => r.label === 'tactile handmade collage' && r.slot === 1) && jobRecords.some((r) => r.label === '' && r.slot === 2),
    JSON.stringify(jobRecords));

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
