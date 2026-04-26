# CLAUDE.md — Rules of Engagement

This file governs **how** backlog items in [BACKLOG.md](BACKLOG.md) get built and verified. Read it before touching code. If a rule here conflicts with a user request in chat, surface the conflict — don't silently break a rule.

---

## 1. Architecture invariants — do not change without explicit approval

- **Single-page vanilla JS.** No framework (React, Vue, Svelte, etc.). No bundler. No TypeScript compile step. No ESM modules — classic `<script>` tags so `onclick="foo()"` works against top-level function declarations.
- **Static files** in `public/`:
  - `index.html` — markup only
  - `styles.css` — all styling
  - `app.js` — entry, globals, shared helpers, persistence wrappers, the `<video>` rAF loop, view router, keyboard router
  - `views/atlas.js` — Atlas tile-board view (home/library)
  - `views/orbit.js` — Orbit circular-timeline view (practice)

  All three JS files load as classic `<script>` tags in `index.html` in the order listed (no `type="module"`, no bundler, no TypeScript). Top-level function declarations and the `window.AtlasView` / `window.OrbitView` namespaces are how views expose their entry points to `app.js` and to inline `onclick=` handlers. Do not split further (e.g. `views/notes.js`) unless any single file exceeds ~2500 lines *and* the user approves.
- **Storage = flat JSON** in `data/`. No database. No ORM. Reads/writes go through `fs.promises`. Fixtures at `data/.fixtures/pre-<taskId>/` are checked in via a `!data/.fixtures/` exception in `.gitignore`.
- **Server stays Express 5 + `youtube-dl-exec`.** No extra deps unless a backlog item explicitly calls for one and the user approves.
- **Client-side state is the source of truth during a session.** Persist on meaningful events (create, edit, delete, pause), not on every keystroke — debounce text inputs 400ms.

If a task seems to require breaking one of these, stop and ask.

---

## 2. Task workflow — one backlog item per PR

1. Pick the top unchecked item in [BACKLOG.md](BACKLOG.md). Do not work ahead — Tier 2 assumes Tier 1 shipped.
2. Mark it `[~]` when you start.
3. Implement against the rules in §3–§6 below.
4. Run the manual test checklist (§7) for that item's category.
5. Update [README.md](README.md) if user-facing behavior or shortcuts changed.
6. Mark it `[x]`. Commit with a message that names the backlog ID, e.g. `T1.1: segment labels`.

One backlog item = one PR. Don't bundle.

---

## 3. Schema migrations

Every change to `library.json`, `segments.json`, or a new `data/*.json` file **must**:

1. **Be additive.** New fields are optional (`field?:`). Never rename or remove existing fields in the same change.
2. **Load old data without throwing.** On read, missing fields get explicit defaults in a single normalization function (one per file, e.g. `normalizeSegment(raw)`). Do not sprinkle `?? default` across the codebase.
3. **Round-trip test manually before commit.** Keep a local pre-change snapshot of `data/*.json` at `data/.fixtures/pre-<taskId>/`, load the app against it, verify nothing is lost, save, diff. `data/` is gitignored — fixtures are a per-clone local tool, not a shared artifact. Delete the snapshot directory after the task lands.
4. **Never write partial objects.** Always write the whole normalized file atomically: write to `*.tmp`, then rename.

If a schema change is genuinely breaking, it's a Tier 3 conversation — stop and ask.

---

## 4. UI rules

- **Keyboard-first.** Every new interactive control needs a keyboard path. Document new shortcuts in [README.md](README.md) and avoid collisions with the existing set (`I`, `O`, `[`, `]`, `Space`, `←`, `→`, `,`, `.`, `L`).
- **No modal dialogs** for primary flows. Inline editing + ephemeral toasts only.
- **Accessibility minimums:** every button has a visible label or `aria-label`; every input has an associated `<label>` or `aria-label`; focus outlines stay visible.
- **Color is never the only signal.** Status pills (T2.2) need an icon or text in addition to color.
- **No layout shift on data load.** Reserve space with skeletons or min-heights so the timeline doesn't jump.

