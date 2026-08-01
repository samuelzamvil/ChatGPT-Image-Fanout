const api = globalThis.browser ?? globalThis.chrome;
const JOB_PREFIX = 'fanoutJob:';
const JOB_TTL_MS = 15 * 60 * 1000;
const LABEL_MAX = 40;
const DETACHED_URL = 'popup.html?detached=1';

function token() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function autoColumns(count) {
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

function gridFor(count, columns) {
  const requested = Number(columns);
  const resolved = Number.isInteger(requested) && requested >= 1 && requested <= 4
    ? Math.min(requested, count)
    : autoColumns(count);
  return { columns: resolved, rows: Math.ceil(count / resolved) };
}

function normalizeBounds(bounds) {
  return {
    left: Number.isFinite(bounds?.left) ? Math.round(bounds.left) : 0,
    top: Number.isFinite(bounds?.top) ? Math.round(bounds.top) : 0,
    width: Number.isFinite(bounds?.width) && bounds.width > 0 ? Math.round(bounds.width) : 1440,
    height: Number.isFinite(bounds?.height) && bounds.height > 0 ? Math.round(bounds.height) : 900,
  };
}

function tileBounds(index, count, bounds, grid) {
  const { columns, rows } = grid;
  const column = index % columns;
  const row = Math.floor(index / columns);

  const baseWidth = Math.floor(bounds.width / columns);
  const baseHeight = Math.floor(bounds.height / rows);
  // The trailing window of a row absorbs the rounding remainder so the grid
  // reaches the far edge. A partial last row ends early, so its final window
  // counts as trailing too and stretches across the gap.
  const endsRow = column === columns - 1 || index === count - 1;
  const endsColumn = row === rows - 1;

  return {
    left: bounds.left + column * baseWidth,
    top: bounds.top + row * baseHeight,
    width: endsRow ? bounds.width - column * baseWidth : baseWidth,
    height: endsColumn ? bounds.height - row * baseHeight : baseHeight,
  };
}

// "Whole screen" uses the bounds the popup measured; "current window" asks the
// browser, since the popup cannot see the geometry of the window behind it.
async function resolveBounds(message) {
  const screen = normalizeBounds(message.screenBounds);
  if (message.tileTarget !== 'window') return screen;

  try {
    const windows = await api.windows.getAll({ windowTypes: ['normal'] });
    const target = windows.find((window) => window.focused) ?? windows[0];
    if (target && Number.isFinite(target.width) && target.width > 0) return normalizeBounds(target);
  } catch {
    // Fall back to the screen bounds below.
  }

  return screen;
}

function chatUrl(jobToken, slot) {
  return `https://chatgpt.com/#fanout=${encodeURIComponent(jobToken)}&slot=${slot}`;
}

async function createTiledWindows(jobToken, prompts, screenBounds, grid) {
  let unpositioned = 0;

  for (let index = 0; index < prompts.length; index += 1) {
    const bounds = tileBounds(index, prompts.length, screenBounds, grid);
    const base = { url: chatUrl(jobToken, index), type: 'popup', focused: index === 0 };

    // Browsers reject bounds they consider off-screen — negative availLeft on a
    // secondary monitor, DPI scaling, a display unplugged mid-launch. Losing the
    // tiling is acceptable; losing the session is not.
    try {
      await api.windows.create({ ...base, ...bounds });
    } catch {
      unpositioned += 1;
      await api.windows.create(base);
    }
  }

  return unpositioned;
}

async function createTabs(jobToken, prompts) {
  const current = await api.windows.getLastFocused();
  for (let index = 0; index < prompts.length; index += 1) {
    await api.tabs.create({
      windowId: current.id,
      url: chatUrl(jobToken, index),
      active: index === 0,
    });
  }
}

async function launchFanout(message) {
  const prompts = Array.isArray(message.prompts)
    ? message.prompts.map((prompt) => String(prompt)).slice(0, 8)
    : [];

  if (prompts.length < 2) throw new Error('At least two prompts are required.');

  // Every tiled session is the same site under the same account, so the only way
  // to tell the windows apart is the label the content script writes into the
  // title bar.
  const labels = Array.isArray(message.labels)
    ? message.labels.map((label) => String(label).slice(0, LABEL_MAX))
    : [];

  // Browsers stay open for weeks, so startup-only cleanup lets jobs pile up.
  await cleanupOldJobs();

  const jobToken = token();
  const createdAt = Date.now();
  const records = Object.fromEntries(prompts.map((prompt, index) => [
    `${JOB_PREFIX}${jobToken}:${index}`,
    { prompt, label: labels[index] ?? '', slot: index + 1, createdAt },
  ]));
  await api.storage.local.set(records);

  if (message.mode === 'tabs') {
    await createTabs(jobToken, prompts);
    return { ok: true };
  }

  const bounds = await resolveBounds(message);
  const grid = gridFor(prompts.length, message.columns);
  const unpositioned = await createTiledWindows(jobToken, prompts, bounds, grid);
  return { ok: true, unpositioned };
}

// Reuse an already-open detached window instead of stacking duplicates.
async function openDetached() {
  const url = api.runtime.getURL(DETACHED_URL);
  const existing = await api.tabs.query({ url });

  if (existing.length) {
    const [tab] = existing;
    await api.windows.update(tab.windowId, { focused: true });
    await api.tabs.update(tab.id, { active: true });
    return { ok: true, reused: true };
  }

  await api.windows.create({ url, type: 'popup', width: 560, height: 820 });
  return { ok: true, reused: false };
}

async function cleanupOldJobs() {
  const all = await api.storage.local.get(null);
  const now = Date.now();
  const staleKeys = Object.entries(all)
    .filter(([key, value]) => key.startsWith(JOB_PREFIX) && now - (value?.createdAt ?? 0) > JOB_TTL_MS)
    .map(([key]) => key);

  if (staleKeys.length) await api.storage.local.remove(staleKeys);
}

const handlers = {
  'launch-fanout': launchFanout,
  'open-detached': openDetached,
};

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return undefined;

  // Chrome ignores a returned Promise and closes the channel immediately, which
  // surfaces in the popup as a failure even though the launch succeeded. The
  // response has to go through sendResponse behind a synchronous `return true`.
  handler(message)
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));

  return true;
});

api.runtime.onStartup?.addListener(() => void cleanupOldJobs());
api.runtime.onInstalled?.addListener(() => void cleanupOldJobs());
