import { describe, expect, it } from 'vitest';
import {
  assertLocalRuntimeUsesLocalDatabase,
  DatabaseConfigError,
  describeConnectionString,
  parseBoolean,
  resolveDatabase,
  resolveLocalDatabase,
  resolveProductionDatabase,
  resolveRuntimeDatabase,
  resolveSslSetting,
  resolveSyncEndpoints,
} from './config';

const localUrl = 'postgresql://glow_grace:secret@localhost:5435/glow_grace';
const neonUrl = 'postgresql://neon_user:secret@ep-cool-pooler.aws-ap-southeast-2.neon.tech/neondb?sslmode=require';

describe('where the running process connects', () => {
  it('uses DATABASE_URL and only DATABASE_URL when local development is on', () => {
    // The single switch decides the store. If the runtime variables were also
    // consulted here, a `NEON_DATABASE_URL` exported for the sync would quietly
    // become the database the application reads and writes.
    const resolved = resolveRuntimeDatabase({
      USE_LOCAL_DATABASE: 'true',
      DATABASE_URL: localUrl,
      NEON_DATABASE_URL: neonUrl,
      LOCAL_DATABASE_SSL: 'disable',
    });
    expect(resolved.variable).toBe('DATABASE_URL');
    expect(resolved.target).toBe('local');
    expect(resolved.description.provider).toBe('local');
  });

  it('falls back to the runtime variables when the local switch is off', () => {
    // What Vercel injects: `NEON_DATABASE_URL` and friends, with no
    // `DATABASE_URL` in the environment at all.
    const resolved = resolveRuntimeDatabase({
      NEON_DATABASE_URL: neonUrl,
      POSTGRES_PRISMA_URL: 'postgresql://other:secret@db.example.com:5432/other',
    });
    expect(resolved.variable).toBe('NEON_DATABASE_URL');
    expect(resolved.target).toBe('production');
  });

  it('prefers a plain DATABASE_URL when the deployment has one', () => {
    const resolved = resolveRuntimeDatabase({
      DATABASE_URL: localUrl,
      NEON_DATABASE_URL: neonUrl,
      LOCAL_DATABASE_SSL: 'disable',
    });
    expect(resolved.variable).toBe('DATABASE_URL');
    expect(resolved.target).toBe('local');
  });

  it('says exactly what to set when there is nothing to connect to', () => {
    expect(() => resolveRuntimeDatabase({})).toThrow(DatabaseConfigError);
    expect(() => resolveRuntimeDatabase({})).toThrow(/DATABASE_URL/);
  });

  it('reads a local DATABASE_URL as local even with the local switch off', () => {
    // A checkout with `.env.local` deleted but `.env` left alone still has the
    // local connection string in it, and it must not be mistaken for production.
    const resolved = resolveDatabase({ DATABASE_URL: localUrl }, ['DATABASE_URL'], 'production');
    expect(resolved.target).toBe('local');
  });
});

