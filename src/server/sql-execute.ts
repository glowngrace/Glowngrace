/**
 * Evaluates a parsed statement against in-memory tables.
 *
 * This replaces the PostgreSQL driver. The tables, the value shapes and the
 * ordering rules all follow what `pg` used to hand back, because every caller
 * above this layer was written against that: `rowCount` is the number of rows a
 * write touched, timestamps come back as `Date`, `count(*)` is a number, and a
 * JSONB column is stored as an object so `readSettings` finds it already parsed.
 */

import { SqlError, type AggregateOrder, type Expr, type SelectItem, type SelectStatement, type SqlRow, type Statement } from './sql.js';

export type GeneratedColumn = 'serial' | 'uuid';

export type TableDefinition = {
  name: string;
  columns: string[];
  /** Column groups a UNIQUE constraint covers, used to resolve `ON CONFLICT`. */
  unique?: string[][];
  /** Columns the store fills in when an insert does not carry them. */
  generated?: Record<string, GeneratedColumn>;
  /** Timestamp columns defaulted to now on insert. */
  timestamps?: string[];
  /** The first value an identity column starts from. */
  serialStart?: number;
};

export type Store = {
  rows: Map<string, SqlRow[]>;
  definitions: Map<string, TableDefinition>;
  sequences: Map<string, number>;
  now: () => Date;
};

export type Frame = Map<string, SqlRow>;

type Env = {
  store: Store;
  params: unknown[];
  frame: Frame;
  /** The enclosing query's bindings, so a correlated subquery can see them. */
  parent: Frame | null;
  excluded: SqlRow | null;
  /**
   * The row set an aggregate is computed over. Set only while projecting a
   * select list that contains an aggregate, which is what makes
   * `SELECT count(*) FROM t` return one row for an empty table.
   */
  aggregate: Frame[] | null;
};

export type ExecutionResult = { rows: SqlRow[]; rowCount: number | null };

export function createStore(definitions: TableDefinition[], now: () => Date = () => new Date()): Store {
  const rows = new Map<string, SqlRow[]>();
  const byName = new Map<string, TableDefinition>();
  for (const definition of definitions) {
    rows.set(definition.name, []);
    byName.set(definition.name, definition);
  }
  return { rows, definitions: byName, sequences: new Map(), now };
}

function tableRows(store: Store, table: string): SqlRow[] {
  return store.rows.get(table) ?? [];
}

function nextSerial(store: Store, table: string, column: string, start: number) {
  const key = `${table}.${column}`;
  const next = (store.sequences.get(key) ?? start - 1) + 1;
  store.sequences.set(key, next);
  return next;
}

function childEnv(env: Env, overrides: Partial<Env>): Env {
  return { ...env, ...overrides };
}

/* ----------------------------------------------------------------- values */

function isNil(value: unknown) {
  return value === null || value === undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Ordering across mixed types.
 *
 * `pg` hands back `NUMERIC` and `BIGINT` columns as strings, and the orderings
 * that matter here are numeric ones: `ORDER BY id DESC` on a text id and
 * `ORDER BY created_at DESC` on a timestamp both have to sort by value, not by
 * the string the value happens to be spelled as. Anything two values can both be
 * read as a number is compared as one.
 */
function compareValues(left: unknown, right: unknown): number {
  // PostgreSQL sorts NULL last ascending and first descending.
  if (isNil(left) && isNil(right)) return 0;
  if (isNil(left)) return 1;
  if (isNil(right)) return -1;
  if (left instanceof Date || right instanceof Date) {
    const leftTime = left instanceof Date ? left.getTime() : (asNumber(left) ?? Number.NaN);
    const rightTime = right instanceof Date ? right.getTime() : (asNumber(right) ?? Number.NaN);
    if (leftTime === rightTime) return 0;
    return leftTime < rightTime ? -1 : 1;
  }
  const leftNumber = asNumber(left);
  const rightNumber = asNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  const leftText = String(left);
  const rightText = String(right);
  return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
}

function valuesEqual(left: unknown, right: unknown) {
  if (isNil(left) || isNil(right)) return isNil(left) && isNil(right);
  if (left instanceof Date || right instanceof Date) return compareValues(left, right) === 0;
  if (typeof left === 'boolean' || typeof right === 'boolean') return Boolean(left) === Boolean(right);
  const leftNumber = asNumber(left);
  const rightNumber = asNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber;
  return String(left) === String(right);
}

function truthy(value: unknown) {
  if (isNil(value)) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === 't';
  return Boolean(value);
}

function likeToRegExp(pattern: string, flags: string) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, flags);
}

