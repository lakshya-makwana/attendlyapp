import { getDatabase, normalizeRows } from '../db/database';
import { toLocalDateString } from '../utils/dateUtils';

export interface LocalWageHistory {
  id: string;
  account_id: string;
  worker_id: string;
  daily_wage: number;
  effective_from: string; // YYYY-MM-DD
  created_at: string;
  updated_at: string;
  sync_status: 'SYNCED' | 'PENDING' | 'FAILED';
}

function generateId(): string {
  return 'wh_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

export const WageHistoryRepository = {
  getByWorkerId(workerId: string, accountId: string): LocalWageHistory[] {
    const db = getDatabase();
    const result = db.executeSync(
      'SELECT * FROM worker_wage_history WHERE worker_id = ? AND account_id = ? ORDER BY effective_from DESC, created_at DESC',
      [workerId, accountId]
    );
    const rows = normalizeRows(result);
    return rows.map(r => ({
      ...r,
      daily_wage: Number(r.daily_wage),
    }));
  },

  getEffectiveWage(
    workerId: string,
    targetDate: string,
    accountId: string,
    fallbackWage: number = 0
  ): number {
    const db = getDatabase();
    const result = db.executeSync(
      'SELECT * FROM worker_wage_history WHERE worker_id = ? AND account_id = ? ORDER BY effective_from ASC, id ASC',
      [workerId, accountId]
    );
    const rows = normalizeRows(result);
    if (!rows || rows.length === 0) {
      return fallbackWage;
    }

    // Earliest recorded wage is baseline fallback (matches PWA wage_service resolve_effective_wage)
    let applicableWage = Number(rows[0].daily_wage);
    for (const r of rows) {
      if (r.effective_from <= targetDate) {
        applicableWage = Number(r.daily_wage);
      } else {
        break;
      }
    }
    return applicableWage;
  },

  save(entry: {
    id?: string;
    account_id: string;
    worker_id: string;
    daily_wage: number;
    effective_from: string;
  }): LocalWageHistory {
    const db = getDatabase();
    const now = new Date().toISOString();
    const id = entry.id || generateId();
    const dailyWage = Number(entry.daily_wage);

    // Check for existing record on exact effective_from
    const existing = db.executeSync(
      'SELECT id FROM worker_wage_history WHERE worker_id = ? AND account_id = ? AND effective_from = ?',
      [entry.worker_id, entry.account_id, entry.effective_from]
    );
    const existingRows = normalizeRows(existing);
    const recordId = existingRows.length > 0 ? existingRows[0].id : id;

    db.executeSync(
      `INSERT OR REPLACE INTO worker_wage_history 
       (id, account_id, worker_id, daily_wage, effective_from, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        recordId,
        entry.account_id,
        entry.worker_id,
        dailyWage,
        entry.effective_from,
        now,
        now,
      ]
    );

    // Re-evaluate worker current rate based on active rate for today
    const todayStr = toLocalDateString();
    const allWages = this.getByWorkerId(entry.worker_id, entry.account_id);
    if (allWages.length > 0) {
      // allWages is ordered by effective_from DESC, created_at DESC
      let activeRate = allWages[allWages.length - 1].daily_wage;
      for (const r of allWages) {
        if (r.effective_from <= todayStr) {
          activeRate = r.daily_wage;
          break;
        }
      }
      db.executeSync(
        `UPDATE workers SET daily_wage = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
        [activeRate, now, entry.worker_id, entry.account_id]
      );
    }

    // Add to sync queue
    db.executeSync(
      `INSERT OR REPLACE INTO sync_queue (id, account_id, entity_type, entity_id, action, payload, created_at, status)
       VALUES (?, ?, 'worker_wage', ?, 'UPSERT', ?, ?, 'PENDING')`,
      [
        'q_' + recordId,
        entry.account_id,
        recordId,
        JSON.stringify({
          id: recordId,
          worker_id: entry.worker_id,
          daily_wage: dailyWage,
          effective_from: entry.effective_from,
        }),
        now,
      ]
    );

    return {
      id: recordId,
      account_id: entry.account_id,
      worker_id: entry.worker_id,
      daily_wage: dailyWage,
      effective_from: entry.effective_from,
      created_at: now,
      updated_at: now,
      sync_status: 'PENDING',
    };
  },

  delete(id: string, workerId: string, accountId: string): void {
    const db = getDatabase();
    const countRes = db.executeSync(
      'SELECT COUNT(*) as cnt FROM worker_wage_history WHERE worker_id = ? AND account_id = ?',
      [workerId, accountId]
    );
    const countRows = normalizeRows(countRes);
    const count = countRows.length > 0 ? Number(countRows[0].cnt) : 0;
    if (count <= 1) {
      throw new Error("Cannot delete the worker's sole wage record.");
    }

    db.executeSync(
      'DELETE FROM worker_wage_history WHERE id = ? AND worker_id = ? AND account_id = ?',
      [id, workerId, accountId]
    );

    // Queue deletion
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT OR REPLACE INTO sync_queue (id, account_id, entity_type, entity_id, action, payload, created_at, status)
       VALUES (?, ?, 'worker_wage', ?, 'DELETE', ?, ?, 'PENDING')`,
      [
        'q_del_' + id,
        accountId,
        id,
        JSON.stringify({ id, worker_id: workerId }),
        now,
      ]
    );

    // Sync worker daily wage with remaining active rate for today
    const todayStr = toLocalDateString();
    const remaining = this.getByWorkerId(workerId, accountId);
    if (remaining.length > 0) {
      // Find latest on or before today
      let activeRate = remaining[remaining.length - 1].daily_wage;
      for (const r of remaining) {
        if (r.effective_from <= todayStr) {
          activeRate = r.daily_wage;
          break;
        }
      }
      db.executeSync(
        `UPDATE workers SET daily_wage = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
        [activeRate, now, workerId, accountId]
      );
    }
  },

  saveBatchFromSync(workerId: string, wages: any[], accountId: string): void {
    const db = getDatabase();
    for (const w of wages) {
      const existing = db.executeSync(
        "SELECT id, sync_status FROM worker_wage_history WHERE id = ? AND sync_status = 'PENDING'",
        [w.id]
      );
      if (existing.rows && existing.rows.length > 0) {
        continue; // Protect local pending edit
      }

      const dailyWage = typeof w.daily_wage === 'number' ? w.daily_wage : parseFloat(w.daily_wage || '0.0');

      db.executeSync(
        `INSERT OR REPLACE INTO worker_wage_history 
         (id, account_id, worker_id, daily_wage, effective_from, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'SYNCED')`,
        [
          w.id,
          accountId,
          workerId,
          dailyWage,
          w.effective_from,
          w.created_at || new Date().toISOString(),
          w.updated_at || new Date().toISOString(),
        ]
      );
    }
  },
};
