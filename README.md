# Autheo Close Desk

Reconcile an apartment equity raise before closing.

Close Desk is for multifamily sponsors who raise outside investor equity to buy apartment communities, and
for the operations person who has to get the ownership register right before closing. It compares three CSV
files, shows what does not match, and produces a reviewed register export for the fund administrator.

| Question | File |
| --- | --- |
| 1. Did they sign? | Subscription records |
| 2. Did their money clear? | Bank or escrow records |
| 3. How many LLC units did the sponsor approve? | Approved allocations |

Close Desk is an off-chain reconciliation tool. It never moves money, issues units or initiates a refund,
and its output is a reviewed register export for your administrator, not the official legal register.

## The pilot runs entirely in the browser

The app is a static site. The host serves HTML, JavaScript, CSS, one font and the sample CSVs. Reading,
parsing, column mapping, matching, exception review, confirmation and CSV generation all happen in the open
browser tab, in memory.

- There is no server runtime, API route, server action, database, cloud storage or sign-in.
- Nothing is written to `localStorage`, `sessionStorage`, IndexedDB, the Cache API or cookies, and there is
  no service worker.
- There are no analytics, session replay, remote error reporting or third-party scripts. The font
  (`@fontsource-variable/inter`), icons and sample files are bundled.
- Downloads are built in the tab as `Blob` URLs. They are revoked by **Clear session** and after 60 seconds.
- A refresh, or closing the tab, ends the session. Nothing is restored.
- After the workspace has loaded, the whole workflow makes no network request at all, so it also works
  offline. Links inside the app do not prefetch, and "Column details" opens the file guide in a new tab.

A Content-Security-Policy restricts scripts, styles, fonts and connections to the app's own origin and
forbids form submission, frames and workers. It ships twice: as a `<meta>` tag in every page (so it holds
even if the host drops response headers) and as response headers (`security-headers.json` is the single
source for the meta tag, `scripts/serve.mjs` and `vercel.json`).

The earlier build had sign-in (Clerk), PostgreSQL storage and server uploads. All of that was removed for
the pilot and is recoverable from commit `935cd1d`. Because there is no sign-in, anyone with the URL can open
the app; there is nothing on the server for them to see, and the only data the site ships is the synthetic
sample deal.

### How each claim is tested

