import { open, DB } from '@op-engineering/op-sqlite';

let dbInstance: DB | null = null;
const CURRENT_SCHEMA_VERSION = 1;

export function getDatabase(): DB {
  if (!dbInstance) {
    dbInstance = open({
      name: 'attendly_local.db',
    });

    // Enforce SQLite integrity pragmas
    try {
      dbInstance.executeSync('PRAGMA foreign_keys = ON;');
      dbInstance.executeSync('PRAGMA journal_mode = WAL;');
    } catch {
      // Ignored in test/mock environments where pragmas may not be implemented
    }

    initSchema(dbInstance);
  }
  return dbInstance;
}

export function normalizeRows(result: any): any[] {
  if (!result || !result.rows) return [];
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result.rows._array)) return result.rows._array;
  return [];
}

function initSchema(db: DB) {
  // Check schema version
  let currentVersion = 0;
  try {
    const versionRes = db.executeSync('PRAGMA user_version;');
    if (versionRes && versionRes.rows && versionRes.rows.length > 0) {
      const row = versionRes.rows[0] as any;
      currentVersion =
        typeof row === 'object' && row !== null
          ? (row.user_version ?? Object.values(row)[0] ?? 0)
          : (row ?? 0);
    }
  } catch {
    currentVersion = 0;
  }

  // Metadata table (tracks schema, device account association, and recovery state)
  db.executeSync(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  if (currentVersion < 1) {
    // Workers table
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        daily_wage REAL NOT NULL DEFAULT 0.0,
        phone TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'SYNCED'
      );
    `);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_workers_account ON workers(account_id);`);

    // Sites table
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        location TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'SYNCED'
      );
    `);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sites_account ON sites(account_id);`);

    // Attendance table
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS attendance (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        site_id TEXT,
        date TEXT NOT NULL,
        work_units REAL NOT NULL DEFAULT 1.0,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'SYNCED',
        UNIQUE(account_id, worker_id, date)
      );
    `);
    try {
      db.executeSync('ALTER TABLE attendance ADD COLUMN notes TEXT;');
    } catch {}
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);`);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_attendance_worker ON attendance(worker_id);`);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_attendance_account ON attendance(account_id);`);

    // Advances table
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS advances (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'SYNCED'
      );
    `);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_advances_date ON advances(date);`);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_advances_worker ON advances(worker_id);`);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_advances_account ON advances(account_id);`);

    // Sync Queue table
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
      );
    `);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);`);
    // Worker Wage History table
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS worker_wage_history (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        daily_wage REAL NOT NULL,
        effective_from TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'SYNCED',
        UNIQUE(account_id, worker_id, effective_from)
      );
    `);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_wage_history_worker ON worker_wage_history(worker_id);`);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_wage_history_effective ON worker_wage_history(effective_from);`);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_wage_history_account ON worker_wage_history(account_id);`);

    try {
      db.executeSync(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
    } catch {}
  }

  // Idempotent migration for existing installations
  try {
    db.executeSync('ALTER TABLE attendance ADD COLUMN notes TEXT;');
  } catch {}
  try {
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS worker_wage_history (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        daily_wage REAL NOT NULL,
        effective_from TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'SYNCED',
        UNIQUE(account_id, worker_id, effective_from)
      );
    `);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_wage_history_worker ON worker_wage_history(worker_id);`);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_wage_history_effective ON worker_wage_history(effective_from);`);
    db.executeSync(`CREATE INDEX IF NOT EXISTS idx_wage_history_account ON worker_wage_history(account_id);`);
  } catch {}
}

export function getLocalAccountId(): string | null {
  try {
    const db = getDatabase();
    const res = db.executeSync("SELECT value FROM app_metadata WHERE key = 'bound_account_id'");
    const rows = normalizeRows(res);
    if (rows.length > 0 && rows[0].value) {
      return rows[0].value;
    }
  } catch {}
  return null;
}

export function setLocalAccountId(accountId: string): void {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT OR REPLACE INTO app_metadata (key, value, updated_at) VALUES ('bound_account_id', ?, ?)`,
      [accountId, now]
    );
  } catch (err) {
    console.warn('Failed to persist bound_account_id to local SQLite metadata:', err);
  }
}

export interface AccountContextVerification {
  safe: boolean;
  reason?: string;
  boundAccountId?: string | null;
}

/**
 * Account Context Verification
 * Protects against cross-account data pollution and silent record reassignment:
 * 1. Checks if local SQLite database has an account binding.
 * 2. If unassigned, checks if existing records exist. If completely clean or matching, binds account.
 * 3. If assigned to account A, but incoming session is for account B, blocks data operations
 *    and sync to prevent cross-account pollution.
 */
export function verifyAccountContext(targetAccountId: string): AccountContextVerification {
  if (!targetAccountId) {
    return { safe: false, reason: 'Target account ID is missing or empty' };
  }

  const boundId = getLocalAccountId();
  if (!boundId) {
    // Check if there are existing records with a different account_id in sync_queue
    try {
      const db = getDatabase();
      const existingQueue = db.executeSync('SELECT DISTINCT account_id FROM sync_queue LIMIT 2');
      const rows = normalizeRows(existingQueue);
      if (rows.length > 0) {
        const foundId = rows[0].account_id;
        if (foundId && foundId !== targetAccountId) {
          return {
            safe: false,
            boundAccountId: foundId,
            reason: `Local unsynced queue belongs to account ${foundId}, cannot bind to ${targetAccountId}`,
          };
        }
      }
    } catch {}

    // Safe to bind
    setLocalAccountId(targetAccountId);
    return { safe: true, boundAccountId: targetAccountId };
  }

  if (boundId === targetAccountId) {
    return { safe: true, boundAccountId: boundId };
  }

  // Account mismatch detected!
  return {
    safe: false,
    boundAccountId: boundId,
    reason: `Account mismatch: Database bound to account ${boundId}, but active session is ${targetAccountId}. Data operations blocked to prevent cross-account contamination.`,
  };
}

export function countUnsyncedRecords(accountId?: string): number {
  try {
    const db = getDatabase();
    const query = accountId
      ? "SELECT COUNT(*) as count FROM sync_queue WHERE account_id = ? AND status = 'PENDING'"
      : "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'";
    const params = accountId ? [accountId] : [];
    const res = db.executeSync(query, params);
    const rows = normalizeRows(res);
    return rows.length > 0 ? rows[0].count || 0 : 0;
  } catch {
    return 0;
  }
}

export function _resetDatabaseForTesting(): void {
  dbInstance = null;
}