---

## 5. Code style

- Plain ES2022. No TypeScript. No JSX.
- Functions over classes unless state genuinely benefits from `this`.
- One named `export`/`window.*` per concept; avoid god-objects.
- No comments that restate code. Only comment the *why* when non-obvious.
- No lodash / utility libs. The standard library is enough for this scope.
- Keep new CSS inside the existing `<style>` block. Group by component, not by property.

---

## 6. Persistence and endpoints

- Every mutation goes through an Express endpoint that writes JSON. The client never writes to disk directly (obviously — it can't).
- New endpoints follow the existing convention: `POST /api/<resource>` for mutations, `GET /api/<resource>` for reads. Return the updated resource, not just `{ ok: true }`.
- Validate inputs server-side. Reject `out <= in`, out-of-range speeds, unknown statuses, non-string tags.
- Concurrent writes: the server reads → mutates → writes. If two requests race, last write wins — that's acceptable for a single-user local app. Do not add locking.

---

## 7. Testing — we have no framework, so testing is explicit and manual

For every PR, run the checklist for the task's tier, and record results in the PR description.

### 7a. Smoke checklist (every PR, every tier)

Run before commit. If any step fails, the PR is not done.

1. `npm start` boots without errors.
2. Load `http://localhost:3000` — library renders, no console errors.
3. Load a previously-downloaded video from the library — plays, segments restore.
4. Create a new segment with `I` / `O`, toggle LOOP, confirm it loops.
5. Refresh the page — segments from step 4 persist.
6. Stop the server with `npm stop`. No orphaned `server.pid`.

### 7b. Tier 1 checklist additions

- **T1.1 labels:** create segment → rename → refresh → name persists. Empty label falls back to numeric display. Enter commits, Esc cancels.
- **T1.2 notes:** type notes → blur → refresh → notes persist. Textarea does not swallow global shortcuts (type `I` in a note, segment is *not* marked).
- **T1.3 speed:** set segment A to 0.75×, segment B to 1.25×. Switching between them restores the correct speed. Refresh — still correct.
- **T1.4 edit in/out:** drag a handle, numeric input updates. Type invalid value (out ≤ in) — rejected with visible error. Undo via Esc returns to prior value.

### 7c. Tier 2 checklist additions

- **T2.1 tags:** add tag to a video, save, refresh, tag persists on the library entry. Autocomplete pulls from existing video tags (case-insensitive). Collection query returns correct set (dims non-matching library entries).
- **T2.2 status:** cycle states with click and with keyboard. Filter "needs work" excludes mastered. Pill has both color and text/icon.
- **T2.3 sessions:** start loop, let it run 30s, pause. `data/sessions.json` has one entry with `durationSec ≈ 30`. Crash-test: kill server mid-loop, restart — no corrupt JSON.
- **T2.4 search:** typing filters in under 100ms for a library of 50 items. Filter chips combine with AND semantics. Filter state survives refresh via `localStorage`.

### 7d. Optional: `npm run smoke` (backlog item X.2)

Once X.2 lands, it runs steps 1, 2, 6 of §7a automatically. Manual steps still required for UI behavior.

---

## 8. What "done" means

A backlog item is done when **all** of these hold:

- Feature works per its acceptance criteria in [BACKLOG.md](BACKLOG.md).
- Relevant checklist in §7 passes, results pasted in the PR.
- Schema change (if any) follows §3.
- Old `data/*.json` files from before the change still load.
- [README.md](README.md) updated if user-visible behavior or shortcuts changed.
- Backlog item ticked `[x]`.

Anything less is `[~]`, not `[x]`.

---

## 9. When in doubt

- Prefer the smallest change that moves a backlog item to `[x]`.
- If a task reveals a latent bug outside its scope, flag it — don't fix it in the same PR.
- If you discover a rule here is wrong or missing, propose an edit to this file as part of the PR.