function mergeJson(left: unknown, right: unknown) {
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    return { ...(left as SqlRow), ...(right as SqlRow) };
  }
  return `${String(left ?? '')}${String(right ?? '')}`;
}

/* -------------------------------------------------------------- resolving */

function lookup(frame: Frame, qualifier: string | null, name: string): { found: boolean; value: unknown } {
  if (qualifier) {
    const row = frame.get(qualifier);
    if (!row) return { found: false, value: undefined };
    return { found: name in row, value: row[name] };
  }
  for (const row of frame.values()) {
    if (name in row) return { found: true, value: row[name] };
  }
  return { found: false, value: undefined };
}

function resolveColumn(qualifier: string | null, name: string, env: Env): unknown {
  if (name === '*') return undefined;
  if (qualifier === 'excluded') {
    if (!env.excluded) throw new SqlError('EXCLUDED is only available in an ON CONFLICT assignment.');
    return env.excluded[name];
  }
  const local = lookup(env.frame, qualifier, name);
  if (local.found) return local.value;
  if (env.parent) {
    const outer = lookup(env.parent, qualifier, name);
    if (outer.found) return outer.value;
  }
  return undefined;
}

/* ------------------------------------------------------------- evaluation */

const aggregates = new Set(['count', 'array_agg', 'json_agg', 'sum', 'max', 'min', 'bool_and']);

function isAggregateCall(expr: Expr): expr is Extract<Expr, { t: 'call' }> {
  return expr.t === 'call' && aggregates.has(expr.name);
}

