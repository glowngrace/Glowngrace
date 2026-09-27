# Glow & Grace

A responsive React storefront and beauty-career platform inspired by `Design/glow-and-grace-elegant 1.html`. The working app includes a product catalogue, category filters, product pages, a persistent bag and wishlist, sign-in and candidate/partner/admin demo portals, partner salons, career listings, contact requests, and newsletter signups. The typography uses the reference's Cormorant Garamond / Jost font pairing, 16 px base size, and matching heading and navigation scale.

## Stack

- React 19, TypeScript, Vite, and React Router
- PostgreSQL locally in Docker Compose; Neon PostgreSQL for production
- Parameterized `pg` queries and Zod validation in the API
- Vercel static hosting and Node.js serverless API functions, with a single-page-app rewrite for deep links
- Vitest / Testing Library for UI and API unit tests; Playwright for browser E2E tests, including a production-build deployment suite

## Local setup

Requirements: Node.js 22+, npm, and Docker Desktop (or another Docker Compose runtime).

1. Copy `.env.example` to `.env` and adjust the local database password if needed. `.env` is ignored by Git.
2. Install packages with `npm install`.
3. Start the local database with `npm run db:up`. Compose initializes it from `db/init.sql` and keeps data in the `glow-grace-data` volume.
4. Start the API and Vite development server with `npm run dev`.
5. Open `http://localhost:5173`.

The starter storefront works without a database. Loading and saving administrator products, contact and newsletter submissions, and checkout require the local PostgreSQL container to be running. Check `http://localhost:3001/api/health` for API liveness. Stop the local database with `npm run db:down`; this keeps its named volume and data. To intentionally remove local database data, run `docker compose down -v`.

## Sign-in and portal previews

Choose **Sign in** in the header and open **Explore a demo account** to fill in one of the sample profiles. Each preview account uses the password `demo123`: `customer@glowngrace.in`, `candidate@glowngrace.in`, `partner@glowngrace.in`, or `admin@glowngrace.in`. Candidate, partner, and administrator previews have working in-page dashboard tabs; the customer preview opens the shop. Saved wishlist items persist in the browser.

These sample accounts and dashboards are front-end previews only. Their role selection is stored in local browser storage, without password hashing, server-side authorization, or a production authentication provider. Do not use these demo credentials or portal previews to protect real customer or business data; production authentication and server-side role authorization must be added before making protected portals available publicly.

The administrator catalogue can add products to PostgreSQL; saved products also appear in the storefront, product pages, bag, and checkout. Add-product images support 1–10 JPEG, PNG, or WebP files, each up to **1200 × 1200 px** and **300 KB**. Images can be selected or drag-and-dropped, previewed, and removed before saving. Demo sign-in is still client-side only: do not expose product management or other admin APIs publicly until server-side authentication and authorization are added.

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

For production, connect the Vercel project to Neon and add `DATABASE_URL` to the Vercel project's **Settings → Environment Variables** for the Production environment (and Preview if desired). Use the Neon connection string with SSL enabled; keep the password in Vercel, not in source control or a browser variable. The serverless endpoints are `/api/contact`, `/api/newsletter`, `/api/checkout`, and `/api/products`; uploaded product images are served from `/api/products/:productId/images/:imageIndex`. Vercel injects project environment variables at runtime; local `.env` values are not deployed.

If using the Vercel CLI locally, link the project with `vercel link` and import the desired Vercel environment with `vercel env pull .env`. This replaces the local `.env`; restore the Docker `DATABASE_URL` before running local form submissions.

## Database

`db/init.sql` creates the contact-request, newsletter-subscriber, product, product-image, order, and order-item tables. Docker runs it when creating a fresh data volume. For an existing database, apply `db/migrations/002_orders.sql`, `db/migrations/003_products.sql`, and `db/migrations/004_product_image_dimensions.sql` before deploying code that depends on those tables. Docker's PostgreSQL entrypoint does not rerun initialization scripts on an already-initialized volume.

Checkout validates the customer's delivery/contact details and product IDs on the server, looks up all prices from the product catalogue, calculates 5% GST and delivery charges, and atomically saves the order and its line items. Delivery costs are free for standard, ₹49 for express, and ₹99 for same-day delivery. Cash on delivery is the only enabled payment option; UPI, cards, and net banking are visibly marked as coming soon because no payment provider is configured. Do not collect or store payment-card details. The order confirmation includes its order number and COD total; confirmation details are kept in the browser's current navigation state rather than exposed through a public order-lookup endpoint.

The application opens a lazy, small (`max: 1`) PostgreSQL pool, which suits Vercel's short-lived function instances and works with both Neon and the local Docker database.

## Quality checks

```sh
npm run lint
npm run build
npm run test
npm run test:e2e
npm run test:e2e:dist
```

Playwright runs Chromium in desktop and mobile emulation. Install its browser once with `npx playwright install chromium`. The E2E server starts automatically; browser tests cover storefront navigation, product and wishlist interactions, checkout delivery/tax calculations and failure recovery, portal access, administrator product/image creation, contact submission, and responsive layouts. API unit tests cover validation and server-calculated persistence without requiring a live database. To verify saved products or real local orders, apply the migrations if needed, start Docker and the app, and create a test product or place a COD test order.

`npm run test:e2e` runs the storefront suite against the Vite development server. `npm run test:e2e:dist` builds the app, serves `dist` with the same routing rules as the deployment, and runs `e2e/deployment.spec.ts` against it, so a broken production route fails the build rather than reaching users. It asserts that every storefront route deep links to the built app, that a refresh keeps working, that the app's own not-found page is served instead of the hosting 404 page, that no page request returns 4xx or 5xx, that API requests still reach the API layer, and that path traversal cannot read files outside the build output. The routing rules themselves are unit tested in `src/lib/vercel-routing.test.ts`, which fails if `vercel.json` loses its rewrite or starts sending `/api` requests to the app.

## Deploy to Vercel

Import this repository into Vercel, keep the Vite framework/build defaults from `vercel.json`, and set `DATABASE_URL` in the Vercel project environment. The browser app is served from `dist`; the `api/` TypeScript files run as Vercel Node.js functions. Do not commit `.env` or deploy local database credentials.

The storefront is a single-page app, so `vercel.json` rewrites every non-API path to `/index.html`. Without that rewrite, Vercel looks for a file that matches each URL, and deep links or refreshes such as `/shop`, `/product/4`, or `/admin` return Vercel's "404 NOT_FOUND" page instead of the app. Two details keep this safe: the rewrite source `/:path((?!api/).*)` excludes `/api/*`, and Vercel checks the filesystem before applying rewrites, so built assets and images under `/assets` and `/images` are still served as files rather than the HTML shell. Keep `cleanUrls` off; with `cleanUrls: true` the rewrite destination must be written without the `.html` extension.

To review a production build locally, run `npm run preview:dist` after `npm run build`. It serves `dist` through the deployment routing rules, so deep links, assets, and API paths behave like they do on Vercel. Its API responses are stand-in JSON, so use `npm run dev` for real form submissions, saved products, and orders.
