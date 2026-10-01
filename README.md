# Glow & Grace

A responsive React storefront and beauty-career platform built to `Design/glow-and-grace-elegant 1.html`, with an administrator console built to `Design/glow-and-grace-admin.html`. The working app includes a product catalogue, category filters, product pages, a persistent bag and wishlist, server-backed sign-in with role-based candidate/partner/admin portals, public registration, partner salons, career listings, contact requests, and newsletter signups. The typography uses the reference's Cormorant Garamond / Jost font pairing, 16 px base size, and matching heading and navigation scale.

## Stack

- React 19, TypeScript, Vite, and React Router
- PostgreSQL locally in Docker Compose; Neon PostgreSQL for production; a disposable Docker mirror of the production schema for reproducing database problems
- Parameterized `pg` queries and Zod validation in the API
- Vercel static hosting and Node.js serverless API functions, with a single-page-app rewrite for deep links
- Vitest / Testing Library for UI and API unit tests; Playwright for browser E2E tests, including a production-build deployment suite
- E2E | Playwright (@playwright/test) — headed/serial suite + UI runner |

## Two databases, one direction

The app never talks to one database from both places. Local development always uses the local Docker PostgreSQL container; production always uses Neon. Data flows in a single direction: **production to local, never local to production.**

| | Local | Production |
| --- | --- | --- |
| Database | PostgreSQL 16 in Docker Compose (`glow-grace-data` volume) | Neon PostgreSQL |
| Connection string | `DATABASE_URL` in `.env` | Same value, set in the Vercel project environment |
| Schema | `npm run db:migrate:local` | `npm run db:migrate:production` |
| Data source of truth | A copy of production, refreshed by `npm run db:sync` | The real data |

Because production is the source of truth, the local database is disposable. A product you add in the local admin console is local-only until it is created in production; `npm run db:sync` will delete it. Add and verify products on production, then refresh local.

