import 'dotenv/config';
import { loadEnvironment } from '../src/server/env.js';

loadEnvironment();

const { composeOrThrow, containerStatus, requireDocker, run, waitForDatabase } = await import('./lib/docker.js');

/**
 * What `npm start` does.
 *
 *   npm start                 the API server, exactly as it has always been
 *   npm start local           Docker database up, migrated, seeded if empty,
 *                             then the API and Vite together
 *   npm start local:api       the same, but only the API
 *
 * The dispatcher exists so `npm start local` can be the one command a new
 * contributor is told to run. It has to own the ordering - wait for PostgreSQL,
 * apply the schema, only then start anything that will query it - and the API
 * server itself has no business knowing what Docker is.
 */

const [command = 'api', ...rest] = process.argv.slice(2);
const skipMigrate = rest.includes('--no-migrate');
const skipSeed = rest.includes('--no-seed');

async function startApi() {
  // Same target as `npm start` always was. Nothing to add here on purpose: a
  // deployment that only runs the API should not also be managing a container.
  await run('npx', ['tsx', 'server/index.ts'], 'Starting the API server');
}

/** Is this volume completely empty, or is it a database somebody is using? */
async function neverSeeded(): Promise<boolean> {
  const { default: pg } = await import('pg');
  const { clientConfig, resolveLocalDatabase } = await import('../src/server/config.js');
  const client = new pg.Client(clientConfig(resolveLocalDatabase()));
  try {
    await client.connect();
    const result = await client.query<{ products: string; pages: string }>(
      `SELECT (SELECT count(*)::text FROM products) AS products,
              (SELECT count(*)::text FROM site_pages) AS pages`,
    );
    const row = result.rows[0] ?? { products: '0', pages: '0' };
    return Number(row.products) === 0 && Number(row.pages) === 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function startLocal() {
  requireDocker();

  if (containerStatus() === 'running') {
    console.log('The local database is already running.');
  } else {
    console.log('Starting the local database from local-dev/docker-compose.yml...');
    composeOrThrow(['up', '-d', '--wait', 'db']);
  }
  await waitForDatabase();
  console.log(`  ready on localhost:${process.env.POSTGRES_PORT ?? '5435'}, data kept in the glow-grace-local-data volume.`);

  if (!skipMigrate) {
    await run('npm', ['run', 'db:migrate'], 'Applying the schema');
  }

  if (!skipSeed && await neverSeeded()) {
    await run('npm', ['run', 'db:seed'], 'Seeding the sample catalogue (first run only)');
  }

  console.log('');
  console.log('  storefront  http://localhost:5173');
  console.log('  console     http://localhost:5173/admin');
  console.log('  API         http://localhost:' + (process.env.PORT ?? '3001') + '/api/health');
  console.log('');

  // `local` runs the storefront too, because that is what somebody typing it
  // wants; `local:api` is the headless version for a test run.
  await run('npm', command === 'local:api' ? ['run', 'dev:api'] : ['run', 'dev'],
    command === 'local:api' ? 'Starting the API server' : 'Starting the API and the storefront');
}

try {
  switch (command) {
    case 'local':
    case 'local:api':
      await startLocal();
      break;
    case 'api':
    case 'server':
      await startApi();
      break;
    default:
      console.error(`Unknown start target "${command}". Expected: local, local:api, or api.`);
      process.exit(1);
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}