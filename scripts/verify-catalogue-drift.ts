import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

/**
 * Proves the catalogue survives a database that is behind the deployment, against
 * a real PostgreSQL rather than a fake.
 *
 * Every other test of this behaviour stubs the driver, and that is exactly the
 * gap that let the production fault through: a fake never raises 42703, so it
 * cannot tell whether the SQL this build actually sends is valid on the database
 * this build is actually pointed at.
 *
 *   npm run db:verify:catalogue
 *
 * It stands the disposable mirror up at migration 012, which is the production
 * fault exactly - every console table in place, the ten columns from
 * 013_product_details.sql absent - then:
 *
 *   1. /api/health names the ten missing columns and the migration that adds them.
 *   2. /api/products returns 200 and never names a column the database lacks.
 *   3. /api/admin/products is not 503, so the console is not taken down with it.
 *   4. A console edit of an absent column is refused with the column named.
 *   5. An edit of a column the database has still succeeds.
 *   6. Applying 013 flips the live server over on its own, with no restart.
 *
 * The mirror is local and disposable, so nothing here can reach production.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mirrorUrl = 'postgresql://glow_grace:glow_grace_mirror@localhost:5436/glow_grace';
const port = 3199;
const baseUrl = `http://127.0.0.1:${port}`;
const ttl = process.env.CATALOGUE_SHAPE_CACHE_MS;
const token = 'e2e00000-0000-4000-8000-0000000000bb';

const failures: string[] = [];
let checks = 0;

function check(description: string, ok: boolean, detail = '') {
  checks += 1;
  if (ok) {
    console.log(`  pass  ${description}`);
    return;
  }
  failures.push(description);
  console.log(`  FAIL  ${description}${detail ? `\n        ${detail}` : ''}`);
}

/** `npx` is a shell script on POSIX and a batch file on Windows. */
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(label: string, command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  console.log(`\n${label}\n  $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    console.error(`${result.stdout?.toString() ?? ''}${result.stderr?.toString() ?? ''}`);
    throw new Error(`${label} failed`);
  }
}

function describe(value: unknown) {
  return value === undefined ? 'undefined' : JSON.stringify(value).slice(0, 300);
}

/** The server's own log, which is the only place the real Postgres error appears. */
function serverErrors() {
  return serverLog
    .join('')
    .split('\n')
    .filter((line) => /error|Error|42703|42P01|does not exist|at Object|at Pool|at Client/i.test(line));
}

function dumpServerLog() {
  const errors = serverErrors();
  if (errors.length === 0) {
    console.log('        (the server logged no error)');
    return;
  }
  console.log('        server log:');
  for (const line of errors.slice(-12)) console.log(`        ${line}`);
}

async function get(path: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, body };
}

async function send(path: string, method: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function waitForApi(deadlineMs = 60_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The API never became ready. Is the mirror running?');
}

/**
 * A live console session, so the admin routes are actually reachable.
 *
 * A fresh mirror has no accounts - migration 010 removed the demo ones - and
 * `admin_sessions.token` is a UUID, so both the account and the token have to be
 * inserted. The password hash is never checked: this proves the schema guard, not
 * the login form.
 */
async function seedSession() {
  console.log('\nSigning a console session into the drifted mirror');
  const client = new Client({ connectionString: mirrorUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO admin_users (id, name, email, role, password_hash, avatar, status)
       VALUES ('e2e00000-0000-4000-8000-0000000000aa', 'Drift Check Admin', 'drift-check@example.invalid',
               'Store Administrator', 'not-a-real-hash', '', 'Active')
       ON CONFLICT (email) DO NOTHING`,
    );
    await client.query("DELETE FROM admin_sessions WHERE token = $1", [token]);
    await client.query(
      "INSERT INTO admin_sessions (token, user_id, expires_at) SELECT $1, id, NOW() + INTERVAL '1 hour' FROM admin_users WHERE email = 'drift-check@example.invalid'",
      [token],
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

const server = spawn(npx, ['tsx', 'server/index.ts'], {
  cwd: projectRoot,
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    DATABASE_URL: mirrorUrl,
    LOCAL_DATABASE_SSL: 'disable',
    DATABASE_SSL: 'disable',
    PORT: String(port),
    // Left unset on purpose: the self-healing check below proves the default.
    CATALOGUE_SHAPE_CACHE_MS: ttl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const serverLog: string[] = [];
server.stdout?.on('data', (chunk: Buffer) => serverLog.push(chunk.toString()));
server.stderr?.on('data', (chunk: Buffer) => serverLog.push(chunk.toString()));

/**
 * Nothing here may hang the caller.
 *
 * `npx` is a batch file on Windows, so killing the spawned shell leaves the node
 * process it started holding the port and the terminal. The tree is killed by
 * name, and a watchdog ends the run even if a step wedges - a verification that
 * never finishes has told nobody anything.
 */
const watchdog = setTimeout(() => {
  console.error('\nThis check did not finish within 10 minutes.');
  process.exit(1);
}, 10 * 60 * 1000);
watchdog.unref?.();

function stopServer() {
  if (process.platform !== 'win32') {
    server.kill('SIGKILL');
    return;
  }
  const processes = spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  if (processes.status !== 0) server.kill('SIGKILL');
}

try {
  run('Discarding any leftover mirror', npx, ['tsx', 'scripts/mirror-database.ts', 'down']);
  run('Standing the mirror up at migration 012, the production fault', npx, ['tsx', 'scripts/mirror-database.ts', 'up', '--through', '012']);

  console.log('\nStarting the API against the drifted mirror');
  await waitForApi();
  await seedSession();

  const absent = ['slug', 'meta_title', 'meta_description', 'shades', 'highlights',
    'features_and_specification', 'measurement', 'material_and_care', 'additional_details', 'item_details'];

  console.log('\n1. /api/health reports the drift instead of claiming to be well');
  const health = await get('/api/health');
  const reported = (health.body.database as Record<string, unknown> | undefined)?.missingProductColumns;
  check('the ten absent columns are named', Array.isArray(reported) && reported.length === absent.length, `got ${describe(reported)}`);
  check('and they are the ten 013 columns', Array.isArray(reported) && absent.every((column) => reported.includes(column)), describe(reported));
  check('the reason names 013_product_details.sql', /013_product_details\.sql/.test(String((health.body.database as Record<string, unknown>)?.reason ?? '')));

  console.log('\n2. /api/products serves the catalogue');
  const catalogue = await get('/api/products');
  check('it is a 200, not the 500 production returned', catalogue.status === 200, `got ${catalogue.status} ${describe(catalogue.body)}`);
  if (catalogue.status !== 200) dumpServerLog();
  check('the body has a products array', Array.isArray(catalogue.body.products), describe(catalogue.body));

  console.log('\n3. /api/admin/products is not taken down');
  const consoleList = await get('/api/admin/products');
  check('it is not a 503 schema_not_migrated', consoleList.status !== 503, `got ${consoleList.status} ${describe(consoleList.body)}`);
  check('it is a 200 with products', consoleList.status === 200 && Array.isArray(consoleList.body.products), `got ${consoleList.status} ${describe(consoleList.body)}`);
  if (consoleList.status >= 500) dumpServerLog();

  console.log('\n4. No query named a column the database does not exist in');
  const named = serverLog.filter((line) => /42703|column .* does not exist/.test(line));
  check('the server log has no 42703', named.length === 0, named.slice(0, 3).join('\n        '));

  // A mirror has no products of its own unless init.sql seeded some, so one is
  // created here with base fields only - exactly what a drifted database can
  // still accept.
  let productId = (consoleList.body.products as Array<Record<string, unknown>> | undefined)?.[0]?.id as string | undefined;
  if (!productId) {
    const seeded = await send('/api/admin/products', 'POST', {
      name: 'Drift Check Base Serum',
      category: 'Skincare',
      brand: 'Glow & Grace',
      sku: 'GG-DRIFT-BASE',
      price: 500,
      mrp: 700,
      stock: 8,
      description: 'Created without any 013 column, to prove base writes still work.',
      images: [],
    });
    check('a product with no detail fields still saves', seeded.status === 201, `got ${seeded.status} ${describe(seeded.body)}`);
    productId = (seeded.body.product as Record<string, unknown> | undefined)?.id as string | undefined;
  }

  console.log('\n5. A console write is refused with the column named, not silently dropped');
  const refused = await send(`/api/admin/products/${productId}`, 'PATCH', { slug: 'a-slug-they-typed' });
  check('it is a 503', refused.status === 503, `got ${refused.status} ${describe(refused.body)}`);
  check('it names slug', Array.isArray(refused.body.columns) && refused.body.columns.includes('slug'), describe(refused.body));
  check('it names the migration', /013_product_details\.sql/.test(String(refused.body.detail ?? '')));
  if (refused.status >= 500) dumpServerLog();

  console.log('\n6. An edit of a column the database does have still saves');
  check('there is a product to edit', Boolean(productId));
  // Under the original price, or the route rejects it for a different reason.
  const applied = await send(`/api/admin/products/${productId}`, 'PATCH', { price: 599 });
  check('it is a 200', applied.status === 200, `got ${applied.status} ${describe(applied.body)}`);
  check('the new price is stored', (applied.body.product as Record<string, unknown> | undefined)?.price === 599, describe(applied.body.product));
  if (applied.status >= 500) dumpServerLog();

  console.log('\n7. Applying migration 013 flips the live server over on its own');
  // The mirror is the target here, not whatever DATABASE_URL the shell happens to hold.
  run('Applying only migration 013 to the mirror', npx, ['tsx', 'scripts/migrate-database.ts', 'local', '--only', '013'], {
    DATABASE_URL: mirrorUrl,
    LOCAL_DATABASE_SSL: 'disable',
  });

  // The console caches the shape it read, so it refuses detail writes for as long
  // as that cache lasts. The promise is "live again within a minute, with no
  // restart", so this polls for exactly that and fails if it takes longer. It is
  // deliberately not shortened with CATALOGUE_SHAPE_CACHE_MS: the point is to prove
  // the default an operator actually gets.
  const healedAt = Date.now();
  let create: { status: number; body: Record<string, unknown> } | undefined;
  while (Date.now() - healedAt < 90_000) {
    const attempt = await send('/api/admin/products', 'POST', {
      name: 'Drift Check Serum',
      category: 'Skincare',
      brand: 'Glow & Grace',
      sku: 'GG-DRIFT-CHECK',
      price: 500,
      mrp: 700,
      stock: 8,
      description: 'Created after migration 013 was applied.',
      slug: 'drift-check-serum',
      metaTitle: 'Drift Check Serum',
      metaDescription: 'A product created to prove the detail columns are writable.',
      shades: ['Rose'],
      highlights: ['Brightening'],
      itemDetails: 'Box of one',
      images: [],
    });
    if (attempt.status === 201) {
      create = attempt;
      break;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  const seconds = Math.round((Date.now() - healedAt) / 1000);
  check(`a product carrying every detail column saves without a restart (took ${seconds}s)`, create !== undefined, describe(create?.body));
  check('it took no longer than the documented one minute', seconds <= 75, `took ${seconds}s`);
  check('the slug round-trips', (create?.body.product as Record<string, unknown> | undefined)?.slug === 'drift-check-serum', describe(create?.body.product));

  const healed = await get('/api/health');
  const healedMissing = (healed.body.database as Record<string, unknown> | undefined)?.missingProductColumns;
  check('health reports no missing product columns', Array.isArray(healedMissing) && healedMissing.length === 0, describe(healedMissing));

  const healedList = await get('/api/admin/products');
  check('the console list still returns 200', healedList.status === 200, `got ${healedList.status} ${describe(healedList.body)}`);

  const nowWritable = await send(`/api/admin/products/${productId}`, 'PATCH', { slug: 'a-slug-after-healing' });
  check('an edit that was refused is accepted once the column exists', nowWritable.status === 200, `got ${nowWritable.status} ${describe(nowWritable.body)}`);
  if (nowWritable.status >= 500) dumpServerLog();
} finally {
  stopServer();
  try {
    run('Throwing the mirror away', npx, ['tsx', 'scripts/mirror-database.ts', 'down']);
  } catch (error) {
    console.error(`The mirror could not be torn down: ${(error as Error).message}`);
    console.error('Remove it by hand with: npm run db:mirror:down');
  }
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failed:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`);
}
process.exit(failures.length > 0 ? 1 : 0);