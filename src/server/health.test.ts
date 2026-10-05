import { describe, expect, it } from 'vitest';
import { missingDatabaseReason } from './health';
import { productionDatabaseVariables, runtimeDatabaseVariables } from './config';

describe('the guidance for a deployment with no database', () => {
  it('names every variable that would actually fix it', () => {
    const reason = missingDatabaseReason();
    for (const variable of runtimeDatabaseVariables) {
      expect(reason).toContain(variable);
    }
  });

  it('sends nobody to a variable a request cannot read', () => {
    // `productionDatabaseVariables` also contains PRODUCTION_DATABASE_URL, which
    // only the sync consults. Setting it leaves a deployment on the in-memory
    // store, so naming it here would be the same no-op as naming nothing.
    const reason = missingDatabaseReason();
    for (const variable of productionDatabaseVariables) {
      if (runtimeDatabaseVariables.includes(variable as (typeof runtimeDatabaseVariables)[number])) continue;
      expect(reason).not.toContain(variable);
    }
    expect(reason).not.toContain('SYNC_FROM_PRODUCTION');
  });

  it('says the data is lost rather than implying it was kept', () => {
    const reason = missingDatabaseReason();
    expect(reason).toMatch(/in-memory/);
    expect(reason).toMatch(/restart/);
    expect(reason).toMatch(/redeploy/);
  });
});