The privacy sentence in the UI ("Your files are processed in this browser. They aren't sent to Autheo or
stored on our servers.") is backed by these tests, which run against the production build:

| Claim | Test |
| --- | --- |
| No request is made between selecting files and downloading the exports; no request ever carries a unique marker placed in the file contents, file names, deal name and review notes | `tests/e2e/privacy.spec.ts` "nothing is requested…" |
| Nothing loads from another origin; no third-party script | `privacy.spec.ts` "the app loads nothing from another origin…" |
| The network recorder would have seen a request, and the page cannot reach another origin | `privacy.spec.ts` "control: …" |
| The in-page policy works when the host sends no security headers | `privacy.spec.ts` "the policy inside the page…" |
| The bundled server answers only GET and HEAD; the legacy API paths are gone | `privacy.spec.ts` "the server refuses anything that could carry data" |
| The full sample workflow runs with the browser offline and exports the known-good register | `privacy.spec.ts` "offline: …" |
| A refresh starts a new session; storage, cookies, caches, IndexedDB and service workers are empty | `privacy.spec.ts` "a refresh starts a new session…" |
| Another tab does not see the session | `privacy.spec.ts` "a second tab…" |
| Clear session resets files, mappings, decisions, the confirmation and download references | `privacy.spec.ts` "Clear session resets…" |
| Source code uses no storage, network or worker API, and the repo has no API route or server package | `tests/unit/browser-only.test.ts` |

## Screens

| Route | What it is |
| --- | --- |
| `/` | What the product is, the three questions, the two calls to action, the $100,000 / $90,000 example, and a small "Custom tokenization · Coming soon" section |
| `/reconcile` | The workspace: **Select files → Review matches → Resolve exceptions → Export** |
| `/guide` | Accepted columns for each file, the matching rules, and the sample CSVs |
| `/tokenization` | Information only. No form, no wallet, no files |

Workspace steps:

1. **Select files.** Three slots, one per question. Each selected file is checked and previewed first: row
   counts, valid and invalid rows with reasons, totals, the first rows, and a column mapping when the headers
   differ. Nothing enters the workspace until you choose "Add files". A second file for a slot adds
   corrections; rows already present are not counted twice, and a row that changes an existing record goes to
   review instead of overwriting it.
2. **Review matches.** Signed subscriptions, net cleared funds and approved allocations as three separate
   totals, and a searchable, sortable table with one row per subscription and share class. "Needs review" is
   one click away.
3. **Resolve exceptions.** The three source records side by side, the difference in plain English, and one
   card per exception. Review items take a decision and a note. Blockers need corrected source data; a note
   cannot clear them.
4. **Export.** Confirm the reviewed snapshot, then download the reviewed register export and a separate
   exceptions report. The register is blocked while any blocker or undecided item remains; a draft exceptions
   report is always available. Any later change to files, mappings, deal settings or decisions cancels the
   confirmation.

### Matching rules

- A payment is matched on the subscription ID it carries, or on a payment reference that the subscription
  file states. Otherwise it stays unmatched until a reviewer links it to a named subscription. Nothing is
  matched on investor name or amount.
- Money is exact decimal arithmetic (`decimal.js`), never floating point.
- Split payments are summed. Pending and failed payments are shown and not counted. A reversal nets against
  the payment it names. A repeated transaction reference is counted once.
- Approved amounts and units come from the allocations file as supplied. Close Desk never calculates or
  changes them. Where cleared funds exceed the approved amount, the register carries the approved amount.
- Cells that a spreadsheet would run as a formula are neutralised in both downloads.

## Synthetic demo path

All sample data is invented (Riverbend Flats Apartments, USD). "Try with sample data" on the home page loads
the three sample files and shows a short walkthrough at the top of the workspace.

The guided case is **SUB-1012** (investor ref INV-0412, Class A): signed for $100,000.00, cleared
$100,000.00 across two wires (WIRE-20517 $60,000.00 and WIRE-20518 $40,000.00), approved by the sponsor for
$90,000.00 / 90 units. Close Desk explains the +$10,000.00 variance, requires a review decision, and exports
only the approved line: `INV-0412,Class A,SUB-1012,90000.00,90,USD`.

1. Home → **Try with sample data**. The workspace opens on Select files with the three sample files
   selected and previewed (subscriptions 50 rows, funding 63 rows with one invalid row and one exact repeat,
   allocations 48 rows). **Add 3 files and review matches**: 52 rows (39 ready, 6 needs review, 7 blocked);
   signed $5,090,000.00, net cleared $4,750,000.00, approved $5,000,000.00.
2. Open **SUB-1012**, read the difference, enter a review note, **Record review decision**.
3. Decide the other review items: exclude the duplicate portal payment `PORTAL-88120` on SUB-1034; link
   `WIRE-20338` to SUB-1038 and `WIRE-20341` to SUB-1041; document SUB-1044 and SUB-1048.
4. Open **Export**. The register is blocked and the reasons are listed. The draft exceptions report can be
   downloaded.
5. In the walkthrough choose **Select sample correction files**. The funding correction uses a bank portal's
   headers, so map **Amount** to "Credit Amount", then add both files.
6. In Resolve exceptions, choose **Use the version from the later file** on SUB-1019, SUB-1023, SUB-1031 and
   SUB-1046.
7. **Export** → tick the review statement → **Confirm reviewed snapshot** → download both files. The register
   has 47 lines totalling $5,000,000.00 and equals `fixtures/demo/expected/ownership-register.csv`.

Sample files live in `fixtures/demo/` and are regenerated with `npm run fixtures:generate`.

## Develop and test

Node 22 (`.nvmrc`).

```bash
npm ci
npm run dev          # http://localhost:3000
npm run lint
npm run typecheck
npm test             # unit and session tests (vitest)
npm run build        # static export to out/
npm run test:e2e     # browser tests against out/ (needs the build first)
npm run check        # all of the above, in order
npm run test:scale   # timing at the 20,000-row limit
```

The browser tests use an installed Google Chrome. To use Playwright's Chromium instead:
`npx playwright install chromium && E2E_BROWSER_CHANNEL=chromium npm run test:e2e`. They start
`scripts/serve.mjs` on `127.0.0.1:4173`, so that port must be free.

Layout:

- `src/domain/` – CSV parsing, normalisation, matching, exceptions, explanations, exports. No browser or
  Node APIs; shared by the app and the tests.
- `src/session/` – the in-memory session: staged files, mappings, records, decisions, confirmation.
- `src/components/workspace/` – the four workspace steps.
- `tests/unit`, `tests/session` – 98 tests, including the acceptance suite that compares the export with
  the known-good register. `tests/e2e` – 26 browser tests.

### Limits and the Web Worker decision

A file can be up to 4 MB, 20,000 data rows and 60 columns. Everything runs on the main thread; no Web Worker
is used (and the Content-Security-Policy forbids them). Measured with three 20,000-row files:

| | Node (`npm run test:scale`) | Chrome, production build |
| --- | --- | --- |
| Select and preview one file | 0.2–0.3 s | 0.4–0.5 s |
| Add three files and reconcile | 1.0 s | 1.2 s |
| Record a decision (reconciles again) | 0.6 s | 1.1 s |

The slowest step shows a busy state. At the sample deal's size every step is instant. If the row limit is
raised substantially, move `previewStaged` and `reconcile` into a bundled worker and add `worker-src 'self'`
to `security-headers.json`.

## Build output

`npm run build` (Next.js 16.4.6, `output: "export"`) prints:

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /guide
├ ○ /icon.svg
├ ○ /reconcile
└ ○ /tokenization

○  (Static)  prerendered as static content
```

and writes `out/` (1.7 MB, 54 files): `index.html`, `reconcile/index.html`, `guide/index.html`,
`tokenization/index.html`, `404.html`, `icon.svg`, and `_next/static/` (hashed JavaScript, CSS and the font).
There is no server bundle and no function. URLs end in a slash (`/reconcile/`).

## Deploy on Shadw.cloud

This has not been published. Two ways to serve it; the first is preferred.

### Option A: static site

Project → Settings → Build:

| Setting | Value |
| --- | --- |
| Framework | Next.js if it is detected, otherwise "Other" / static |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `out` |
| Root directory | repository root |
| Node version | 22 |

No environment variables are needed. `vercel.json` carries the response headers for hosts that read it.

### Option B: Node web service

Use this if the static deployment does not serve `out/` correctly or does not apply the headers.

| Setting | Value |
| --- | --- |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Start command | `npm start` |

`npm start` runs `scripts/serve.mjs`, a dependency-free static file server for `out/`. It listens on `$PORT`
(default 3000) and `$HOST` (default `0.0.0.0`), answers only GET and HEAD, sends the security headers, and
caches `/_next/static/` as immutable. It does not read request bodies and has no routes other than files.

### After the first deployment

1. Open `/`, `/reconcile/`, `/guide/`, `/tokenization/` and an unknown path (expect the 404 page).
2. `curl -sI https://<host>/reconcile/` and check for `content-security-policy`, `x-frame-options: DENY`,
   `referrer-policy: no-referrer` and `x-content-type-options: nosniff`.
3. In the browser's network panel, load `/reconcile/`, clear the log, run the sample walkthrough to both
   downloads, and confirm the log stays empty and that every earlier request went to the app's own host.
   The automated privacy tests run against the local production build, not the deployed URL.

### Not verified from this repository

These depend on the Shadw dashboard and could not be checked here:

- Whether Shadw's Next.js detection handles `output: "export"` on its own, or needs the output directory set
  to `out` by hand.
- Whether `vercel.json` `headers` are applied to a static deployment. If they are not, the in-page policy
  still applies (it cannot express `frame-ancestors`; `X-Frame-Options` would then also be missing), or use
  Option B.
- That **Speed Insights**, analytics, and any other feature that injects a script into pages are off for
  this project. They would add a third-party script to the reconciliation screen. The in-page policy only
  allows scripts from the app's own origin, but turn them off rather than rely on that.
- Whether preview protection or another access control should be placed in front of the pilot URL. The app
  has no sign-in of its own.
- Environment variables left from the earlier build (`DATABASE_URL`, the Clerk keys, and any other auth or
  storage settings) are unused and can be removed. Any database attached to the project is no longer read
  or written.
- Unknown paths should return `out/404.html` with status 404, and `/reconcile` should redirect to
  `/reconcile/`. Option B does both.
