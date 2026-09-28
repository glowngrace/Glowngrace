import type { ClientConfig, PoolConfig } from 'pg';

export type DatabaseTarget = 'local' | 'production';
export type SslSetting = 'disable' | 'require' | 'verify-full';
export type DatabaseProvider = 'local' | 'neon' | 'other';
export type RuntimeEnvironment = 'vercel' | 'local';
export type Environment = Record<string, string | undefined>;

export const runtimeDatabaseVariables = [
  'DATABASE_URL',
  'NEON_DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
] as const;

export const productionDatabaseVariables = [
  'PRODUCTION_DATABASE_URL',
  'NEON_DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
] as const;

export const requiredTables = [
  'contact_requests',
  'newsletter_subscribers',
  'products',
  'product_images',
  'orders',
  'order_items',
] as const;

/**
 * Tables the admin console needs. They are reported separately from the
 * storefront core so a database that predates the console still serves the shop
 * while the console reports exactly what it is missing.
 */
export const adminTables = [
  'admin_users',
  'admin_sessions',
  'store_settings',
  'site_pages',
  'job_vacancies',
  'candidates',
  'partner_salons',
  'customers',
  'reviews',
  'demo_datasets',
] as const;

const localHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

export type ConnectionDescription = {
  host: string;
  port: number;
  database: string;
  user: string;
  provider: DatabaseProvider;
  sslMode: string | null;
};

export type ResolvedDatabase = {
  connectionString: string;
  variable: string;
  target: DatabaseTarget;
  description: ConnectionDescription;
  ssl: SslSetting;
  pool: PoolConfig;
};

export type HealthReport = {
  status: 'ok' | 'degraded' | 'error';
  environment: RuntimeEnvironment;
  database: {
    configured: boolean;
    variable?: string;
    provider?: DatabaseProvider;
    host?: string;
    port?: number;
    name?: string;
    ssl?: SslSetting;
    reachable: boolean;
    missingTables: string[];
    missingAdminTables?: string[];
    missingProductColumns?: string[];
    productCount?: number | null;
    latencyMs?: number;
    reason?: string;
  };
};

function providerForHost(host: string): DatabaseProvider {
  if (localHosts.has(host)) return 'local';
  if (host === 'neon.tech' || host.endsWith('.neon.tech')) return 'neon';
  return 'other';
}

export function isLocalHost(host: string) {
  return localHosts.has(host.toLowerCase());
}

export function maskHost(host: string) {
  if (isLocalHost(host)) return host;
  const [first, ...rest] = host.split('.');
  const masked = first.length > 2 ? `${first[0]}${'*'.repeat(first.length - 1)}` : '*';
  return [masked, ...rest].join('.');
}

