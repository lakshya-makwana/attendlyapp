import { getDatabase, normalizeRows } from '../db/database';

export interface LocalWorker {
  id: string;
  account_id: string;
  name: string;
  daily_wage: number;
  phone?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  sync_status: 'SYNCED' | 'PENDING' | 'FAILED';
}

function generateId(): string {
  return 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

export const WorkerRepository = {
  getAll(accountId: string, onlyActive: boolean = true): LocalWorker[] {
    const db = getDatabase();
    const query = onlyActive
      ? 'SELECT * FROM workers WHERE account_id = ? AND is_active = 1 ORDER BY name ASC'
      : 'SELECT * FROM workers WHERE account_id = ? ORDER BY name ASC';
    const result = db.executeSync(query, [accountId]);
    const rows = normalizeRows(result);
    return rows.map(row => ({
      ...row,
      is_active: Boolean(row.is_active),
    }));
  },

  getById(id: string, accountId: string): LocalWorker | null {
    const db = getDatabase();
    const result = db.executeSync('SELECT * FROM workers WHERE id = ? AND account_id = ?', [id, accountId]);
    const rows = normalizeRows(result);
    if (rows.length === 0) return null;
    const row = rows[0] as any;
    return {
      ...row,
      is_active: Boolean(row.is_active),
    };
  },

  save(worker: Partial<LocalWorker> & { name: string; daily_wage: number; account_id: string }): LocalWorker {
    const db = getDatabase();
    const now = new Date().toISOString();
    const id = worker.id || generateId();
    const isActive = worker.is_active !== undefined ? (worker.is_active ? 1 : 0) : 1;

    db.executeSync(
      `INSERT OR REPLACE INTO workers 
       (id, account_id, name, daily_wage, phone, is_active, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        id,
        worker.account_id,
        worker.name,
        worker.daily_wage,
        worker.phone || null,
        isActive,
        worker.created_at || now,
        now,
      ]
    );

    // Add to sync queue
    db.executeSync(
      `INSERT OR REPLACE INTO sync_queue (id, account_id, entity_type, entity_id, action, payload, created_at, status)
       VALUES (?, ?, 'worker', ?, 'UPSERT', ?, ?, 'PENDING')`,
      [
        'q_' + id,
        worker.account_id,
        id,
        JSON.stringify({
          id,
          name: worker.name,
          daily_wage: worker.daily_wage,
          phone: worker.phone,
          is_active: Boolean(isActive),
          effective_from: (worker as any).effective_from || new Date().toISOString().split('T')[0],
        }),
        now,
      ]
    );

    // Ensure initial wage history record is saved locally
    try {
      const wageCheck = db.executeSync(
        'SELECT COUNT(*) as cnt FROM worker_wage_history WHERE worker_id = ? AND account_id = ?',
        [id, worker.account_id]
      );
      const wageRows = normalizeRows(wageCheck);
      if (!wageRows.length || Number(wageRows[0].cnt) === 0) {
        const effFrom = (worker as any).effective_from || new Date().toISOString().split('T')[0];
        const whId = 'wh_' + id + '_init';
        db.executeSync(
          `INSERT OR REPLACE INTO worker_wage_history 
           (id, account_id, worker_id, daily_wage, effective_from, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [whId, worker.account_id, id, worker.daily_wage, effFrom, now, now]
        );
      }
    } catch {}

    return {
      id,
      account_id: worker.account_id,
      name: worker.name,
      daily_wage: worker.daily_wage,
      phone: worker.phone || null,
      is_active: Boolean(isActive),
      created_at: worker.created_at || now,
      updated_at: now,
      sync_status: 'PENDING',
    };
  },

  saveBatchFromSync(workers: any[], activeAccountId?: string): void {
    const db = getDatabase();
    for (const w of workers) {
      // Check if local record exists with PENDING sync status
      const existing = db.executeSync(
        "SELECT id, sync_status FROM workers WHERE id = ? AND sync_status = 'PENDING'",
        [w.id]
      );
      if (existing.rows && existing.rows.length > 0) {
        continue; // Keep local unsynced record intact
      }

      const isActive = w.active !== undefined ? (w.active ? 1 : 0) : (w.is_active ? 1 : 0);
      const dailyWage = typeof w.daily_wage === 'number' ? w.daily_wage : parseFloat(w.daily_wage || '0.0');
      const accId = w.account_id || activeAccountId || '';

      db.executeSync(
        `INSERT OR REPLACE INTO workers 
         (id, account_id, name, daily_wage, phone, is_active, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED')`,
        [
          w.id,
          accId,
          w.name,
          dailyWage,
          w.phone || null,
          isActive,
          w.created_at,
          w.updated_at,
        ]
      );

      // Sync nested wage history if present
      if (Array.isArray(w.wage_history) && w.wage_history.length > 0) {
        for (const wh of w.wage_history) {
          const whWage = typeof wh.daily_wage === 'number' ? wh.daily_wage : parseFloat(wh.daily_wage || '0.0');
          db.executeSync(
            `INSERT OR REPLACE INTO worker_wage_history 
             (id, account_id, worker_id, daily_wage, effective_from, created_at, updated_at, sync_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'SYNCED')`,
            [
              wh.id,
              accId,
              w.id,
              whWage,
              wh.effective_from,
              wh.created_at || new Date().toISOString(),
              wh.updated_at || new Date().toISOString(),
            ]
          );
        }
      }
    }
  },
};
