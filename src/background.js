const api = globalThis.browser ?? globalThis.chrome;
const JOB_PREFIX = 'fanoutJob:';
const JOB_TTL_MS = 15 * 60 * 1000;

function token() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function gridFor(count) {
  if (count <= 2) return { columns: 2, rows: 1 };
  if (count <= 4) return { columns: 2, rows: 2 };
  if (count <= 6) return { columns: 3, rows: 2 };
  return { columns: 4, rows: 2 };
}

function normalizeBounds(bounds) {
  return {
    left: Number.isFinite(bounds?.left) ? Math.round(bounds.left) : 0,
    top: Number.isFinite(bounds?.top) ? Math.round(bounds.top) : 0,
    width: Number.isFinite(bounds?.width) && bounds.width > 0 ? Math.round(bounds.width) : 1440,
    height: Number.isFinite(bounds?.height) && bounds.height > 0 ? Math.round(bounds.height) : 900,
  };
}

function tileBounds(index, count, screenBounds) {
  const bounds = normalizeBounds(screenBounds);
  const { columns, rows } = gridFor(count);
  const column = index % columns;
  const row = Math.floor(index / columns);

  const baseWidth = Math.floor(bounds.width / columns);
  const baseHeight = Math.floor(bounds.height / rows);
  const isLastColumn = column === columns - 1;
  const isLastRow = row === rows - 1;

  return {
    left: bounds.left + column * baseWidth,
    top: bounds.top + row * baseHeight,
    width: isLastColumn ? bounds.width - column * baseWidth : baseWidth,
    height: isLastRow ? bounds.height - row * baseHeight : baseHeight,
  };
}

function chatUrl(jobToken, slot) {
  return `https://chatgpt.com/#fanout=${encodeURIComponent(jobToken)}&slot=${slot}`;
}

async function createTiledWindows(jobToken, prompts, screenBounds) {
  for (let index = 0; index < prompts.length; index += 1) {
    const bounds = tileBounds(index, prompts.length, screenBounds);
    await api.windows.create({
      url: chatUrl(jobToken, index),
      type: 'popup',
      focused: index === 0,
      ...bounds,
    });
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

  const jobToken = token();
  const createdAt = Date.now();
  const records = Object.fromEntries(prompts.map((prompt, index) => [
    `${JOB_PREFIX}${jobToken}:${index}`,
    { prompt, createdAt },
  ]));
  await api.storage.local.set(records);

  if (message.mode === 'tabs') {
    await createTabs(jobToken, prompts);
  } else {
    await createTiledWindows(jobToken, prompts, message.screenBounds);
  }

  return { ok: true };
}

async function cleanupOldJobs() {
  const all = await api.storage.local.get(null);
  const now = Date.now();
  const staleKeys = Object.entries(all)
    .filter(([key, value]) => key.startsWith(JOB_PREFIX) && now - (value?.createdAt ?? 0) > JOB_TTL_MS)
    .map(([key]) => key);

  if (staleKeys.length) await api.storage.local.remove(staleKeys);
}

api.runtime.onMessage.addListener((message) => {
  if (message?.type === 'launch-fanout') {
    return launchFanout(message).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  return undefined;
});

api.runtime.onStartup?.addListener(() => void cleanupOldJobs());
api.runtime.onInstalled?.addListener(() => void cleanupOldJobs());