export function describeConnectionString(connectionString: string): ConnectionDescription {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new DatabaseConfigError('The database connection string is not a valid URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new DatabaseConfigError(`The database connection string must use postgres:// or postgresql:// (received ${url.protocol}//).`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!host) throw new DatabaseConfigError('The database connection string is missing a host.');
  if (!database) throw new DatabaseConfigError('The database connection string is missing a database name.');
  return {
    host,
    port: url.port ? Number(url.port) : 5432,
    database,
    user: decodeURIComponent(url.username) || 'unknown',
    provider: providerForHost(host),
    sslMode: url.searchParams.get('sslmode'),
  };
}

export function parseSslSetting(raw: string): SslSetting | null {
  const value = raw.trim().toLowerCase();
  if (['disable', 'false', 'off', '0', 'no'].includes(value)) return 'disable';
  if (['require', 'verify-ca', 'prefer', 'allow', 'true', 'on', '1', 'yes'].includes(value)) return 'require';
  if (['verify-full', 'verifyfull', 'verify_full'].includes(value)) return 'verify-full';
  return null;
}

export function sslOption(setting: SslSetting): PoolConfig['ssl'] {
  if (setting === 'disable') return false;
  if (setting === 'verify-full') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

function readNumber(raw: string | undefined, fallback: number, min: number, max: number, name: string) {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DatabaseConfigError(`${name} must be a whole number between ${min} and ${max} (received ${raw}).`);
  }
  return value;
}

export function resolveSslSetting(env: Environment, target: DatabaseTarget): SslSetting {
  const variable = sslVariableFor(target);
  const raw = env[variable]?.trim();
  if (raw) return parseSslSettingOrThrow(raw, variable);
  return target === 'local' ? 'disable' : 'require';
}

function parseSslSettingOrThrow(raw: string, variable: string): SslSetting {
  const parsed = parseSslSetting(raw);
  if (!parsed) {
    throw new DatabaseConfigError(`${variable} must be disable, require, or verify-full (received ${raw}).`);
  }
  return parsed;
}

function sslVariableFor(target: DatabaseTarget) {
  return target === 'local' ? 'LOCAL_DATABASE_SSL' : 'DATABASE_SSL';
}

export function buildPoolConfig(env: Environment, connectionString: string, ssl: SslSetting, deferSslToConnectionString: boolean): PoolConfig {
  return {
    connectionString,
    ...(deferSslToConnectionString ? {} : { ssl: sslOption(ssl) }),
    max: readNumber(env.DATABASE_POOL_MAX, 1, 1, 20, 'DATABASE_POOL_MAX'),
    idleTimeoutMillis: readNumber(env.DATABASE_IDLE_TIMEOUT_MS, 10_000, 0, 600_000, 'DATABASE_IDLE_TIMEOUT_MS'),
    connectionTimeoutMillis: readNumber(env.DATABASE_CONNECT_TIMEOUT_MS, 8_000, 250, 120_000, 'DATABASE_CONNECT_TIMEOUT_MS'),
    statement_timeout: readNumber(env.DATABASE_STATEMENT_TIMEOUT_MS, 0, 0, 120_000, 'DATABASE_STATEMENT_TIMEOUT_MS'),
  };
}

export function clientConfig(resolved: ResolvedDatabase): ClientConfig {
  return {
    connectionString: resolved.connectionString,
    ...(resolved.pool.ssl === undefined ? {} : { ssl: resolved.pool.ssl }),
    connectionTimeoutMillis: resolved.pool.connectionTimeoutMillis,
    statement_timeout: resolved.pool.statement_timeout,
  };
}

function pickConnectionString(env: Environment, variables: readonly string[]) {
  for (const variable of variables) {
    const value = env[variable]?.trim();
    if (value) return { variable, connectionString: value };
  }
  return null;
}

export function resolveDatabase(
  env: Environment,
  variables: readonly string[],
  target: DatabaseTarget,
): ResolvedDatabase {
  const picked = pickConnectionString(env, variables);
  if (!picked) {
    throw new DatabaseConfigError(
      `No ${target} database connection string is configured. Set ${variables.slice(0, 2).join(' or ')} in .env, `
      + `or add it to the Vercel project environment for Production deployments.`,
    );
  }
  const description = describeConnectionString(picked.connectionString);
  const resolvedTarget: DatabaseTarget = description.provider === 'local' ? 'local' : target;
  const configured = env[sslVariableFor(resolvedTarget)]?.trim();
  const ssl = configured
    ? parseSslSettingOrThrow(configured, sslVariableFor(resolvedTarget))
    : resolveSslSettingFromUrlOrDefault(env, description, resolvedTarget);
  return {
    connectionString: picked.connectionString,
    variable: picked.variable,
    target: resolvedTarget,
    description,
    ssl,
    pool: buildPoolConfig(env, picked.connectionString, ssl, !configured && description.sslMode !== null),
  };
}

function resolveSslSettingFromUrlOrDefault(env: Environment, description: ConnectionDescription, target: DatabaseTarget) {
  if (description.sslMode) return parseSslSetting(description.sslMode) ?? resolveSslSetting(env, target);
  return resolveSslSetting(env, target);
}

export function resolveRuntimeDatabase(env: Environment = process.env) {
  return resolveDatabase(env, runtimeDatabaseVariables, 'production');
}

export function resolveLocalDatabase(env: Environment = process.env) {
  return resolveDatabase(env, ['DATABASE_URL'], 'local');
}

export function resolveProductionDatabase(env: Environment = process.env) {
  return resolveDatabase(env, productionDatabaseVariables, 'production');
}

export function runtimeEnvironment(env: Environment = process.env): RuntimeEnvironment {
  return env.VERCEL ? 'vercel' : 'local';
}

export function parseBoolean(raw: string | undefined) {
  if (raw === undefined || raw.trim() === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export function assertLocalRuntimeUsesLocalDatabase(resolved: ResolvedDatabase, env: Environment = process.env) {
  if (env.VERCEL || resolved.description.provider === 'local') return;
  if (parseBoolean(env.ALLOW_REMOTE_DATABASE)) return;
  throw new DatabaseConfigError(
    `Local development resolved ${resolved.variable} to the remote ${resolved.description.provider} database at `
    + `${maskHost(resolved.description.host)}. Point DATABASE_URL at the local Docker database, or set `
    + 'ALLOW_REMOTE_DATABASE=true in .env to override. Local work must never read or write production by accident.',
  );
}

export function assertSyncTargetIsLocal(source: ConnectionDescription, target: ConnectionDescription) {
  if (!isLocalHost(target.host)) {
    throw new DatabaseConfigError(
      `Refusing to sync into ${maskHost(target.host)}: the sync target must be the local Docker database. `
      + 'Data only ever flows from production to local, never the other way round.',
    );
  }
  if (source.host === target.host && source.port === target.port) {
    throw new DatabaseConfigError('Refusing to sync: the production and local connection strings resolve to the same database.');
  }
}

export function describeResolvedDatabase(resolved: ResolvedDatabase) {
  const { host, port, database, provider } = resolved.description;
  return `${resolved.variable} ${maskHost(host)}:${port}/${database} (provider=${provider}, ssl=${resolved.ssl})`;
}
