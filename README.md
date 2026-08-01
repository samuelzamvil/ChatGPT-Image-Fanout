# ChatGPT Image Fanout

A small local-only browser extension for opening **2–8 independent ChatGPT new-chat sessions** from one image concept.

Each session receives:

1. The same shared concept.
2. Its own variance instruction.
3. An explicit instruction to treat the result as an independent first interpretation.

The extension fills the ChatGPT composer but **does not submit the prompt**.

## Features

- 2–8 sessions.
- Separate variance field for every session.
- Tiled popup windows across the current monitor.
- Alternative tab mode.
- Remembers the last form locally.
- No API key, server, analytics, or network calls by the extension.
- Chrome and Firefox builds.

## Install in Chrome / Chromium

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `chrome` folder.
5. Pin **ChatGPT Image Fanout** to the toolbar.

Chrome can also load the contents of `chatgpt-image-fanout-chrome.zip` after you unzip it.

## Install in Firefox for testing

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `manifest.json` inside the `firefox` folder.

A permanent Firefox installation requires signing through Mozilla Add-ons.

## Use

1. Click the extension icon.
2. Enter the shared concept.
3. Select 2–8 sessions.
4. Give each session a distinct variance instruction.
5. Choose **Tiled windows** or **Tabs**.
6. Click **Launch**.
7. Review each loaded prompt and submit it in that panel.

## Limitations

- ChatGPT's web interface is not a public automation API. A future DOM change may require updating the prompt-box selectors in `content.js`.
- Native Chrome/Firefox split view is two-way and is not consistently controllable through cross-browser extension APIs. This extension tiles real browser windows instead.
- Popup-window placement may differ slightly because browser frame dimensions and operating-system window rules vary.
- All panels use the currently signed-in ChatGPT account and its normal usage limits.

## Privacy

The extension stores the current form and short-lived launch jobs in browser local extension storage. Launch jobs are deleted after all panels consume them or after approximately 15 minutes. Nothing is sent anywhere except when you manually submit a prompt to ChatGPT.

## Files

- `popup.html`, `popup.js`, `popup.css`: form UI.
- `background.js`: stores jobs and opens tabs/windows.
- `content.js`: fills the ChatGPT composer.
- `manifest.json`: browser-specific extension manifest.

## License

MIT
