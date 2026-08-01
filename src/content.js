(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const match = location.hash.match(/(?:^#|&)fanout=([^&]+)&slot=(\d+)/);
  if (!match) return;

  const jobToken = decodeURIComponent(match[1]);
  const slot = Number(match[2]);
  const key = `fanoutJob:${jobToken}:${slot}`;

  const selectors = [
    '#prompt-textarea[contenteditable="true"]',
    'div#prompt-textarea.ProseMirror',
    'div.ProseMirror[contenteditable="true"]',
    'textarea#prompt-textarea',
    'textarea[data-id="root"]',
  ];

  function isUsable(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 40 && rect.height > 20 && !element.hasAttribute('disabled');
  }

  function findEditor() {
    for (const selector of selectors) {
      const candidates = document.querySelectorAll(selector);
      for (const candidate of candidates) {
        if (isUsable(candidate)) return candidate;
      }
    }
    return null;
  }

  function waitForEditor(timeoutMs = 30000) {
    return new Promise((resolve) => {
      const existing = findEditor();
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const editor = findEditor();
        if (editor) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(editor);
        }
      });

      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const timeout = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillContentEditable(editor, text) {
    editor.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {
      inserted = false;
    }

    if (!inserted || !editor.textContent?.trim()) {
      editor.replaceChildren();
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (index > 0) editor.append(document.createElement('br'));
        editor.append(document.createTextNode(lines[index]));
      }
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text,
      }));
    }

    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillEditor(editor, text) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      editor.focus();
      setNativeValue(editor, text);
      return;
    }
    fillContentEditable(editor, text);
  }

  // Eight tiled sessions are the same site under the same account, so the tab and
  // title bar are identical everywhere. Stamp the slot and its variance on the
  // front of the title. ChatGPT rewrites the title on every navigation, so this
  // has to keep re-applying rather than set it once.
  function labelWindow(text) {
    const prefix = `${text} · `;
    const apply = () => {
      if (!document.title.startsWith(prefix)) document.title = prefix + document.title;
    };

    apply();
    new MutationObserver(apply).observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function cleanUrl() {
    try {
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    } catch {
      // Cosmetic only.
    }
  }

  function showFallback(prompt) {
    const panel = document.createElement('aside');
    panel.setAttribute('data-fanout-fallback', '');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      width: 'min(420px, calc(100vw - 32px))',
      maxHeight: '60vh',
      overflow: 'auto',
      padding: '14px',
      border: '1px solid rgba(127,127,127,.35)',
      borderRadius: '12px',
      background: 'Canvas',
      color: 'CanvasText',
      boxShadow: '0 12px 40px rgba(0,0,0,.28)',
      font: '13px/1.4 system-ui, sans-serif',
    });

    const title = document.createElement('strong');
    title.textContent = 'Fanout could not find the ChatGPT prompt box.';

    const body = document.createElement('pre');
    body.textContent = prompt;
    Object.assign(body.style, {
      whiteSpace: 'pre-wrap',
      maxHeight: '36vh',
      overflow: 'auto',
      padding: '9px',
      borderRadius: '8px',
      background: 'color-mix(in srgb, CanvasText 8%, Canvas)',
      userSelect: 'text',
    });

    const button = document.createElement('button');
    button.textContent = 'Copy prompt';
    Object.assign(button.style, {
      border: '0',
      borderRadius: '8px',
      padding: '8px 11px',
      cursor: 'pointer',
      background: 'CanvasText',
      color: 'Canvas',
      fontWeight: '700',
    });
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(prompt);
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Copy blocked — select the text above';
      }
    });

    panel.append(title, body, button);
    document.body.append(panel);
  }

  async function run() {
    const stored = await api.storage.local.get(key);
    const record = stored[key];
    const prompt = record?.prompt;
    if (typeof prompt !== 'string') {
      cleanUrl();
      return;
    }

    // Label first: it is useful even if the composer never turns up.
    const position = record.slot ?? slot + 1;
    labelWindow(record.label ? `${position} · ${record.label}` : `Session ${position}`);

    // Keep the record until the prompt is actually in the composer. Removing it
    // first meant a login redirect or reload during the wait lost the prompt for
    // good; on failure the 15-minute TTL still clears it.
    const editor = await waitForEditor();
    if (editor) {
      fillEditor(editor, prompt);
      editor.focus();
      await api.storage.local.remove(key);
      cleanUrl();
      return;
    }

    showFallback(prompt);
  }

  void run();
})();
