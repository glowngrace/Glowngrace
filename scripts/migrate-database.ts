import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  clientConfig,
  describeResolvedDatabase,
  requiredTables,
  resolveLocalDatabase,
  resolveProductionDatabase,
  type ResolvedDatabase,
} from '../src/server/config.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const target = arguments_.includes('production') ? 'production' : 'local';

function schemaFiles() {
  const dbDirectory = join(projectRoot, 'db');
  const files = [join(dbDirectory, 'init.sql')];
  const migrationsDirectory = join(dbDirectory, 'migrations');
  const migrations = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(migrationsDirectory, name));
  return [...files, ...migrations];
}

function resolveTarget() {
  return target === 'local' ? resolveLocalDatabase() : resolveProductionDatabase();
}

async function applySchema(client: Client, resolved: ResolvedDatabase) {
  console.log(`\nApplying schema to ${resolved.target === 'local' ? 'the local Docker database' : 'production Neon'}`);
  console.log(`Target: ${describeResolvedDatabase(resolved)}\n`);
  for (const file of schemaFiles()) {
    await client.query(readFileSync(file, 'utf8'));
    console.log(`  applied ${file.slice(projectRoot.length + 1)}`);
  }
  const presence = await client.query<Record<string, unknown>>(
    `SELECT ${requiredTables.map((table) => `to_regclass('public.${table}') IS NOT NULL AS ${table}`).join(', ')}`,
  );
  const row = presence.rows[0] ?? {};
  const missingTables = requiredTables.filter((table) => row[table] !== true);
  if (missingTables.length > 0) {
    console.error(`\nStill missing after migrating: ${missingTables.join(', ')}`);
    return false;
  }
  console.log(`\nAll ${requiredTables.length} tables are present.`);
  return true;
}

const resolved = resolveTarget();
const client = new Client(clientConfig(resolved));
try {
  await client.connect();
  const complete = await applySchema(client, resolved);
  process.exitCode = complete ? 0 : 1;
} catch (error) {
  const cause = error as { code?: string; message?: string };
  console.error(`\nMigration failed: ${cause?.message ?? String(error)}${cause?.code ? ` (code=${cause.code})` : ''}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
