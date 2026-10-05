## Databases

The shop runs on **PostgreSQL**. Which PostgreSQL depends on one switch.

| `USE_LOCAL_DATABASE` | The app talks to | Used by |
| --- | --- | --- |
| `true` | `DATABASE_URL`, and nothing else | Development, the e2e run, `npm start local`. |
| unset or `false` | The first runtime connection string present, which on Vercel is the one Neon injects | The deployment. |

There is also an in-memory store, kept for the unit tests that never open a socket.
A process with no connection string and no flag uses it, and `/api/health` then says
`"store": "memory"`. Nothing in development or production is *meant* to take that
path.

On Vercel it reports `"status": "error"` rather than `ok`, and names the fix. That is
deliberate: the in-memory store answers every request successfully while keeping
nothing, so a deployment missing its database variable looks like a healthy site right
up until a cold start discards it. It was, in fact, live that way - see
[`/api/health` on a deployment with no database](#api-health-on-a-deployment-with-no-database).

With `USE_LOCAL_DATABASE=true`, a `DATABASE_URL` that resolves to a remote host is
**refused** rather than obeyed. Local work must never read or write production by
accident; `ALLOW_REMOTE_DATABASE=true` overrides it if you really mean it.

This covers the scripts as well as the server. `db:seed`, `db:migrate` and
`db:check` resolve the local database directly rather than through the request
path, and they carry the same guard — before that, a Neon URL sitting in
`DATABASE_URL` was seeded as though it were the local container.

Which SSL variable applies is decided by **where the host actually is**, not by
which target was asked for. A remote host reached through a local target inherits
`DATABASE_SSL`, never `LOCAL_DATABASE_SSL`: the container speaks plain TCP, so
`LOCAL_DATABASE_SSL=disable` dialled a remote host in cleartext and overrode the
`sslmode=require` in its own connection string.

| | Local | Production |
| --- | --- | --- |
| What | PostgreSQL 16 in Docker, port `5435`, named volume | Neon, `neon-glowngraceproddb`, region `aws-ap-southeast-2` |
| Connection string | `DATABASE_URL` | `DATABASE_URL` or `NEON_DATABASE_URL` — either one is enough on its own (`PRODUCTION_DATABASE_URL` is *not*, it is sync-only) |
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

Fills an empty database with the sample content the storefront ships with: the
owner account, the console's pages and settings, and the bundled catalogue from
`src/data/catalog.ts`.

**The catalogue is written before the sample orders, not after.** `order_items`
carries a denormalised `product_name` and resolves its `product_id` from it by
joining `products`, so an order line can only be attached to a product that
exists. Seeding them the other way round - which is what this used to do - left
every line pointing at an id that was never issued, and nothing complained,
because `order_items.product_id` has no foreign key on it. Any line whose name
matches nothing is skipped and reported rather than invented.

> `products.id` is `GENERATED ... START WITH 9`, so the seeded ids are `9`–`16`
> on a fresh database and **not** `1`–`8` as the bundled catalogue in
> `src/data/catalog.ts` numbers its own array. A deep link has to carry a real id.
> `db:seed --reset` deletes and reinserts the catalogue without rewinding the
> sequence, so ids move again on every reseed — read them from `/api/products`
> rather than hardcoding them.

The owner's password is generated, written to the `email_outbox` table, printed to
the console, and emailed. `OWNER_PINNED_PASSWORD` is honoured if you set it, but
nothing in this project sets it — see [The owner password](#the-owner-password).

### `db:check`

Prints the same report as `/api/health` for whichever databases are configured:
which tables exist, which of the required ones are missing, and the connection
string with the password left out. It is the first thing to run when the local
database looks wrong.

It also fails (exit 1) when any `order_items` row points at a `product_id` that
does not exist, and says which migration repairs it. That check exists because the
dangling ids above were invisible from every other angle: the storefront reads
`product_name`, the schema does not constrain the column, and the seed reported
success.

## The owner password

Nobody chooses the Super Admin password. It is generated on the server, stored
hashed, written to `email_outbox`, and emailed to the owner address. It rotates
weekly, and every rotation ends every open session.

| | |
| --- | --- |
| Where it lands | The owner address, plus the `email_outbox` table (kept as the record, and how you read it when SMTP is not configured) |
| Where it never lands | The browser, the API response, the console, the logs |
| Who can ask for a new one | The `Super Admin` account, on `POST /api/admin/owner-password/generate` |

### `/superadmin/ggpass`

The screen that does it on demand — sign in as the owner and open
`/superadmin/ggpass`. Use it after a suspected compromise, a lost mailbox, or
whenever somebody leaves.

It asks the server who is signed in rather than trusting what is in
`localStorage`, so an edited role string cannot reveal the button. It confirms
before acting, because the call ends the caller's own session. And it **never
shows the password**: there is no field to copy out of and no value in the
response, so a screen recording, a shared screen or the network tab has nothing
to pick up. If the mail does not arrive, generate another one — that is cheap and
safe to repeat, which is a better failure mode than a password on a page.

The destination is shown in a fixed field — the owner address, prefilled, readonly and
disabled. Nobody can send the owner password somewhere else by typing over it, and the
address is on screen *before* anything is pressed, so nobody discovers at the last
moment that they cannot reach the mailbox.

The page also reads `/api/health` on arrival. If the deployment has no database, or no
mail settings, it says which and disables the button rather than reporting a rotation
that cannot survive the next request — see
[`/api/health` on a deployment with no database](#api-health-on-a-deployment-with-no-database).
An unreachable health route is treated as unknown, not as a fault, so a network hiccup
does not take a working feature away.

The page hiding the button is a courtesy. The guard that counts is on the server:
the endpoint re-reads the session and answers `403` to anything but the owner
role, so it is safe to reach by typing the URL and safe to call directly. Both
gates are covered by tests.

### How the retry reaches a serverless deployment

A rotation whose first send attempt failed leaves the row in `email_outbox` with
`sent_at` null, and something later has to try again. Locally that is
`startMailDelivery`, an interval started by the Express server.

Vercel has no such server. Every request is its own function, frozen the moment it
answers, so no interval ever fires and nothing was retrying a failed send. The design
assumed "the next pass tries again"; on serverless there is no next pass.

So the retry also rides along on admin requests. An empty outbox costs one indexed
lookup and no network, and a pass only runs if something is waiting, so the ordinary
request path is unaffected. The pass is fired rather than awaited — a slow relay adds
nothing to the response — and one pass runs at a time, so two concurrent requests
cannot send the same credential twice.

### Getting the password into an inbox

Delivery needs a mail server, and nothing here works without one being named. The
password is generated and stored either way — a rotation cannot fail because mail
is unavailable — but until the settings below are present the `email_outbox` row is
the only copy, and it has to be read out of the table by hand:

```sql
SELECT body FROM email_outbox WHERE kind = 'owner-credentials'
ORDER BY created_at DESC LIMIT 1;
```

With them set, the same row is emailed and `sent_at` is stamped on it. That column
is the delivery marker: `NULL` means the message is still the only copy of that
password and the next pass retries it, and a timestamp means it went out and must
never be repeated — a superseded message is never sent even after a rotation,
because it holds a password that no longer opens anything.

Gmail needs an **App Password**, not the account password. Create one at
<https://myaccount.google.com/apppasswords> with 2-Step Verification on; it is 16
characters and Gmail displays it with spaces, which must be stripped.

Both spellings of each setting are read, and `SMTP_*` wins where both are set —
so a hosting provider's own names work without being translated first:

| `SMTP_*` | `MAIL_*` alias | Default |
| --- | --- | --- |
| `SMTP_HOST` | `MAIL_HOST` | required |
| `SMTP_PORT` | `MAIL_PORT` | `587` |
| `SMTP_USER` | `MAIL_USERNAME` | required |
| `SMTP_PASSWORD` | `MAIL_PASSWORD` | required |
| `SMTP_SECURE` | `MAIL_ENCRYPTION` | `true` on port 465, `false` everywhere else |
| `MAIL_FROM` | `MAIL_FROM_ADDRESS` | `SMTP_USER` |
| — | `MAIL_FROM_NAME` | none; the inbox shows the bare address |

The two encryption spellings are deliberately not interchangeable.
`SMTP_SECURE` is a boolean about the connection mode; `MAIL_ENCRYPTION` names the
protocol, so `tls`/`starttls` means *negotiated after connecting* (port 587) and
`ssl` means *encrypted up front*. Reading `MAIL_ENCRYPTION=tls` as implicit TLS
would fail the connection against a protocol error that names neither the setting
nor the port, so it is not what it does. Port 465 always means implicit TLS — no
relay offers STARTTLS there — and there is deliberately no setting that ships the
password in plain text.

`MAIL_FROM_NAME` is quoted and bracketed for you, because an unquoted display name
containing a space parses as two addresses.

## Environment

Nothing is hard-coded and no secret is committed. `.env` is ignored by Git and is
the shared template; `.env.local` is ignored too, is loaded **first**, and is where
real passwords go. `.env.local.example` is the committed starting point.

| Variable | Used by | Description |
| --- | --- | --- |
| `USE_LOCAL_DATABASE` | Everything | The switch above. `true` for local work. |
| `DATABASE_URL` | Local, production | The local Docker database when `USE_LOCAL_DATABASE` is on — then it is the only variable the app reads. In production it is the first name checked for the connection string, and the one Vercel's Neon integration injects on its own. |
| `LOCAL_DATABASE_SSL` | Local | `disable` — the container speaks plain TCP, so there is no certificate to verify. |
| `NEON_DATABASE_URL` | Sync, production | The pooled Neon connection string. Also read on every production request, so setting it is enough on its own — it is not sync-only. |
| `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL` | Production | Accepted aliases for the production connection string, in that order after the two above. Use whichever your provider hands you. |
| `PRODUCTION_DATABASE_URL` | Sync | Configures the remote for the sync only; a request will not read it. |
| `DATABASE_SSL` | Production | `require` unless the connection string's `sslmode` says otherwise. |
| `SYNC_FROM_PRODUCTION` | Sync | Whether the console may reach for Neon at all. Off by default. |
| `NEON_API_KEY`, `NEON_ORG_ID`, `NEON_PROJECT_NAME`, `NEON_REGION_ID` | `neon:provision` | Only needed to create the Neon project. |
| `DATABASE_POOL_MAX` | Pool | Defaults to `1`. Every request is a single short query, and a second connection on a pooled endpoint buys a second compute slot, not throughput. |
| `PORT` | Local API | Express API port (defaults to `3001`). |
| `VITE_API_BASE_URL` | Vite | Browser-visible API prefix; keep this as `/api`. Never put secrets in a `VITE_` variable. |
| `SMTP_*` / `MAIL_*`, `MAIL_FROM`, `MAIL_FROM_NAME` | Mailer | How the owner's password is delivered. Unset means the password lands in `email_outbox` and nowhere else. See [Getting the password into an inbox](#getting-the-password-into-an-inbox). |
| `OWNER_PINNED_PASSWORD` | Seed | Not used by this project. A hand-chosen owner password, honoured only alongside `OWNER_PINNED_HOLD_UNTIL`, and both stop mattering at the next restart. See [The owner password](#the-owner-password). |
| `OWNER_PINNED_HOLD_UNTIL` | Seed | Not used by this project. When the weekly rotation takes a pinned password back. ISO 8601, and at most 7 days out. |

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

**Leave behind anything that looks like a connection string to the wrong database.**
The names above are checked in order, so a stray `DATABASE_URL` pointing somewhere
unintended will be preferred over the variable you meant to use. Check
`/api/health`, which reports the variable it resolved and a masked host, then unset
the ones you did not mean and rotate whatever they held.

The mail settings belong in Vercel's environment too, or `/superadmin/ggpass` will
rotate the owner password into `email_outbox` and nowhere else. The startup log
says which it found:

```
Owner credentials will be emailed through smtp.gmail.com:587 as "GG Security" <…>.
```

If it instead says `No SMTP settings found`, the names are missing or misspelled
rather than merely unconfigured — a missing value and an unread one are the same
failure here, and both leave the password sitting in the outbox. Set the same
variables documented under
[Getting the password into an inbox](#getting-the-password-into-an-inbox). The
App Password is a live credential for the mailbox: rotate it if it has been in a
file that was committed, a screenshot, or a chat.

## Store health

`/api/health` reports the store. It never returns a password: the host is masked
where it is remote, and no connection string is echoed back.

| `status` | Meaning | Fix |
| --- | --- | --- |
| `ok` (HTTP 200) | The process came up with its tables. | Nothing. |
| `error` (HTTP 503) | The store could not be read, or the deployment has no database at all. `reason` explains which. | `npm run db:check`, then restart. Or see below. |

`store` is `postgres` or `memory`. `tables`, `rows` and `productCount` describe
**the database this process is connected to**. Against `memory` they describe this
instance and return to zero when it is replaced; against PostgreSQL they survive a
restart, and on a deployed Neon they are the production numbers, which is worth
remembering before pasting `/api/health` into a chat.

`mail` is `configured` or `absent`, and `mailPending` counts owner credentials written
but not yet sent. `configured` only means the settings were *read* — whether the relay
accepts mail is something only a real send would find out. `mailPending` staying above
zero is a send that failed and has not been retried yet; see
[How the retry reaches a serverless deployment](#how-the-retry-reaches-a-serverless-deployment).

### `/api/health` on a deployment with no database

On Vercel, in-memory is not a choice — it is what happens when the database variable
is missing from the project settings. This is not hypothetical: the deployment served
from memory for a week while `/api/health` answered `status: ok` and every page worked,
because nothing in the request path can tell that a write went into a store that will
be thrown away. Nothing alerted. The first sign of trouble would have been a customer
reporting a missing order.

So on Vercel the report is `status: "error"` with `reason` naming the variables it
accepts:

```
{ "status": "error", "store": "memory", "reason": "This deployment has no database configured… Set one of DATABASE_URL, NEON_DATABASE_URL, DATABASE_URL_UNPOOLED, POSTGRES_URL, POSTGRES_PRISMA_URL…" }
```

That list is `runtimeDatabaseVariables` from `src/server/config.ts`, and the message is
built from it rather than written out, so the two cannot drift apart.

The HTTP status is still 200, because a body that says `error` is a successful answer
to the question. Off Vercel the same store stays `ok`: in memory is a legitimate choice
for an unconfigured checkout and for the unit tests, and only on a deployment does it
mean a setting is missing.

`/superadmin/ggpass` reads this and refuses to generate a password when the store is
`memory` or mail is `absent`, rather than reporting a rotation that cannot survive the
next request.

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