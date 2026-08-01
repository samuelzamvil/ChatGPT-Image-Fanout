const api = globalThis.browser ?? globalThis.chrome;

const basePrompt = document.querySelector('#basePrompt');
const countSelect = document.querySelector('#count');
const separatorSelect = document.querySelector('#separator');
const variances = document.querySelector('#variances');
const launchButton = document.querySelector('#launch');
const clearButton = document.querySelector('#clear');
const status = document.querySelector('#status');

let varianceValues = Array(8).fill('');
let saveTimer;

function activeMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function renderVariances() {
  for (const area of variances.querySelectorAll('textarea')) {
    varianceValues[Number(area.dataset.index)] = area.value;
  }

  const count = Number(countSelect.value);
  variances.replaceChildren();

  for (let index = 0; index < count; index += 1) {
    const row = document.createElement('div');
    row.className = 'variance';

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = String(index + 1);

    const area = document.createElement('textarea');
    area.dataset.index = String(index);
    area.value = varianceValues[index] ?? '';
    area.placeholder = index === 0
      ? 'Example: cinematic realism, severe wide-angle composition, sodium-vapor night lighting'
      : index === 1
        ? 'Example: flat editorial poster, limited palette, hard geometric silhouettes'
        : 'Describe a direction that should differ radically from the others.';
    area.addEventListener('input', scheduleSave);

    row.append(badge, area);
    variances.append(row);
  }

  launchButton.textContent = `Launch ${count} sessions`;
}

function currentSettings() {
  for (const area of variances.querySelectorAll('textarea')) {
    varianceValues[Number(area.dataset.index)] = area.value;
  }

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

async function launch() {
  const settings = currentSettings();
  const shared = settings.basePrompt.trim();

  if (!shared) {
    setStatus('Enter a shared image concept.', true);
    basePrompt.focus();
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
    setStatus(`Opened ${settings.count} independent sessions.`);
    window.close();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    launchButton.disabled = false;
    clearButton.disabled = false;
  }
}

async function clearForm() {
  basePrompt.value = '';
  varianceValues = Array(8).fill('');
  renderVariances();
  setStatus('');
  await saveSettings();
  basePrompt.focus();
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

void restoreSettings();
