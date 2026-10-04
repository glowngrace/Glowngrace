import 'dotenv/config';
import { loadEnvironment } from '../src/server/env.js';

loadEnvironment();

const { syncFromNeon } = await import('../src/server/sync-from-neon.js');
const { DatabaseConfigError } = await import('../src/server/config.js');

/**
 * Copies the Neon production database into the local Docker one.
 *
 *   npm run db:sync                  copy everything
 *   npm run db:sync -- --dry-run     report what would happen, change nothing
 *   npm run db:sync -- --skip-images leave product_images alone
 *   npm run db:sync -- --force       copy even if the two already match
 *
 * The same code backs the console's "Sync from Neon" button, so the CLI and the
 * button cannot drift apart.
 *
 * One direction only, and `assertSyncTargetIsLocal` enforces it: the target has
 * to be the local Docker database, and the two connection strings must not
 * resolve to the same host. There is no `--direction` flag, and no argument that
 * could turn this into a push.
 */

const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  skipImages: args.includes('--skip-images'),
  force: args.includes('--force'),
  log: (message: string) => console.log(`  ${message}`),
};

console.log('\nSyncing Neon into the local database.');
console.log('Reading from Neon once, over a single pooled connection, for as long as it takes.\n');

try {
  const result = await syncFromNeon(options);

  console.log(`\n  source: ${result.source}`);
  console.log(`  target: ${result.target}`);
  console.log(`  status: ${result.status}`);
  console.log(`\n${result.message}`);

  if (result.status === 'ok') {
    console.log('\n  Rows copied:');
    for (const [table, count] of Object.entries(result.copied)) {
      const total = result.available[table] ?? 0;
      const mark = count === total ? ' ' : '!';
      console.log(`   ${mark} ${table.padEnd(24)} ${String(count).padStart(7)} of ${total}`);
    }
    if (result.skipImages) console.log('\n  product_images was skipped.');
    console.log('\n  Local changes are never pushed back to Neon. This copies one way only.');
  }

  if (result.status === 'unchanged') process.exitCode = 0;
} catch (error) {
  if (error instanceof DatabaseConfigError) {
    console.error(`\n${error.message}\n`);
    console.error('The production connection comes from PRODUCTION_DATABASE_URL or NEON_DATABASE_URL in .env.local.');
    console.error('Create the resource with `npm run neon:provision` if it does not exist yet.');
    process.exitCode = 1;
  } else {
    const cause = error as { code?: string; message?: string };
    console.error(`\nSync failed: ${cause?.message ?? String(error)}${cause?.code ? ` (code=${cause.code})` : ''}`);
    process.exitCode = 1;
  }
}