A **third** database exists for reproduction and holds no data at all: the disposable mirror described in [Reproducing a production database problem](#reproducing-a-production-database-problem).

## Local setup

Requirements: Node.js 22+, npm, and Docker Desktop (or another Docker Compose runtime).

1. Copy `.env.example` to `.env`, set the local database password, and paste the Neon pooled connection string into `PRODUCTION_DATABASE_URL`. `.env` is ignored by Git and holds every setting the project uses.
2. Install packages with `npm install`.
3. Start the local database with `npm run db:up`. Compose initializes it from `db/init.sql` and keeps data in the `glow-grace-data` volume.
4. Confirm both databases with `npm run db:check`, then load the current production data with `npm run db:sync`.
5. Start the API and Vite development server with `npm run dev`.
6. Open `http://localhost:5173`.

The starter storefront works without a database. Loading and saving administrator products, contact and newsletter submissions, and checkout require the local PostgreSQL container to be running. `http://localhost:3001/api/health` reports database health, not just process liveness. Stop the local database with `npm run db:down`; this keeps its named volume and data. To intentionally remove local database data, run `docker compose down -v` and then `npm run db:sync` to rebuild it from production.

## Reproducing a production database problem

When production misbehaves, the first instinct is to connect to Neon and look. `npm run db:sync` and `npm run db:check production` exist for that, but neither is appropriate while developing a fix: they read the live database, and a query written while debugging can write to it.

The **disposable mirror** is a throwaway PostgreSQL that reproduces the production schema instead. It runs the same `postgres:16-alpine` image on port `5436`, its data directory is a `tmpfs` so nothing survives, and it is a local host, so the API's guard against remote databases accepts it without an override. It never touches `.env` and never reads `PRODUCTION_DATABASE_URL`.

```sh
npm run db:mirror:up      # start it and apply the full schema
npm run db:mirror:down    # delete it and everything in it
```

Point the app at it instead of the local database:

```sh
DATABASE_URL=postgresql://glow_grace:glow_grace_mirror@localhost:5436/glow_grace npm run dev
```

The valuable part is `--through`, which stops the schema at a chosen migration:

```sh
npm run db:mirror:up -- --through 004
```

That produces exactly the database a deployment had before the console migrations existed — no `site_pages`, no `admin_users`, and no `products.published` — which is how the "the whole site returns 500" class of production bug is reproduced. `db/migrations/005_admin_console.sql` is the one that added `products.published`, so `--through 004` and `--through 005` behave very differently.

Run `npm run db:mirror:up` again with a higher `--through` to apply the missing migrations to the running mirror; the API picks them up on its next request, with no restart.

## Accounts, roles, and the way in

There is no demo account any more. Authentication is the server's: passwords are scrypt-hashed, sessions are bearer tokens in `admin_sessions`, and every protected route checks the account's own role rather than the mere presence of a token. A `Customer` who signs in successfully still cannot walk into `/admin` with a valid session.

- **Registration is public and narrow.** `/signup` offers exactly three roles - `Customer`, `Candidate`, and `Partner Salon` - and the server rejects anything else, including every console role. A registration creates a `Pending` account with `source = 'signup'`, mints no session, and leaves a message in `email_outbox` so an administrator knows a request arrived. Nobody can sign in as a `Pending` account, and nobody can send a status in the request body: the caller does not choose one.
- **Console roles** - `Super Admin`, `Store Administrator`, `Store Manager`, `Inventory Manager`, `Partnerships Lead`, `Content & Reviews`, `Placement Coordinator` - are granted from the console's Settings section, never by self-registration.
- **Approval** happens in Settings, where a pending registration is promoted to `Active` with a role. Until then the account exists and cannot sign in.
- **Forgotten passwords** use a hashed, single-use, expiring token. `POST /api/admin/password-reset` always answers the same way whether or not the address is known, so it cannot be used to discover who has an account. A console operator can also set any team member's password from Settings.
- **Passwords** are 8-128 characters and there is no longer any `demo123` exception. The browser demo sign-in, `src/auth/demo-auth.ts`, and the published credentials were all removed.
- **The seeded colleagues are retired one row at a time, and only while they still hold the published password.** Five accounts used to share the credential printed in an old README. They were removed by address, on the reasoning that a demo row is nothing an operator would keep - and production disproved that: `deepak@glowngrace.in` had been claimed with a password somebody chose, and a delete by address takes the account with it, unasked. The check that already protected `admin@glowngrace.in` now covers all of them, so a claimed account survives with the password its owner set and an unclaimed one goes. `retirePublishedDemoAccounts` in `src/server/admin.ts` runs on the first request after the migration; `db/migrations/010` no longer deletes anything itself. Comparing hashes cannot decide this, because every hash carries its own random salt, so the password is verified against each row's own salt.

### The owner account

`glowngracebiz@gmail.com` is a fixed `Super Admin` whose password nobody chooses: the system generates a 24-character password, stores only its hash, and mails the plaintext to that same address. This is the only way into a deployment that has lost every other credential.

- The address was `glownglancebiz@gmail.com` until the password-hold branch, which is a misspelling and matched no account in any database - so the weekly rotation was looking for a row that was not there and quietly doing nothing. `db/migrations/012` renames the row in any database still holding the old spelling, and the old address is now refused everywhere it used to be accepted: it cannot receive a credential, and an account still sitting on it is an ordinary team member rather than a protected owner.
- The first password is written to `email_outbox` at the moment the account is created. The insert is guarded by its row count, so a later boot does not mail a password that was never stored.
- `password_rotated_at` then drives a rotation every 7 days from `src/server/admin/owner-password.ts`. Each rotation replaces the hash, revokes every session the old password opened, and mails the new one. The schedule wakes daily and decides in SQL whether a rotation is due, so a clock skew or a restart cannot cause one on every request.
- The owner row cannot be deleted or moved to another role, while its name can still be corrected. The rotation job, not the account row, is what changes the password.
- "Mail" here means a row in `email_outbox`. `src/server/mailer.ts` sends the owner's message over SMTP and stamps `sent_at`, and the outbox stays the record either way. On a host where the outbox is not acceptable, set the first password directly instead: `npx tsx scripts/reset-admin-password.ts --email glowngracebiz@gmail.com`.

### Holding a password that a person chose

The weekly rotation is the right default and the wrong behaviour for a short window. During a handover, a demo or an incident somebody needs a password they actually know, and a rotation replaces it a week later whether or not anyone has read it. `password_hold_until` is that window.

```sh
OWNER_PINNED_PASSWORD=... npx tsx scripts/reset-admin-password.ts \
  --email glowngracebiz@gmail.com --hold-until 2026-10-10T23:59:59Z

OWNER_PINNED_PASSWORD=... npx tsx scripts/reset-admin-password.ts \
  --email glowngracebiz@gmail.com --hold-until 2026-10-10T23:59:59Z --allow-local
```

- **The password is never in the source.** It is read from `OWNER_PINNED_PASSWORD` in `.env`, or typed at a masked prompt, and is never accepted as a command-line argument - so it cannot reach a shell history, a process listing or a CI log. The server never reads it: the script hashes the value, stores the hash, and the plaintext is not needed again. Delete the line from `.env` once it has been applied.
- **A hold replaces the rotation, it does not add to it.** While the date is in the future the account is not due however long ago `password_rotated_at` was stamped. The moment it passes the account is due immediately, whatever that stamp says, and the rotation clears the column - so the hold is spent exactly once and cannot go on exempting the password that replaced it. After that the normal 7-day clock resumes.
- **The reset lands on the first daily check after the deadline, not at the deadline.** `ownerRotationCheckMs` is a day, so a hold ending at 23:59 is honoured somewhere in the following 24 hours. The new password is written to `email_outbox` and every session the old one opened is destroyed.
- **It is the owner account only.** `password_hold_until` is read by the owner's rotation and by nothing else, so a hold on any other row would be a column saying "do not touch this" to a schedule that never looks at it. The script refuses `--hold-until` for another address rather than handing back a password everybody believes is pinned and that is rotated away a week later with nobody told.
- **It is capped at 30 days** by `maxPasswordHoldDays`. Past that the script refuses, so this cannot quietly become a way to switch the rotation off. `passwordHoldError` is the whole rule and is unit tested, including a date in the past, which is rejected rather than stored - storing it would make the account due on the very next tick, the opposite of the intent.

`src/server/admin/owner-password.test.ts` covers the window end to end: the password survives a rotation stamp 60 days old, the hold is still in force on its last day, the first check after it closes rotates and mails, the column is cleared, and six days later the account is back on the weekly clock. `e2e/ui-review.spec.ts` covers the browser half: the owner signs in at the real address and the console opens, and a portal account with a valid session still meets the locked console, because a hold changes when the owner password is replaced and not who may use it.


### Sending the owner's password

A rotation writes the message and then tries to send it in the same call, so the password is normally in the mailbox before the request returns. Because that row is the only copy of a working password, a send that fails is not allowed to break anything: the row stays queued, and a pass runs every 5 minutes from `server/index.ts` to try again. `sent_at` is what stops it being sent twice.

SMTP is configured in `.env` (see `.env.example`):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=postmaster@glowandgrace.in
SMTP_PASSWORD=<a Gmail app password, not the account password>
MAIL_FROM=postmaster@glowandgrace.in
```

- Port 465 implies implicit TLS; any other port negotiates STARTTLS. `SMTP_SECURE=true` forces implicit TLS elsewhere.
- `MAIL_FROM` defaults to `SMTP_USER`, which is right for a dedicated sending mailbox. Use a real address the provider is allowed to send from, or the mail will be rejected.
- The server says at boot whether it will send owner credentials or only queue them. A deployment that believes it is emailing a password and is not would otherwise be found out a week later, when a password nobody received stops working.
- Delivery is restricted to `kind = 'owner-credentials'` addressed to `glowngracebiz@gmail.com`. No other message in the outbox is ever sent, and no other address is ever mailed, whatever the row says. The address the owner used to be spelled with is refused as well, so a credential cannot be posted to a mailbox that is not the one holding the console. Everything else - signup notices and reset links - stays in the console inbox on purpose.

## Loading feedback

`src/components/Loader.tsx` is the single loading primitive for the whole application, so a slow request always produces the same visible, announced feedback instead of a blank screen. Nothing renders a bespoke spinner.

- `Loader` fills a region that is fetching its first payload, `PageLoader` fills a whole page, `Spinner` sits inside a button, and `Skeleton` / `TableSkeleton` keep a region's final shape while it loads.
- `LoadingProvider` wraps the app and renders a thin route progress bar during navigation. It is mounted once in `src/App.tsx`.
- The storefront page gate (`StorefrontPagesProvider`) shows a `PageLoader` until `GET /api/site/pages` resolves, and clears it on failure as well as success, so a failed request can never strand a spinner.
- `AdminStore` distinguishes the first load from a background reload. The admin console shows a full loader while the first payload arrives and a small progress bar for later refreshes, which is what previously caused a reload loop on every settings change.
- Every loader is a `role="status"` region with `aria-live="polite"` and `aria-busy="true"`, and the animations are disabled by the global `prefers-reduced-motion` rule.

`e2e/regressions.spec.ts` holds the relevant request open and asserts the loader is visible, announced, and then removed, which is the failure the old implementation produced: an empty `#main-content` with no indication anything was happening.

## Page visibility settings

`GET /api/admin/pages` and `PATCH /api/admin/pages/:slug` are restricted server-side to the three pages that actually have a storefront visibility switch: **Partners**, **Shop**, and **Careers**. The list is declared once as `switchablePageSlugs` in `src/server/admin/seeds.ts`; structural pages such as About, Contact, and FAQ are rejected on update, because hiding them would leave the app with no route.

`GET /api/site/pages`, which the storefront gate uses, still returns every page. The admin restriction applies to the admin surface only.

## Admin settings

The Settings section reads and writes `GET`/`PUT /api/admin/settings`. Values are stored in `store_settings` as one JSONB row per section (`profile`, `delivery`, `notifications`, `preview`), so `src/server/admin/settings.ts` is the single source of truth: `storeSettingsSchema` validates an incoming change and `normalizeStoreSettings` guarantees a caller always receives a complete, correctly typed object even when a row is missing, partial, or was written before the schema tightened.

- **Each form saves on its own.** Profile, delivery, password, and invite are separate forms with separate save buttons, each carrying only the sections it owns, and every team-member row has its own *Save role* button. A `PUT` merges section objects at the JSONB level (`value || EXCLUDED.value`), so saving the profile cannot blank out delivery or the switches.
- **A switch that fails to save returns to where it was.** Notification and preview toggles persist immediately rather than behind a save button, so a rejected request toggles the switch back instead of leaving the UI claiming a setting is on when the server never stored it.
- **A rejected save keeps your typing.** Validation failures come back as `400` with a `fieldErrors` map keyed by dotted path (`profile.email`, `delivery.deliveryFee`). The form splits the path on `.` and takes the last segment, renders the message next to the field with `aria-describedby` and `aria-invalid` set, and moves focus to the first bad field. An invalid email is the quick check: `z.string().email(...)`, because the project is on Zod v3 and `z.email()` does not exist.
- **A save in flight locks the section.** Edits made while a section is saving are not clobbered when the response lands; the dirty-section guard tracks which form the operator is still editing.
- **The danger zone asks first.** Reset and delete actions open a focus-managed confirm dialog, close on Escape, and never run without a click.
- **Clipboard failures are reported, not ignored.** A browser that blocks `navigator.clipboard` shows a failure message instead of a false "copied" confirmation.

Admin team members are managed through `GET`/`POST /api/admin/users` plus `PATCH`/`DELETE /api/admin/users/:id` and `POST /api/admin/users/:id/password`. A password change verifies the current password first and returns a `wrong_password` field error, which the form maps back to the current-password input rather than showing an unexplained error. Sample datasets shown under the settings status card come from `GET /api/admin/demo-data`, which reports a `rowCount` per dataset plus a `visible` flag, and `POST /api/admin/demo-data` restores or hides them.

## Bulk uploads and spreadsheets

Bulk upload templates are generated in the browser by `src/lib/xlsx.ts` and downloads are triggered by `downloadBlob`.

- **The workbook builder drains the compression stream before it waits on the write.** Browsers apply backpressure to `CompressionStream`: the promise returned by `write()` does not settle until the readable side is being drained. The original code wrote first and read afterwards, which Node tolerates (it buffers eagerly) but which deadlocked in Chrome, so no template ever downloaded. Both compression and decompression now start the read and the write together.
- **Compression degrades, it does not fail.** If a compressor has not produced output within four seconds, the entry is written as a stored (uncompressed) ZIP member instead. The archive stays valid, so a slow device gets a larger file rather than no file.
- **`downloadBlob` attaches its anchor to the document, clicks it, and revokes the object URL after 60 seconds.** Revoking inline tore the blob down before the browser read it; the anchor is removed from the DOM immediately after the click so it cannot accumulate.

`src/lib/xlsx.test.ts` covers all three with fakes that model the browser backpressure rule, because Node's implementation cannot reproduce the deadlock. `e2e/regressions.spec.ts` additionally downloads a real template in Chromium and asserts the file starts with the `PK` ZIP header, which is the check that would have caught the original bug.

## Administrator console

`/admin` is a single-page console built to `Design/glow-and-grace-admin.html`: a dark grouped sidebar, a topbar with search and quick-create, and twelve sections — Dashboard, Orders, Products, Add product, Job vacancies, Post a vacancy, Candidates, Partner salons, Customers, Reviews, Add a review, and Settings. It shares the storefront `/login` route; there is no separate administrator login.

- The sidebar collapses to an off-canvas drawer below 1000 px, opened with the **Toggle navigation** button in the topbar.
- Search, status filter chips, table sorting-free row actions, detail modals, CSV export, toasts, and the settings forms are all client-side.
- **Product creation is real.** `createCatalogueProduct` posts to `POST /api/products` and the saved product appears in the console, the storefront, product pages, the bag, and checkout.
- **Every console section is persisted.** Orders, jobs, candidates, partner salons, customers, and reviews are served from the database through `/api/admin/collections/:collection` and can be created, updated, and deleted like products. The seeded rows exist so a fresh install has something to look at, not as a client-side mock.
- A mutation that the server rejects is not swallowed. `AdminStore` rethrows the failure so the calling form can keep the typed values, mark the offending field, and explain what went wrong instead of clearing the form and showing a generic toast.

Add-product images support 1–10 JPEG, PNG, or WebP files, each up to **1200 × 1200 px** and **300 KB**. Images can be chosen, drag-and-dropped, picked from the in-app library, previewed, and removed before saving. Demo sign-in is still client-side only: do not expose product management or other admin APIs publicly until server-side authentication and authorization are added.

### The console API route is an index function, not a catch-all

Every console request nests a path segment: `/api/admin/products/11`, `/api/admin/pages/careers`, `/api/admin/orders/GG-2046`. The console is the only API in this project that does, and Vercel matches a `[...path]` serverless function for a **single** segment and answers `x-vercel-error: NOT_FOUND` for anything deeper. That is how every save, publish toggle and page switch came back as a platform 404 in production while local development kept working: `app.all('/api/admin/*')` matches any depth, so the two environments disagreed and the deployment preview could not reproduce it.

The console API therefore lives in `api/admin/index.ts` and `vercel.json` forwards it explicitly:

```json
{ "source": "/api/admin/:path*", "destination": "/api/admin/index" }
```

Keep it that way. Adding a `[...path].ts` file under `api/` will look correct locally and fail again in production. `src/lib/vercel-routing.test.ts` fails if any `/api/admin/**` path stops resolving to the function, and `src/server/admin.test.ts` covers the nested product route itself.

## Environment

Every setting lives in `.env` at the project root; nothing is hard-coded and no secret is committed. `.env` is ignored by Git, and `.env.example` is the committed template. Copy the template and fill in the production connection string before running any database command.

| Variable | Used by | Description |
| --- | --- | --- |
| `DATABASE_URL` | API, sync | The **local** Docker connection string. It is also the name the Vercel project uses, where it must hold the **Neon** connection string. |
| `POSTGRES_DB` | Docker Compose | Local database name. |
| `POSTGRES_USER` | Docker Compose | Local database user. |
| `POSTGRES_PASSWORD` | Docker Compose | Local database password; replace the example value. |
| `POSTGRES_PORT` | Docker Compose | Host port for the local container (default `5435`; change it in `.env` if the port is in use). |
| `PRODUCTION_DATABASE_URL` | Sync, migrate, check | The **production** Neon pooled connection string. Read-only source for `npm run db:sync` and target for `npm run db:migrate:production`. |
| `LOCAL_DATABASE_SSL` | API | TLS for the local container. Defaults to `disable`; the local image does not serve TLS. |
| `DATABASE_SSL` | API | TLS for the production Neon connection. Defaults to `require` when the connection string does not set `sslmode`. Accepts `disable`, `require`, or `verify-full`. |
| `DATABASE_POOL_MAX` | API | Pool size per function instance. Default `1`. |
| `DATABASE_IDLE_TIMEOUT_MS` | API | Default `10000`. |
| `DATABASE_CONNECT_TIMEOUT_MS` | API | Default `8000`, deliberately below the 10 s function budget so a bad connection fails with a real error instead of a hard timeout. |
| `DATABASE_STATEMENT_TIMEOUT_MS` | API | Default `0` (off). Set a value to abort long-running queries. |
| `ALLOW_REMOTE_DATABASE` | Local API | Default `false`. While `false`, the local API server refuses to start if `DATABASE_URL` points at anything other than the local container, so local work can never read or write production by accident. |
| `OWNER_PINNED_PASSWORD` | Reset script | Read by `scripts/reset-admin-password.ts` only, and only to apply a password once. The server never sees it, because the script stores only the hash. Set it in `.env`, run the script, delete the line. |
| `PORT` | Local API | Express API port (defaults to `3001` if omitted). |
| `VITE_API_BASE_URL` | Vite | Browser-visible API prefix; keep this as `/api`. Never put secrets in a `VITE_` variable. |

The disposable mirror sets its own four variables in `scripts/mirror-database.ts` and `docker-compose.mirror.yml` (`MIRROR_POSTGRES_DB`, `MIRROR_POSTGRES_USER`, `MIRROR_POSTGRES_PASSWORD`, `MIRROR_POSTGRES_PORT`, default port `5436`). They are not read from `.env`, which is what keeps the mirror from ever being pointed at production.

### How the API picks a connection string

`src/server/config.ts` is the single place that reads configuration. The API tries these names in order and uses the first one that is set: `DATABASE_URL`, `NEON_DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`. The later names are the ones Neon and the Vercel Neon integration inject automatically, so the API connects whether you set `DATABASE_URL` by hand or link Neon from the Vercel dashboard.

`PRODUCTION_DATABASE_URL` is deliberately **not** in that list. It is only read by the local scripts, which is what guarantees the sync can never mistake the local database for production.

### Production setup on Vercel

The production API needs two things: the Neon connection string and an applied schema.

1. Create or pick the Neon project and copy its **pooled** connection string.
2. Set it in the Vercel project under **Settings → Environment Variables** as `DATABASE_URL`, for the **Production** environment (and Preview if you want preview deployments to work). Keep the password in Vercel, not in source control or a browser variable.
3. Apply the schema to Neon once, from your machine: `npm run db:migrate:production`.
4. Confirm it works: `curl https://your-app.vercel.app/api/health` should return `"status": "ok"` with empty `missingTables`, `missingProductColumns` and `missingAdminTables`.

If you already linked Neon through the Vercel Neon integration, step 2 is unnecessary — the injected variables are in the list above.

**Run `npm run db:migrate:production` again after every migration you add.** Deploying code that reads a new column or table without applying the migration is what produces the drift described in [Database](#database); the API now degrades instead of going down, but only the migration actually enables the feature.

## Database health

`/api/health` reports whether the deployed API can reach its database. It never returns a password, and the host is masked.

```sh
curl -s https://glowngrace-tau.vercel.app/api/health
```

| `status` | Meaning | Fix |
| --- | --- | --- |
| `ok` (HTTP 200) | Connected and every table exists. | Nothing. |
| `ok` with `missingProductColumns` or `missingAdminTables` | The shop works, but the console cannot run. | `npm run db:migrate:production` |
| `degraded` (HTTP 503) | Connected, but tables are missing. `missingTables` lists them. | `npm run db:migrate:production` |
| `error` (HTTP 503) | Not connected, or no connection string is configured. `reason` explains which. | Set `DATABASE_URL` in Vercel, then redeploy. |

`missingProductColumns` exists because migration `005_admin_console.sql` adds columns to the existing `products` table, so a database can be missing part of the schema while every table it reports is present. The storefront keeps serving in that state: `GET /api/products` falls back to the pre-`published` behaviour and every product is treated as published, and `GET /api/site/pages` falls back to the bundled page list. The console does not pretend to work — it returns `503` with `"error": "schema_not_migrated"` and the command to run.

The same check runs locally and covers both databases at once:

```sh
npm run db:check              # local and production
npm run db:check production   # production only
```

It exits non-zero when either database is unhealthy, so it can be used as a deployment gate.

## Schema and data commands

```sh
npm run db:up                  # start the local container
npm run db:check               # report health of both databases
npm run db:migrate:local       # apply the schema to the local container
npm run db:migrate:production  # apply the schema to Neon
npm run db:sync                # copy production data into the local container
npm run db:mirror:up           # start a disposable mirror of the production schema
npm run db:mirror:up -- --through 004   # stop that schema at migration 004
npm run db:mirror:down         # delete the mirror and all of its data
```

`db/migrate:*` is safe to re-run. Every statement in `db/init.sql` and `db/migrations/*.sql` is `IF NOT EXISTS` or `IF EXISTS`, so the files apply cleanly to a fresh database, an existing one, and one that is already up to date. The mirror applies the same files, so `--through 00N` is exactly the schema a deployment had when `00N` was the newest migration.

`npm run db:sync` is the only command that copies rows, and it is deliberately one-way:

- It **reads** `PRODUCTION_DATABASE_URL` and **writes** `DATABASE_URL`.
- It refuses to start unless the target is a local host, and refuses if both strings point at the same database. There is no code path that writes to production.
- It applies `db/init.sql` to the local database, truncates the local tables, copies every row across in batches, and then realigns local identity sequences so the next locally created product gets the correct ID.
- `--dry-run` reports production row counts without writing. `--schema-only` applies the schema and copies nothing. `--skip-images` copies the catalogue without the binary `product_images` rows.

Always run it before starting local work if you need to reproduce a production bug.

## Database

`db/init.sql` creates the contact-request, newsletter-subscriber, product, product-image, order, and order-item tables. Docker runs it when creating a fresh data volume, and `npm run db:migrate:local` and `npm run db:migrate:production` apply it plus every file in `db/migrations/` to an existing database. `005_admin_console.sql` adds the publishing columns and the console tables, `006_store_settings.sql` the default store settings, and `007_admin_users.sql` the demo console accounts. `008`-`011` add role signup, the password-reset lookup, the removal of the demo accounts and the outbox's delivery marker. `012_owner_password_hold.sql` adds `password_hold_until` and renames the owner row off its old misspelling. Docker's PostgreSQL entrypoint does not rerun initialization scripts on an already-initialized volume, so use the migrate commands after changing the schema.

**A deployment that is newer than its database is the single most common cause of "The catalogue could not be loaded."** Code that reads `products.published` fails with `42703` on a database where migration 005 was never applied, and code that reads `site_pages` or `admin_users` fails with `42P01`. `src/server/schema.ts` recognises both, and the API is written to survive them:

- The storefront degrades. `GET /api/products` and `GET /api/site/pages` retry in the pre-migration shape — every product published, nothing featured, the bundled page list — so the shop keeps selling while the schema is behind.
- The console does not degrade. Any `/api/admin/*` route returns `503` with `"error": "schema_not_migrated"`, the PostgreSQL code, and the command to run, instead of an anonymous `500`.
- A failure is never allowed to escape a route as a rejected promise. Express 4 does not catch those, so one failed request used to end the API process and turn every following request into a `500` until the instance was replaced.

Reproduce any of it with `npm run db:mirror:up -- --through 004` (see [Reproducing a production database problem](#reproducing-a-production-database-problem)). The fix is always `npm run db:migrate:production`.

Checkout validates the customer's delivery/contact details and product IDs on the server, looks up all prices from the product catalogue, calculates 5% GST and delivery charges, and atomically saves the order and its line items. Delivery costs are free for standard, ₹49 for express, and ₹99 for same-day delivery. Cash on delivery is the only enabled payment option; UPI, cards, and net banking are visibly marked as coming soon because no payment provider is configured. Do not collect or store payment-card details. The order confirmation includes its order number and COD total; confirmation details are kept in the browser's current navigation state rather than exposed through a public order-lookup endpoint.

The application opens a lazy, small (`max: 1`) PostgreSQL pool, which suits Vercel's short-lived function instances and works with both Neon and the local Docker database. TLS is decided per environment: off for the local container, on for Neon. When a query fails, the error names the variable, the masked host, the SSL mode, and the PostgreSQL error code, so the Vercel function log identifies the cause without printing the password.

## Quality checks

```sh
npm run lint
npm run build
npm run test
npm run test:e2e
npm run test:e2e:dist
```

Playwright runs Chromium in desktop and mobile emulation. Install its browser once with `npx playwright install chromium`. The E2E server starts automatically; browser tests cover storefront navigation, product and wishlist interactions, checkout delivery/tax calculations and failure recovery, portal access, administrator section navigation and product/image creation, contact submission, and responsive layouts. API unit tests cover validation and server-calculated persistence without requiring a live database. To verify saved products or real local orders, apply the migrations if needed, start Docker and the app, and create a test product or place a COD test order.

`e2e/regressions.spec.ts` covers the three regressions fixed in the loading, settings, and spreadsheet work described above: a held request must produce a visible and announced loader that then clears (including on failure), the Settings page must offer exactly three page switches and no structural pages, and the products template must download as a real ZIP archive whose button announces progress while the workbook is built. Every request in that file is stubbed, so the suite never touches the database.

`e2e/ui-review.spec.ts` is the pass over the pages this branch touched, checked the way a person meets them. It walks `/signup`, `/login`, `/reset-password`, and `/admin` on desktop and mobile and asserts the things a component test cannot see: that the sign-up form offers exactly the three public roles and never mentions a console role, that a refused sign-up or a wrong password produces an announced message without revealing whether an account exists, that the console lock offers a route to the sign-up form, and that a weak password never reaches the server. It also signs in as the owner at the real address and checks the console opens, and signs in as a Candidate and checks the console does not - the two halves of the password hold, which changes when the owner credential is replaced and not who may use it. The last check on each page is a layout audit - no horizontal overflow, no text clipped by its own box, no unlabelled field, no image without alternative text, exactly one `h1`, and a clean console. The screen-reader-only one-pixel pattern is excluded from the clipping check on purpose, since hiding a label from the eye is the point of it.

The admin settings work is covered twice. `src/pages/admin/SettingsPage.test.tsx` runs twelve UI tests against a stubbed fetch: per-section saves, dotted-path field errors, a rejected save keeping the typed value, cleared number fields staying empty rather than becoming `0`, the `wrong_password` mapping, the focus-managed danger dialog, and the blocked-clipboard path. `e2e/admin-settings.spec.ts` repeats the critical ones in Chromium on desktop and mobile against a real signed-in session. Both are slower than the other suites because the page resolves thirteen requests per render; `src/test/setup.ts` raises `asyncUtilTimeout` and `vite.config.ts` raises `testTimeout` for that reason. The E2E file stubs `**/api/admin/**` and never touches the database, so the sign-in request must still reach the real API — register the catch-all route first and `route.continue()` for anything unstubbed, because Playwright matches the most recently registered route first.

**The storefront specs pin the bundled sample catalogue.** `e2e/storefront.spec.ts` asserts on shipped product names (for example *Glow Ritual Vitamin C Face Serum*) because those are stable fixtures with known prices, and a test that reads its expectations out of whatever the database holds cannot assert anything. Those specs call `stubBundledCatalogue()` from `e2e/support/accounts.ts`, which answers `**/api/products` with `catalogueManaged: false`. That is the value the API really returns for a shop that has never been stocked, and it is the only setting under which `ProductCatalog` keeps the bundled products, so the stub documents the contract rather than faking around it.

This matters because the alternative was a suite whose result depended on local data. `npm run db:sync` copies three production products into the local database, the API then answers `catalogueManaged: true`, and the browser correctly discards the bundled samples - every product-name assertion failed on data rather than on code. Pinning the catalogue means the same suite passes against a stocked database, an unstocked one, or none at all. `e2e/deployment.spec.ts` needs no stub because it runs against `npm run preview:dist`, whose API is stand-in JSON and never consults a database.

Worth knowing why the fallback exists at all: the API never serves bundled rows. It returns an empty list and lets the browser decide, so a catalogue outage is indistinguishable from an unstocked shop, and a customer sees sample products rather than an empty grid.

`src/server/admin.test.ts` covers the nested product route, because every console write depends on a path the deployment bug took offline and that route had no tests of its own: saving through `PATCH /products/:id`, the publish toggle, a reference that is not a whole number, a product that is no longer in the catalogue, and an unauthenticated request. The last two matter for triage: the handler answers `401` for a missing session and `404 not_found` for a missing product, so a platform `404` with an `x-vercel-error` header is a routing failure rather than data.

`src/server/schema-drift.test.ts` covers the deployment-ahead-of-database behaviour against a fake database that raises `42P01` and `42703`, so no live database is needed. To check it for real rather than against a mock, start `npm run db:mirror:up -- --through 004` and read `GET /api/products` (expect `200` with the products treated as published), `GET /api/site/pages` (expect `200` with the bundled page list) and `POST /api/admin/session` (expect `503` `schema_not_migrated`).

The owner rename in `012` is worth checking against a real database rather than a mock, because the interesting case is a row that exists under the old spelling. `npm run db:mirror:up -- --through 011` gives a schema without the column and without the rename; insert an `admin_users` row at `glownglancebiz@gmail.com`, then `npm run db:mirror:up` again to apply `012` and confirm the row now reads `glowngracebiz@gmail.com` and that `password_hold_until` exists and is `NULL`. The update is guarded on the new address not already existing, so a database that was corrected by hand is left alone rather than failing on a duplicate key - and running the migration twice changes nothing.

`npm run test:e2e` runs the storefront suite against the Vite development server. `npm run test:e2e:dist` builds the app, serves `dist` with the same routing rules as the deployment, and runs `e2e/deployment.spec.ts` against it, so a broken production route fails the build rather than reaching users. It asserts that every storefront route deep links to the built app, that a refresh keeps working, that the app's own not-found page is served instead of the hosting 404 page, that no page request returns 4xx or 5xx, that API requests still reach the API layer, including the nested `/api/admin/products/11`, and that path traversal cannot read files outside the build output. The routing rules themselves are unit tested in `src/lib/vercel-routing.test.ts`, which fails if `vercel.json` loses a rewrite, stops sending `/api` requests to the app, or lets a nested console path stop resolving to `api/admin/index.ts`.

## Deploy to Vercel

Import this repository into Vercel, keep the Vite framework/build defaults from `vercel.json`, and set `DATABASE_URL` in the Vercel project environment to the same Neon pooled connection string that `PRODUCTION_DATABASE_URL` holds in your local `.env`. If Neon is linked through the Vercel integration you can skip that and let the injected variables satisfy the API. Then run `npm run db:migrate:production` once and verify with `/api/health`; see [Production setup on Vercel](#production-setup-on-vercel). The browser app is served from `dist`; the `api/` TypeScript files run as Vercel Node.js functions. Do not commit `.env` or deploy local database credentials.

The storefront is a single-page app, so `vercel.json` rewrites every non-API path to `/index.html`. Without that rewrite, Vercel looks for a file that matches each URL, and deep links or refreshes such as `/shop`, `/product/4`, or `/admin` return Vercel's "404 NOT_FOUND" page instead of the app. Two details keep this safe: the rewrite source `/:path((?!api/).*)` excludes `/api/*`, and Vercel checks the filesystem before applying rewrites, so built assets and images under `/assets` and `/images` are still served as files rather than the HTML shell. Keep `cleanUrls` off; with `cleanUrls: true` the rewrite destination must be written without the `.html` extension.

`vercel.json` carries a second rewrite, `/api/admin/:path*` → `/api/admin/index`, and it is not optional. Every console request nests a segment (`/api/admin/products/11`, `/api/admin/pages/careers`), and Vercel matches a `[...path]` serverless function for a single segment only, so the nested paths returned a platform 404 and took every save, publish toggle and page switch offline while `vercel dev` and `npm run dev` kept working. The console API therefore ships as `api/admin/index.ts`. See [The console API route is an index function, not a catch-all](#the-console-api-route-is-an-index-function-not-a-catch-all).

To review a production build locally, run `npm run preview:dist` after `npm run build`. It serves `dist` through the deployment routing rules, so deep links, assets, and API paths behave like they do on Vercel. Its API responses are stand-in JSON, so use `npm run dev` for real form submissions, saved products, and orders. The preview answers `/api/health`, `/api/products`, and `/api/site/pages` and returns a JSON `404` for anything else. `/api/site/pages` matters because every route asks for the page list on load: without it the deployment suite fails on a request the app makes on every page. `/api/admin/**` paths are resolved to the admin function and then return that stand-in `404`; what the preview proves is that they reach the API layer instead of falling through to the HTML shell, which is the failure the nested console route used to have.
