## Databases

The shop runs on **PostgreSQL**. Which PostgreSQL depends on one switch.

| `USE_LOCAL_DATABASE` | The app talks to | Used by |
| --- | --- | --- |
| `true` | `DATABASE_URL`, and nothing else | Development, the e2e run, `npm start local`. |
| unset or `false` | The first runtime connection string present, which on Vercel is the one Neon injects | The deployment. |

There is also an in-memory store, kept for the unit tests that never open a socket.
A process with no connection string and no flag uses it, and `/api/health` then says
`"store": "memory"`. Nothing in development or production takes that path.

With `USE_LOCAL_DATABASE=true`, a `DATABASE_URL` that resolves to a remote host is
**refused** rather than obeyed. Local work must never read or write production by
accident; `ALLOW_REMOTE_DATABASE=true` overrides it if you really mean it.

| | Local | Production |
| --- | --- | --- |
| What | PostgreSQL 16 in Docker, port `5435`, named volume | Neon, `neon-glowngraceproddb`, region `aws-ap-southeast-2` |
| Connection string | `DATABASE_URL` | `NEON_DATABASE_URL` (or `PRODUCTION_DATABASE_URL`) |
| TLS | `LOCAL_DATABASE_SSL=disable` — plain TCP on localhost | `DATABASE_SSL=require`, certificate verified |
| Reached by | `npm run db:up`, `npm start local` | The Vercel deployment |

Full local setup, including Adminer and the volume rules: [local-dev/README.md](local-dev/README.md).

## Getting started locally

```bash
cp .env.local.example .env.local      # then put the local password in it
npm run db:up                          # start PostgreSQL on 5435
npm run db:migrate                     # apply db/migrations/*.sql
npm run db:seed                        # the owner account and the bundled catalogue
npm start local                        # all three of the above, then the app
```

`npm start local` is the whole sequence: `db:up`, `db:migrate`, `db:seed`, then the
storefront on `http://localhost:5173` and the API on `3001`. `npm start local:api` is
the same without the storefront, for when you want to drive the browser yourself.

### `db:seed`

Creates the owner account and, only when `products` is empty, the bundled
catalogue. The owner's password is generated and written to the `email_outbox`
table, unless `OWNER_PINNED_PASSWORD` and `OWNER_PINNED_HOLD_UNTIL` are both set —
both or neither, so a pinned password cannot quietly become permanent.

### `db:check`

Prints the same report as `/api/health` for whichever databases are configured:
which tables exist, which of the required ones are missing, and the connection
string with the password left out. It is the first thing to run when the local
database looks wrong.

## Environment

Nothing is hard-coded and no secret is committed. `.env` is ignored by Git and is
the shared template; `.env.local` is ignored too, is loaded **first**, and is where
real passwords go. `.env.local.example` is the committed starting point.

| Variable | Used by | Description |
| --- | --- | --- |
| `USE_LOCAL_DATABASE` | Everything | The switch above. `true` for local work. |
| `DATABASE_URL` | Local | The local Docker database. The only variable the app reads when the switch is on. |
| `LOCAL_DATABASE_SSL` | Local | `disable` — the container speaks plain TCP, so there is no certificate to verify. |
| `NEON_DATABASE_URL` | Sync | The pooled Neon connection string. Read only by the sync, never by a request. |
| `PRODUCTION_DATABASE_URL` | Sync | The same thing under the other name. Either one configures the remote. |
| `DATABASE_SSL` | Production | `require` unless the connection string's `sslmode` says otherwise. |
| `SYNC_FROM_PRODUCTION` | Sync | Whether the console may reach for Neon at all. Off by default. |
| `NEON_API_KEY`, `NEON_ORG_ID`, `NEON_PROJECT_NAME`, `NEON_REGION_ID` | `neon:provision` | Only needed to create the Neon project. |
| `DATABASE_POOL_MAX` | Pool | Defaults to `1`. Every request is a single short query, and a second connection on a pooled endpoint buys a second compute slot, not throughput. |
| `PORT` | Local API | Express API port (defaults to `3001`). |
| `VITE_API_BASE_URL` | Vite | Browser-visible API prefix; keep this as `/api`. Never put secrets in a `VITE_` variable. |
| `SMTP_*`, `MAIL_FROM` | Mailer | How the owner's password is delivered. |
| `OWNER_PINNED_PASSWORD` | Seed | A hand-chosen owner password. Only honoured with `OWNER_PINNED_HOLD_UNTIL`, and both stop mattering at the next restart. |
| `OWNER_PINNED_HOLD_UNTIL` | Seed | When the weekly rotation takes the pinned password back. ISO 8601, and at most 7 days out. |

## Copying production data down

The local database is a **disposable copy**, and this is the only thing in the
project that touches production. It is how the console, the storefront and the
test suite get to work against the real catalogue and the real orders without
anyone logging into production by hand.

```bash
npm run db:sync                        # or Admin → Settings → Sync from Neon
npm run db:sync -- --dry-run           # count the rows, write nothing
npm run db:sync -- --skip-images       # leave the local images alone
npm run db:sync -- --force             # copy even when nothing has changed
```

