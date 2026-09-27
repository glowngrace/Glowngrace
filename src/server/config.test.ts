import { describe, expect, it } from 'vitest';
import {
  DatabaseConfigError,
  assertLocalRuntimeUsesLocalDatabase,
  assertSyncTargetIsLocal,
  clientConfig,
  describeConnectionString,
  maskHost,
  parseSslSetting,
  productionDatabaseVariables,
  resolveDatabase,
  resolveLocalDatabase,
  resolveProductionDatabase,
  resolveRuntimeDatabase,
  runtimeDatabaseVariables,
  runtimeEnvironment,
  sslOption,
  type Environment,
} from './config';

const localUrl = 'postgresql://glow_grace:local_secret@localhost:5435/glow_grace';
const neonUrl = 'postgresql://neondb_owner:neon_secret@ep-abc-pooler.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

function describeUrl(connectionString: string) {
  return describeConnectionString(connectionString);
}

describe('connection string parsing', () => {
  it('describes a local Docker connection string', () => {
    expect(describeUrl(localUrl)).toEqual({
      host: 'localhost',
      port: 5435,
      database: 'glow_grace',
      user: 'glow_grace',
      provider: 'local',
      sslMode: null,
    });
  });

  it('recognises a Neon pooled connection string and its declared sslmode', () => {
    expect(describeUrl(neonUrl)).toEqual({
      host: 'ep-abc-pooler.us-east-1.aws.neon.tech',
      port: 5432,
      database: 'neondb',
      user: 'neondb_owner',
      provider: 'neon',
      sslMode: 'require',
    });
  });

  it('defaults to port 5432 when the connection string omits it', () => {
    expect(describeUrl('postgresql://user:pass@db.example.com/shop').port).toBe(5432);
  });

  it('rejects connection strings that are not usable PostgreSQL URLs', () => {
    expect(() => describeUrl('not a url')).toThrow(DatabaseConfigError);
    expect(() => describeUrl('mysql://user:pass@localhost:3306/shop')).toThrow(/postgres/);
    expect(() => describeUrl('postgresql://user:pass@localhost:5432/')).toThrow(/database name/);
  });

  it('never leaks the password when describing a host for logs', () => {
    const described = maskHost(describeUrl(neonUrl).host);
    expect(described).toMatch(/^e\*+\.us-east-1\.aws\.neon\.tech$/);
    expect(described).not.toContain('ep-abc');
    expect(described).not.toContain('neon_secret');
    expect(maskHost('localhost')).toBe('localhost');
  });
});

describe('ssl settings', () => {
  it('parses the accepted spellings', () => {
    expect(parseSslSetting('require')).toBe('require');
    expect(parseSslSetting('VERIFY-FULL')).toBe('verify-full');
    expect(parseSslSetting(' off ')).toBe('disable');
    expect(parseSslSetting('sometimes')).toBeNull();
  });

  it('maps settings onto the pg ssl option', () => {
    expect(sslOption('disable')).toBe(false);
    expect(sslOption('verify-full')).toEqual({ rejectUnauthorized: true });
    expect(sslOption('require')).toEqual({ rejectUnauthorized: false });
  });

  it('defaults local Docker to no TLS and production Neon to TLS', () => {
    expect(resolveLocalDatabase({ DATABASE_URL: localUrl }).ssl).toBe('disable');
    expect(resolveProductionDatabase({ PRODUCTION_DATABASE_URL: neonUrl }).ssl).toBe('require');
  });

  it('lets the explicit local and production variables override the defaults', () => {
    expect(resolveLocalDatabase({ DATABASE_URL: localUrl, LOCAL_DATABASE_SSL: 'require' }).ssl).toBe('require');
    expect(resolveProductionDatabase({ PRODUCTION_DATABASE_URL: neonUrl, DATABASE_SSL: 'disable' }).ssl).toBe('disable');
  });

  it('rejects an unusable ssl setting with the variable name', () => {
    expect(() => resolveProductionDatabase({ PRODUCTION_DATABASE_URL: neonUrl, DATABASE_SSL: 'maybe' }))
      .toThrow(/DATABASE_SSL must be disable, require, or verify-full/);
  });

  it('leaves the ssl option to pg when the connection string already declares sslmode', () => {
    expect(resolveProductionDatabase({ PRODUCTION_DATABASE_URL: neonUrl }).pool.ssl).toBeUndefined();
    expect(resolveLocalDatabase({ DATABASE_URL: localUrl }).pool.ssl).toBe(false);
  });

  it('exposes the same connection settings to single clients as to the pool', () => {
    const resolved = resolveProductionDatabase({ PRODUCTION_DATABASE_URL: neonUrl });
    const config = clientConfig(resolved);
    expect(config.connectionString).toBe(neonUrl);
    expect(config.connectionTimeoutMillis).toBe(8_000);
    expect(config.statement_timeout).toBe(0);
  });

  it('validates numeric pool tuning with the variable name', () => {
    expect(() => resolveRuntimeDatabase({ DATABASE_URL: localUrl, DATABASE_POOL_MAX: '99' }))
      .toThrow(/DATABASE_POOL_MAX must be a whole number between 1 and 20/);
  });
});

