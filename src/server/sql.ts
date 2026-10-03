/**
 * A parser and evaluator for the slice of PostgreSQL this application issues.
 *
 * The database layer was removed, so the `Database` interface is now served by an
 * in-memory store (`./database.ts`). That store still receives the same query
 * strings the handlers and the admin console have always sent, so something has to
 * understand them. This module is that something.
 *
 * It is deliberately not a general SQL engine. It covers the statement shapes and
 * expressions that appear in this codebase and throws on anything else, so a query
 * that drifts outside the supported subset fails loudly at the call site instead of
 * silently returning the wrong rows.
 */

export type SqlRow = Record<string, unknown>;

/* ------------------------------------------------------------------ tokens */

type TokenKind = 'ident' | 'string' | 'number' | 'param' | 'punct' | 'operator';

export type Token = { kind: TokenKind; value: string; start: number };

const multiCharOperators = ['::', '<>', '!=', '<=', '>=', '||'];

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    // A dollar-quoted body: $$...$$ or $tag$...$tag$. Used for the JSON payload a
    // bulk write hands over, where the body is arbitrary text that may itself
    // contain single quotes.
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, index + tag.length);
      if (end === -1) throw new SqlError(`Unterminated dollar-quoted string at position ${index}.`);
      tokens.push({ kind: 'string', value: sql.slice(index + tag.length, end), start: index });
      index = end + tag.length;
      continue;
    }

    if (char === "'") {
      let value = '';
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === "'") {
          if (sql[cursor + 1] === "'") {
            value += "'";
            cursor += 2;
            continue;
          }
          break;
        }
        value += sql[cursor];
        cursor += 1;
      }
      if (cursor >= sql.length) throw new SqlError('Unterminated string literal.');
      tokens.push({ kind: 'string', value, start: index });
      index = cursor + 1;
      continue;
    }

    if (char === '"') {
      const end = sql.indexOf('"', index + 1);
      if (end === -1) throw new SqlError('Unterminated quoted identifier.');
      tokens.push({ kind: 'ident', value: sql.slice(index + 1, end), start: index });
      index = end + 1;
      continue;
    }

    const parameter = /^\$(\d+)/.exec(sql.slice(index));
    if (parameter) {
      tokens.push({ kind: 'param', value: parameter[1], start: index });
      index += parameter[0].length;
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(sql[index + 1] ?? ''))) {
      const number = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(sql.slice(index)) as RegExpExecArray;
      tokens.push({ kind: 'number', value: number[0], start: index });
      index += number[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(index)) as RegExpExecArray;
      tokens.push({ kind: 'ident', value: word[0], start: index });
      index += word[0].length;
      continue;
    }

    const pair = sql.slice(index, index + 2);
    if (multiCharOperators.includes(pair)) {
      tokens.push({ kind: 'operator', value: pair, start: index });
      index += 2;
      continue;
    }

    if ('(),.[];'.includes(char)) {
      tokens.push({ kind: 'punct', value: char, start: index });
      index += 1;
      continue;
    }

    if ('+-*/<>=%'.includes(char)) {
      tokens.push({ kind: 'operator', value: char, start: index });
      index += 1;
      continue;
    }

    throw new SqlError(`Unexpected character ${JSON.stringify(char)} at position ${index}.`);
  }
  return tokens;
}

export class SqlError extends Error {
  /** The PostgreSQL error code, so a caller can branch on it as it did on `pg`. */
  code: string | undefined;

  constructor(message: string, options: { code?: string } = {}) {
    super(message);
    this.name = 'SqlError';
    this.code = options.code;
  }
}

/* -------------------------------------------------------------- expressions */

/** The ordering written inside an aggregate, as in `json_agg(x ORDER BY y)`. */
export type AggregateOrder = { expr: Expr; direction: 'asc' | 'desc' };

