# Glow & Grace

A responsive React storefront and beauty-career platform built to `Design/glow-and-grace-elegant 1.html`, with an administrator console built to `Design/glow-and-grace-admin.html`. The working app includes a product catalogue, category filters, product pages, a persistent bag and wishlist, sign-in and candidate/partner/admin demo portals, partner salons, career listings, contact requests, and newsletter signups. The typography uses the reference's Cormorant Garamond / Jost font pairing, 16 px base size, and matching heading and navigation scale.

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

## Sign-in and portal previews

Choose **Sign in** in the header and open **Explore a demo account** to fill in one of the sample profiles. Each preview account uses the password `demo123`: `customer@glowngrace.in`, `candidate@glowngrace.in`, `partner@glowngrace.in`, or `admin@glowngrace.in`. The candidate and partner previews open dashboards with working in-page tabs; the administrator preview opens the admin console at `/admin`; the customer preview opens the shop. Saved wishlist items persist in the browser.

These sample accounts and dashboards are front-end previews only. Their role selection is stored in local browser storage, without password hashing, server-side authorization, or a production authentication provider. Do not use these demo credentials or portal previews to protect real customer or business data; production authentication and server-side role authorization must be added before making protected portals available publicly.

## Administrator console

`/admin` is a single-page console built to `Design/glow-and-grace-admin.html`: a dark grouped sidebar, a topbar with search and quick-create, and twelve sections — Dashboard, Orders, Products, Add product, Job vacancies, Post a vacancy, Candidates, Partner salons, Customers, Reviews, Add a review, and Settings. It shares the demo-auth `/login` route; there is no separate administrator login.

- The sidebar collapses to an off-canvas drawer below 1000 px, opened with the **Toggle navigation** button in the topbar.
- Search, status filter chips, table sorting-free row actions, detail modals, CSV export, toasts, and the settings forms are all client-side.
- **Product creation is real.** `createCatalogueProduct` posts to `POST /api/products` and the saved product appears in the console, the storefront, product pages, the bag, and checkout.
- Every other section uses local demo state. Orders, jobs, candidates, partners, customers, and reviews are seeded for layout review, and the API exposes no update or delete endpoints, so the row actions explain what is not persisted instead of pretending to save.

Add-product images support 1–10 JPEG, PNG, or WebP files, each up to **1200 × 1200 px** and **300 KB**. Images can be chosen, drag-and-dropped, picked from the in-app library, previewed, and removed before saving. Demo sign-in is still client-side only: do not expose product management or other admin APIs publicly until server-side authentication and authorization are added.

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

`db/init.sql` creates the contact-request, newsletter-subscriber, product, product-image, order, and order-item tables. Docker runs it when creating a fresh data volume, and `npm run db:migrate:local` and `npm run db:migrate:production` apply it plus every file in `db/migrations/` to an existing database. `005_admin_console.sql` adds the publishing columns and the console tables, `006_store_settings.sql` the default store settings, and `007_admin_users.sql` the demo console accounts. Docker's PostgreSQL entrypoint does not rerun initialization scripts on an already-initialized volume, so use the migrate commands after changing the schema.

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

`src/server/schema-drift.test.ts` covers the deployment-ahead-of-database behaviour against a fake database that raises `42P01` and `42703`, so no live database is needed. To check it for real rather than against a mock, start `npm run db:mirror:up -- --through 004` and read `GET /api/products` (expect `200` with the products treated as published), `GET /api/site/pages` (expect `200` with the bundled page list) and `POST /api/admin/session` (expect `503` `schema_not_migrated`).

`npm run test:e2e` runs the storefront suite against the Vite development server. `npm run test:e2e:dist` builds the app, serves `dist` with the same routing rules as the deployment, and runs `e2e/deployment.spec.ts` against it, so a broken production route fails the build rather than reaching users. It asserts that every storefront route deep links to the built app, that a refresh keeps working, that the app's own not-found page is served instead of the hosting 404 page, that no page request returns 4xx or 5xx, that API requests still reach the API layer, and that path traversal cannot read files outside the build output. The routing rules themselves are unit tested in `src/lib/vercel-routing.test.ts`, which fails if `vercel.json` loses its rewrite or starts sending `/api` requests to the app.

## Deploy to Vercel

Import this repository into Vercel, keep the Vite framework/build defaults from `vercel.json`, and set `DATABASE_URL` in the Vercel project environment to the same Neon pooled connection string that `PRODUCTION_DATABASE_URL` holds in your local `.env`. If Neon is linked through the Vercel integration you can skip that and let the injected variables satisfy the API. Then run `npm run db:migrate:production` once and verify with `/api/health`; see [Production setup on Vercel](#production-setup-on-vercel). The browser app is served from `dist`; the `api/` TypeScript files run as Vercel Node.js functions. Do not commit `.env` or deploy local database credentials.

The storefront is a single-page app, so `vercel.json` rewrites every non-API path to `/index.html`. Without that rewrite, Vercel looks for a file that matches each URL, and deep links or refreshes such as `/shop`, `/product/4`, or `/admin` return Vercel's "404 NOT_FOUND" page instead of the app. Two details keep this safe: the rewrite source `/:path((?!api/).*)` excludes `/api/*`, and Vercel checks the filesystem before applying rewrites, so built assets and images under `/assets` and `/images` are still served as files rather than the HTML shell. Keep `cleanUrls` off; with `cleanUrls: true` the rewrite destination must be written without the `.html` extension.

To review a production build locally, run `npm run preview:dist` after `npm run build`. It serves `dist` through the deployment routing rules, so deep links, assets, and API paths behave like they do on Vercel. Its API responses are stand-in JSON, so use `npm run dev` for real form submissions, saved products, and orders.