function evaluate(expr: Expr, env: Env): unknown {
  switch (expr.t) {
    case 'null': return null;
    case 'bool': return expr.v;
    case 'num': return expr.v;
    case 'str': return expr.v;
    case 'param': return env.params[expr.i - 1] ?? null;
    case 'col': return resolveColumn(expr.qualifier, expr.name, env);
    case 'now': return env.store.now();

    case 'cast': {
      const value = evaluate(expr.arg, env);
      // The only cast that changes anything is to JSONB, where the caller wrote a
      // JSON string and PostgreSQL would have parsed it on the way in.
      if ((expr.to === 'jsonb' || expr.to === 'json') && typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      if ((expr.to === 'text' || expr.to === 'varchar') && typeof value === 'number') return String(value);
      return value;
    }

    case 'unary': {
      const value = asNumber(evaluate(expr.arg, env));
      return value === null ? null : -value;
    }

    case 'row': return expr.items.map((item) => evaluate(item, env));

    case 'subquery': {
      const rows = runSelect(expr.statement, childEnv(env, { frame: new Map(), parent: env.frame, aggregate: null })).rows;
      if (rows.length === 0) return null;
      const keys = Object.keys(rows[0] as SqlRow);
      return keys.length === 0 ? null : (rows[0] as SqlRow)[keys[0] as string];
    }

    case 'exists': {
      const found = selectFrames(expr.statement, childEnv(env, { frame: new Map(), parent: env.frame, aggregate: null })).length > 0;
      return expr.negated ? !found : found;
    }

    case 'and': return expr.args.every((arg) => truthy(evaluate(arg, env)));
    case 'or': return expr.args.some((arg) => truthy(evaluate(arg, env)));
    case 'not': return !truthy(evaluate(expr.arg, env));

    case 'isnull': {
      const absent = isNil(evaluate(expr.arg, env));
      return expr.negated ? !absent : absent;
    }

    case 'in': {
      const target = evaluate(expr.arg, env);
      const listed = expr.subquery
        ? selectFrames(expr.subquery, childEnv(env, { frame: new Map(), parent: env.frame, aggregate: null }))
          .map((frame) => firstColumn(frame))
        : expr.list.map((item) => evaluate(item, env));
      // `= ANY ($1)` arrives here as a one-element list holding the bound array, so
      // an array-valued candidate contributes its elements rather than itself.
      const candidates = listed.flatMap((candidate) => (Array.isArray(candidate) ? candidate : [candidate]));
      const found = candidates.some((candidate) => valuesEqual(target, candidate));
      return expr.negated ? !found : found;
    }

    case 'binary': return evaluateBinary(expr, env);
    case 'call': return evaluateCall(expr, env);
    default: throw new SqlError('Unsupported expression.');
  }
}

function firstColumn(frame: Frame) {
  for (const row of frame.values()) {
    const keys = Object.keys(row);
    if (keys.length > 0) return row[keys[0] as string];
  }
  return null;
}

function evaluateBinary(expr: Extract<Expr, { t: 'binary' }>, env: Env): unknown {
  // Row comparison, e.g. `(newer.created_at, newer.id) > (candidate.created_at, candidate.id)`.
  if (expr.left.t === 'row' && expr.right.t === 'row') {
    const left = expr.left.items.map((item) => evaluate(item, env));
    const right = expr.right.items.map((item) => evaluate(item, env));
    for (let index = 0; index < left.length; index += 1) {
      const order = compareValues(left[index], right[index]);
      if (order !== 0) {
        switch (expr.op) {
          case '>': return order > 0;
          case '>=': return order >= 0;
          case '<': return order < 0;
          case '<=': return order <= 0;
          default: return order !== 0;
        }
      }
    }
    return expr.op === '>=' || expr.op === '<=';
  }

  const left = evaluate(expr.left, env);
  const right = evaluate(expr.right, env);

  switch (expr.op) {
    case '=': return valuesEqual(left, right);
    case '<>': return !valuesEqual(left, right);
    case '<': return compareValues(left, right) < 0;
    case '<=': return compareValues(left, right) <= 0;
    case '>': return compareValues(left, right) > 0;
    case '>=': return compareValues(left, right) >= 0;
    case '||': return mergeJson(left, right);
    case '+': return (asNumber(left) ?? 0) + (asNumber(right) ?? 0);
    case '-': return (asNumber(left) ?? 0) - (asNumber(right) ?? 0);
    case '*': return (asNumber(left) ?? 0) * (asNumber(right) ?? 0);
    case '/': return (asNumber(left) ?? 0) / (asNumber(right) ?? 0);
    case '%': return (asNumber(left) ?? 0) % (asNumber(right) ?? 0);
    case 'like': return isNil(left) || isNil(right) ? null : likeToRegExp(String(right), '').test(String(left));
    case 'ilike': return isNil(left) || isNil(right) ? null : likeToRegExp(String(right), 'i').test(String(left));
    default: throw new SqlError(`Unsupported operator ${expr.op}.`);
  }
}

function evaluateCall(expr: Extract<Expr, { t: 'call' }>, env: Env): unknown {
  const name = expr.name;

  if (aggregates.has(name)) {
    const frames = env.aggregate ?? [env.frame];
    return evaluateAggregate(name, expr.args, frames, env, expr.orderBy);
  }

  if (name === 'any' || name === 'all') {
    // Only the two-array form reaches here; `x = ANY (array)` is folded into an
    // `in` node by the parser, because that is where the operator lives.
    const target = evaluate(expr.args[0] as Expr, env);
    const source = evaluate(expr.args[1] as Expr, env);
    const candidates = Array.isArray(source) ? source : isNil(source) ? [] : [source];
    return name === 'any'
      ? candidates.some((candidate) => valuesEqual(target, candidate))
      : candidates.every((candidate) => valuesEqual(target, candidate));
  }

  if (name === 'coalesce') {
    for (const arg of expr.args) {
      const value = evaluate(arg, env);
      if (!isNil(value)) return value;
    }
    return null;
  }

  if (name === 'nullif') {
    const left = evaluate(expr.args[0] as Expr, env);
    return valuesEqual(left, evaluate(expr.args[1] as Expr, env)) ? null : left;
  }

  if (name === 'to_regclass') return `public.${String(evaluate(expr.args[0] as Expr, env) ?? '')}`;

  if (name === 'json_agg') {
    const value = evaluate(expr.args[0] as Expr, env);
    return value === undefined ? null : JSON.stringify(value);
  }

  if (name === 'decode') return Buffer.from(String(evaluate(expr.args[0] as Expr, env) ?? ''), 'base64');

  if (name === 'lower') return String(evaluate(expr.args[0] as Expr, env) ?? '').toLowerCase();
  if (name === 'upper') return String(evaluate(expr.args[0] as Expr, env) ?? '').toUpperCase();
  if (name === 'length') return String(evaluate(expr.args[0] as Expr, env) ?? '').length;

  throw new SqlError(`Unsupported function ${name.toUpperCase()}.`);
}

function evaluateAggregate(
  name: string,
  args: Expr[],
  frames: Frame[],
  env: Env,
  orderBy: AggregateOrder[] = [],
): unknown {
  const argument = args[0];
  const perFrame = (frame: Frame) => evaluate(argument as Expr, childEnv(env, { frame, aggregate: null }));

  // `json_agg(value ORDER BY position)` collects the rows in that order. Sorting a
  // copy keeps the caller's row order intact, which matters because the same frames
  // can be read by more than one aggregate in the same select list.
  const ordered = orderBy.length === 0 ? frames : [...frames].sort((left, right) => {
    for (const term of orderBy) {
      const a = evaluate(term.expr, childEnv(env, { frame: left, aggregate: null }));
      const b = evaluate(term.expr, childEnv(env, { frame: right, aggregate: null }));
      const result = compareValues(a, b);
      if (result !== 0) return term.direction === 'desc' ? -result : result;
    }
    return 0;
  });

  if (name === 'count') {
    if (!argument) return frames.length;
    if (argument.t === 'col' && argument.name === '*') return frames.length;
    return frames.filter((frame) => !isNil(perFrame(frame))).length;
  }

  // The remaining aggregates are null over an empty set, exactly as PostgreSQL
  // reports them, so the COALESCE wrappers around them still take effect.
  if (frames.length === 0) return null;

  // `pg` parsed a json column into JavaScript on the way out, so the aggregate hands
  // back an array rather than the text PostgreSQL stores. Returning the text here
  // would leave every caller that reads a JSON column having to parse it itself,
  // and `COALESCE(json_agg(...), '[]'::json)` would mix an array with a string.
  if (name === 'array_agg') return ordered.map(perFrame);
  if (name === 'json_agg') return ordered.map(perFrame);
  if (name === 'bool_and') return ordered.every((frame) => truthy(perFrame(frame)));

  const numbers = ordered.map((frame) => asNumber(perFrame(frame))).filter((value): value is number => value !== null);
  if (name === 'sum') return numbers.reduce((total, value) => total + value, 0);
  if (name === 'max') return numbers.length === 0 ? null : numbers.reduce((best, value) => (value > best ? value : best));
  if (name === 'min') return numbers.length === 0 ? null : numbers.reduce((best, value) => (value < best ? value : best));
  throw new SqlError(`Unsupported aggregate ${name.toUpperCase()}.`);
}

/* -------------------------------------------------------------- selection */

/** True when the expression contains an aggregate outside any nested subquery. */
function containsAggregate(expr: Expr): boolean {
  switch (expr.t) {
    case 'call': return isAggregateCall(expr);
    case 'binary': return containsAggregate(expr.left) || containsAggregate(expr.right);
    case 'unary': return containsAggregate(expr.arg);
    case 'and':
    case 'or': return expr.args.some(containsAggregate);
    case 'not': return containsAggregate(expr.arg);
    case 'isnull': return containsAggregate(expr.arg);
    case 'cast': return containsAggregate(expr.arg);
    case 'row': return expr.items.some(containsAggregate);
    default: return false;
  }
}

function selectFrames(statement: SelectStatement, env: Env): Frame[] {
  const from = statement.from;
  const base: Frame[] = from
    ? tableRows(env.store, from.table).map((row) => new Map<string, SqlRow>([[from.alias, row]]))
    : [new Map<string, SqlRow>()];

  let frames = base;
  for (const join of statement.joins) {
    const joined = tableRows(env.store, join.table);
    const next: Frame[] = [];
    for (const frame of frames) {
      for (const row of joined) {
        const candidate = new Map(frame);
        candidate.set(join.alias, row);
        if (truthy(evaluate(join.on, childEnv(env, { frame: candidate, aggregate: null })))) next.push(candidate);
      }
    }
    frames = next;
  }

  if (!statement.where) return frames;
  return frames.filter((frame) => truthy(evaluate(statement.where as Expr, childEnv(env, { frame, aggregate: null }))));
}

/**
 * The output name for a select item.
 *
 * PostgreSQL does not require an alias: a column is named after itself and a
 * function call after the function. Only the caller cares about the name, and it
 * only cares when it reads the column back by hand, so synthesising one is safe
 * where insisting on an alias would refuse a statement PostgreSQL runs happily.
 */
function aliasFor(item: SelectItem, position = 0) {
  if (item.alias) return item.alias;
  if (item.expr.t === 'col') return item.expr.name;
  if (item.expr.t === 'call') return item.expr.name;
  return `column${position + 1}`;
}

function runSelect(statement: SelectStatement, env: Env): ExecutionResult {
  // The schema probe is answered from the store's own column list rather than by
  // walking information_schema, which has no rows here.
  if (statement.from?.table === 'information_schema.columns') return columnPresence(env);

  const frames = selectFrames(statement, env);

  for (const order of [...statement.orderBy].reverse()) {
    // Sorting from the last key backwards keeps the earlier keys dominant, and
    // keeps the sort stable so equal keys keep their scan order.
    frames.sort((left, right) => {
      const a = evaluate(order.expr, childEnv(env, { frame: left, aggregate: null }));
      const b = evaluate(order.expr, childEnv(env, { frame: right, aggregate: null }));
      const result = compareValues(a, b);
      return order.direction === 'desc' ? -result : result;
    });
  }

  const aggregated = statement.items.some((item) => containsAggregate(item.expr));

  let rows: SqlRow[];
  if (aggregated) {
    // One row for the whole set, so an aggregate over an empty table is still 0
    // rather than no row at all.
    const output: SqlRow = {};
    for (const item of statement.items) {
      output[aliasFor(item)] = evaluate(item.expr, childEnv(env, { frame: new Map(), aggregate: frames }));
    }
    rows = [output];
  } else {
    rows = frames.map((frame) => {
      const output: SqlRow = {};
      for (const item of statement.items) {
        if (item.expr.t === 'col' && item.expr.qualifier === null && item.expr.name === '*') {
          for (const [alias, row] of frame) {
            if (alias === statement.from?.alias || statement.joins.length === 0) Object.assign(output, row);
          }
          continue;
        }
        output[aliasFor(item)] = evaluate(item.expr, childEnv(env, { frame, aggregate: null }));
      }
      return output;
    });
  }

  if (statement.limit) {
    const count = asNumber(evaluate(statement.limit, env)) ?? 0;
    rows = rows.slice(0, Math.max(0, count));
  }
  if (statement.offset) {
    const start = asNumber(evaluate(statement.offset, env)) ?? 0;
    rows = rows.slice(Math.max(0, start));
  }
  return { rows, rowCount: rows.length };
}

/** The catalogue column probe, answered from the store's own definitions. */
function columnPresence(env: Env): ExecutionResult {
  const products = env.store.definitions.get('products');
  const wanted = new Set(
    (Array.isArray(env.params[0]) ? env.params[0] : []).map((value) => String(value)),
  );
  const columns = products ? products.columns.filter((column) => wanted.has(column)) : [];
  return { rows: [{ table_present: products !== undefined, columns }], rowCount: 1 };
}

/* ----------------------------------------------------------------- writes */

function conflictColumns(definition: TableDefinition | undefined, requested: string[]) {
  if (requested.length > 0) return [requested];
  // `ON CONFLICT DO NOTHING` with no target means any unique constraint, so the
  // table's first declared one stands in for it.
  return definition?.unique ?? [];
}

function findConflict(store: Store, table: string, groups: string[][], row: SqlRow) {
  const rows = tableRows(store, table);
  for (const candidate of rows) {
    for (const group of groups) {
      const comparable = group.filter((column) => !isNil(row[column]));
      // A group of all-NULL columns never clashes. That is what the partial index
      // on products.sku expressed, and it is why two products with no SKU set do
      // not collide with each other.
      if (comparable.length === 0) continue;
      if (comparable.every((column) => valuesEqual(candidate[column], row[column]))) return candidate;
    }
  }
  return null;
}

function applyDefaults(store: Store, definition: TableDefinition | undefined, table: string, row: SqlRow) {
  if (!definition) return;
  for (const [column, kind] of Object.entries(definition.generated ?? {})) {
    if (!isNil(row[column])) continue;
    row[column] = kind === 'serial'
      ? nextSerial(store, table, column, definition.serialStart ?? 1)
      : crypto.randomUUID();
  }
  for (const column of definition.timestamps ?? []) {
    if (row[column] === undefined) row[column] = store.now();
  }
}

function runInsert(statement: Extract<Statement, { t: 'insert' }>, env: Env): ExecutionResult {
  const store = env.store;
  const definition = store.definitions.get(statement.table);
  const target = tableRows(store, statement.table);

  let candidates: SqlRow[] = [];
  if (statement.rows) {
    candidates = statement.rows.map((tuple) => {
      const row: SqlRow = {};
      statement.columns.forEach((column, position) => {
        row[column] = tuple[position] ? evaluate(tuple[position], env) : null;
      });
      return row;
    });
  } else if (statement.select) {
    const frames = selectFrames(statement.select, env);
    candidates = frames.map((frame) => {
      const row: SqlRow = {};
      statement.columns.forEach((column, position) => {
        const item = statement.select?.items[position];
        row[column] = item ? evaluate(item.expr, childEnv(env, { frame, aggregate: null })) : null;
      });
      return row;
    });
  }

  const affected: SqlRow[] = [];
for (const candidate of candidates) {
    const row: SqlRow = { ...candidate };
    applyDefaults(store, definition, statement.table, row);

    // Every unique group is checked, whether or not the statement named a conflict
    // target. `ON CONFLICT` decides what happens to a clash; the absence of it is
    // what makes a clash an error, so skipping the check without one would let a
    // duplicate row in where PostgreSQL raises 23505.
    const groups = statement.onConflict
      ? conflictColumns(definition, statement.onConflict.columns)
      : definition?.unique ?? [];
    const clash = findConflict(store, statement.table, groups, row);
    if (clash) {
      if (!statement.onConflict) {
        const column = groups.find((group) => group.filter((name) => !isNil(row[name]))
          .every((name) => valuesEqual(clash[name], row[name])));
        throw new SqlError(
          `duplicate key value violates unique constraint "${statement.table}_${(column ?? groups[0] ?? ['row']).join('_')}_key"`,
          { code: '23505' },
        );
      }
      if (statement.onConflict.action === 'nothing') continue;
      for (const assignment of statement.onConflict.assignments) {
        clash[assignment.column] = evaluate(
          assignment.value,
          childEnv(env, {
            frame: new Map([[statement.table, clash]]),
            excluded: row,
            aggregate: null,
          }),
        );
      }
      affected.push(clash);
      continue;
    }
    target.push(row);
    affected.push(row);
  }

  if (!statement.returning) return { rows: [], rowCount: affected.length };
  const rows = project(statement.returning, affected, env, (row) => new Map([[statement.table, row]]));
  return { rows, rowCount: affected.length };
}

function project(items: SelectItem[], rows: SqlRow[], env: Env, frameFor: (row: SqlRow) => Frame): SqlRow[] {
  return rows.map((row) => {
    const output: SqlRow = {};
    for (const item of items) {
      if (item.expr.t === 'col' && item.expr.qualifier === null && item.expr.name === '*') {
        Object.assign(output, row);
        continue;
      }
      output[aliasFor(item)] = evaluate(item.expr, childEnv(env, { frame: frameFor(row), aggregate: null }));
    }
    return output;
  });
}

function runUpdate(statement: Extract<Statement, { t: 'update' }>, env: Env): ExecutionResult {
  const rows = tableRows(env.store, statement.table);
  const affected: SqlRow[] = [];
  for (const row of rows) {
    const frame = new Map([[statement.alias, row]]);
    if (statement.where && !truthy(evaluate(statement.where, childEnv(env, { frame, aggregate: null })))) continue;
    for (const assignment of statement.set) {
      row[assignment.column] = evaluate(assignment.value, childEnv(env, { frame, aggregate: null }));
    }
    affected.push(row);
  }
  if (!statement.returning) return { rows: [], rowCount: affected.length };
  const projected = project(statement.returning, affected, env, (row) => new Map([[statement.alias, row]]));
  return { rows: projected, rowCount: affected.length };
}

function runDelete(statement: Extract<Statement, { t: 'delete' }>, env: Env): ExecutionResult {
  const rows = tableRows(env.store, statement.table);
  const removed: SqlRow[] = [];
  for (const row of [...rows]) {
    const frame = new Map([[statement.alias, row]]);
    if (statement.where && !truthy(evaluate(statement.where, childEnv(env, { frame, aggregate: null })))) continue;
    rows.splice(rows.indexOf(row), 1);
    removed.push(row);
  }
  if (!statement.returning) return { rows: [], rowCount: removed.length };
  const projected = project(statement.returning, removed, env, (row) => new Map([[statement.alias, row]]));
  return { rows: projected, rowCount: removed.length };
}

export function execute(store: Store, statement: Statement, params: unknown[]): ExecutionResult {
  const env: Env = { store, params, frame: new Map(), parent: null, excluded: null, aggregate: null };
  switch (statement.t) {
    case 'select': return runSelect(statement, env);
    case 'insert': return runInsert(statement, env);
    case 'update': return runUpdate(statement, env);
    case 'delete': return runDelete(statement, env);
    default: throw new SqlError('Unsupported statement.');
  }
}