export type Expr =
  | { t: 'null' }
  | { t: 'bool'; v: boolean }
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'param'; i: number }
  | { t: 'col'; qualifier: string | null; name: string }
  | { t: 'now' }
  | { t: 'call'; name: string; args: Expr[]; orderBy: AggregateOrder[] }
  | { t: 'cast'; arg: Expr; to: string }
  | { t: 'unary'; op: string; arg: Expr }
  | { t: 'binary'; op: string; left: Expr; right: Expr }
  | { t: 'and'; args: Expr[] }
  | { t: 'or'; args: Expr[] }
  | { t: 'not'; arg: Expr }
  | { t: 'isnull'; arg: Expr; negated: boolean }
  | { t: 'in'; arg: Expr; list: Expr[]; subquery: SelectStatement | null; negated: boolean }
  | { t: 'any'; arg: Expr; list: Expr; negated: boolean }
  | { t: 'subquery'; statement: SelectStatement }
  | { t: 'exists'; statement: SelectStatement; negated: boolean }
  | { t: 'row'; items: Expr[] };

export type SelectItem = { expr: Expr; alias: string | null };

export type OnConflict =
  | { action: 'nothing'; columns: string[] }
  | { action: 'update'; columns: string[]; assignments: Array<{ column: string; value: Expr }> };

export type Statement =
  | {
      t: 'select';
      items: SelectItem[];
      from: { table: string; alias: string } | null;
      joins: Array<{ table: string; alias: string; on: Expr }>;
      where: Expr | null;
      orderBy: Array<{ expr: Expr; direction: 'asc' | 'desc' }>;
      limit: Expr | null;
      offset: Expr | null;
    }
  | {
      t: 'insert';
      table: string;
      columns: string[];
      rows: Expr[][] | null;
      select: SelectStatement | null;
      onConflict: OnConflict | null;
      returning: SelectItem[] | null;
    }
  | { t: 'update'; table: string; alias: string; set: Array<{ column: string; value: Expr }>; where: Expr | null; returning: SelectItem[] | null }
  | { t: 'delete'; table: string; alias: string; where: Expr | null; returning: SelectItem[] | null };

/* ------------------------------------------------------------------ parser */

const reservedAfterFrom = new Set([
  'from', 'where', 'order', 'limit', 'offset', 'join', 'inner', 'left', 'on', 'returning',
  'group', 'having', 'union', 'set', 'values', 'cross', 'as', 'and', 'or', 'is', 'in',
  'like', 'ilike', 'between', 'not', 'distinct', 'into', 'do', 'update', 'delete',
]);

class Parser {
  private tokens: Token[];
  private index = 0;

  constructor(sql: string) {
    this.tokens = tokenize(sql);
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    if (!token) throw new SqlError('The statement ended unexpectedly.');
    this.index += 1;
    return token;
  }

  private atKeyword(...words: string[]) {
    const token = this.peek();
    return token?.kind === 'ident' && words.includes(token.value.toLowerCase());
  }

  private eatKeyword(...words: string[]) {
    if (!this.atKeyword(...words)) return false;
    this.index += 1;
    return true;
  }

  private expectKeyword(word: string) {
    if (!this.eatKeyword(word)) throw new SqlError(`Expected ${word.toUpperCase()}.`);
  }

  private atPunct(value: string) {
    return this.peek()?.kind === 'punct' && this.peek()?.value === value;
  }

  private eatPunct(value: string) {
    if (!this.atPunct(value)) return false;
    this.index += 1;
    return true;
  }

  private expectPunct(value: string) {
    if (!this.eatPunct(value)) throw new SqlError(`Expected ${JSON.stringify(value)}.`);
  }

  private atOperator(...values: string[]) {
    const token = this.peek();
    return token?.kind === 'operator' && values.includes(token.value);
  }

  private eatOperator(...values: string[]) {
    if (!this.atOperator(...values)) return false;
    this.index += 1;
    return true;
  }

  parse(): Statement {
    if (this.atKeyword('with')) throw new SqlError('Common table expressions are not supported by the in-memory store.');
    const token = this.peek();
    if (!token) throw new SqlError('Empty statement.');
    if (token.kind !== 'ident') throw new SqlError('A statement must start with SELECT, INSERT, UPDATE or DELETE.');
    switch (token.value.toLowerCase()) {
      case 'select': return this.parseSelect(true);
      case 'insert': return this.parseInsert();
      case 'update': return this.parseUpdate();
      case 'delete': return this.parseDelete();
      default: throw new SqlError(`Unsupported statement ${token.value.toUpperCase()}.`);
    }
  }

