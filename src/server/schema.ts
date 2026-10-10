/**
 * Helpers for a deployment that is newer than the database it is pointed at.
 *
 * Migrations 005-007 add products.published/products.featured, the site_pages
 * table and the console tables. When a deployment ships without those
 * migrations being applied, every affected route raises 42P01 (relation does
 * not exist) or 42703 (column does not exist). Those are not request errors, so
 * they get their own handling: the storefront degrades to the behaviour from
 * before the column existed, and the console reports what to migrate.
 */

export const missingRelationCode = '42P01';
export const missingColumnCode = '42703';

export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** True when the failure means "the schema is behind this build". */
export function isMissingSchema(error: unknown): boolean {
  const code = errorCode(error);
  return code === missingRelationCode || code === missingColumnCode;
}

export const migrateConsoleHint =
  'The admin console needs db/migrations/005_admin_console.sql, 006_store_settings.sql, 007_admin_users.sql, '
  + '008_role_signup.sql, 009_password_reset_lookup.sql, 010_remove_demo_accounts.sql, 011_email_delivery.sql, '
  + '012_owner_password_hold.sql, 013_product_details.sql, 014_order_item_products.sql, '
  + '015_owner_password_no_rotation.sql and 016_owner_password_history.sql. '
  + 'Run "npm run db:migrate:production" against this database.';

export type SchemaDrift = { status: number; body: Record<string, unknown> };

/**
 * The response a console route returns when the database predates the console.
 * 503 rather than 500: the request was fine, the deployment is not, and a
 * monitor should not count it as an application fault.
 */
export function schemaNotMigrated(error: unknown, extra: Record<string, unknown> = {}): SchemaDrift {
  const relation = errorCode(error) === missingRelationCode;
  return {
    status: 503,
    body: {
      error: 'schema_not_migrated',
      message: relation
        ? 'The admin console cannot run because this database is missing its tables.'
        : 'The admin console cannot run because this database is missing a column it needs.',
      detail: migrateConsoleHint,
      code: errorCode(error),
      ...extra,
    },
  };
}
