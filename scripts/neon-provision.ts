import 'dotenv/config';
import { loadEnvironment } from '../src/server/env.js';

loadEnvironment();

/**
 * Creates the Neon production resource this project points at.
 *
 *   npm run neon:provision            create `neon-glowngraceproddb` if it is not there
 *   npm run neon:provision -- --dry-run
 *                                    print the request without sending it
 *
 * Talks to the Neon API directly over HTTPS rather than through a CLI, so there
 * is no global tool to install and the project stays self-contained.
 *
 * Needs NEON_API_KEY in `.env.local`. Create one at
 * https://console.neon.tech/app/settings/api-keys. With a personal key (as
 * opposed to an organisation key) NEON_ORG_ID also has to be set, because the
 * key does not say which organisation to create in.
 *
 * The script is idempotent: it lists the account's projects first and does
 * nothing if one already carries the name. Running it twice cannot produce two
 * databases or lose the connection string to the first.
 */

const apiBase = 'https://console.neon.tech/api/v2';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const projectName = process.env.NEON_PROJECT_NAME?.trim() || 'neon-glowngraceproddb';
const regionId = process.env.NEON_REGION_ID?.trim() || 'aws-ap-southeast-2';
const pgVersion = Number(process.env.NEON_PG_VERSION ?? 16);
const apiKey = process.env.NEON_API_KEY?.trim() || '';
const orgId = process.env.NEON_ORG_ID?.trim() || '';

type NeonError = { code?: string; message?: string; detail?: string; error?: string };

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  return { status: response.status, ok: response.ok, body: body as Record<string, unknown> & NeonError };
}

/**
 * Neon reports "you have hit your plan limit" in several shapes, and the exact
 * wording is what tells the operator whether to wait, to upgrade, or to delete
 * something else. So the whole thing is shown rather than collapsed into a
 * generic failure.
 */
function explainQuota(response: { status: number; body: Record<string, unknown> & NeonError }) {
  const parts = [
    response.body.message,
    response.body.detail,
    response.body.error,
    response.body.code,
  ].filter((value): value is string => typeof value === 'string' && value.trim() !== '');

  const text = parts.join(' - ').toLowerCase();
  const quota = ['limit', 'quota', 'exceed', 'too many', 'upgrade', 'plan'].some((word) => text.includes(word));

  console.error(`\nNeon refused the request (HTTP ${response.status}).`);
  if (parts.length > 0) console.error(`  ${parts.join('\n  ')}`);
  console.error('');
  if (quota) {
    console.error('This reads as a plan limit rather than a bad request. Neon will not create a');
    console.error('project while the account is over quota. Nothing about the configuration is wrong:');
    console.error(`  project: ${projectName}`);
    console.error(`  region:  ${regionId}`);
    console.error(`  version: PostgreSQL ${pgVersion}`);
    console.error('');
    console.error('Either wait for the quota to reset, raise the plan, or create the project by hand:');
    console.error(`  https://console.neon.tech/app/settings/projects   then name it "${projectName}"`);
    console.error('');
    console.error('Either way, add the pooled connection string it prints to .env.local:');
    console.error('  NEON_DATABASE_URL=postgresql://...@ep-xxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require');
  }
  console.error('Everything else in the local setup works without it: the Docker database, the');
  console.error('migrations, the seed and the whole test suite run entirely on localhost.');
}

if (!apiKey) {
  console.error('\nNEON_API_KEY is not set, so there is nothing to authenticate with.');
  console.error('');
  console.error('  1. Create a key at https://console.neon.tech/app/settings/api-keys');
  console.error('  2. Add it to .env.local:  NEON_API_KEY=...');
  if (!orgId) console.error('  3. With a personal key, also set NEON_ORG_ID to the organisation id.');
  console.error('');
  console.error('If the project already exists, none of this is needed - put its pooled connection');
  console.error('string in .env.local as NEON_DATABASE_URL and run `npm run db:check -- production`.');
  process.exit(1);
}

console.log(`\nNeon project: ${projectName}`);
console.log(`Region:       ${regionId}`);
console.log(`PostgreSQL:   ${pgVersion}`);

if (dryRun) {
  console.log('\nDry run, nothing was sent. The request would have been:');
  console.log(`  POST ${apiBase}/projects`);
  console.log(JSON.stringify({
    project: {
      name: projectName,
      region_id: regionId,
      pg_version: pgVersion,
      // 0.25 CU floor is the cheapest compute Neon offers and is ample for a
      // storefront; autoscaling lets it drop to that between requests instead of
      // holding a larger compute awake all day.
      autoscaling_limit_min_cu: 0.25,
      autoscaling_limit_max_cu: 1,
      ...(orgId ? { org_id: orgId } : {}),
    },
  }, null, 2));
  process.exit(0);
}

const listed = await call('/projects?limit=100');
if (!listed.ok) {
  explainQuota(listed);
  process.exit(1);
}

const existing = ((listed.body.projects as Array<{ name?: string; id?: string }> | undefined) ?? [])
  .find((project) => project.name === projectName);

if (existing) {
  console.log(`\nA project named "${projectName}" already exists (id ${existing.id}).`);
  console.log('Nothing was created. Its connection strings are at:');
  console.log('  https://console.neon.tech/app/settings/connections');
  console.log('');
  console.log('Put the pooled one in .env.local as NEON_DATABASE_URL, then run');
  console.log('  npm run db:migrate -- production');
  console.log('  npm run db:sync');
  process.exit(0);
}

console.log('\nCreating the project...');
const created = await call('/projects', {
  method: 'POST',
  body: JSON.stringify({
    project: {
      name: projectName,
      region_id: regionId,
      pg_version: pgVersion,
      autoscaling_limit_min_cu: 0.25,
      autoscaling_limit_max_cu: 1,
      ...(orgId ? { org_id: orgId } : {}),
    },
  }),
});

if (!created.ok) {
  explainQuota(created);
  process.exit(1);
}

const connectionUris = (created.body.connection_uris as Array<{ name?: string; connection_uri?: string }> | undefined) ?? [];
// The pooled endpoint is the one to configure: it multiplexes every connection
// over one TCP socket, so the application holds a single connection and Neon can
// scale the compute to zero between requests.
const pooled = connectionUris.find((uri) => uri.name === 'pooled') ?? connectionUris[0];

console.log(`\nCreated "${projectName}".`);
console.log('\nAdd this to .env.local:');
console.log('');
console.log(`  NEON_DATABASE_URL=${pooled?.connection_uri ?? 'postgresql://...@ep-xxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require'}`);
console.log('');
console.log('Then:');
console.log('  npm run db:migrate -- production   create the schema');
console.log('  npm run db:check                  confirm both databases answer');
console.log('  npm run db:sync                   pull production rows into the local Docker database');
console.log('');
console.log('The connection strings are also at https://console.neon.tech/app/settings/connections');