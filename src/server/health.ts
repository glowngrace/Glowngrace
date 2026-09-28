import { Client } from 'pg';
import {
  adminTables,
  DatabaseConfigError,
  clientConfig,
  maskHost,
  requiredTables,
  resolveRuntimeDatabase,
  runtimeEnvironment,
  type Environment,
  type HealthReport,
} from './config.js';

function tablePresenceSql() {
  return [...requiredTables, ...adminTables]
    .map((table) => `to_regclass('public.${table}') IS NOT NULL AS ${table}`)
    .join(', ');
}

export async function checkDatabaseHealth(env: Environment = process.env): Promise<HealthReport> {
  const environment = runtimeEnvironment(env);
  let resolved;
  try {
    resolved = resolveRuntimeDatabase(env);
  } catch (error) {
    return {
      status: 'error',
      environment,
      database: {
        configured: false,
        reachable: false,
        missingTables: [...requiredTables],
        missingAdminTables: [...adminTables],
        reason: error instanceof DatabaseConfigError ? error.message : 'The database configuration could not be read.',
      },
    };
  }

  const client = new Client(clientConfig(resolved));
  const startedAt = Date.now();
  try {
    await client.connect();
    const presence = await client.query<Record<string, boolean>>(
      `SELECT current_database() AS name, ${tablePresenceSql()}`,
    );
    const row = presence.rows[0] ?? {};
    const missingTables = requiredTables.filter((table) => row[table] !== true);
    const missingAdminTables = adminTables.filter((table) => row[table] !== true);
    let productCount: number | null = null;
    if (!missingTables.includes('products')) {
      const counted = await client.query<{ total: string }>('SELECT count(*)::text AS total FROM products');
      productCount = Number(counted.rows[0]?.total ?? 0);
    }
    await client.end();
    return {
      status: missingTables.length === 0 ? 'ok' : 'degraded',
      environment,
      database: {
        configured: true,
        variable: resolved.variable,
        provider: resolved.description.provider,
        host: maskHost(resolved.description.host),
        port: resolved.description.port,
        name: String(row.name ?? resolved.description.database),
        ssl: resolved.ssl,
        reachable: true,
        missingTables,
        missingAdminTables,
        productCount,
        latencyMs: Date.now() - startedAt,
        reason: missingTables.length > 0
          ? `Connected, but these tables are missing. Apply db/init.sql to this database: ${missingTables.join(', ')}.`
          : missingAdminTables.length > 0
            ? `Connected and serving the storefront. The admin console still needs: ${missingAdminTables.join(', ')}.`
            : undefined,
      },
    };
  } catch (error) {
    await client.end().catch(() => undefined);
    const cause = error as { code?: string; message?: string };
    const code = typeof cause?.code === 'string' ? ` (code=${cause.code})` : '';
    return {
      status: 'error',
      environment,
      database: {
        configured: true,
        variable: resolved.variable,
        provider: resolved.description.provider,
        host: maskHost(resolved.description.host),
        port: resolved.description.port,
        name: resolved.description.database,
        ssl: resolved.ssl,
        reachable: false,
        missingTables: [...requiredTables],
        missingAdminTables: [...adminTables],
        reason: `${cause?.message ?? 'The connection failed.'}${code}`,
      },
    };
  }
}
