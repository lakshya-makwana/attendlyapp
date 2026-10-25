import { getDatabase, normalizeRows } from '../db/database';

export interface LocalAttendance {
  id: string;
  account_id: string;
  worker_id: string;
  site_id: string | null;
  date: string;
  work_units: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  sync_status: 'SYNCED' | 'PENDING' | 'FAILED';
}

function generateId(): string {
  return 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

export const AttendanceRepository = {
  getByDate(date: string, accountId: string): LocalAttendance[] {
    const db = getDatabase();
    const result = db.executeSync(
      'SELECT * FROM attendance WHERE date = ? AND account_id = ?',
      [date, accountId]
    );
    return normalizeRows(result) as LocalAttendance[];
  },

  getByDateRange(startDate: string, endDate: string, accountId: string): LocalAttendance[] {
    const db = getDatabase();
    const result = db.executeSync(
      'SELECT * FROM attendance WHERE date >= ? AND date <= ? AND account_id = ? ORDER BY date DESC',
      [startDate, endDate, accountId]
    );
    return normalizeRows(result) as LocalAttendance[];
  },

  getByDateRangeWithSites(
    startDate: string,
    endDate: string,
    accountId: string
  ): Array<LocalAttendance & { site_name: string | null }> {
    const db = getDatabase();
    const result = db.executeSync(
      `SELECT a.*, s.name as site_name
       FROM attendance a
       LEFT JOIN sites s ON a.site_id = s.id
       WHERE a.date >= ? AND a.date <= ? AND a.account_id = ?
       ORDER BY a.date ASC`,
      [startDate, endDate, accountId]
    );
    return normalizeRows(result) as Array<LocalAttendance & { site_name: string | null }>;
  },

  recordAttendance(data: {
    id?: string;
    account_id: string;
    worker_id: string;
    site_id: string | null;
    date: string;
    work_units: number;
    notes?: string | null;
  }): LocalAttendance {
    const db = getDatabase();
    const now = new Date().toISOString();

    // Check if attendance already exists locally for (account_id, worker_id, date)
    const existing = db.executeSync(
      'SELECT id, created_at FROM attendance WHERE account_id = ? AND worker_id = ? AND date = ?',
      [data.account_id, data.worker_id, data.date]
    );

    const existingRow = existing.rows && existing.rows.length > 0 ? (existing.rows[0] as any) : null;
    const id = existingRow ? existingRow.id : (data.id || generateId());
    const createdAt = existingRow ? existingRow.created_at : now;

    // For absent workers (work_units === 0), site_id is optional / null
    const siteIdToSave = data.work_units > 0 ? data.site_id : (data.site_id || null);

    db.executeSync(
      `INSERT OR REPLACE INTO attendance
       (id, account_id, worker_id, site_id, date, work_units, notes, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        id,
        data.account_id,
        data.worker_id,
        siteIdToSave,
        data.date,
        data.work_units,
        data.notes || null,
        createdAt,
        now,
      ]
    );

    // Queue for sync
    db.executeSync(
      `INSERT OR REPLACE INTO sync_queue (id, account_id, entity_type, entity_id, action, payload, created_at, status)
       VALUES (?, ?, 'attendance', ?, 'UPSERT', ?, ?, 'PENDING')`,
      [
        'q_' + id,
        data.account_id,
        id,
        JSON.stringify({
          id,
          worker_id: data.worker_id,
          site_id: siteIdToSave,
          date: data.date,
          work_units: data.work_units,
          notes: data.notes || null,
        }),
        now,
      ]
    );

    return {
      id,
      account_id: data.account_id,
      worker_id: data.worker_id,
      site_id: siteIdToSave,
      date: data.date,
      work_units: data.work_units,
      notes: data.notes || null,
      created_at: createdAt,
      updated_at: now,
      sync_status: 'PENDING',
    };
  },

  recordAttendanceBatch(
    items: Array<{
      account_id: string;
      worker_id: string;
      site_id: string | null;
      date: string;
      work_units: number;
      notes?: string | null;
    }>
  ): LocalAttendance[] {
    const results: LocalAttendance[] = [];
    for (const item of items) {
      results.push(this.recordAttendance(item));
    }
    return results;
  },

  saveBatchFromSync(attendanceList: any[], activeAccountId?: string): void {
    const db = getDatabase();
    for (const a of attendanceList) {
      // Check if local record exists with PENDING sync status
      // We must not overwrite unsynced local edits with server pull!
      const existing = db.executeSync(
        "SELECT id, sync_status FROM attendance WHERE (id = ? OR (worker_id = ? AND date = ?)) AND sync_status = 'PENDING'",
        [a.id, a.worker_id, a.date]
      );
      if (existing.rows && existing.rows.length > 0) {
        continue; // Keep local unsynced record intact!
      }

      db.executeSync(
        `INSERT OR REPLACE INTO attendance 
         (id, account_id, worker_id, site_id, date, work_units, notes, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED')`,
        [
          a.id,
          a.account_id || activeAccountId || '',
          a.worker_id,
          a.site_id || null,
          a.date,
          typeof a.work_units === 'number' ? a.work_units : parseFloat(a.work_units || '1.0'),
          a.notes || null,
          a.created_at,
          a.updated_at,
        ]
      );
    }
  },
};