  /* ---------------------------------------------------------------- select */

  /**
 * A SELECT, whether it is the whole statement or a subquery.
 *
 * `topLevel` is what separates the two: only the outermost statement may claim to
 * have consumed the input, because a subquery is followed by a closing paren, a
 * comma or another clause rather than by the end of the text.
 */
private parseSelect(topLevel = false): SelectStatement {
    this.expectKeyword('select');
    this.eatKeyword('all');
    const items = this.parseSelectItems();
    let from: { table: string; alias: string } | null = null;
    const joins: Array<{ table: string; alias: string; on: Expr }> = [];
    if (this.eatKeyword('from')) from = this.parseTableRef();

    for (;;) {
      if (this.atKeyword('join', 'inner', 'left')) {
        this.eatKeyword('inner');
        this.eatKeyword('left');
        this.eatKeyword('outer');
        this.expectKeyword('join');
        const table = this.parseTableRef();
        let on: Expr = { t: 'bool', v: true };
        if (this.eatKeyword('on')) on = this.parseExpr();
        joins.push({ ...table, on });
        continue;
      }
      if (this.atKeyword('cross')) {
        this.eatKeyword('cross');
        this.expectKeyword('join');
        const table = this.parseTableRef();
        joins.push({ ...table, on: { t: 'bool', v: true } });
        continue;
      }
      break;
    }

    let where: Expr | null = null;
    if (this.eatKeyword('where')) where = this.parseExpr();

    if (this.atKeyword('group', 'having', 'union', 'window')) {
      throw new SqlError('GROUP BY, HAVING, UNION and WINDOW are not supported by the in-memory store.');
    }

    const orderBy = this.parseOrderBy();

    let limit: Expr | null = null;
    let offset: Expr | null = null;
    if (this.eatKeyword('limit')) {
      if (this.atKeyword('all')) this.next();
      else limit = this.parseExpr();
    }
    if (this.eatKeyword('offset')) offset = this.parseExpr();

    if (!this.atEnd() && topLevel) {
      throw new SqlError(`Unexpected trailing input near ${this.peek()?.value ?? 'the end of the statement'}.`);
    }

    return { t: 'select', items, from, joins, where, orderBy, limit, offset };
  }

  /** `ORDER BY a, b DESC`, shared by a select list and an aggregate's arguments. */
  private parseOrderBy(): AggregateOrder[] {
    if (!this.atKeyword('order')) return [];
    this.next();
    this.expectKeyword('by');
    const terms: AggregateOrder[] = [];
    do {
      const expr = this.parseExpr();
      let direction: 'asc' | 'desc' = 'asc';
      if (this.eatKeyword('asc')) direction = 'asc';
      else if (this.eatKeyword('desc')) direction = 'desc';
      terms.push({ expr, direction });
    } while (this.eatPunct(','));
    return terms;
  }

  private parseSelectItems(): SelectItem[] {
    const items: SelectItem[] = [];
    do {
      // `alias.*` is not used anywhere, but `*` on its own is.
      if (this.atOperator('*') && !this.isOperatorAfterOperand()) {
        this.next();
        items.push({ expr: { t: 'col', qualifier: null, name: '*' }, alias: null });
        continue;
      }
      const expr = this.parseExpr();
      let alias: string | null = null;
      if (this.eatKeyword('as')) {
        alias = this.next().value;
      } else {
        const token = this.peek();
        // A bare identifier directly after an operand is an implicit alias.
        if (token?.kind === 'ident' && !reservedAfterFrom.has(token.value.toLowerCase())) {
          alias = this.next().value;
        }
      }
      items.push({ expr, alias });
    } while (this.eatPunct(','));
    return items;
  }

  private isOperatorAfterOperand() {
    return false;
  }

