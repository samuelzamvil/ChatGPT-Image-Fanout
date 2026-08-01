const api = globalThis.browser ?? globalThis.chrome;
const isDetached = new URLSearchParams(location.search).get('detached') === '1';

const basePrompt = document.querySelector('#basePrompt');
const countSelect = document.querySelector('#count');
const separatorSelect = document.querySelector('#separator');
const variances = document.querySelector('#variances');
const launchButton = document.querySelector('#launch');
const clearButton = document.querySelector('#clear');
const detachButton = document.querySelector('#detach');
const suggestButton = document.querySelector('#suggest');
const status = document.querySelector('#status');

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

let varianceValues = Array(8).fill('');
let saveTimer;
let blankWarningIssued = false;

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
  area.addEventListener('input', () => {
    blankWarningIssued = false;
    area.classList.remove('blank');
    scheduleSave();
  });

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
    varianceValues,
  };
}

async function saveSettings() {
  clearTimeout(saveTimer);
  await api.storage.local.set({ fanoutSettings: currentSettings() });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveSettings(), 250);
}

async function restoreSettings() {
  const { fanoutSettings } = await api.storage.local.get('fanoutSettings');
  if (!fanoutSettings) {
    renderVariances();
    return;
  }

  basePrompt.value = fanoutSettings.basePrompt ?? '';
  countSelect.value = String(Math.min(8, Math.max(2, fanoutSettings.count ?? 4)));
  separatorSelect.value = fanoutSettings.separator ?? 'heading';
  varianceValues = Array(8).fill('').map((_, index) => fanoutSettings.varianceValues?.[index] ?? '');

  const mode = document.querySelector(`input[name="mode"][value="${fanoutSettings.mode ?? 'windows'}"]`);
  if (mode) mode.checked = true;

  renderVariances();
}

function composePrompt(shared, direction, style) {
  const base = shared.trim();
  const variance = direction.trim();
  if (!variance) return base;

  if (style === 'none') return `${base}\n\n${variance}`;
  if (style === 'plain') return `${base}\n\nTake this version in the following distinct direction: ${variance}`;

  return `${base}\n\nVARIANCE DIRECTION FOR THIS SESSION:\n${variance}\n\nTreat this as an independent first interpretation. Do not converge toward a safe compromise or assume any visual choices from other sessions.`;
}

function blankIndexes(count) {
  syncValuesFromDom();
  const blanks = [];
  for (let index = 0; index < count; index += 1) {
    if (!varianceValues[index]?.trim()) blanks.push(index);
  }
  return blanks;
}

function markBlanks(indexes) {
  for (const area of variances.querySelectorAll('textarea')) {
    area.classList.toggle('blank', indexes.includes(Number(area.dataset.index)));
  }
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
    area.classList.remove('blank');
  }

  blankWarningIssued = false;
  setStatus(filled ? `Filled ${filled} empty ${filled === 1 ? 'field' : 'fields'}.` : 'Nothing to fill.');
  void saveSettings();
}

async function launch() {
  const settings = currentSettings();
  const shared = settings.basePrompt.trim();

  if (!shared) {
    setStatus('Enter a shared image concept.', true);
    basePrompt.focus();
    return;
  }

  // Blank variances collapse to the bare shared concept, so those sessions would
  // be byte-identical to each other. Warn once, then let it through.
  const blanks = blankIndexes(settings.count);
  if (blanks.length && !blankWarningIssued) {
    const labels = blanks.map((index) => index + 1).join(', ');
    markBlanks(blanks);
    blankWarningIssued = true;
    setStatus(
      `Session${blanks.length === 1 ? '' : 's'} ${labels} ${blanks.length === 1 ? 'has' : 'have'} no variance and would be identical. Launch again to proceed.`,
      true,
    );
    return;
  }

  const prompts = settings.varianceValues
    .slice(0, settings.count)
    .map((direction) => composePrompt(shared, direction, settings.separator));

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
      mode: settings.mode,
      screenBounds,
    });

    if (!response?.ok) throw new Error(response?.error || 'The extension could not open the sessions.');

    const unpositioned = response.unpositioned ?? 0;
    setStatus(unpositioned
      ? `Opened ${settings.count} sessions. ${unpositioned} could not be tiled and opened at the default position.`
      : `Opened ${settings.count} independent sessions.`);
    blankWarningIssued = false;

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
  varianceValues = Array(8).fill('');
  for (const area of variances.querySelectorAll('textarea')) {
    area.value = '';
    area.classList.remove('blank');
  }
  blankWarningIssued = false;
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
basePrompt.addEventListener('input', scheduleSave);
for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener('change', scheduleSave);
}
launchButton.addEventListener('click', () => void launch());
clearButton.addEventListener('click', () => void clearForm());
suggestButton.addEventListener('click', fillEmptyVariances);
detachButton.addEventListener('click', () => void detach());

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    void launch();
  }
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
