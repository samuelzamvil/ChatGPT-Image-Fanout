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

// Neither browser will shrink a window below roughly this. Ask for less and you
// get a window of the minimum size at the requested position, which is why a
// too-fine grid overlaps instead of tiling. The grid is chosen against these
// numbers rather than assuming any count fits on any screen.
const MIN_TILE = { width: 500, height: 340 };

function measure(count, columns, bounds) {
  const rows = Math.ceil(count / columns);
  const width = Math.floor(bounds.width / columns);
  const height = Math.floor(bounds.height / rows);
  return {
    columns,
    rows,
    width,
    height,
    // Below 1 the browser refuses to shrink and the tiles start overlapping.
    slack: Math.min(width / MIN_TILE.width, height / MIN_TILE.height),
    holes: columns * rows - count,
    // Tiles shaped like the screen beat tall slivers when both layouts fit.
    skew: Math.abs(Math.log((width / height) / (bounds.width / bounds.height))),
  };
}

// Every column count is a candidate. Prefer the layouts that actually fit, then
// the tightest packing; if nothing fits, take the least-bad one so the sessions
// still open somewhere sensible.
function chooseGrid(count, bounds) {
  let best = null;

  for (let columns = 1; columns <= count; columns += 1) {
    const candidate = measure(count, columns, bounds);
    if (!best) {
      best = candidate;
      continue;
    }

    if (candidate.slack >= 1 && best.slack >= 1) {
      // Halving the width and halving the height skew a tile by the same amount,
      // so ties here are routine — and they land a few ulps apart, which without
      // the epsilon lets float noise pick the layout. Columns ascend, so a tie
      // goes to the later one: two sessions belong side by side, not stacked.
      const better = candidate.holes < best.holes
        || (candidate.holes === best.holes && candidate.skew <= best.skew + 1e-9);
      if (better) best = candidate;
    } else if (candidate.slack > best.slack) {
      best = candidate;
    }
  }

  return best;
}

function gridFor(count, columns, bounds) {
  const requested = Number(columns);
  // An explicit column count is an instruction, not a hint: honour it even when
  // it does not fit, and let the status line say so.
  if (Number.isInteger(requested) && requested >= 1) {
    return measure(count, Math.min(requested, count), bounds);
  }
  return chooseGrid(count, bounds);
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

// Frames and shadows make the settled geometry differ from the request by a few
// pixels even when placement worked, so only count real drift.
const PLACEMENT_TOLERANCE = 24;

function drifted(window, bounds) {
  return Math.abs(window.left - bounds.left) > PLACEMENT_TOLERANCE
    || Math.abs(window.top - bounds.top) > PLACEMENT_TOLERANCE
    || Math.abs(window.width - bounds.width) > PLACEMENT_TOLERANCE
    || Math.abs(window.height - bounds.height) > PLACEMENT_TOLERANCE;
}

async function createTiledWindows(jobToken, prompts, screenBounds, grid) {
  const placed = [];

  for (let index = 0; index < prompts.length; index += 1) {
    const bounds = tileBounds(index, prompts.length, screenBounds, grid);
    const base = { url: chatUrl(jobToken, index), type: 'popup', focused: index === 0 };

    // Browsers reject bounds they consider off-screen — negative availLeft on a
    // secondary monitor, DPI scaling, a display unplugged mid-launch. Losing the
    // tiling is acceptable; losing the session is not.
    let created;
    try {
      created = await api.windows.create({ ...base, ...bounds });
    } catch {
      await api.windows.create(base).catch(() => {});
      continue;
    }

    // Chrome honours create-time bounds inconsistently — it reports the bounds
    // you asked for and then sizes the window differently. Re-asserting through
    // windows.update after the window exists is what actually sticks.
    try {
      await api.windows.update(created.id, bounds);
    } catch {
      // The verification pass below reports whatever we ended up with.
    }

    placed.push({ id: created.id, bounds });
  }

  return placed;
}

// windows.create resolves before the window has settled, and it never throws on
// bounds it silently declines, so the only honest way to know whether tiling
// worked is to look afterwards.
async function countMisplaced(placed) {
  if (!placed.length) return 0;

  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    const all = await api.windows.getAll();
    const byId = new Map(all.map((window) => [window.id, window]));
    return placed.filter(({ id, bounds }) => {
      const window = byId.get(id);
      // A window the user already closed is not a placement failure.
      return window ? drifted(window, bounds) : false;
    }).length;
  } catch {
    return 0;
  }
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
  const grid = gridFor(prompts.length, message.columns, bounds);
  const placed = await createTiledWindows(jobToken, prompts, bounds, grid);

  return {
    ok: true,
    unpositioned: await countMisplaced(placed),
    columns: grid.columns,
    rows: grid.rows,
    // The screen cannot hold this many windows at the browser's minimum size, so
    // they will overlap no matter how the grid is arranged.
    cramped: grid.slack < 1,
  };
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
