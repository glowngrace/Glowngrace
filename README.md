## Environment

Every setting lives in `.env` at the project root; nothing is hard-coded and no secret is committed. `.env` is ignored by Git, and `.env.example` is the committed template.

| Variable | Used by | Description |
| --- | --- | --- |
| `PORT` | Local API | Express API port (defaults to `3001` if omitted). |
| `VITE_API_BASE_URL` | Vite | Browser-visible API prefix; keep this as `/api`. Never put secrets in a `VITE_` variable. |
| `SMTP_*`, `MAIL_FROM` | Mailer | How the owner's password is delivered. See [Sending the owner's password](#sending-the-owners-password). |
| `OWNER_PINNED_PASSWORD` | API seed | A hand-chosen owner password for this process. Only honoured together with `OWNER_PINNED_HOLD_UNTIL`, and both stop mattering at the next restart. |
| `OWNER_PINNED_HOLD_UNTIL` | API seed | When the weekly rotation takes the pinned password back. ISO 8601, and at most 30 days out. |

There are no connection strings to set. Anything that used to name a database is ignored.

### Production setup on Vercel

Nothing to provision. Build the project, deploy, and check that `/api/health` answers `"status": "ok"`.

**Leave behind anything that looks like a connection string.** A leftover `DATABASE_URL` or `POSTGRES_*` in the Vercel project is dead weight at best, and at worst a live credential for a database this code no longer talks to. Delete it, then rotate anything it held.

## Store health

`/api/health` reports the store. It never returns a password, because there is no connection to leak one from.

| `status` | Meaning | Fix |
| --- | --- | --- |
| `ok` (HTTP 200) | The process came up with its tables. | Nothing. |
| `error` (HTTP 503) | The store could not be read. `reason` explains which. | Restart the instance. |

`store`, `tables`, `rows` and `productCount` describe **this process**, not a server. A non-zero `rows.products` means somebody saved a product since this instance started, and it returns to zero when the instance is replaced.

This is a liveness check, not a durability one. Nothing here can tell you whether an order placed yesterday is still there, because whether it is depends on whether the instance that took it is still the instance you are asking.

## The store's schema

`src/server/database.ts` declares every table and column in a single `tables` array. That array **is** the schema: there is no migration to apply and nothing can drift from it.

Adding a product column means changing two places that have to agree — the table definition, and the query fragments in `src/server/catalogue.ts`:

| List | Columns |
| --- | --- |
| `baseProductColumns` | `id` … `description` |
| `publishingColumns` | `published`, `featured`, `updated_at` |
| `productDetailColumns` | `slug`, `meta_title`, `meta_description`, `shades`, `highlights`, `features_and_specification`, `measurement`, `material_and_care`, `additional_details`, `item_details` |

`src/server/catalogue-columns.test.ts` fails if a query in `admin.ts` or `handlers.ts` names a `products` column that none of those lists declare, which is the assertion that stops the two drifting apart.

A column named in a query but missing from the store is an **error**, not an empty value: the executor refuses to resolve it. That is the opposite of the old behaviour, where an absent column was quietly swapped for `NULL::TEXT` and a product silently lost its slug.

Checkout validates the customer's delivery/contact details and product IDs on the server, looks up all prices from the product catalogue, calculates 5% GST and delivery charges, and saves the order and its line items. Delivery costs are free for standard, ₹49 for express, and ₹99 for same-day delivery. Cash on delivery is the only enabled payment option; UPI, cards, and net banking are visibly marked as coming soon because no payment provider is configured. Do not collect or store payment-card details. The order confirmation includes its order number and COD total; confirmation details are kept in the browser's current navigation state rather than exposed through a public order-lookup endpoint.

The order and its lines are separate statements, so they are **not** written as a unit: a failure after the order lands leaves an order behind with no lines. A product save that fails while writing an image has the same problem. Real transactions in the store are the fix, and they have not been added.