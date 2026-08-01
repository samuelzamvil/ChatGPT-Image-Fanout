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
- **Labelled windows** — each session's title bar carries its slot and variance, so tiled panels are tellable apart.
- Tiled popup windows with a **choice of column count** and tiling across the whole screen or just the current window. The automatic grid is chosen against the browser's minimum window size, so it never asks for tiles the browser will refuse to shrink to.
- Alternative tab mode.
- **Detachable window** so the form survives clicking into another tab.
- **Saved sets** — name and reload a whole concept plus its variances.
- **Bulk paste** a list of variances instead of filling eight fields by hand.
- One-click preset fill for empty variance fields.
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

Releases are cut from the version in the manifests, not from a manual tag. When a
commit lands on `main`, CI looks for a release named `v<version>`; if there isn't
one, it tags that commit and publishes a GitHub Release with
`chatgpt-image-fanout-chrome-v<version>.zip` and the Firefox equivalent attached.

So publishing is a version bump:

```sh
# bump "version" in package.json, manifests/chrome.json, manifests/firefox.json
git commit -am "Release 0.2.1" && git push
```

Merges that don't touch the version publish nothing — the release for that
version already exists. The three files have to agree on the version or the job
fails before publishing anything. Pushing a `v*` tag by hand still works and
takes the same path.

Every push to `main` and every pull request also packages both targets as the
`extension-zips` workflow artifact, which is how you get a build of a commit that
isn't released.

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
5. Give each session a distinct variance instruction, or click **Fill empty** for presets or **Paste list…** for a list you already have.
6. Choose **Tiled windows** or **Tabs**, and for windows pick the column count and whether to tile across the screen or the current window.
7. Click **Launch** (or press `Ctrl`/`Cmd` + `Enter`).
8. Review each loaded prompt and submit it in that panel.

Launch always launches. A session left without a variance instruction collapses to the bare shared concept, which is sometimes exactly what you want as a control.

### Telling the windows apart

Every session is the same site under the same account, so tiled panels are otherwise indistinguishable. Each window's title is prefixed with its slot number and the first clause of its variance — `3 · tactile handmade collage · ChatGPT`. Sessions launched without a variance fall back to `Session 3`. ChatGPT rewrites the title as you navigate, so the label is re-applied rather than set once.

### Saved sets

**Save…** stores the shared concept, the session count, the direction label, and every variance instruction under a name; picking that name from **Saved sets** loads it back. Saving under an existing name overwrites it. Window mode and tiling stay as standing preferences and are deliberately not part of a set — they describe your screen, not the concept.

### Bulk paste

**Paste list…** takes one variance per line. If the pasted text contains a line that is just `---`, entries are split on those rules instead, so a single variance can span several lines. The session count follows the list length; anything beyond it stays in memory and comes back if you raise the count again.

### Tiling

Neither browser will shrink a window below roughly 500×340. Ask for less and you get a minimum-size window at the requested position — which is why a grid finer than the screen can hold overlaps instead of tiling, and why eight sessions on a 1440-wide laptop cannot tile no matter how the grid is arranged.

**Tile columns** is `Auto` by default, which scores every column count against that minimum and picks the layout that fits with the least wasted space and the squarest tiles. On a 1920×1080 screen that is 2 columns for 2–4 sessions, 3 for 6, and 3×3 for 8 — a 4×2 grid would need 480px-wide windows, which the browser declines. Pin it to a fixed number to override; an explicit choice is honoured even when it does not fit, and the status line says so.

**Tile across** chooses between the whole monitor and the bounds of the current browser window, which is the useful option when the browser occupies half an ultrawide.

The status line after a launch reports what actually happened: the grid used, whether the screen was too small to hold the sessions at minimum size, and whether any window refused the position it was given.

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
- The window label is cosmetic and lives only for that page load. Reloading a labelled session clears it, because the launch job it came from is already gone.
- Native Chrome/Firefox split view is two-way and is not consistently controllable through cross-browser extension APIs. This extension tiles real browser windows instead.
- Window placement is a request, not a guarantee. `windows.create` reports the bounds you asked for and then lets the platform decide, so the extension re-asserts each position with `windows.update` and checks the result afterwards rather than trusting the call. A tiling desktop or a window manager that overrides application placement will still win; the sessions open regardless and the status line says how many drifted.
- All panels use the currently signed-in ChatGPT account and its normal usage limits — see [Rate limits](#rate-limits).

## Privacy

The extension stores the current form, your saved sets, and short-lived launch jobs in browser local extension storage. A launch job is deleted once its prompt reaches the composer, and any leftovers are cleared after approximately 15 minutes. Saved sets persist until you delete them. Nothing is sent anywhere except when you manually submit a prompt to ChatGPT.

## Files

- `src/popup.html`, `src/popup.js`, `src/popup.css`: form UI.
- `src/background.js`: stores jobs, computes the tiling grid, opens tabs/windows, manages the detached window.
- `src/content.js`: labels the window and fills the ChatGPT composer.
- `manifests/chrome.json`, `manifests/firefox.json`: per-browser manifests.
- `build.mjs`: assembles `dist/<target>` from `src/` plus the matching manifest.

## License

MIT
