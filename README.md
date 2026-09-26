# Glow & Grace

A responsive React storefront and beauty-career platform inspired by `Design/glow-and-grace-elegant 1.html`. The working app includes a product catalogue, category filters, product pages, a persistent bag and wishlist, sign-in and candidate/partner/admin demo portals, partner salons, career listings, contact requests, and newsletter signups. The typography uses the reference's Cormorant Garamond / Jost font pairing, 16 px base size, and matching heading and navigation scale.

## Stack

- React 19, TypeScript, Vite, and React Router
- PostgreSQL locally in Docker Compose; Neon PostgreSQL for production
- Parameterized `pg` queries and Zod validation in the API
- Vercel static hosting and Node.js serverless API functions
- Vitest / Testing Library for UI and API unit tests; Playwright for browser E2E tests

## Local setup

Requirements: Node.js 22+, npm, and Docker Desktop (or another Docker Compose runtime).

1. Copy `.env.example` to `.env` and adjust the local database password if needed. `.env` is ignored by Git.
2. Install packages with `npm install`.
3. Start the local database with `npm run db:up`. Compose initializes it from `db/init.sql` and keeps data in the `glow-grace-data` volume.
4. Start the API and Vite development server with `npm run dev`.
5. Open `http://localhost:5173`.

The storefront and catalogue work without a database. Contact, newsletter, and checkout submissions require the local PostgreSQL container to be running. Check `http://localhost:3001/api/health` for API liveness. Stop the local database with `npm run db:down`; this keeps its named volume and data. To intentionally remove local database data, run `docker compose down -v`.

## Sign-in and portal previews

Choose **Sign in** in the header and open **Explore a demo account** to fill in one of the sample profiles. Each preview account uses the password `demo123`: `customer@glowngrace.in`, `candidate@glowngrace.in`, `partner@glowngrace.in`, or `admin@glowngrace.in`. Candidate, partner, and administrator previews have working in-page dashboard tabs; the customer preview opens the shop. Saved wishlist items persist in the browser.

These sample accounts and dashboards are front-end previews only. Their role selection is stored in local browser storage, without password hashing, server-side authorization, or a production authentication provider. Do not use these demo credentials or portal previews to protect real customer or business data; production authentication and server-side role authorization must be added before making protected portals available publicly.

The administrator catalogue includes an **Add a product** preview form. Submitting it displays a demo notice; it does not create or persist catalogue records because product management is not connected to a backend yet.

## Environment

All application/deployment settings use these environment variable names. For local Docker development, `.env` supplies both Compose and the API:

| Variable | Used by | Description |
| --- | --- | --- |
| `DATABASE_URL` | API | PostgreSQL connection string. Use the local Docker URL in `.env`; use Neon’s pooled connection string in Vercel. |
| `POSTGRES_DB` | Docker Compose | Local database name. |
| `POSTGRES_USER` | Docker Compose | Local database user. |
| `POSTGRES_PASSWORD` | Docker Compose | Local database password; replace the example value for personal deployments. |
| `POSTGRES_PORT` | Docker Compose | Host port for the local PostgreSQL container (default `5435`; change it in `.env` if the port is already in use). |
| `PORT` | Local API | Express API port (defaults to `3001` if omitted). |
| `VITE_API_BASE_URL` | Vite | Browser-visible API prefix; keep this as `/api`. Never put secrets in a `VITE_` variable. |

For production, connect the Vercel project to Neon and add `DATABASE_URL` to the Vercel project's **Settings → Environment Variables** for the Production environment (and Preview if desired). Use the Neon connection string with SSL enabled; keep the password in Vercel, not in source control or a browser variable. The serverless endpoints are `/api/contact`, `/api/newsletter`, and `/api/checkout`. Vercel injects project environment variables at runtime; local `.env` values are not deployed.

If using the Vercel CLI locally, link the project with `vercel link` and import the desired Vercel environment with `vercel env pull .env`. This replaces the local `.env`; restore the Docker `DATABASE_URL` before running local form submissions.

## Database

`db/init.sql` creates the contact-request, newsletter-subscriber, order, and order-item tables. Docker runs it when creating a fresh data volume. To add checkout tables to a database created before checkout was added, apply `db/migrations/002_orders.sql` to the local Docker database and Neon production database before deploying code that depends on them. Docker's PostgreSQL entrypoint does not rerun initialization scripts on an already-initialized volume.

Checkout validates the customer's delivery/contact details and product IDs on the server, looks up all prices from the product catalogue, calculates 5% GST and delivery charges, and atomically saves the order and its line items. Delivery costs are free for standard, ₹49 for express, and ₹99 for same-day delivery. Cash on delivery is the only enabled payment option; UPI, cards, and net banking are visibly marked as coming soon because no payment provider is configured. Do not collect or store payment-card details. The order confirmation includes its order number and COD total; confirmation details are kept in the browser's current navigation state rather than exposed through a public order-lookup endpoint.

The application opens a lazy, small (`max: 1`) PostgreSQL pool, which suits Vercel's short-lived function instances and works with both Neon and the local Docker database.

## Quality checks

```sh
npm run lint
npm run build
npm run test
npm run test:e2e
```

Playwright runs Chromium in desktop and mobile emulation. Install its browser once with `npx playwright install chromium`. The E2E server starts automatically; browser tests cover storefront navigation, product and wishlist interactions, checkout delivery/tax calculations and failure recovery, portal access, the administrator add-product preview flow, contact submission, and responsive layouts. API unit tests cover validation and server-calculated atomic persistence without requiring a live database. To verify real local orders, apply the migration if needed, start Docker and the app, and place a COD test order.

## Deploy to Vercel

Import this repository into Vercel, keep the Vite framework/build defaults from `vercel.json`, and set `DATABASE_URL` in the Vercel project environment. Run `npm run build` before deploying. The browser app is served from `dist`; the `api/` TypeScript files run as Vercel Node.js functions. Do not commit `.env` or deploy local database credentials.