A sync **replaces** the contents of every table it touches. It is a transaction:
either all of it lands or none of it does, so a failure part way through cannot
leave a half-copied database.

### What comes across

Every table the application reads, plus `email_outbox`:

`contact_requests`, `newsletter_subscribers`, `products`, `product_images`,
`orders`, `order_items`, `admin_users`, `store_settings`, `site_pages`,
`job_vacancies`, `candidates`, `partner_salons`, `customers`, `reviews`,
`demo_datasets`, `email_outbox`.

### What does not, and why

| Left behind | Because |
| --- | --- |
| `admin_sessions` | A production session token that became valid against the local database is a way in nobody signed for. Your local session is not a copy of a production one. |
| `password_resets` | A reset code is a way to take an account over. Copying one onto a developer's machine hands over whatever it was issued for. |

The consequence is that **a sync signs you out of the console**: `admin_users` is
copied, the rows get production's ids, and the local session rows cascade away
with them. Sign in again with the account that came across.

### The rules it enforces

| Rule | What happens without it |
| --- | --- |
| `SYNC_FROM_PRODUCTION=true` and `USE_LOCAL_DATABASE=true` | With the switch off the endpoint answers `404`. A deployment never carries an endpoint that reads production. |
| Owner only | Any other role gets `403`. |
| The target must be a local host | A production-shaped host is refused. |
| Source and target must not be the same database | Refused before a connection is opened. |
| One direction only | Data flows Neon → local. Nothing writes to Neon, ever, and the failure message says so. |

It reads in pages of 500 rows and fingerprints every table first, so a second run
over unchanged data copies nothing and says so in a couple of hundred
milliseconds. A fingerprint is one query per side carrying the row count, the
newest row's timestamp and the highest key of every table, compared as the server's
own text so nothing is reformatted on the way through. An earlier version compared
`updated_at` values parsed through `Date`, which drops the microseconds PostgreSQL
stores, and so found a difference on every single run and copied the whole database
again.

## Production setup on Vercel

```bash
npm run neon:provision       # creates the Neon project, prints a connection string
```

The script needs a Neon API key from https://console.neon.tech/app/settings/api-keys
and is idempotent: run it again and it adopts the project it finds rather than
creating a second one. Paste the pooled `PRODUCTION_DATABASE_URL` it prints into the
Vercel project's environment, **unset** `USE_LOCAL_DATABASE`, and deploy. Check
`/api/health` answers `"status": "ok"`.

Neon's free tier is per-project; if the script answers that the quota is spent, that
is the account's limit and not something the script can work around.

**Leave behind anything that looks like a connection string.** A leftover
`DATABASE_URL` or `POSTGRES_*` in the Vercel project is dead weight at best, and at
worst a live credential for a database this code no longer talks to. Delete it, then
rotate anything it held.

## Store health

`/api/health` reports the store. It never returns a password: the host is masked
where it is remote, and no connection string is echoed back.

| `status` | Meaning | Fix |
| --- | --- | --- |
| `ok` (HTTP 200) | The process came up with its tables. | Nothing. |
| `error` (HTTP 503) | The store could not be read. `reason` explains which. | `npm run db:check`, then restart. |

`store` is `postgres` or `memory`. `tables`, `rows` and `productCount` describe
**the database this process is connected to**. Against `memory` they describe this
instance and return to zero when it is replaced; against PostgreSQL they survive a
restart, and on a deployed Neon they are the production numbers, which is worth
remembering before pasting `/api/health` into a chat.

## The store's schema

With `USE_LOCAL_DATABASE=true`, the schema is SQL: `db/init.sql` plus
`db/migrations/*.sql`, applied by `npm run db:migrate`. Every migration is
`IF NOT EXISTS`, so applying them twice is a no-op, and adding a column means
adding a migration rather than editing an existing one.

The in-memory store is still there for the unit tests, and it declares every table
and column in a single `tables` array in `src/server/database.ts`. That array is
the schema for those tests, and `src/server/catalogue-columns.test.ts` fails if a
query in `admin.ts` or `handlers.ts` names a `products` column that none of
`baseProductColumns`, `publishingColumns` or `productDetailColumns` declares — the
assertion that stops the query fragments and the column lists drifting apart.

A column named in a query but missing from the store is an **error**, not an empty
value: the executor refuses to resolve it. That is the opposite of the old
behaviour, where an absent column was quietly swapped for `NULL::TEXT` and a product
silently lost its slug.

Checkout validates the customer's delivery/contact details and product IDs on the
server, looks up all prices from the product catalogue, calculates 5% GST and
delivery charges, and saves the order and its line items. Delivery costs are free
for standard, ₹49 for express, and ₹99 for same-day delivery. Cash on delivery is
the only enabled payment option; UPI, cards, and net banking are visibly marked as
coming soon because no payment provider is configured. Do not collect or store
payment-card details. The order confirmation includes its order number and COD
total; confirmation details are kept in the browser's current navigation state rather
than exposed through a public order-lookup endpoint.

The order and its lines are separate statements, so they are **not** written as a
unit: a failure after the order lands leaves an order behind with no lines. A
product save that fails while writing an image has the same problem. The Neon sync
does run inside a transaction, because it empties and refills whole tables and has
to be all-or-nothing; checkout does not.