const api = globalThis.browser ?? globalThis.chrome;
const isDetached = new URLSearchParams(location.search).get('detached') === '1';

const basePrompt = document.querySelector('#basePrompt');
const countSelect = document.querySelector('#count');
const separatorSelect = document.querySelector('#separator');
const columnsSelect = document.querySelector('#columns');
const tileTargetSelect = document.querySelector('#tileTarget');
const layoutRow = document.querySelector('#layoutRow');
const variances = document.querySelector('#variances');
const launchButton = document.querySelector('#launch');
const clearButton = document.querySelector('#clear');
const detachButton = document.querySelector('#detach');
const suggestButton = document.querySelector('#suggest');
const status = document.querySelector('#status');

const savedSetsSelect = document.querySelector('#savedSets');
const saveSetButton = document.querySelector('#saveSet');
const deleteSetButton = document.querySelector('#deleteSet');
const saveSetPanel = document.querySelector('#saveSetPanel');
const setNameInput = document.querySelector('#setName');
const confirmSaveSetButton = document.querySelector('#confirmSaveSet');
const cancelSaveSetButton = document.querySelector('#cancelSaveSet');

const bulkButton = document.querySelector('#bulk');
const bulkPanel = document.querySelector('#bulkPanel');
const bulkText = document.querySelector('#bulkText');
const applyBulkButton = document.querySelector('#applyBulk');
const cancelBulkButton = document.querySelector('#cancelBulk');

// Deliberately spread across rendering idioms so the sessions diverge instead of
// converging on the same house style.
const PRESETS = [
  'cinematic realism, severe wide-angle composition, sodium-vapor night lighting',
  'flat editorial poster, limited palette, hard geometric silhouettes',
  'tactile handmade collage, torn paper edges, visible material texture',
  'technical cutaway diagram, isometric projection, precise annotation',
  'high-key studio product photography, seamless backdrop, soft gradient falloff',
  'expressive ink and gouache, heavy brush economy, unresolved negative space',
  'long-exposure documentary frame, motion smear, available light only',
  'retro-futurist screen print, misregistered halftone, four-color separation',
];

const MAX_SESSIONS = 8;
const LABEL_MAX = 40;

let varianceValues = Array(MAX_SESSIONS).fill('');
let savedSets = [];
let saveTimer;

function activeMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function syncValuesFromDom() {
  for (const area of variances.querySelectorAll('textarea')) {
    varianceValues[Number(area.dataset.index)] = area.value;
  }
}

function placeholderFor(index) {
  return index < 2 ? `Example: ${PRESETS[index]}` : 'Describe a direction that should differ radically from the others.';
}

function createVarianceRow(index) {
  const row = document.createElement('div');
  row.className = 'variance';

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = String(index + 1);
  badge.setAttribute('aria-hidden', 'true');

  const area = document.createElement('textarea');
  area.dataset.index = String(index);
  area.value = varianceValues[index] ?? '';
  area.placeholder = placeholderFor(index);
  area.setAttribute('aria-label', `Variance instruction for session ${index + 1}`);
  area.addEventListener('input', scheduleSave);

  row.append(badge, area);
  return row;
}

// Add and remove only the rows that changed. Rebuilding every row would reset
// focus and wipe each textarea's native undo history on any count change.
function renderVariances() {
  syncValuesFromDom();
  const count = Number(countSelect.value);
  const rows = variances.children;

  while (rows.length > count) variances.lastElementChild.remove();
  while (rows.length < count) variances.append(createVarianceRow(rows.length));

  launchButton.textContent = `Launch ${count} sessions`;
}

function currentSettings() {
  syncValuesFromDom();

  return {
    basePrompt: basePrompt.value,
    count: Number(countSelect.value),
    separator: separatorSelect.value,
    mode: activeMode(),
    columns: columnsSelect.value,
    tileTarget: tileTargetSelect.value,
    varianceValues,
  };
}

// Tiling options are meaningless once the sessions open as tabs.
function syncLayoutVisibility() {
  layoutRow.hidden = activeMode() === 'tabs';
}

