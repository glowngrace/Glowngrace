import 'dotenv/config';
import { loadEnvironment } from '../src/server/env.js';

loadEnvironment();

const {
  composeOrThrow,
  containerStatus,
  requireDocker,
  waitForDatabase,
} = await import('./lib/docker.js');
const { run } = await import('./lib/docker.js');

/**
 * The one place that knows how to bring the local database up.
 *
 * `up`, `down`, `destroy`, `logs`, `status`, `reset` and `wait`. `npm start
 * local` calls `up` and `wait` before it starts anything else, which is the
 * ordering that keeps a cold `npm start local` from failing its first request.
 */

const [command = 'up'] = process.argv.slice(2);
const service = 'db';

async function up() {
  requireDocker();
  const before = containerStatus();
  if (before === 'running') {
    console.log('The local database is already running.');
  } else {
    console.log('Starting the local database...');
    composeOrThrow(['up', '-d', '--wait', service]);
  }

  await waitForDatabase();
  const port = process.env.POSTGRES_PORT ?? '5435';
  console.log(`The local database is ready on localhost:${port} and is accepting queries.`);
  console.log('Its data is kept in the glow-grace-local-data volume, so a restart does not lose it.');
}

async function down() {
  requireDocker();
  composeOrThrow(['stop', service]);
  console.log('Stopped. The data volume is untouched, so `npm run db:up` brings back the same rows.');
}

async function destroy() {
  requireDocker();
  composeOrThrow(['down', '-v']);
  console.log('Stopped and emptied. The next `npm run db:up` starts from a fresh volume and re-runs db/init.sql.');
}

async function logs() {
  requireDocker();
  composeOrThrow(['logs', '-f', service]);
}

async function status() {
  requireDocker();
  const state = containerStatus();
  const ps = composeOrThrow(['ps']);
  process.stdout.write(ps.stdout || ps.stderr);
  console.log(`\ncontainer: ${state}`);
  if (state === 'running') {
    const { resolveLocalDatabase, describeResolvedDatabase } = await import('../src/server/config.js');
    try {
      console.log(`app points at: ${describeResolvedDatabase(resolveLocalDatabase())}`);
    } catch (error) {
      console.log(`app points at: nothing - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  process.exitCode = state === 'running' ? 0 : 1;
}

async function wait() {
  await waitForDatabase();
  console.log('The local database is ready.');
}

/**
 * Start, migrate, then start empty and usable.
 *
 * The reset a developer means when they say "start clean": the volume goes, the
 * schema comes back, and the storefront's own sample content is seeded so the
 * shop renders something on first load. It is a local operation and never
 * touches Neon.
 */
async function reset() {
  requireDocker();
  console.log('Rebuilding the local database from scratch...');
  composeOrThrow(['down', '-v']);
  composeOrThrow(['up', '-d', '--wait', service]);
  await waitForDatabase();
  await run('npm', ['run', 'db:migrate'], 'Applying the schema');
  await run('npm', ['run', 'db:seed'], 'Seeding the sample catalogue');
  console.log('\nThe local database is empty of real data and stocked with the sample catalogue.');
}

const commands: Record<string, () => Promise<void> | void> = {
  up,
  down,
  destroy,
  logs,
  status,
  wait,
  reset,
  // Historical aliases, because `db:mirror:down` and `db:migrate` were the names
  // this project used before the local database moved into local-dev/.
  start: up,
  stop: down,
};

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command "${command}". Expected one of: ${Object.keys(commands).join(', ')}.`);
  process.exit(1);
}

try {
  await handler();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}