  private parseTableRef(): { table: string; alias: string } {
    const token = this.next();
    if (token.kind !== 'ident') throw new SqlError('Expected a table name.');
    let name = token.value;
    // `information_schema.columns` and `pg_catalog.pg_type` arrive as one path.
    while (this.atPunct('.')) {
      this.next();
      name += `.${this.next().value}`;
    }
    let alias = name.split('.').pop() as string;
    if (this.eatKeyword('as')) alias = this.next().value;
    else {
      const next = this.peek();
      if (next?.kind === 'ident' && !reservedAfterFrom.has(next.value.toLowerCase())) alias = this.next().value;
    }
    return { table: name, alias };
  }

  /* ---------------------------------------------------------------- insert */

  private parseInsert(): Statement {
    this.expectKeyword('insert');
    this.eatKeyword('into');
    const table = this.parseBareTableName();
    const columns = this.eatPunct('(') ? this.parseNameList() : [];

    let rows: Expr[][] | null = null;
    let select: SelectStatement | null = null;
    if (this.eatKeyword('values')) {
      rows = [];
      do {
        this.expectPunct('(');
        const tuple: Expr[] = [];
        if (!this.atPunct(')')) {
          do {
            tuple.push(this.parseExpr());
          } while (this.eatPunct(','));
        }
        this.expectPunct(')');
        rows.push(tuple);
      } while (this.eatPunct(','));
    } else if (this.atKeyword('select')) {
      select = this.parseSelect();
    } else {
      throw new SqlError('INSERT needs VALUES or a SELECT.');
    }

    let onConflict: OnConflict | null = null;
    if (this.atKeyword('on')) {
      this.next();
      this.expectKeyword('conflict');
      const conflictColumns = this.eatPunct('(') ? this.parseNameList() : [];
      if (this.eatKeyword('do')) {
        if (this.eatKeyword('nothing')) {
          onConflict = { action: 'nothing', columns: conflictColumns };
        } else {
          this.expectKeyword('update');
          this.expectKeyword('set');
          const assignments: Array<{ column: string; value: Expr }> = [];
          do {
            const column = this.next().value;
            if (!this.eatOperator('=')) throw new SqlError('Expected = in an ON CONFLICT assignment.');
            assignments.push({ column, value: this.parseExpr() });
          } while (this.eatPunct(','));
          onConflict = { action: 'update', columns: conflictColumns, assignments };
        }
      } else {
        throw new SqlError('Expected DO NOTHING or DO UPDATE.');
      }
    }

    const returning = this.eatKeyword('returning') ? this.parseSelectItems() : null;
    if (!this.atEnd()) throw new SqlError(`Unexpected trailing input near ${this.peek()?.value ?? 'the end of the statement'}.`);

    return { t: 'insert', table, columns, rows, select, onConflict, returning };
  }

  private parseBareTableName() {
    const token = this.next();
    if (token.kind !== 'ident') throw new SqlError('Expected a table name.');
    let name = token.value;
    while (this.atPunct('.')) {
      this.next();
      name += `.${this.next().value}`;
    }
    return name;
  }

  private parseNameList(): string[] {
    const names: string[] = [];
    do {
      const token = this.next();
      if (token.kind !== 'ident') throw new SqlError(`Expected a column name, found ${token.value}.`);
      names.push(token.value);
    } while (this.eatPunct(','));
    this.expectPunct(')');
    return names;
  }

  /* ---------------------------------------------------------------- update */

  private parseUpdate(): Statement {
    this.expectKeyword('update');
    const reference = this.parseTableRef();
    this.expectKeyword('set');
    const set: Array<{ column: string; value: Expr }> = [];
    do {
      const column = this.next().value;
      if (!this.eatOperator('=')) throw new SqlError(`Expected = after ${column}.`);
      set.push({ column, value: this.parseExpr() });
    } while (this.eatPunct(','));

    const where = this.eatKeyword('where') ? this.parseExpr() : null;
    const returning = this.eatKeyword('returning') ? this.parseSelectItems() : null;
    if (!this.atEnd()) throw new SqlError(`Unexpected trailing input near ${this.peek()?.value ?? 'the end of the statement'}.`);
    return { t: 'update', table: reference.table, alias: reference.alias, set, where, returning };
  }

  /* ---------------------------------------------------------------- delete */