describe('database resolution order', () => {
  it('prefers DATABASE_URL and accepts the names Neon and Vercel inject', () => {
    expect(resolveRuntimeDatabase({ DATABASE_URL: localUrl, POSTGRES_URL: neonUrl }).variable).toBe('DATABASE_URL');
    expect(resolveRuntimeDatabase({ POSTGRES_URL: neonUrl }).variable).toBe('POSTGRES_URL');
    expect(resolveRuntimeDatabase({ DATABASE_URL_UNPOOLED: neonUrl }).variable).toBe('DATABASE_URL_UNPOOLED');
    expect(resolveRuntimeDatabase({ POSTGRES_PRISMA_URL: neonUrl }).variable).toBe('POSTGRES_PRISMA_URL');
  });

  it('never resolves the production source from the local DATABASE_URL', () => {
    expect(productionDatabaseVariables).not.toContain('DATABASE_URL');
    expect(() => resolveProductionDatabase({ DATABASE_URL: localUrl }))
      .toThrow(/No production database connection string is configured/);
  });

  it('names the variables to set when nothing is configured', () => {
    expect(() => resolveRuntimeDatabase({})).toThrow(/DATABASE_URL or NEON_DATABASE_URL/);
  });

  it('ignores blank and whitespace-only values', () => {
    expect(() => resolveRuntimeDatabase({ DATABASE_URL: '   ', POSTGRES_URL: '' })).toThrow(DatabaseConfigError);
  });

  it('covers every runtime candidate name it advertises', () => {
    expect(runtimeDatabaseVariables).toContain('DATABASE_URL');
    expect(runtimeDatabaseVariables).toContain('POSTGRES_URL');
  });
});

describe('one-way production to local safety', () => {
  it('refuses to sync into any non-local database', () => {
    const production = describeUrl(neonUrl);
    const remote = describeUrl('postgresql://user:pass@db.example.com:5432/shop');
    expect(() => assertSyncTargetIsLocal(production, remote)).toThrow(/must be the local Docker database/);
  });

  it('refuses to sync a database into itself', () => {
    expect(() => assertSyncTargetIsLocal(describeUrl(localUrl), describeUrl(localUrl)))
      .toThrow(/same database/);
  });

  it('allows two different local databases so the copy path can be tested', () => {
    const source = describeUrl('postgresql://fixture:fixture@localhost:5436/glow_grace');
    const target = describeUrl(localUrl);
    expect(() => assertSyncTargetIsLocal(source, target)).not.toThrow();
  });

  it('never prints a password in the refusal', () => {
    try {
      assertSyncTargetIsLocal(describeUrl(neonUrl), describeUrl(neonUrl.replace('5432', '5432').replace('neon.tech', 'neon.tech')));
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('neon_secret');
    }
  });
});

describe('local runtime isolation', () => {
  const remote = resolveDatabase({ DATABASE_URL: neonUrl }, runtimeDatabaseVariables, 'production');
  const local = resolveDatabase({ DATABASE_URL: localUrl }, runtimeDatabaseVariables, 'production');

  it('stops local development from reaching a remote database', () => {
    expect(() => assertLocalRuntimeUsesLocalDatabase(remote, {})).toThrow(/Local work must never read or write production/);
  });

  it('allows the local Docker database', () => {
    expect(() => assertLocalRuntimeUsesLocalDatabase(local, {})).not.toThrow();
  });

  it('allows a remote database on Vercel', () => {
    expect(() => assertLocalRuntimeUsesLocalDatabase(remote, { VERCEL: '1' })).not.toThrow();
  });

  it('allows an explicit opt-in for remote local development', () => {
    expect(() => assertLocalRuntimeUsesLocalDatabase(remote, { ALLOW_REMOTE_DATABASE: 'true' })).not.toThrow();
  });

  it('treats the Vercel runtime as production and a bare shell as local', () => {
    expect(runtimeEnvironment({ VERCEL: '1', VERCEL_ENV: 'production' })).toBe('vercel');
    expect(runtimeEnvironment({} as Environment)).toBe('local');
  });
});