describe('refusing to point local work at production', () => {
  it('rejects a remote DATABASE_URL in local development', () => {
    expect(() => resolveRuntimeDatabase({ USE_LOCAL_DATABASE: 'true', DATABASE_URL: neonUrl }))
      .toThrow(/Local work must never read or write production by accident/);
  });

  it('allows it only when the developer says so, and says so in the message', () => {
    const resolved = resolveRuntimeDatabase({
      USE_LOCAL_DATABASE: 'true',
      DATABASE_URL: neonUrl,
      ALLOW_REMOTE_DATABASE: 'true',
    });
    expect(resolved.description.provider).toBe('neon');
    expect(() => assertLocalRuntimeUsesLocalDatabase(resolved, { ALLOW_REMOTE_DATABASE: 'true' })).not.toThrow();
  });

  it('never applies the guard on Vercel, where the remote host is the point', () => {
    const resolved = resolveRuntimeDatabase({ USE_LOCAL_DATABASE: 'true', DATABASE_URL: neonUrl, VERCEL: '1' });
    expect(resolved.description.provider).toBe('neon');
  });

  it('keeps the password out of the error it throws', () => {
    let message = '';
    try {
      resolveRuntimeDatabase({ USE_LOCAL_DATABASE: 'true', DATABASE_URL: 'postgresql://glow_grace:hunter2@ep-cool-pooler.aws-ap-southeast-2.neon.tech/neondb' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('hunter2');
  });
});

describe('the scripts that only ever want the local database', () => {
  it('refuses a DATABASE_URL that resolves to production', () => {
    // `db:seed`, `db:migrate` and `db:check` resolve the local database directly
    // rather than through `resolveRuntimeDatabase`, so before this guard existed a
    // Neon URL in DATABASE_URL was seeded as if it were the local container.
    expect(() => resolveLocalDatabase({ DATABASE_URL: neonUrl }))
      .toThrow(/Local work must never read or write production by accident/);
  });

  it('never dials a remote host with the local ssl setting', () => {
    // The defect this closes: the target was `local`, so the resolver read
    // `LOCAL_DATABASE_SSL` - `disable`, for a container that speaks plain TCP -
    // and applied it to Neon. `sslmode=require` sat in the connection string and
    // lost to the explicitly set variable, so the connection was attempted
    // unencrypted and only failed on timeout.
    const localSsl = resolveLocalDatabase({
      DATABASE_URL: localUrl,
      LOCAL_DATABASE_SSL: 'disable',
      ALLOW_REMOTE_DATABASE: 'true',
    });
    expect(localSsl.ssl).toBe('disable');

    const remoteSsl = resolveLocalDatabase({
      DATABASE_URL: neonUrl,
      LOCAL_DATABASE_SSL: 'disable',
      ALLOW_REMOTE_DATABASE: 'true',
    });
    expect(remoteSsl.ssl).toBe('require');
    expect(remoteSsl.description.provider).toBe('neon');
  });

  it('still lets somebody who means it reach a remote database deliberately', () => {
    const resolved = resolveLocalDatabase({
      DATABASE_URL: neonUrl,
      LOCAL_DATABASE_SSL: 'disable',
      ALLOW_REMOTE_DATABASE: 'true',
    });
    expect(resolved.description.host).toContain('neon.tech');
  });
});

describe('the two ends of a sync', () => {
  it('reads production from either of the two names it goes by', () => {
    expect(resolveProductionDatabase({ NEON_DATABASE_URL: neonUrl }).variable).toBe('NEON_DATABASE_URL');
    expect(resolveProductionDatabase({ PRODUCTION_DATABASE_URL: neonUrl }).variable).toBe('PRODUCTION_DATABASE_URL');
  });

  it('gives back a local target and a production source', () => {
    const { source, target } = resolveSyncEndpoints({
      DATABASE_URL: localUrl,
      LOCAL_DATABASE_SSL: 'disable',
      NEON_DATABASE_URL: neonUrl,
    });
    expect(target.description.provider).toBe('local');
    expect(source.description.provider).toBe('neon');
  });

  it('refuses when the two names point at the same host and port', () => {
    // The stand-in used while testing was a local PostgreSQL on another port, so
    // this is the exact mistake that guard is there for: one container, two names.
    expect(() => resolveSyncEndpoints({ DATABASE_URL: localUrl, NEON_DATABASE_URL: localUrl }))
      .toThrow(/resolve to the same database/);
  });

  it('refuses a remote target', () => {
    // Refused by `resolveLocalDatabase` now, before the sync's own guard ever
    // runs: a DATABASE_URL that resolves to Neon is not a local target whatever
    // the sync was going to do with it.
    expect(() => resolveSyncEndpoints({ DATABASE_URL: neonUrl, NEON_DATABASE_URL: 'postgresql://u:p@localhost:5437/glow_grace' }))
      .toThrow(/Local work must never read or write production by accident/);
  });

  it('reports the local target even when it is the one missing', () => {
    expect(() => resolveLocalDatabase({})).toThrow(/No local database connection string is configured/);
  });
});

describe('ssl', () => {
  it('defaults a local host to no ssl and anything remote to requiring it', () => {
    expect(resolveSslSetting({}, 'local')).toBe('disable');
    expect(resolveSslSetting({}, 'production')).toBe('require');
  });

  it('lets the environment override it', () => {
    expect(resolveSslSetting({ LOCAL_DATABASE_SSL: 'require' }, 'local')).toBe('require');
    expect(resolveSslSetting({ DATABASE_SSL: 'disable' }, 'production')).toBe('disable');
  });

  it('follows the sslmode in the connection string when the environment says nothing', () => {
    expect(describeConnectionString(neonUrl).sslMode).toBe('require');
    expect(resolveDatabase({ DATABASE_URL: neonUrl }, ['DATABASE_URL'], 'production').ssl).toBe('require');
  });

  it('treats localhost and the loopback addresses as local', () => {
    for (const host of ['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal', '[::1]']) {
      expect(describeConnectionString(`postgresql://u:p@${host}:5435/glow_grace`).provider, host).toBe('local');
    }
    expect(describeConnectionString(neonUrl).provider).toBe('neon');
  });

  it('lets local work connect over the IPv6 loopback', () => {
    // The brackets a URL needs are not part of the host, and a machine that only
    // listens on IPv6 would otherwise be refused as if it were production.
    const resolved = resolveRuntimeDatabase({ USE_LOCAL_DATABASE: 'true', DATABASE_URL: 'postgresql://u:p@[::1]:5435/glow_grace' });
    expect(resolved.description.provider).toBe('local');
  });
});

describe('the switches', () => {
  it('reads the spellings a developer is likely to reach for', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
      expect(parseBoolean(value), value).toBe(true);
    }
    for (const value of [undefined, '', '0', 'false', 'no', 'off']) {
      expect(parseBoolean(value), value).toBe(false);
    }
  });
});