  private parseDelete(): Statement {
    this.expectKeyword('delete');
    this.expectKeyword('from');
    const reference = this.parseTableRef();
    const where = this.eatKeyword('where') ? this.parseExpr() : null;
    const returning = this.eatKeyword('returning') ? this.parseSelectItems() : null;
    if (!this.atEnd()) throw new SqlError(`Unexpected trailing input near ${this.peek()?.value ?? 'the end of the statement'}.`);
    return { t: 'delete', table: reference.table, alias: reference.alias, where, returning };
  }

  private atEnd() {
    return this.index >= this.tokens.length;
  }

  /* ------------------------------------------------------------ expression */

  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    const left = this.parseAnd();
    if (!this.atKeyword('or')) return left;
    const args = [left];
    while (this.eatKeyword('or')) args.push(this.parseAnd());
    return { t: 'or', args };
  }

  private parseAnd(): Expr {
    const left = this.parseNot();
    if (!this.atKeyword('and')) return left;
    const args = [left];
    while (this.eatKeyword('and')) args.push(this.parseNot());
    return { t: 'and', args };
  }

  private parseNot(): Expr {
    if (this.eatKeyword('not')) return { t: 'not', arg: this.parseNot() };
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();

    for (;;) {
      if (this.atOperator('=', '<>', '!=', '<', '<=', '>', '>=')) {
        const op = this.next().value;
        // `x = ANY (array)` is a membership test, not a comparison of two values,
        // so it is folded into the same node `IN` produces. The one argument is
        // evaluated at run time, which is what lets a bound array parameter work.
        if (op === '=' && this.atKeyword('any')) {
          this.next();
          this.expectPunct('(');
          const source = this.parseExpr();
          this.expectPunct(')');
          left = { t: 'in', arg: left, list: [source], subquery: null, negated: false };
          continue;
        }
        if (this.atKeyword('any', 'all')) {
          throw new SqlError('The in-memory store supports `= ANY (array)` only.');
        }
        left = { t: 'binary', op: op === '!=' ? '<>' : op, left, right: this.parseAdditive() };
        continue;
      }
      if (this.atKeyword('is')) {
        this.next();
        const negated = this.eatKeyword('not');
        if (this.eatKeyword('null')) {
          left = { t: 'isnull', arg: left, negated };
          continue;
        }
        if (this.eatKeyword('true')) {
          left = { t: 'binary', op: '=', left, right: { t: 'bool', v: !negated } };
          continue;
        }
        if (this.eatKeyword('false')) {
          left = { t: 'binary', op: '=', left, right: { t: 'bool', v: negated } };
          continue;
        }
        throw new SqlError('IS only supports NULL, TRUE and FALSE.');
      }
      const negated = this.atKeyword('not') && this.peek(1)?.kind === 'ident'
        && ['in', 'like', 'ilike'].includes((this.peek(1) as Token).value.toLowerCase());
      if (negated) this.next();

      if (this.atKeyword('in')) {
        this.next();
        this.expectPunct('(');
        if (this.atKeyword('select')) {
          const subquery = this.parseSelect();
          this.expectPunct(')');
          left = { t: 'in', arg: left, list: [], subquery, negated };
        } else {
          const list: Expr[] = [];
          if (!this.atPunct(')')) {
            do {
              list.push(this.parseExpr());
            } while (this.eatPunct(','));
          }
          this.expectPunct(')');
          left = { t: 'in', arg: left, list, subquery: null, negated };
        }
        continue;
      }

      if (this.atKeyword('like', 'ilike')) {
        const op = this.next().value.toLowerCase();
        left = { t: 'binary', op, left, right: this.parseAdditive() };
        continue;
      }

      if (this.atKeyword('between')) {
        this.next();
        const low = this.parseAdditive();
        this.expectKeyword('and');
        left = { t: 'and', args: [
          { t: 'binary', op: '>=', left, right: low },
          { t: 'binary', op: '<=', left, right: this.parseAdditive() },
        ] };
        continue;
      }

      if (this.atKeyword('exists')) {
        this.next();
        this.expectPunct('(');
        const subquery = this.parseSelect();
        this.expectPunct(')');
        left = existsNode(subquery, negated);
        continue;
      }

      if (negated) throw new SqlError('NOT must be followed by IN, LIKE or EXISTS.');
      return left;
    }
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.atOperator('+', '-', '||')) {
      const op = this.next().value;
      left = { t: 'binary', op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.atOperator('*', '/', '%')) {
      const op = this.next().value;
      left = { t: 'binary', op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.atOperator('-')) {
      this.next();
      return { t: 'unary', op: '-', arg: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    while (this.atOperator('::')) {
      this.next();
      let type = this.next().value;
      // `::integer[]` and `::jsonb` both arrive as two identifiers.
      while (this.atPunct('[')) {
        this.next();
        this.expectPunct(']');
        type += '[]';
      }
      expr = { t: 'cast', arg: expr, to: type.toLowerCase() };
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    if (!token) throw new SqlError('The expression ended unexpectedly.');

    if (token.kind === 'param') {
      this.next();
      return { t: 'param', i: Number(token.value) };
    }
    if (token.kind === 'string') {
      this.next();
      return { t: 'str', v: token.value };
    }
    if (token.kind === 'number') {
      this.next();
      return { t: 'num', v: Number(token.value) };
    }
    if (token.kind === 'punct' && token.value === '(') {
      this.next();
      // Either a parenthesised expression or a subquery.
      if (this.atKeyword('select')) {
        const subquery = this.parseSelect();
        this.expectPunct(')');
        return { t: 'subquery', statement: subquery };
      }
      const first = this.parseExpr();
      if (this.atPunct(',')) {
        const items = [first];
        while (this.eatPunct(',')) items.push(this.parseExpr());
        this.expectPunct(')');
        return { t: 'row', items };
      }
      this.expectPunct(')');
      return first;
    }

    if (token.kind === 'ident') {
      const word = token.value.toLowerCase();

      if (word === 'null') { this.next(); return { t: 'null' }; }
      if (word === 'true') { this.next(); return { t: 'bool', v: true }; }
      if (word === 'false') { this.next(); return { t: 'bool', v: false }; }
      if (word === 'not') return this.parseNot();

      if (word === 'exists') {
        this.next();
        this.expectPunct('(');
        const subquery = this.parseSelect();
        this.expectPunct(')');
        return existsNode(subquery, false);
      }

      if (word === 'case') throw new SqlError('CASE is not supported by the in-memory store.');

      this.next();
      // A function call, or a bare word.
      if (this.atPunct('(')) {
        // NOW() is spelled with empty parentheses in an UPDATE's SET list.
        if (word === 'now') {
          this.next();
          this.expectPunct(')');
          return { t: 'now' };
        }
        this.next();
        const args: Expr[] = [];
        if (!this.atPunct(')')) {
          if (this.atOperator('*')) {
            this.next();
            args.push({ t: 'col', qualifier: null, name: '*' });
          } else {
            do {
              args.push(this.parseExpr());
            } while (this.eatPunct(','));
          }
        }
        // `json_agg(value ORDER BY position)` orders the rows the aggregate
        // collects, which is how the gallery keeps its positions in order.
        const orderBy = this.parseOrderBy();
        this.expectPunct(')');
        return { t: 'call', name: word, args, orderBy };
      }

      if (word === 'excluded') {
        if (!this.atPunct('.')) return { t: 'col', qualifier: null, name: token.value };
        this.next();
        return { t: 'col', qualifier: 'excluded', name: this.next().value };
      }

      // A qualified reference such as `product.name` or `newer.created_at`.
      if (this.atPunct('.')) {
        this.next();
        const name = this.next().value;
        return { t: 'col', qualifier: token.value, name };
      }

      if (word === 'now' && !this.atPunct('(')) return { t: 'now' };

      return { t: 'col', qualifier: null, name: token.value };
    }

    throw new SqlError(`Unexpected token ${JSON.stringify(token.value)} at position ${token.start}.`);
  }
}

export type SelectStatement = Extract<Statement, { t: 'select' }>;

export type ExistsExpr = { t: 'exists'; statement: SelectStatement; negated: boolean };

function existsNode(statement: SelectStatement, negated: boolean): ExistsExpr {
  return { t: 'exists', statement, negated };
}

export function parseSql(sql: string): Statement {
  const parser = new Parser(sql);
  return parser.parse();
}