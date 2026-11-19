# Autheo Close Desk

A private web app for the operations team of a multifamily real estate sponsor. It reconciles three CSV files from one apartment offering (subscriptions, funding, approved allocations) and produces a reviewed, frozen ownership register for the sponsor's administrator to accept.

**Workflow:** Create offering → Import three files → Reconcile → Review exceptions → Approve and freeze → Export.

**Out of scope for this pilot, by design:** bank APIs, wallets, token issuance, payment execution or refunds, L1, THEO, custody and live settlement. The export is a reviewed input for the administrator. It is not the official legal register.

## Contents

- [What it does](#what-it-does)
- [Local development](#local-development)
- [Demo walkthrough](#demo-walkthrough)
- [Roles and access](#roles-and-access)
- [Import files](#import-files)
- [Reconciliation rules](#reconciliation-rules)
- [Tests](#tests)
- [Deploying to Shadw.cloud](#deploying-to-shadwcloud)
- [Post-deploy smoke test](#post-deploy-smoke-test)
- [Security notes](#security-notes)
- [Project layout](#project-layout)

## What it does

| Area | Behaviour |
| --- | --- |
| Imports | CSV upload with column mapping, a preview, invalid rows, row counts and totals before anything is saved. Re-importing a file adds nothing. A changed record with an existing reference goes to review; it never overwrites the source. |
| Reconciliation | One row per subscription and share class. Matches only on subscription ID or an explicit payment reference. Counts cleared funding only, net of linked reversals. Never nets different currencies. Exact decimal arithmetic throughout. |
| Review | Side panel with the subscription, funding records and approved allocation side by side, the source file and row behind each figure, the variance, and earlier decisions. Reviewers document exceptions, link or exclude payments, and choose between conflicting source versions. Hard blockers need corrected source data. |
| Approval | Enforced on the server. Freezes a numbered snapshot holding the exact CSV bytes and their SHA-256. Later imports and decisions cannot change an approved version. |
| Export | Ownership register CSV and exception report CSV per approved version. Text cells that could be read as spreadsheet formulas are neutralised. |
| Audit | Imports, decisions, approvals and downloads are logged with identifiers and counts only, never investor records. |

## Local development

Requirements: Node.js 20.9 or newer (developed and verified on Node 22), npm 10, PostgreSQL 14 or newer (verified on 16).

```bash
# 1. Databases (one for development, one for tests)
sudo -u postgres psql -c "CREATE ROLE closedesk LOGIN PASSWORD 'closedesk'"
sudo -u postgres createdb -O closedesk closedesk_dev
sudo -u postgres createdb -O closedesk closedesk_test

# 2. Dependencies and environment
npm ci
cp .env.example .env.local
```

Edit `.env.local` for local use:

```bash
DATABASE_URL=postgres://closedesk:closedesk@127.0.0.1:5432/closedesk_dev
CLOSE_DESK_DEV_AUTH=1
APP_BASE_URL=http://localhost:3000
```

```bash
# 3. Schema, synthetic demo data, dev server
npm run db:migrate
npm run seed:demo -- --dev-users
npm run dev
```

Open <http://localhost:3000>. With `CLOSE_DESK_DEV_AUTH=1` and `NODE_ENV` other than `production`, `/dev/sign-in` lists three synthetic local users (administrator, reviewer, approver). That screen and its API do not exist in a production build, and setting the variable in production closes the app. To develop against Clerk instead, remove `CLOSE_DESK_DEV_AUTH` and set the two Clerk keys.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / production server (`next start`) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit and integration tests (needs the test database) |
| `npm run db:migrate` / `npm run db:status` | Apply / list migrations. Never run by the app itself. |
| `npm run user:invite -- --email <address> [--name "Full Name"] [--admin]` | Invite a user. This is how the first administrator is created. |
| `npm run seed:demo -- --reviewer <email> --approver <email>` | Load the synthetic demo offering for two users who are already invited. `--dev-users` creates local dev users instead. `--confirm` is required for a non-local database. |
| `npm run fixtures:generate` | Regenerate the synthetic fixtures |

## Demo walkthrough

`npm run seed:demo` loads **Riverbend Flats Apartments**, a fictional $5,000,000 offering, by importing the three example files through the same code path as the import screen. All data is invented: investor references are opaque codes, with no names, tax IDs or bank details. Demo data exists only after someone runs the seed command.

Starting position: 52 rows (39 ready, 6 need review, 7 blocked). Signed commitments $5,090,000.00, net cleared funding $4,750,000.00, approved allocations $5,000,000.00.

**Guided case, SUB-1012.** The investor signed for $100,000, sent two cleared wires (WIRE-20517 $60,000 and WIRE-20518 $40,000), and was approved for $90,000.

1. Sign in as the reviewer, open the offering, open **Reconciliation** and select **Needs review**.
2. Open SUB-1012. The panel shows requested $100,000.00, net cleared $100,000.00, approved $90,000.00, 90 units, and a variance of +$10,000.00, with the file and row behind each figure.
3. Write a note and select **Document exception**. The register carries $90,000.00 and 90 units from the allocations file. Close Desk does not initiate a refund.

**The other exceptions in the demo**

| Row | Exception | How it is cleared |
| --- | --- | --- |
| SUB-1034 | Possible duplicate payment, excess funding | Reviewer excludes PORTAL-88120 |
| SUB-1044 | Cleared funding, no allocation | Reviewer documents it. Not in the register. |
| SUB-1048 | Unsigned, no allocation | Reviewer documents it. Not in the register. |
| WIRE-20338 | Payment reference maps to no subscription | Reviewer links it to SUB-1038 |
| WIRE-20341 | Payment reference maps to two subscriptions | Reviewer links it to SUB-1041 |
| SUB-1019 | Unsigned with an approved allocation (blocker) | Import `corrections/subscriptions-corrections.csv`, then accept the newer record |
| SUB-1023 | Funding still pending (blocker) | Import `corrections/funding-corrections.csv`, then accept the newer record |
| SUB-1031 | Reversal points at an unknown transaction (blocker) | Same funding corrections file |
| SUB-1046 | Funding in CAD against a USD allocation (blocker) | Same funding corrections file |
| SUB-1036 | Allocation with no cleared funding (blocker) | Same funding corrections file (adds WIRE-20336) |

`funding-corrections.csv` uses a bank portal's column names. On the mapping step, set **Amount** to `Credit Amount` and **Payment reference** to `Wire Memo`; the other columns are matched automatically.

When everything is cleared, the approver opens **Approval and export**, reviews the close summary, and approves version 1: 47 register lines, $5,000,000.00 (Class A 3,349.5 units, $3,349,500.00; Class B 1,320.4 units, $1,650,500.00). The downloaded register matches `fixtures/demo/expected/ownership-register.csv` line for line. The export uses CRLF line endings; the fixture uses LF.

## Roles and access

Access is invitation-only. A person can use Close Desk only if a workspace administrator has invited their email address. There is no sign-up page, no default account and no demo login.

| Role | Scope | Can |
| --- | --- | --- |
| Workspace administrator | Whole workspace | Create offerings, invite and disable people, manage offering access, view every offering. Holds no reviewer or approver rights unless added to an offering. |
| Reviewer | One offering | Import files, record and revoke review decisions |
| Approver | One offering | Approve and freeze a close |

A person holds one role per offering, so the reviewer and the approver of a close are different people. Any member of an offering can view it and download its approved exports. Requests for an offering the user does not belong to return 404.

Every page, API route and download checks the session and the offering role on the server. A valid Clerk session whose verified email is not on the invitation list is refused (403 from the API, `/no-access` in the browser).

## Import files

Example files are in `fixtures/demo/` and can be downloaded in the app from **File guide**, which also explains each field.

| File | Required columns | Optional columns |
| --- | --- | --- |
| Subscriptions | `subscription_id`, `investor_ref`, `share_class`, `requested_amount`, `currency`, `signature_status` | `payment_reference` |
| Funding | `transaction_ref`, `amount`, `currency`, `settlement_status`, `settled_at`, and `subscription_id` or `payment_reference` | `original_transaction_ref` (the transaction a reversal reverses) |
| Approved allocations | `subscription_id`, `share_class`, `approved_amount`, `approved_units`, `currency` | |

Limits: CSV only, UTF-8, 4 MB, 20,000 rows, 60 columns. Column names do not have to match: the mapping step lets the operator pick the source column for each field and shows a preview before import. Files are parsed in memory and stored as rows in PostgreSQL. Nothing is written to the host filesystem.

## Reconciliation rules

- Money and units are decimal strings handled with `decimal.js`. No floating-point arithmetic. Approved units come from the allocations file only and are never derived from funded dollars.
- Funding matches a subscription by `subscription_id`, or by a `payment_reference` that maps to exactly one subscription, or by an explicit reviewer link. Nothing is matched by name or amount.
- Only cleared funding counts. A cleared reversal reduces funding only when it references a known, cleared original transaction in the same currency and on the same subscription, and reversals never exceed the original amount. Any other reversal is flagged as invalid and is not netted.
- Amounts in another currency are shown separately and never netted.
- **Blockers** need corrected source data: unsigned subscription with an allocation, unfunded allocation, partial funding, allocation above the commitment, allocation without a subscription, share class mismatch, currency mismatch, invalid reversal. A reviewer note cannot clear a blocker.
- **Review items** need a documented decision: excess funding, missing allocation, unsigned subscription without an allocation, possible duplicate, unmatched funding, ambiguous reference, conflicting source record.
- Source records are never edited. Decisions are stored separately, are append-only, and are tied to the facts they were made against. If the underlying figures change, the decision no longer applies and the exception reopens.
- Approval recomputes the reconciliation inside the approval transaction and refuses if anything is open or if the data changed since the approver loaded the summary.

## Tests

```bash
npm run lint
npm run typecheck
npm test          # 77 tests: 61 unit, 16 integration
npm run build
```

Integration tests call the real route handlers against PostgreSQL (`TEST_DATABASE_URL`, default `postgres://closedesk:closedesk@127.0.0.1:5432/closedesk_test`; the name must contain `test` because every table is truncated). Only the identity provider is replaced. They cover the five acceptance points:

1. An invited user imports the three sample files and reconciles the offering end to end. A visitor without a session, or with a session but no invitation, gets nothing.
2. Re-importing funding does not count a wire twice. Split payments, linked and invalid reversals, ambiguous and unmapped references, conflicting records, and the $10,000 variance behave as specified.
3. Open blockers and unreviewed exceptions prevent approval. A note cannot clear a blocker. Reviewer and approver permissions are separate. A user cannot reach another offering. An approved snapshot is byte-for-byte unchanged after later imports and decisions.
4. The exported register matches the known-good fixture by investor and share class, including units and totals, and line for line.
5. The production build passes (`npm run build`).

## Deploying to Shadw.cloud

This section separates what was verified locally, what was observed in a real Shadw build, and what must still be confirmed in the Shadw dashboard.

**Sources.** Shadw statements below come from its public pages as read on 2026-11-18: <https://shadw.cloud/docs/getting-started>, <https://shadw.cloud/docs/api-reference> and <https://shadw.cloud/llms.txt>. App statements were verified locally on Node 22.23.4, npm 10.9.9 and PostgreSQL 16.15. The first Shadw build of `main` ran on 2026-11-19; what its log showed is listed under [Observed on Shadw](#observed-on-shadw).

### Verified locally

| Item | Result |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` (`next build`). Passes with no database and no Clerk keys present. |
| Start | `npm start` (`next start`). Honours `PORT` (checked with `PORT=4123`) and listens on all interfaces. Defaults to 3000. |
| Runtime | Node.js 20.9 or newer (`engines` in `package.json`). `.nvmrc` names Node 22, the version this was verified on. |
| Migrations | `npm run db:migrate`. Separate command. The app never migrates at startup. |
| Fail closed | A production server without both Clerk keys, or with `CLOSE_DESK_DEV_AUTH=1`, returns 503 for every page and API route. The response text and the server log name the variable to fix, never a value. `/api/health` returns 503 with `{"status":"closed","reason":"auth_not_configured"}`. |
| Clerk | Against a temporary Clerk development instance and a production build: CLI invitation of the first administrator, invitation acceptance, invitations from the Team page, imports, approval, downloads, and refusal of a Clerk account that was not invited. |

### What Shadw documents

- Deploy from Git (dashboard **New Project**, paste a Git URL; or `POST https://api.shadw.cloud/v1/git/deploy`), from a zip upload, or from a container image.
- Framework detection covers Next.js. Shadw runs install and build and serves the output as static assets plus a serverless server. **Settings → Build** can override the install command, build command, output directory and root directory.
- If a `Dockerfile` is present, Shadw builds and runs it as a container instead. **This repository deliberately has no Dockerfile**, so the Next.js path is used.
- **Settings → Environment Variables**: in the dashboard, "Available during" defaults to build and runtime. Through the API a variable is runtime-only unless `"scope": "build"` or `"scope": "all"` is passed. Variables marked Sensitive are encrypted at rest.
- Managed Postgres with a per-database connection URL, provisioned from the dashboard.
- Each deployment has its own URL. The latest production deploy owns the project domain. Promoting an earlier deployment rolls back.

### Observed on Shadw

From the build log of the first production deploy of `main` (2026-11-19, region `san-jose`). That deploy was not promoted: its readiness check failed because the Clerk variables were not set. See [If the deploy fails its readiness check](#if-the-deploy-fails-its-readiness-check).

| Item | What the log showed |
| --- | --- |
| Detection | "Detected framework: Next.js — primitive: Hybrid, package manager: npm". No build settings were needed. |
| Install | `npm ci --no-audit --no-fund`. Passed. |
| Build | `npm run build`. Passed. |
| Start | Shadw provisions the server itself: `node node_modules/next/dist/bin/next start`. This is the same server as `npm start`. No start command was asked for. |
| Request proxy | "middleware: true". `src/proxy.ts` also ran at runtime: the readiness response was the proxy's 503 text. |
| Readiness | After the build, Shadw sends a request to the server and fails the deploy on HTTP 503. The log does not show which path it requests or which statuses it accepts. |
| Not shown | The Node.js version, and whether `PORT` is supplied. |

### Dashboard checks

Shadw's public documentation does not state the following. Confirm each in the dashboard or with Shadw support. No setting has been invented here.

| # | Check | Why it matters |
| --- | --- | --- |
| 1 | **`PORT`.** Shadw starts the server itself (see [Observed on Shadw](#observed-on-shadw)) and that server answered the readiness request, so no start command or port setting was needed. Neither the docs nor the build log say whether `PORT` is supplied. `next start` honours `PORT` if it is, and uses 3000 if it is not. | Requested verification. Nothing to set unless a deploy reports a port error. |
| 2 | **Node.js version** used for build and runtime is 20.9 or newer (22 preferred). | Next.js 16 requires it. |
| 3 | **Readiness check**: which path Shadw requests and which statuses it accepts. Only a 503 has been observed to fail it. With authentication configured, a signed-out request gets 307 to `/sign-in` on `/` and 200 on `/api/health`. If a deploy fails readiness with a status other than 503 and Shadw offers a health-check path, `/api/health` is the route meant for it. | A redirect on `/` is the expected signed-out answer. Whether Shadw counts it as ready is not known. |
| 4 | **Request body limit** allows at least 5 MB. | Import files can be up to 4 MB. |
| 5 | **Managed Postgres**: the name under which the connection URL is exposed (the app reads `DATABASE_URL`), whether it must be added to the project by hand, whether TLS is required, and whether the database accepts connections from outside Shadw. | Decides how migrations and the invite command are run. See step 4. |
| 6 | **Connection limit** of the database plan against the number of app instances. Each instance opens up to `DATABASE_POOL_MAX` connections (default 5). | Serverless instances scale out. |
| 7 | **Zip upload**: where it is in the dashboard and whether it runs the same install and build. | Listed as supported; procedure not documented. |
| 8 | **Preview deployments**: either disable them for this project, or confirm they are protected and do not receive production `DATABASE_URL` or Clerk keys. | Pull request previews must not reach investor data. |
| 9 | **Database backups** and retention. | Approved snapshots live in PostgreSQL. |
| 10 | **Logs**: who can read runtime logs. | The app logs no investor records, but access should still be limited. |

### Deploy steps

**1. Clerk (identity provider)**

1. Create a Clerk application and switch it to a **production instance** (keys start with `pk_live_` and `sk_live_`). Clerk production instances require a domain you control.
2. Under **Restrictions**, set **Sign-up mode** to **Restricted**, so accounts can only be created from an invitation. Close Desk keeps its own invitation list as well, and an account that is not on it is refused.
3. Sign-in methods: email with password or email code. Keep email verification on. Turn off any social connection you do not want.
4. Paths (Clerk dashboard → Paths, if you set them there): sign-in `/sign-in`, sign-up `/accept-invitation`. The app also sets these itself.
5. Invitation emails link to `${APP_BASE_URL}/accept-invitation`. If Clerk restricts redirect URLs for your instance, allow that URL.

There is no separate OAuth callback route to register: Clerk's components handle the handshake on `/sign-in` and `/accept-invitation`.

For a first smoke test with synthetic data on a Shadw-provided address, a Clerk development instance (`pk_test_` and `sk_test_` keys) works without a domain of your own. Do not use a development instance with real investor data.

**2. Database**

Provision a PostgreSQL database (14 or newer) from the Shadw dashboard, or use an external one. Note its connection URL (dashboard check 5).

**3. Environment variables, then the project**

Set the variables **before the first build**. Shadw checks readiness after building, and the app answers 503 until both Clerk keys are present at runtime, so a deploy without them fails. Shadw's docs say variables can be set when creating a project, or afterwards under **Settings → Environment Variables**.

Production target:

| Name | Value | Available during | Sensitive |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_REPLACE_ME` | Build and runtime | No |
| `CLERK_SECRET_KEY` | `sk_live_REPLACE_ME` | Runtime | Yes |
| `DATABASE_URL` | `postgres://USER:PASSWORD@HOST:5432/DATABASE` | Runtime | Yes |
| `DATABASE_SSL` | `require` (only if the provider needs it and the URL does not carry `sslmode`) | Runtime | No |
| `APP_BASE_URL` | `https://YOUR_DOMAIN` (no trailing slash) | Runtime | No |

Do not set `CLOSE_DESK_DEV_AUTH` or `CLOSE_DESK_DEV_AUTH_SECRET`. If variables are set through the API, pass `"scope": "all"` for the publishable key.

The two Clerk keys decide whether the deploy passes readiness. `DATABASE_URL` is needed as soon as someone signs in. `APP_BASE_URL` is needed for invitation emails.

Then create the project from Git:

- Dashboard: **New Project** → paste the repository URL → add the variables above → deploy.
- Or API:

  ```bash
  curl -X POST https://api.shadw.cloud/v1/git/deploy \
    -H 'content-type: application/json' \
    -H 'Authorization: Bearer hive_YOUR_API_KEY' \
    -d '{ "repo_url": "https://github.com/YOUR_ORG/Autheo-Close-Desk", "project": "close-desk", "production": true }'
  ```

If the project already exists, add the variables under **Settings → Environment Variables** and redeploy (dashboard, or `POST https://api.shadw.cloud/v1/projects/close-desk/redeploy`).

Or from a ZIP, where the dashboard offers upload (dashboard check 7). Build the archive from a clean commit so that no local files are included:

```bash
git archive --format=zip --output close-desk.zip HEAD
```

The archive contains `package-lock.json` and no `.env` files, `node_modules` or build output. A clean `npm ci && npm run build` from this archive was verified locally.

Build settings were detected automatically. Only if detection ever needs overriding (**Settings → Build**): install `npm ci`, build `npm run build`, root directory the repository root. Leave the output directory empty.

**4. Migrations**

Migrations are explicit and forward-only. Run them before the first deploy serves traffic and before any deploy that adds a migration file:

```bash
# from a trusted machine or CI job that has the repository and can reach the database
npm ci
DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DATABASE' npm run db:migrate
DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DATABASE' npm run db:status
```

Shadw's public docs describe no release or pre-deploy hook. If the managed database is not reachable from outside Shadw (dashboard check 5), ask Shadw how to run a one-off command. A possible fallback is to set the build command to `npm run db:migrate && npm run build` with `DATABASE_URL` available during build; this is untested on Shadw and depends on the build environment reaching the database.

**5. Invite the first user**

There is no sign-up, so the first administrator is created from the command line, with the production environment values:

```bash
export DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DATABASE'
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='pk_live_REPLACE_ME'
export CLERK_SECRET_KEY='sk_live_REPLACE_ME'
export APP_BASE_URL='https://YOUR_DOMAIN'
npm run user:invite -- --email ops.lead@your-company.example --name "Ops Lead" --admin
```

Expected output: `Created ops.lead@your-company.example as workspace administrator.` and `Invitation email sent.` The person opens the emailed link, creates their login on `/accept-invitation`, and lands on **Offerings**. Everyone else is invited from **Team** in the app, then given a role on an offering under **Access**.

If the command reports that Clerk did not send the email, the user record still exists: send the invitation to the same address from the Clerk dashboard (Users → Invitations).

**6. Optional: synthetic demo offering**

Only if you want the fictional demo in this environment. Both people must already be invited and must be different.

```bash
npm run seed:demo -- --reviewer reviewer@your-company.example --approver approver@your-company.example --confirm
```

Never load real investor data into a demo or preview environment.

### If the deploy fails its readiness check

```text
Error: api readiness request returned HTTP 503 (body: Autheo Close Desk is unavailable: authentication is not configured. ...)
```

The build succeeded and the app started, then refused to serve because authentication is not configured. This is the intended fail-closed behaviour, and Shadw does not promote the deployment. The end of the message, and an `[auth]` line in the runtime log, say what to fix:

| Message ends with | Fix |
| --- | --- |
| `... not set in the runtime environment.` | Add the named variable for the Production target and make sure it is available at runtime, not only during the build. |
| `... must start with pk_test_ or pk_live_.` / `... sk_test_ or sk_live_.` | The value is a placeholder, has stray characters, or the two keys are swapped. |
| `CLOSE_DESK_DEV_AUTH is set in production.` | Remove `CLOSE_DESK_DEV_AUTH`. It is for local development only. |

Then redeploy. There is no setting that makes the app serve without authentication.

## Post-deploy smoke test

Use the synthetic example files from **File guide**. About ten minutes.

1. **Closed by default.** In a private window open `https://YOUR_DOMAIN/offerings`. Expect a redirect to `/sign-in`. Run `curl -i https://YOUR_DOMAIN/api/offerings`. Expect `401`.
2. **Health.** `curl -i https://YOUR_DOMAIN/api/health`. Expect `200` and `{"status":"ok"}`. A `503` means the Clerk keys are missing or malformed. The endpoint does not test the database; step 3 does.
3. **Sign-in.** Accept the administrator invitation from the email. Expect to land on **Offerings**. Open `https://YOUR_DOMAIN/accept-invitation` without an invitation link in a private window. Expect "Invitation required" and no sign-up form.
4. **Team.** Invite a reviewer and an approver from **Team**. Create a test offering. Add both under **Access**.
5. **Imports.** As the reviewer, download the three example files from **File guide** and import each one. On the funding file, tick the box to leave out the one invalid row. Expect 50, 61 and 48 new records. **Overview** shows 39 ready, 6 needs review, 7 blocked, and totals of $5,090,000.00, $4,750,000.00 and $5,000,000.00.
6. **Idempotency.** Import the funding file again. Expect 0 new records and unchanged totals.
7. **Approval is blocked.** As the approver, open **Approval and export**. Expect "This close cannot be approved yet", the list of open items, and no approve control.
8. **Review.** As the reviewer, clear the exceptions as in [Demo walkthrough](#demo-walkthrough), including both correction files.
9. **Approve.** As the approver, approve version 1. Expect 47 register lines and $5,000,000.00.
10. **Download.** Download the ownership register and the exception report. The register has 47 data lines; the line for SUB-1012 reads `INV-0412,Class A,SUB-1012,90000.00,90,USD`. Its SHA-256 matches the one shown on the page.
11. **Isolation.** Sign in as a person who is not a member of the offering. Expect the offering to be absent from **Offerings** and its URL to return "not found".
12. Disable the test users you no longer need under **Team**.

## Security notes

- **Authentication** is Clerk. Missing or malformed keys in production close the app (503). There is no anonymous mode, default user or production bypass. The local development identity requires `NODE_ENV` other than `production` and `CLOSE_DESK_DEV_AUTH=1`.
- **Authorization** is checked on the server in every route handler and page, per offering and per role. State-changing requests from another origin are rejected.
- **Imports** are validated for size, extension, encoding and structure, parsed in memory, and stored as database rows. Files are not kept on disk.
- **Exports** are served only to members of the offering, with `Cache-Control: no-store, private`. Approved versions are served from the frozen bytes.
- **Logging** contains event names, identifiers and counts. Request bodies, file contents and database error parameters are not logged.
- **Secrets** are read from environment variables only. `.env*` files are ignored by git except `.env.example`.
- **Database**: triggers forbid changing the content of a source record or deleting one, and make import batches, decisions, snapshots and audit events append-only.
- Response headers set a frame ban, `nosniff`, a referrer policy, a permissions policy and `noindex` (`next.config.ts`).

## Project layout

```text
db/migrations/        SQL migrations (applied only by npm run db:migrate)
fixtures/demo/        Synthetic example files, correction files, known-good register
scripts/              migrate, invite-user, seed-demo, generate-fixtures
src/domain/           Pure logic: decimals, CSV, import validation, reconciliation, exports
src/server/           Auth, authorization, services, database access
src/app/api/          JSON and download routes
src/app/(app)/        Signed-in pages
src/app/(auth)/       Sign-in, invitation acceptance, no-access
src/components/       Interface components
src/proxy.ts          Request proxy: fail-closed check and signed-out redirect
tests/                Unit and integration tests
```