async function saveSettings() {
  clearTimeout(saveTimer);
  await api.storage.local.set({ fanoutSettings: currentSettings() });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveSettings(), 250);
}

function applySettings(settings) {
  basePrompt.value = settings.basePrompt ?? '';
  countSelect.value = String(Math.min(MAX_SESSIONS, Math.max(2, settings.count ?? 4)));
  separatorSelect.value = settings.separator ?? 'heading';
  varianceValues = Array(MAX_SESSIONS).fill('').map((_, index) => settings.varianceValues?.[index] ?? '');

  for (const area of variances.querySelectorAll('textarea')) {
    area.value = varianceValues[Number(area.dataset.index)] ?? '';
  }

  renderVariances();
}

async function restoreSettings() {
  const { fanoutSettings, fanoutSets } = await api.storage.local.get(['fanoutSettings', 'fanoutSets']);

  savedSets = Array.isArray(fanoutSets) ? fanoutSets : [];
  renderSavedSets();

  if (!fanoutSettings) {
    renderVariances();
    syncLayoutVisibility();
    return;
  }

  const mode = document.querySelector(`input[name="mode"][value="${fanoutSettings.mode ?? 'windows'}"]`);
  if (mode) mode.checked = true;
  columnsSelect.value = fanoutSettings.columns ?? 'auto';
  tileTargetSelect.value = fanoutSettings.tileTarget ?? 'screen';

  applySettings(fanoutSettings);
  syncLayoutVisibility();
}

function composePrompt(shared, direction, style) {
  const base = shared.trim();
  const variance = direction.trim();
  if (!variance) return base;

  if (style === 'none') return `${base}\n\n${variance}`;
  if (style === 'plain') return `${base}\n\nTake this version in the following distinct direction: ${variance}`;

  return `${base}\n\nVARIANCE DIRECTION FOR THIS SESSION:\n${variance}\n\nTreat this as an independent first interpretation. Do not converge toward a safe compromise or assume any visual choices from other sessions.`;
}

function fillEmptyVariances() {
  syncValuesFromDom();
  const count = Number(countSelect.value);
  let filled = 0;

  for (let index = 0; index < count; index += 1) {
    if (varianceValues[index]?.trim()) continue;
    varianceValues[index] = PRESETS[index % PRESETS.length];
    filled += 1;
  }

  for (const area of variances.querySelectorAll('textarea')) {
    const index = Number(area.dataset.index);
    area.value = varianceValues[index];
  }

  setStatus(filled ? `Filled ${filled} empty ${filled === 1 ? 'field' : 'fields'}.` : 'Nothing to fill.');
  void saveSettings();
}

function renderSavedSets() {
  const previous = savedSetsSelect.value;
  savedSetsSelect.replaceChildren();

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = savedSets.length ? '— pick a set —' : '— none saved —';
  savedSetsSelect.append(placeholder);

  for (const set of savedSets) {
    const option = document.createElement('option');
    option.value = set.name;
    option.textContent = set.name;
    savedSetsSelect.append(option);
  }

  savedSetsSelect.value = savedSets.some((set) => set.name === previous) ? previous : '';
  deleteSetButton.disabled = !savedSetsSelect.value;
}

async function persistSets() {
  await api.storage.local.set({ fanoutSets: savedSets });
}

function openSavePanel() {
  bulkPanel.hidden = true;
  saveSetPanel.hidden = false;
  // Saving over the loaded set is the common case; a fresh name is one edit away.
  setNameInput.value = savedSetsSelect.value || basePrompt.value.trim().split(/\s+/).slice(0, 5).join(' ');
  setNameInput.focus();
  setNameInput.select();
}

