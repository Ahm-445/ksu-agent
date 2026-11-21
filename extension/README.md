# KSU Agent — Chrome extension

Step 5 of the Phase 2 plan ([ADR 0001](../docs/adr/0001-phase2-data-access.md)): the
trust features. The popup is the full consent screen — one switch per data category,
the local activity history and Disconnect — and the service worker records what it read,
shows a reading badge while a tool runs and clears the badge when it finishes.

TypeScript, Manifest V3. `tsc` type-checks; esbuild bundles `src/` into `dist/`.

## Build

```bash
cd extension
npm install
npm run build
```

`npm run build` deletes `dist/`, type-checks with `tsc --noEmit`, then bundles three
files with esbuild: the content script and the popup as IIFE scripts, the service worker
as an ES module. The content script is one self-contained file, so the extension needs no
`web_accessible_resources` and Edugate pages cannot detect it. `node_modules/` and
`dist/` are git-ignored.

## Test

```bash
cd extension
npm test
```

Vitest covers the pure message handler (`src/handler.ts`), the service worker's tool
runner, the content script's message plumbing, and the GPA reader against the fake
academic record page in `test/fixtures/edugate/` (jsdom).

## Load it in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `extension/` folder — the one that holds
   `manifest.json`, not `extension/dist/`.
5. Reload the page after any rebuild.

Chrome only allows one unpacked copy per extension ID, so remove an older copy before
loading a new one.

## Fixed extension ID

```
efapbngaolcipklnchgbgmompcaoiiig
```

The ID comes from the `key` field in `manifest.json` (the base64 public key of an RSA 2048
key pair), so every machine gets the same ID. The private key is **not** in the repository
and is not needed to load the extension unpacked; keep it only if the extension is ever
packaged and published. The website needs the ID in `NEXT_PUBLIC_EXTENSION_ID`.

## Permissions

| Permission | Why it is needed |
| :--- | :--- |
| `storage` | Remembers which data categories the student has allowed, and the local activity history: category names, tool names, times and outcomes only, never academic values. Disconnect deletes both. |
| `host_permissions`: `https://edugate.ksu.edu.sa/*` | Reads the Edugate pages the student is already logged in to, in the student's own session. |
| `host_permissions`: `https://lms.ksu.edu.sa/*` | Same, for the LMS (Blackboard Ultra) pages. |
| `externally_connectable`: `http://localhost:3000/*`, `https://ksu-agent-web.onrender.com/*` | Lets the KSU Agent website send messages to the extension. Every other origin is refused, and `sender.origin` is checked on every message. |

There is no `cookies`, no `webRequest`, and no `<all_urls>`. The one content script runs
on `https://edugate.ksu.edu.sa/*` only, and the extension declares no
`web_accessible_resources`, so a page cannot ask the extension for its files.

## What it does today

- Answers `{ "kind": "ping" }` from the KSU Agent website with
  `{ "kind": "pong", "version": "0.1.0", "categories_allowed": [] }`.
- Shows the consent screen: one switch per category (`grades`, `schedule`,
  `attendance`, `plan`, `lms`), all off until the student turns one on, each with a
  one-line description in Arabic and English. A change is written to `storage` and added
  to the history as a `consent` entry.
- Shows the newest 20 history entries, newest first, as text lines such as
  `قراءة المعدل — نجحت — 14:05` / `Read GPA — ok — 14:05`. The history holds
  category names, tool names, times and outcomes only; no value a tool read is stored.
- Offers Disconnect behind an inline confirmation; confirming removes both stored keys.
- Answers `{ "kind": "run_tool" }` with `no_consent` until the student allows the
  category, and records that refusal as a `blocked` entry.
- Shows the badge `…` while a tool reads and clears it when the read finishes, including
  on error and on timeout.
- For an allowed `get_gpa`, asks the open Edugate tab's content script to read the
  academic record page in the student's own session, and returns only the five contract
  fields. No Edugate tab, no content script in it, or a page that does not match the page
  map is reported as `not_logged_in` / `page_unreadable`, never guessed.
- Never returns cookies, page HTML, or any field a tool does not list.

The message shapes and error codes are in
[the API contract](../docs/api-contract.md), section "Phase 2 — agreed, not implemented
yet".
