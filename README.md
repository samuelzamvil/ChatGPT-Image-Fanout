# ChatGPT Image Fanout

A small local-only browser extension for opening **2–8 independent ChatGPT new-chat sessions** from one image concept.

> **⚠️ Completely experimental.** This is a hobby project that drives ChatGPT's web UI, not a supported integration. Expect it to break, and expect ChatGPT to rate-limit you if you generate images too quickly across the fanned-out sessions — see [Rate limits](#rate-limits) below.

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
- **Detachable window** so the form survives clicking into another tab.
- One-click preset fill for empty variance fields.
- Warns before launching sessions that would be identical.
- `Ctrl`/`Cmd` + `Enter` to launch.
- Remembers the last form locally.
- No API key, server, analytics, or network calls by the extension.
- Chrome and Firefox builds from a single source.

## Build

Source lives in `src/` and is shared by both browsers; only `manifests/*.json` differ.

```sh
npm run build          # -> dist/chrome and dist/firefox
npm run build:chrome   # one target
npm run package        # also writes dist/*.zip
```

`dist/` is generated and git-ignored — run a build before loading the extension.

## Releases

Every push to `main` and every pull request packages both targets in CI; the zips
are attached to that run as the `extension-zips` artifact.

Pushing a `v*` tag publishes a GitHub Release instead, with
`chatgpt-image-fanout-chrome-<tag>.zip` and the Firefox equivalent as assets. The
tag must match the version in `package.json` and both manifests, so bump those
first:

```sh
git tag v0.2.1 && git push origin v0.2.1
```

A mismatched tag fails the release job before anything is published.

## Install in Chrome / Chromium

1. `npm run build:chrome`
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the `dist/chrome` folder.
6. Pin **ChatGPT Image Fanout** to the toolbar.

## Install in Firefox for testing

1. `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on**.
4. Select `manifest.json` inside `dist/firefox`.

A permanent Firefox installation requires signing through Mozilla Add-ons.

## Use

1. Click the extension icon.
2. Optionally click **Open in window** to detach the form — the toolbar popup closes whenever you click away, which loses your place in a long form. The detached window stays put and stays open across launches.
3. Enter the shared concept.
4. Select 2–8 sessions.
5. Give each session a distinct variance instruction, or click **Fill empty** to drop in presets.
6. Choose **Tiled windows** or **Tabs**.
7. Click **Launch** (or press `Ctrl`/`Cmd` + `Enter`).
8. Review each loaded prompt and submit it in that panel.

Sessions left without a variance instruction collapse to the bare shared concept and would be identical to each other, so the first Launch click warns and marks them; click again to proceed anyway.

## Tests

```sh
npm install
npm run build && npm test
```

Loads the built Chrome extension in headless Chromium and exercises the popup, the background worker, and the messaging between them. Chrome and Firefox diverge on extension APIs in ways that are invisible without actually running them — `runtime.onMessage` accepts a returned Promise in Firefox and silently drops it in Chrome — so these checks guard that class of bug specifically.

Set `CHROMIUM_PATH` to reuse an existing Chromium binary instead of Playwright's own download.

## Rate limits

Fanning out is the whole point of this extension, and it is also the fastest way to hit ChatGPT's limits. Every panel runs on the same signed-in account, so eight sessions burn through your image quota roughly eight times as fast as one. Submitting them back to back will get you rate-limited, and image generation is limited more aggressively than plain chat.

Practical notes:

- Start with fewer sessions than you think you need. 3–4 is usually enough variance.
- Stagger the submits instead of clicking through all eight panels at once.
- A rate limit hits the account, not the extension — once you are limited, the normal ChatGPT UI is limited too, and waiting is the only fix.
- The extension never submits anything on its own, so the pace is entirely yours to control.

## Terms of service

I asked ChatGPT whether this violates the OpenAI terms of service and he said no, so we're good.

> **Claude, butting in (nobody asked, but I was told to own it):** for the record, "I asked the defendant and he said it was fine" is not a recognized legal standard. My read happens to match his, though: this fills a text box in a browser you're already signed into. Nothing gets submitted, no limits get dodged, no API gets touched. If you want an answer from someone who isn't a language model, the [OpenAI terms](https://openai.com/policies/terms-of-use) are right there.

## Limitations

- ChatGPT's web interface is not a public automation API. A future DOM change may require updating the prompt-box selectors in `src/content.js`.
- Native Chrome/Firefox split view is two-way and is not consistently controllable through cross-browser extension APIs. This extension tiles real browser windows instead.
- Popup-window placement may differ slightly because browser frame dimensions and operating-system window rules vary. If the browser rejects a computed position — which happens on some multi-monitor layouts — that session still opens, just at the default position, and the status line says how many.
- All panels use the currently signed-in ChatGPT account and its normal usage limits — see [Rate limits](#rate-limits).

## Privacy

The extension stores the current form and short-lived launch jobs in browser local extension storage. A launch job is deleted once its prompt reaches the composer, and any leftovers are cleared after approximately 15 minutes. Nothing is sent anywhere except when you manually submit a prompt to ChatGPT.

## Files

- `src/popup.html`, `src/popup.js`, `src/popup.css`: form UI.
- `src/background.js`: stores jobs, opens tabs/windows, manages the detached window.
- `src/content.js`: fills the ChatGPT composer.
- `manifests/chrome.json`, `manifests/firefox.json`: per-browser manifests.
- `build.mjs`: assembles `dist/<target>` from `src/` plus the matching manifest.

## License

MIT