async function saveSet() {
  const name = setNameInput.value.trim();
  if (!name) {
    setStatus('Give the set a name.', true);
    setNameInput.focus();
    return;
  }

  const settings = currentSettings();
  // Only the composition travels with a set. Window mode and tiling are standing
  // preferences, not part of the concept.
  const record = {
    name,
    basePrompt: settings.basePrompt,
    count: settings.count,
    separator: settings.separator,
    varianceValues: settings.varianceValues.slice(0, MAX_SESSIONS),
    savedAt: Date.now(),
  };

  const existing = savedSets.findIndex((set) => set.name.toLowerCase() === name.toLowerCase());
  if (existing === -1) savedSets.push(record);
  else savedSets[existing] = record;

  savedSets.sort((a, b) => a.name.localeCompare(b.name));
  await persistSets();

  saveSetPanel.hidden = true;
  renderSavedSets();
  savedSetsSelect.value = name;
  deleteSetButton.disabled = false;
  setStatus(existing === -1 ? `Saved "${name}".` : `Updated "${name}".`);
}

async function deleteSet() {
  const name = savedSetsSelect.value;
  if (!name) return;

  savedSets = savedSets.filter((set) => set.name !== name);
  await persistSets();
  renderSavedSets();
  setStatus(`Deleted "${name}".`);
}

function loadSet() {
  const name = savedSetsSelect.value;
  deleteSetButton.disabled = !name;
  if (!name) return;

  const set = savedSets.find((entry) => entry.name === name);
  if (!set) return;

  applySettings(set);
  void saveSettings();
  setStatus(`Loaded "${name}".`);
}

// A blank line separates entries only when the list is line-per-variance; an
// explicit `---` rule lets a single variance span several lines.
function parseBulk(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const entries = /^\s*---+\s*$/m.test(trimmed)
    ? trimmed.split(/^\s*---+\s*$/m)
    : trimmed.split(/\r?\n/);

  return entries.map((entry) => entry.trim()).filter(Boolean).slice(0, MAX_SESSIONS);
}

function applyBulk() {
  const entries = parseBulk(bulkText.value);
  if (!entries.length) {
    setStatus('Nothing to paste in.', true);
    bulkText.focus();
    return;
  }

  syncValuesFromDom();
  entries.forEach((entry, index) => {
    varianceValues[index] = entry;
  });

  // Match the session count to the list. Values past the new count stay in
  // varianceValues, so raising the count again brings them back.
  countSelect.value = String(Math.min(MAX_SESSIONS, Math.max(2, entries.length)));

  for (const area of variances.querySelectorAll('textarea')) {
    const index = Number(area.dataset.index);
    area.value = varianceValues[index] ?? '';
  }

  renderVariances();
  bulkPanel.hidden = true;
  bulkText.value = '';
  void saveSettings();
  setStatus(`Filled ${entries.length} ${entries.length === 1 ? 'session' : 'sessions'} from the list.`);
}

// The window title has very little room, so cut the variance at its first clause.
// An empty label leaves the content script on its "Session N" fallback.
function labelFor(variance) {
  const first = variance.trim().split(/[,.;\n]/)[0].trim();
  if (!first) return '';
  return first.length > LABEL_MAX ? `${first.slice(0, LABEL_MAX - 1).trimEnd()}…` : first;
}

// The old message claimed a clean tiling it never checked. Say what happened.
function launchSummary(settings, response) {
  const opened = `Opened ${settings.count} sessions`;
  if (settings.mode === 'tabs') return `${opened} as tabs.`;

  const grid = response.columns && response.rows ? ` in a ${response.columns}×${response.rows} grid` : '';
  const misplaced = response.unpositioned ?? 0;

  if (misplaced) {
    return `${opened}${grid}, but ${misplaced} ${misplaced === 1 ? 'window' : 'windows'} would not take the tiled position. `
      + 'Some window managers override extension placement.';
  }
  if (response.cramped) {
    return `${opened}${grid}. This screen is too small to fit them all at the browser's minimum window size, so they overlap — `
      + 'try fewer sessions or tabs instead.';
  }
  return `${opened}${grid}.`;
}

