import { getDatabase, normalizeRows } from '../db/database';

export interface LocalSite {
  id: string;
  account_id: string;
  name: string;
  location?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  sync_status: 'SYNCED' | 'PENDING' | 'FAILED';
}

function generateId(): string {
  return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

export const SiteRepository = {
  getAll(accountId: string, onlyActive: boolean = true): LocalSite[] {
    const db = getDatabase();
    const query = onlyActive
      ? 'SELECT * FROM sites WHERE account_id = ? AND is_active = 1 ORDER BY name ASC'
      : 'SELECT * FROM sites WHERE account_id = ? ORDER BY name ASC';
    const result = db.executeSync(query, [accountId]);
    const rows = normalizeRows(result);
    return rows.map(row => ({
      ...row,
      is_active: Boolean(row.is_active),
    }));
  },

  getById(id: string, accountId: string): LocalSite | null {
    const db = getDatabase();
    const result = db.executeSync('SELECT * FROM sites WHERE id = ? AND account_id = ?', [id, accountId]);
    const rows = normalizeRows(result);
    if (rows.length === 0) return null;
    const row = rows[0] as any;
    return {
      ...row,
      is_active: Boolean(row.is_active),
    };
  },

  save(site: Partial<LocalSite> & { name: string; account_id: string }): LocalSite {
    const db = getDatabase();
    const now = new Date().toISOString();
    const id = site.id || generateId();
    const isActive = site.is_active !== undefined ? (site.is_active ? 1 : 0) : 1;

    db.executeSync(
      `INSERT OR REPLACE INTO sites 
       (id, account_id, name, location, is_active, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        id,
        site.account_id,
        site.name,
        site.location || null,
        isActive,
        site.created_at || now,
        now,
      ]
    );

    // Add to sync queue
    db.executeSync(
      `INSERT OR REPLACE INTO sync_queue (id, account_id, entity_type, entity_id, action, payload, created_at, status)
       VALUES (?, ?, 'site', ?, 'UPSERT', ?, ?, 'PENDING')`,
      [
        'q_' + id,
        site.account_id,
        id,
        JSON.stringify({
          id,
          name: site.name,
          location: site.location || null,
          active: Boolean(isActive),
        }),
        now,
      ]
    );

    return {
      id,
      account_id: site.account_id,
      name: site.name,
      location: site.location || null,
      is_active: Boolean(isActive),
      created_at: site.created_at || now,
      updated_at: now,
      sync_status: 'PENDING',
    };
  },

  getAttendanceCount(id: string, accountId: string): number {
    const db = getDatabase();
    const result = db.executeSync(
      'SELECT COUNT(*) as count FROM attendance WHERE site_id = ? AND account_id = ?',
      [id, accountId]
    );
    const rows = normalizeRows(result);
    return rows[0]?.count ?? 0;
  },

  toggleStatus(id: string, accountId: string): LocalSite | null {
    const site = this.getById(id, accountId);
    if (!site) return null;
    return this.save({
      ...site,
      is_active: !site.is_active,
    });
  },

  delete(id: string, accountId: string): void {
    const count = this.getAttendanceCount(id, accountId);
    const site = this.getById(id, accountId);
    const siteName = site?.name || 'Site';
    if (count > 0) {
      throw new Error(
        `Cannot delete '${siteName}' because it has ${count} historical attendance records. Please deactivate the site instead.`
      );
    }
    const db = getDatabase();
    const now = new Date().toISOString();
    db.executeSync('DELETE FROM sites WHERE id = ? AND account_id = ?', [id, accountId]);
    db.executeSync('DELETE FROM sync_queue WHERE entity_id = ? AND account_id = ?', [id, accountId]);
    db.executeSync(
      `INSERT OR REPLACE INTO sync_queue (id, account_id, entity_type, entity_id, action, payload, created_at, status)
       VALUES (?, ?, 'site', ?, 'DELETE', ?, ?, 'PENDING')`,
      [
        'q_del_' + id,
        accountId,
        id,
        JSON.stringify({ id }),
        now,
      ]
    );
  },

  saveBatchFromSync(sites: any[], activeAccountId?: string): void {
    const db = getDatabase();
    for (const s of sites) {
      // Check if local record exists with PENDING sync status
      const existing = db.executeSync(
        "SELECT id, sync_status FROM sites WHERE id = ? AND sync_status = 'PENDING'",
        [s.id]
      );
      if (existing.rows && existing.rows.length > 0) {
        continue; // Keep local unsynced record intact
      }

      const isActive = s.active !== undefined ? (s.active ? 1 : 0) : (s.is_active ? 1 : 0);
      const loc = s.location || s.address || null;

      db.executeSync(
        `INSERT OR REPLACE INTO sites 
         (id, account_id, name, location, is_active, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'SYNCED')`,
        [
          s.id,
          s.account_id || activeAccountId || '',
          s.name,
          loc,
          isActive,
          s.created_at,
          s.updated_at,
        ]
      );
    }
  },
};
