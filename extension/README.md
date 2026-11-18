# KSU Agent — Chrome extension

Step 3 of the Phase 2 plan ([ADR 0001](../docs/adr/0001-phase2-data-access.md)). This is
the skeleton: it answers the website's `ping`, holds the tool catalogue and the consent
check, and reads **nothing** yet. The page readers arrive in Step 4.

TypeScript, Manifest V3, no bundler. `tsc` compiles `src/` to `dist/` as ES modules.

## Build

```bash
cd extension
npm install
npm run build
```

`npm run build` runs `tsc` and writes `dist/`. The manifest loads `dist/background.js`,
so build before loading the extension. `node_modules/` and `dist/` are git-ignored.

## Test

```bash
cd extension
npm test
```

Vitest covers the pure message handler (`src/handler.ts`): origin checks, `ping`,
`run_tool`, and malformed messages.

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
| `storage` | Remembers which data categories the student has allowed, so consent survives a browser restart. It holds category names only, never academic values. |
| `host_permissions`: `https://edugate.ksu.edu.sa/*` | Reads the Edugate pages the student is already logged in to, in the student's own session. |
| `host_permissions`: `https://lms.ksu.edu.sa/*` | Same, for the LMS (Blackboard Ultra) pages. |
| `externally_connectable`: `http://localhost:3000/*`, `https://ksu-agent-web.onrender.com/*` | Lets the KSU Agent website send messages to the extension. Every other origin is refused, and `sender.origin` is checked on every message. |

There is no `cookies`, no `webRequest`, no `<all_urls>`, and no content script.

## What it does today

- Answers `{ "kind": "ping" }` from the KSU Agent website with
  `{ "kind": "pong", "version": "0.1.0", "categories_allowed": [] }`.
- Answers `{ "kind": "run_tool" }` with `no_consent`, because consent is wired in Step 5.
- Never returns cookies, page HTML, or any field a tool does not list.

The message shapes and error codes are in
[the API contract](../docs/api-contract.md), section "Phase 2 — agreed, not implemented
yet".