async function launch() {
  const settings = currentSettings();
  const shared = settings.basePrompt.trim();

  if (!shared) {
    setStatus('Enter a shared image concept.', true);
    basePrompt.focus();
    return;
  }

  const directions = settings.varianceValues.slice(0, settings.count);
  const prompts = directions.map((direction) => composePrompt(shared, direction, settings.separator));
  const labels = directions.map((direction) => labelFor(direction));

  launchButton.disabled = true;
  clearButton.disabled = true;
  setStatus('Opening sessions…');

  try {
    await saveSettings();

    const screenBounds = {
      left: Number.isFinite(window.screen.availLeft) ? window.screen.availLeft : 0,
      top: Number.isFinite(window.screen.availTop) ? window.screen.availTop : 0,
      width: window.screen.availWidth,
      height: window.screen.availHeight,
    };

    const response = await api.runtime.sendMessage({
      type: 'launch-fanout',
      prompts,
      labels,
      mode: settings.mode,
      columns: settings.columns === 'auto' ? undefined : Number(settings.columns),
      tileTarget: settings.tileTarget,
      screenBounds,
    });

    if (!response?.ok) throw new Error(response?.error || 'The extension could not open the sessions.');

    setStatus(launchSummary(settings, response));

    // A detached window is meant to stay open for the next round.
    if (isDetached) {
      launchButton.disabled = false;
      clearButton.disabled = false;
    } else {
      window.close();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    launchButton.disabled = false;
    clearButton.disabled = false;
  }
}

async function clearForm() {
  basePrompt.value = '';
  varianceValues = Array(MAX_SESSIONS).fill('');
  for (const area of variances.querySelectorAll('textarea')) {
    area.value = '';
  }
  // The form no longer reflects whatever set was loaded.
  savedSetsSelect.value = '';
  deleteSetButton.disabled = true;
  setStatus('');
  await saveSettings();
  basePrompt.focus();
}

async function detach() {
  const response = await api.runtime.sendMessage({ type: 'open-detached' });
  if (!response?.ok) {
    setStatus(response?.error || 'Could not open a separate window.', true);
    return;
  }
  window.close();
}

countSelect.addEventListener('change', () => {
  renderVariances();
  scheduleSave();
});
separatorSelect.addEventListener('change', scheduleSave);
columnsSelect.addEventListener('change', scheduleSave);
tileTargetSelect.addEventListener('change', scheduleSave);
basePrompt.addEventListener('input', scheduleSave);
for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener('change', () => {
    syncLayoutVisibility();
    scheduleSave();
  });
}
launchButton.addEventListener('click', () => void launch());
clearButton.addEventListener('click', () => void clearForm());
suggestButton.addEventListener('click', fillEmptyVariances);
detachButton.addEventListener('click', () => void detach());

savedSetsSelect.addEventListener('change', loadSet);
saveSetButton.addEventListener('click', openSavePanel);
confirmSaveSetButton.addEventListener('click', () => void saveSet());
cancelSaveSetButton.addEventListener('click', () => { saveSetPanel.hidden = true; });
deleteSetButton.addEventListener('click', () => void deleteSet());
setNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void saveSet();
  }
});

bulkButton.addEventListener('click', () => {
  saveSetPanel.hidden = true;
  bulkPanel.hidden = !bulkPanel.hidden;
  if (!bulkPanel.hidden) bulkText.focus();
});
applyBulkButton.addEventListener('click', applyBulk);
cancelBulkButton.addEventListener('click', () => { bulkPanel.hidden = true; });

document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
  event.preventDefault();

  // Inside an open panel the shortcut belongs to that panel, not to Launch.
  if (event.target === bulkText) applyBulk();
  else if (event.target === setNameInput) void saveSet();
  else void launch();
});

// The debounced save never fires if the popup is dismissed first — its timers die
// with the document — so flush synchronously on teardown.
for (const event of ['pagehide', 'blur']) {
  window.addEventListener(event, () => void saveSettings());
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void saveSettings();
});

if (isDetached) {
  document.body.classList.add('detached');
  detachButton.remove();
}

void restoreSettings();
