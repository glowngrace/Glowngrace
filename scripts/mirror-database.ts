import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { clientConfig, resolveDatabase } from '../src/server/config.js';

/**
 * Creates and destroys a disposable PostgreSQL that mirrors the production Neon
 * schema, so a production database problem can be reproduced without reading or
 * writing Neon. Everything it creates is thrown away with `down`.
 *
 *   npm run db:mirror:up                  # the full schema
 *   npm run db:mirror:up -- --through 004 # the schema a deployment predates
 *   npm run db:mirror:down                # delete the database and its data
 *
 * `--through 004` is the important one: it reproduces the database as it was
 * before the console migrations, which is how a deployment that ships ahead of
 * its schema is reproduced.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = join(projectRoot, 'docker-compose.mirror.yml');
const container = 'glow-grace-mirror-db';

const mirrorEnvironment = {
  MIRROR_POSTGRES_DB: 'glow_grace',
  MIRROR_POSTGRES_USER: 'glow_grace',
  MIRROR_POSTGRES_PASSWORD: 'glow_grace_mirror',
  MIRROR_POSTGRES_PORT: '5436',
};

const arguments_ = process.argv.slice(2);
const command = arguments_.find((argument) => argument === 'up' || argument === 'down') ?? 'up';
const throughIndex = arguments_.indexOf('--through');
const through = throughIndex === -1 ? undefined : arguments_[throughIndex + 1];

function compose(...commandArguments: string[]) {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...commandArguments], {
    cwd: projectRoot,
    env: { ...process.env, ...mirrorEnvironment },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`\ndocker compose ${commandArguments.join(' ')} failed.`);
    process.exit(1);
  }
}

/** init.sql plus every migration, in the order `db:migrate:*` applies them. */
function schemaFiles(limit?: string) {
  const migrations = readdirSync(join(projectRoot, 'db', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => !limit || name.slice(0, 3) <= limit);
  return [join(projectRoot, 'db', 'init.sql'), ...migrations.map((name) => join(projectRoot, 'db', 'migrations', name))];
}

function mirrorUrl() {
  const url = new URL('postgresql://localhost');
  url.username = mirrorEnvironment.MIRROR_POSTGRES_USER;
  url.password = mirrorEnvironment.MIRROR_POSTGRES_PASSWORD;
  url.hostname = 'localhost';
  url.port = mirrorEnvironment.MIRROR_POSTGRES_PORT;
  url.pathname = `/${mirrorEnvironment.MIRROR_POSTGRES_DB}`;
  return url.toString();
}

/**
 * The Postgres entrypoint runs a temporary server while it initialises and then
 * shuts it down, so `pg_isready` can succeed against a server that is about to
 * disappear. Wait for the log line that follows the init phase, then for
 * readiness, before connecting.
 */
async function waitForPostgres() {
  const deadline = Date.now() + 60_000;
  let initialised = false;
  while (Date.now() < deadline) {
    if (!initialised) {
      const logs = spawnSync('docker', ['logs', container], { encoding: 'utf8' });
      initialised = `${logs.stdout ?? ''}${logs.stderr ?? ''}`.includes('ready for start up');
      if (!initialised) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
        continue;
      }
    }
    const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-U', mirrorEnvironment.MIRROR_POSTGRES_USER], { stdio: 'ignore' });
    if (probe.status === 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  console.error(`\n${container} did not accept connections within 60s.`);
  process.exit(1);
}

async function applySchema() {
  // Resolved through the same reader the API uses, so the mirror proves that a
  // connection string of this shape is accepted, and the TLS rules stay in one place.
  const resolved = resolveDatabase({ DATABASE_URL: mirrorUrl() }, ['DATABASE_URL'], 'local');
  const client = new Client(clientConfig(resolved));
  await client.connect();
  try {
    for (const file of schemaFiles(through)) {
      await client.query(readFileSync(file, 'utf8'));
      console.log(`  applied ${file.slice(projectRoot.length + 1)}`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
  return resolved.description;
}

if (command === 'down') {
  compose('down', '--volumes', '--remove-orphans');
  console.log('\nThe mirror database and all of its data are gone.');
  process.exit(0);
}

console.log(`\nStarting the disposable mirror (${container})`);
// The container name is fixed so the schema can be applied with a known target.
// Clear any leftover from an interrupted run rather than failing on the conflict.
spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore' });
compose('up', '-d');
await waitForPostgres();

console.log('\nApplying the schema');
const description = await applySchema();

console.log('\nMirror ready.');
console.log(`  connection: postgresql://***@${description.host}:${description.port}/${description.database}`);
console.log(`  migrations: ${through ? `init.sql through ${through}` : 'init.sql plus every migration'}`);
console.log('  point the app at it with:');
console.log(`    DATABASE_URL=${mirrorUrl()} npm run dev`);
console.log('  throw it away with:');
console.log('    npm run db:mirror:down\n');
