import { getDatabase, normalizeRows } from '../db/database';

export interface LocalAdvance {
  id: string;
  account_id: string;
  worker_id: string;
  worker_name?: string;
  amount: number;
  date: string;
  note?: string | null;
  created_at: string;
  updated_at: string;
  sync_status: 'SYNCED' | 'PENDING' | 'FAILED';
}

function generateId(): string {
  return 'adv_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

export const AdvanceRepository = {
  getAll(accountId: string): LocalAdvance[] {
    const db = getDatabase();
    const result = db.executeSync(
      `SELECT a.*, w.name as worker_name 
       FROM advances a 
       LEFT JOIN workers w ON a.worker_id = w.id 
       WHERE a.account_id = ? 
       ORDER BY a.date DESC, a.created_at DESC`,
      [accountId]
    );
    return normalizeRows(result) as LocalAdvance[];
  },

  getById(id: string, accountId: string): LocalAdvance | null {
    const db = getDatabase();
    const result = db.executeSync(
      `SELECT a.*, w.name as worker_name 
       FROM advances a 
       LEFT JOIN workers w ON a.worker_id = w.id 
       WHERE a.id = ? AND a.account_id = ?`,
      [id, accountId]
    );
    const rows = normalizeRows(result) as LocalAdvance[];
    return rows.length > 0 ? rows[0] : null;
  },

  getByWorkerId(workerId: string, accountId: string): LocalAdvance[] {
    const db = getDatabase();
    const result = db.executeSync(
      `SELECT a.*, w.name as worker_name 
       FROM advances a 
       LEFT JOIN workers w ON a.worker_id = w.id 
       WHERE a.worker_id = ? AND a.account_id = ? 
       ORDER BY a.date DESC, a.created_at DESC`,
      [workerId, accountId]
    );
    return normalizeRows(result) as LocalAdvance[];
  },

  getByDateRange(startDate: string, endDate: string, accountId: string, workerId?: string): LocalAdvance[] {
    const db = getDatabase();
    if (workerId) {
      const result = db.executeSync(
        `SELECT a.*, w.name as worker_name 
         FROM advances a 
         LEFT JOIN workers w ON a.worker_id = w.id 
         WHERE a.date >= ? AND a.date <= ? AND a.account_id = ? AND a.worker_id = ? 
         ORDER BY a.date DESC, a.created_at DESC`,
        [startDate, endDate, accountId, workerId]
      );
      return normalizeRows(result) as LocalAdvance[];
    }
    const result = db.executeSync(
      `SELECT a.*, w.name as worker_name 
       FROM advances a 
       LEFT JOIN workers w ON a.worker_id = w.id 
       WHERE a.date >= ? AND a.date <= ? AND a.account_id = ? 
       ORDER BY a.date DESC, a.created_at DESC`,
      [startDate, endDate, accountId]
    );
    return normalizeRows(result) as LocalAdvance[];
  },

  recordAdvance(data: {
    id?: string;
    account_id: string;
    worker_id: string;
    amount: number;
    date: string;
    note?: string;
  }): LocalAdvance {
    const db = getDatabase();
    const now = new Date().toISOString();
    const id = data.id || generateId();

    db.executeSync(
      `INSERT OR REPLACE INTO advances
       (id, account_id, worker_id, amount, date, note, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        id,
        data.account_id,
        data.worker_id,
        data.amount,
        data.date,
        data.note || null,
        now,
        now,
      ]
    );

    // Queue for sync
    db.executeSync(
      `INSERT OR REPLACE INTO sync_queue (id, account_id, entity_type, entity_id, action, payload, created_at, status)
       VALUES (?, ?, 'advance', ?, 'UPSERT', ?, ?, 'PENDING')`,
      [
        'q_' + id,
        data.account_id,
        id,
        JSON.stringify({
          id,
          worker_id: data.worker_id,
          amount: data.amount,
          date: data.date,
          note: data.note,
        }),
        now,
      ]
    );

    // Fetch created advance with joined worker name
    const created = this.getById(id, data.account_id);
    if (created) return created;

    return {
      id,
      account_id: data.account_id,
      worker_id: data.worker_id,
      amount: data.amount,
      date: data.date,
      note: data.note || null,
      created_at: now,
      updated_at: now,
      sync_status: 'PENDING',
    };
  },

  delete(id: string, accountId: string): void {
    const db = getDatabase();
    const now = new Date().toISOString();

    // Remove local advance
    db.executeSync('DELETE FROM advances WHERE id = ? AND account_id = ?', [id, accountId]);

    // Remove any pending UPSERT queue items for this advance
    db.executeSync(
      "DELETE FROM sync_queue WHERE entity_type = 'advance' AND entity_id = ? AND account_id = ?",
      [id, accountId]
    );

    // Enqueue DELETE operation for server synchronization
    db.executeSync(
      `INSERT OR REPLACE INTO sync_queue (id, account_id, entity_type, entity_id, action, payload, created_at, status)
       VALUES (?, ?, 'advance', ?, 'DELETE', ?, ?, 'PENDING')`,
      [
        'q_del_' + id,
        accountId,
        id,
        JSON.stringify({ id }),
        now,
      ]
    );
  },

  saveBatchFromSync(advances: any[], activeAccountId?: string): void {
    const db = getDatabase();
    for (const adv of advances) {
      // Check if local record exists with PENDING sync status
      const existing = db.executeSync(
        "SELECT id, sync_status FROM advances WHERE id = ? AND sync_status = 'PENDING'",
        [adv.id]
      );
      if (existing.rows && existing.rows.length > 0) {
        continue;
      }

      db.executeSync(
        `INSERT OR REPLACE INTO advances 
         (id, account_id, worker_id, amount, date, note, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED')`,
        [
          adv.id,
          adv.account_id || activeAccountId || '',
          adv.worker_id,
          typeof adv.amount === 'number' ? adv.amount : parseFloat(adv.amount || '0'),
          adv.date,
          adv.note || null,
          adv.created_at,
          adv.updated_at,
        ]
      );
    }
  },
};
