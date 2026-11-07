import initSqlJs, { Database, SqlJsStatic, SqlValue, BindParams } from 'sql.js';
import {
  DbLike,
  SQLiteBindParams,
  SQLiteBindValue,
  SQLiteRunResult,
  SQLiteVariadicBindParams,
} from './types';
import { migrations } from './migrations';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

function toSqlValue(v: SQLiteBindValue): SqlValue {
  if (typeof v === 'boolean') {
    return v ? 1 : 0;
  }
  if (v instanceof ArrayBuffer) {
    return new Uint8Array(v);
  }
  return v;
}

function extractParams(
  paramOrFirst?: SQLiteBindParams | SQLiteBindValue,
  rest?: SQLiteBindValue[]
): BindParams {
  if (paramOrFirst === undefined) {
    return rest && rest.length > 0 ? rest.map(toSqlValue) : [];
  }

  if (Array.isArray(paramOrFirst)) {
    return paramOrFirst.map(toSqlValue);
  }

  if (
    typeof paramOrFirst === 'object' &&
    paramOrFirst !== null &&
    !(paramOrFirst instanceof Uint8Array) &&
    !(paramOrFirst instanceof ArrayBuffer)
  ) {
    const obj: Record<string, SqlValue> = {};
    for (const [k, v] of Object.entries(paramOrFirst)) {
      obj[k] = toSqlValue(v);
    }
    return obj;
  }

  const all = [paramOrFirst, ...(rest ?? [])];
  return all.map(toSqlValue);
}

/**
 * SQLite WASM test adapter on top of sql.js implementing DbLike.
 * Enables running Jest unit tests with real SQLite schemas in pure Node environments.
 */
export class SqlJsAdapter implements DbLike {
  public readonly rawDb: Database;
  private savepointIndex = 0;

  constructor(db: Database) {
    this.rawDb = db;
  }

  static async create(): Promise<SqlJsAdapter> {
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON;');
    return new SqlJsAdapter(db);
  }

  /**
   * Initializes a new in-memory SQLite database and applies all official migrations
   * sequentially, exactly matching the production schema.
   */
  static async createWithMigrations(): Promise<SqlJsAdapter> {
    const adapter = await SqlJsAdapter.create();
    for (const m of migrations) {
      for (const statement of m.statements) {
        const sql = statement.trim();
        if (sql.length > 0) {
          adapter.rawDb.run(sql);
        }
      }
      adapter.rawDb.run(`PRAGMA user_version = ${m.version};`);
    }
    return adapter;
  }

  async runAsync(source: string, params: SQLiteBindParams): Promise<SQLiteRunResult>;
  async runAsync(source: string, ...params: SQLiteVariadicBindParams): Promise<SQLiteRunResult>;
  async runAsync(
    source: string,
    paramOrFirst?: SQLiteBindParams | SQLiteBindValue,
    ...rest: SQLiteBindValue[]
  ): Promise<SQLiteRunResult> {
    const params = extractParams(paramOrFirst, rest);
    this.rawDb.run(source, params);
    const changes = this.rawDb.getRowsModified();
    const idResult = this.rawDb.exec('SELECT last_insert_rowid() as id;');
    const lastInsertRowId =
      idResult.length > 0 && idResult[0].values.length > 0
        ? (idResult[0].values[0][0] as number)
        : 0;
    return { changes, lastInsertRowId };
  }

  async getFirstAsync<T>(source: string, params: SQLiteBindParams): Promise<T | null>;
  async getFirstAsync<T>(source: string, ...params: SQLiteVariadicBindParams): Promise<T | null>;
  async getFirstAsync<T>(
    source: string,
    paramOrFirst?: SQLiteBindParams | SQLiteBindValue,
    ...rest: SQLiteBindValue[]
  ): Promise<T | null> {
    const params = extractParams(paramOrFirst, rest);
    const stmt = this.rawDb.prepare(source);
    try {
      if (params !== null && (!Array.isArray(params) || params.length > 0)) {
        stmt.bind(params);
      }
      if (stmt.step()) {
        return stmt.getAsObject() as unknown as T;
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  async getAllAsync<T>(source: string, params: SQLiteBindParams): Promise<T[]>;
  async getAllAsync<T>(source: string, ...params: SQLiteVariadicBindParams): Promise<T[]>;
  async getAllAsync<T>(
    source: string,
    paramOrFirst?: SQLiteBindParams | SQLiteBindValue,
    ...rest: SQLiteBindValue[]
  ): Promise<T[]> {
    const params = extractParams(paramOrFirst, rest);
    const stmt = this.rawDb.prepare(source);
    try {
      if (params !== null && (!Array.isArray(params) || params.length > 0)) {
        stmt.bind(params);
      }
      const results: T[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as unknown as T);
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  async execAsync(source: string): Promise<void> {
    this.rawDb.exec(source);
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    const sp = `sp_repo_${++this.savepointIndex}`;
    this.rawDb.exec(`SAVEPOINT ${sp};`);
    try {
      await task();
      this.rawDb.exec(`RELEASE SAVEPOINT ${sp};`);
    } catch (err) {
      this.rawDb.exec(`ROLLBACK TO SAVEPOINT ${sp};`);
      this.rawDb.exec(`RELEASE SAVEPOINT ${sp};`);
      throw err;
    }
  }
}
