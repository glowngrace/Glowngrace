# Local database

PostgreSQL 16 in Docker, on port **5435**, in a named volume. It is the database
every local change is tested against: `npm start local` starts it, applies the
migrations, seeds the catalogue and then runs the app on it.

Port 5435 rather than 5432 so a PostgreSQL you already run on your own machine
keeps 5432 to itself.

## Starting and stopping

| Command | What it does |
| --- | --- |
| `npm run db:up` | Start it and wait until it accepts a query. |
| `npm run db:status` | Is it running, and what version is it on? |
| `npm run db:logs` | Follow its log. |
| `npm run db:down` | Stop it, keeping the data. |
| `npm run db:reset` | Throw the data away and start over. |
| `npm run db:destroy` | Stop it and delete the volume for good. |
| `npm start local` | `up` → `migrate` → `seed` → run the storefront and the API on it. |
| `npm start local:api` | The API on its own, for driving the browser yourself. |

`db/up` waits on `pg_isready`, so "up" means "will accept a query" rather than
"running but still initialising".

## Credentials

They come from the environment, not from this directory, so the same compose file
works whatever `.env.local` says. With nothing set it is `glow_grace` /
`glow_grace` / `glow_grace_local` on `localhost:5435`.

Compose reads `.env` from **its own directory**, not from the repository root. If
you would rather keep the overrides out of the root `.env.local`, put them in
`local-dev/.env`:

```ini
POSTGRES_DB=glow_grace
POSTGRES_USER=glow_grace
POSTGRES_PASSWORD=change-this-local-password
POSTGRES_PORT=5435
```

`POSTGRES_PASSWORD` is read once, by the Postgres image, on the first run against
an empty data directory. Changing it later means either changing `DATABASE_URL` to
match the old password or running `npm run db:destroy` and starting over.

## What gets created, and when

| | |
| --- | --- |
| Volume | `glow-grace-local-data`, created on first start. |
| Schema | `db/init.sql` is applied by the image on the first start, when the volume is still empty. |
| Migrations | `db/migrations/*.sql`, applied by `npm run db:migrate`. All `IF NOT EXISTS`, so re-running is safe. |
| Catalogue | `npm run db:seed`. Idempotent: it only inserts the bundled products when `products` is empty. |
| Order | The catalogue is seeded **before** the sample orders, because `order_items.product_id` is resolved from `products` by name. Lines whose product name matches nothing are skipped and reported. |

So a brand-new volume gets `init.sql` from the image and then every migration on
top of it, which is why the migrations have to be safe to run against a schema that
already has the columns.

## Looking at it

Adminer, a browser UI for the database, sits behind a profile so it never starts as
part of `db:up`:

```bash
docker compose --profile tools up -d
```

Then open http://localhost:8081 and sign in with the `POSTGRES_*` credentials above.
`psql` works too:

```bash
docker exec -it glow-grace-local-db psql -U glow_grace -d glow_grace
```

## Getting production data into it

The local database starts as a seeded shop. When you need the real catalogue, the
real orders and the real pages, copy them down from Neon:

```bash
npm run db:sync            # or press the button in Admin → Settings
```

See the "Copying production data down" section of the [README](../README.md) for
what comes across, what does not, and the rules that keep it one-way.