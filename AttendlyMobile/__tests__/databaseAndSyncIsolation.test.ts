import { verifyAccountContext, getLocalAccountId, setLocalAccountId, _resetDatabaseForTesting } from '../src/db/database';
import { AttendanceRepository } from '../src/repositories/attendanceRepository';
import { SyncManager } from '../src/sync/syncManager';
import { ApiClient } from '../src/api/client';
import { AuthStorage } from '../src/storage/authStorage';
import { open } from '@op-engineering/op-sqlite';

// Real in-memory table store for thorough SQLite logic verification
function createMockDb() {
  const tables: Record<string, any[]> = {
    app_metadata: [],
    workers: [],
    sites: [],
    attendance: [],
    advances: [],
    sync_queue: [],
  };

  return {
    tables,
    executeSync: jest.fn((query: string, params: any[] = []) => {
      const q = query.trim();

      // Pragmas
      if (q.startsWith('PRAGMA user_version')) {
        if (q.includes('=')) {
          return { rows: [] };
        }
        return { rows: [{ user_version: 1 }] };
      }
      if (q.startsWith('PRAGMA')) {
        return { rows: [] };
      }

      // CREATE TABLE or INDEX
      if (q.startsWith('CREATE TABLE') || q.startsWith('CREATE INDEX')) {
        return { rows: [] };
      }

      // SELECT
      if (q.startsWith('SELECT')) {
        if (q.includes('FROM app_metadata WHERE key =')) {
          const key = params[0] || (q.includes("'bound_account_id'") ? 'bound_account_id' : '');
          const row = tables.app_metadata.find((r) => r.key === key);
          return { rows: row ? [row] : [] };
        }

        if (q.includes('FROM sync_queue')) {
          let rows = [...tables.sync_queue];
          if (q.includes("status = 'PENDING'")) {
            rows = rows.filter((r) => r.status === 'PENDING');
          }
          if (q.includes('account_id = ?')) {
            rows = rows.filter((r) => r.account_id === params[0]);
          }
          if (q.includes('COUNT(*)')) {
            return { rows: [{ count: rows.length }] };
          }
          if (q.includes('DISTINCT account_id')) {
            const distinct = Array.from(new Set(rows.map((r) => r.account_id))).map((id) => ({ account_id: id }));
            return { rows: distinct };
          }
          return { rows };
        }

        if (q.includes('FROM attendance')) {
          let rows = [...tables.attendance];
          if (q.includes("sync_status = 'PENDING'")) {
            // Check (id = ? OR (worker_id = ? AND date = ?))
            if (params.length === 3) {
              const [id, workerId, dt] = params;
              rows = rows.filter((r) => (r.id === id || (r.worker_id === workerId && r.date === dt)) && r.sync_status === 'PENDING');
            } else {
              rows = rows.filter((r) => r.sync_status === 'PENDING');
            }
          } else if (q.includes('date = ? AND account_id = ?')) {
            rows = rows.filter((r) => r.date === params[0] && r.account_id === params[1]);
          }
          return { rows };
        }

        if (q.includes('FROM workers')) {
          let rows = [...tables.workers];
          if (q.includes("sync_status = 'PENDING'")) {
            rows = rows.filter((r) => r.id === params[0] && r.sync_status === 'PENDING');
          } else if (q.includes('account_id = ?')) {
            rows = rows.filter((r) => r.account_id === params[0]);
          }
          return { rows };
        }

        if (q.includes('FROM sites')) {
          let rows = [...tables.sites];
          if (q.includes("sync_status = 'PENDING'")) {
            rows = rows.filter((r) => r.id === params[0] && r.sync_status === 'PENDING');
          }
          return { rows };
        }

        return { rows: [] };
      }

      // INSERT OR REPLACE
      if (q.startsWith('INSERT OR REPLACE INTO')) {
        if (q.includes('INTO app_metadata')) {
          let key = 'bound_account_id';
          let value = params[0];
          let updatedAt = params[1];
          if (params.length === 3) {
            [key, value, updatedAt] = params;
          }
          const idx = tables.app_metadata.findIndex((r) => r.key === key);
          const entry = { key, value, updated_at: updatedAt };
          if (idx >= 0) tables.app_metadata[idx] = entry;
          else tables.app_metadata.push(entry);
          return { rows: [] };
        }

        if (q.includes('INTO sync_queue')) {
          let id, accountId, entityType, entityId, action, payload, createdAt, status;
          if (params.length === 5) {
            id = params[0];
            accountId = params[1];
            entityId = params[2];
            entityType = q.includes("'attendance'") ? 'attendance' : (q.includes("'worker'") ? 'worker' : 'site');
            action = 'UPSERT';
            payload = params[3];
            createdAt = params[4];
            status = 'PENDING';
          } else {
            [id, accountId, entityType, entityId, action, payload, createdAt, status] = params;
          }
          const idx = tables.sync_queue.findIndex((r) => r.id === id);
          const entry = { id, account_id: accountId, entity_type: entityType, entity_id: entityId, action, payload, created_at: createdAt, status };
          if (idx >= 0) tables.sync_queue[idx] = entry;
          else tables.sync_queue.push(entry);
          return { rows: [] };
        }

        if (q.includes('INTO attendance')) {
          const syncStatus = q.includes("'PENDING'") ? 'PENDING' : 'SYNCED';
          const [id, accountId, workerId, siteId, dt, workUnits, createdAt, updatedAt] = params;
          const idx = tables.attendance.findIndex((r) => r.id === id || (r.account_id === accountId && r.worker_id === workerId && r.date === dt));
          const entry = {
            id,
            account_id: accountId,
            worker_id: workerId,
            site_id: siteId,
            date: dt,
            work_units: workUnits,
            created_at: createdAt,
            updated_at: updatedAt,
            sync_status: syncStatus,
          };
          if (idx >= 0) tables.attendance[idx] = entry;
          else tables.attendance.push(entry);
          return { rows: [] };
        }

        if (q.includes('INTO workers')) {
          const [id, accountId, name, dailyWage, phone, isActive, createdAt, updatedAt, syncStatus] = params;
          const idx = tables.workers.findIndex((r) => r.id === id);
          const entry = { id, account_id: accountId, name, daily_wage: dailyWage, phone, is_active: isActive, created_at: createdAt, updated_at: updatedAt, sync_status: syncStatus };
          if (idx >= 0) tables.workers[idx] = entry;
          else tables.workers.push(entry);
          return { rows: [] };
        }

        if (q.includes('INTO sites')) {
          const [id, accountId, name, location, isActive, createdAt, updatedAt, syncStatus] = params;
          const idx = tables.sites.findIndex((r) => r.id === id);
          const entry = { id, account_id: accountId, name, location, is_active: isActive, created_at: createdAt, updated_at: updatedAt, sync_status: syncStatus };
          if (idx >= 0) tables.sites[idx] = entry;
          else tables.sites.push(entry);
          return { rows: [] };
        }
      }

      // UPDATE
      if (q.startsWith('UPDATE')) {
        if (q.includes("UPDATE attendance SET sync_status = 'SYNCED'")) {
          const id = params[0];
          const rec = tables.attendance.find((r) => r.id === id);
          if (rec) rec.sync_status = 'SYNCED';
          return { rows: [] };
        }
        if (q.includes("UPDATE workers SET sync_status = 'SYNCED'")) {
          const id = params[0];
          const rec = tables.workers.find((r) => r.id === id);
          if (rec) rec.sync_status = 'SYNCED';
          return { rows: [] };
        }
      }

      // DELETE
      if (q.startsWith('DELETE FROM sync_queue WHERE id = ?')) {
        const id = params[0];
        tables.sync_queue = tables.sync_queue.filter((r) => r.id !== id);
        return { rows: [] };
      }

      return { rows: [] };
    }),
    close: jest.fn(),
  };
}

describe('Phase 3 & 4: Local Database Isolation & Sync Safety', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    jest.clearAllMocks();
    _resetDatabaseForTesting();
    mockDb = createMockDb();
    (open as jest.Mock).mockReturnValue(mockDb);
    await AuthStorage.resetDevice();
  });

  describe('Database Account Binding & Cross-Account Isolation', () => {
    it('binds database to contractor account on first access', () => {
      const result = verifyAccountContext('contractor_acc_001');
      expect(result.safe).toBe(true);
      expect(result.boundAccountId).toBe('contractor_acc_001');

      const bound = getLocalAccountId();
      expect(bound).toBe('contractor_acc_001');
    });

    it('allows operations when target account matches the bound account', () => {
      setLocalAccountId('contractor_acc_001');

      const result = verifyAccountContext('contractor_acc_001');
      expect(result.safe).toBe(true);
      expect(result.boundAccountId).toBe('contractor_acc_001');
    });

    it('blocks data operations and sync when an account mismatch is detected', () => {
      setLocalAccountId('contractor_acc_001');

      // Attempt operation with different account
      const result = verifyAccountContext('contractor_acc_999');
      expect(result.safe).toBe(false);
      expect(result.boundAccountId).toBe('contractor_acc_001');
      expect(result.reason).toContain('Account mismatch');
      expect(result.reason).toContain('Data operations blocked');
    });

    it('rejects verification if target account ID is empty or missing', () => {
      const result = verifyAccountContext('');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('missing or empty');
    });
  });

  describe('Local Attendance Offline Queuing & Persistence', () => {
    it('saves attendance locally with PENDING sync status and queues sync operation', () => {
      const record = AttendanceRepository.recordAttendance({
        account_id: 'acc_001',
        worker_id: 'w_001',
        site_id: 's_001',
        date: '2026-10-25',
        work_units: 1.0,
      });

      expect(record.sync_status).toBe('PENDING');
      expect(record.work_units).toBe(1.0);

      // Verify stored in local attendance table
      const stored = mockDb.tables.attendance.find((r) => r.id === record.id);
      expect(stored).toBeTruthy();
      expect(stored.sync_status).toBe('PENDING');

      // Verify queued in sync_queue
      const queued = mockDb.tables.sync_queue.find((q) => q.entity_id === record.id);
      expect(queued).toBeTruthy();
      expect(queued.status).toBe('PENDING');
      expect(queued.entity_type).toBe('attendance');
    });

    it('does NOT overwrite local PENDING attendance records during server sync pull', () => {
      // 1. Worker has edited attendance offline (work_units = 1.5, PENDING)
      mockDb.tables.attendance.push({
        id: 'att_local_123',
        account_id: 'acc_001',
        worker_id: 'w_001',
        site_id: 's_001',
        date: '2026-10-25',
        work_units: 1.5,
        created_at: '2026-10-25T08:00:00Z',
        updated_at: '2026-10-25T09:00:00Z',
        sync_status: 'PENDING',
      });

      // 2. Server pull returns older or different attendance (work_units = 1.0, SYNCED)
      AttendanceRepository.saveBatchFromSync([
        {
          id: 'att_local_123',
          worker_id: 'w_001',
          site_id: 's_001',
          date: '2026-10-25',
          work_units: 1.0,
          created_at: '2026-10-25T08:00:00Z',
          updated_at: '2026-10-25T08:00:00Z',
        },
      ], 'acc_001');

      // 3. Verify local attendance remained at 1.5 and sync_status remained PENDING
      const record = mockDb.tables.attendance.find((r) => r.id === 'att_local_123');
      expect(record.work_units).toBe(1.5);
      expect(record.sync_status).toBe('PENDING');
    });

    it('safely inserts or updates SYNCED attendance when no local PENDING conflict exists', () => {
      AttendanceRepository.saveBatchFromSync([
        {
          id: 'att_server_456',
          worker_id: 'w_002',
          site_id: 's_002',
          date: '2026-10-24',
          work_units: 0.5,
          created_at: '2026-10-24T08:00:00Z',
          updated_at: '2026-10-24T08:00:00Z',
        },
      ], 'acc_001');

      const record = mockDb.tables.attendance.find((r) => r.id === 'att_server_456');
      expect(record).toBeTruthy();
      expect(record.work_units).toBe(0.5);
      expect(record.sync_status).toBe('SYNCED');
    });
  });

  describe('Sync Push Confirmation & Failure Handling', () => {
    it('preserves items in sync_queue and does NOT mark SYNCED if backend push returns failure', async () => {
      await AuthStorage.saveSession('jwt_token_123', 'acc_001', '+919876543210');
      setLocalAccountId('acc_001');

      // Enqueue an offline attendance change
      mockDb.tables.attendance.push({
        id: 'att_fail_01',
        account_id: 'acc_001',
        worker_id: 'w_001',
        site_id: 's_001',
        date: '2026-10-25',
        work_units: 1.0,
        sync_status: 'PENDING',
      });
      mockDb.tables.sync_queue.push({
        id: 'q_att_fail_01',
        account_id: 'acc_001',
        entity_type: 'attendance',
        entity_id: 'att_fail_01',
        action: 'UPSERT',
        payload: JSON.stringify({ id: 'att_fail_01', worker_id: 'w_001', site_id: 's_001', date: '2026-10-25', work_units: 1.0 }),
        status: 'PENDING',
      });

      // Backend push reports failure
      const pushSpy = jest.spyOn(ApiClient, 'syncPush').mockResolvedValueOnce({
        success: false,
        synced_workers: 0,
        synced_sites: 0,
        synced_attendance: 0,
        synced_advances: 0,
        errors: ['Database constraint error'],
      });

      const success = await SyncManager.triggerSync();
      expect(success).toBe(false);

      // Verify item is STILL in sync_queue with status PENDING
      expect(mockDb.tables.sync_queue.length).toBe(1);
      expect(mockDb.tables.sync_queue[0].id).toBe('q_att_fail_01');

      // Verify attendance record is NOT falsely marked SYNCED
      const att = mockDb.tables.attendance.find((r) => r.id === 'att_fail_01');
      expect(att.sync_status).toBe('PENDING');

      pushSpy.mockRestore();
    });

    it('preserves items in sync_queue if network drops during sync push', async () => {
      await AuthStorage.saveSession('jwt_token_123', 'acc_001', '+919876543210');
      setLocalAccountId('acc_001');

      mockDb.tables.sync_queue.push({
        id: 'q_net_fail',
        account_id: 'acc_001',
        entity_type: 'worker',
        entity_id: 'w_net_01',
        action: 'UPSERT',
        payload: JSON.stringify({ id: 'w_net_01', name: 'Offline Worker' }),
        status: 'PENDING',
      });

      // Network error throws
      const pushSpy = jest.spyOn(ApiClient, 'syncPush').mockRejectedValueOnce(new Error('Network request failed'));

      const success = await SyncManager.triggerSync();
      expect(success).toBe(false);

      // Verify queue intact
      expect(mockDb.tables.sync_queue.length).toBe(1);

      pushSpy.mockRestore();
    });

    it('removes from sync_queue and marks SYNCED only after backend explicitly confirms success', async () => {
      await AuthStorage.saveSession('jwt_token_123', 'acc_001', '+919876543210');
      setLocalAccountId('acc_001');

      mockDb.tables.attendance.push({
        id: 'att_success_01',
        account_id: 'acc_001',
        worker_id: 'w_001',
        site_id: 's_001',
        date: '2026-10-25',
        work_units: 1.0,
        sync_status: 'PENDING',
      });
      mockDb.tables.sync_queue.push({
        id: 'q_att_success_01',
        account_id: 'acc_001',
        entity_type: 'attendance',
        entity_id: 'att_success_01',
        action: 'UPSERT',
        payload: JSON.stringify({ id: 'att_success_01', worker_id: 'w_001', site_id: 's_001', date: '2026-10-25', work_units: 1.0 }),
        status: 'PENDING',
      });

      const pushSpy = jest.spyOn(ApiClient, 'syncPush').mockResolvedValueOnce({
        success: true,
        synced_workers: 0,
        synced_sites: 0,
        synced_attendance: 1,
        synced_advances: 0,
        errors: [],
      });
      const pullSpy = jest.spyOn(ApiClient, 'syncPull').mockResolvedValueOnce({
        server_time: '2026-10-25T10:00:00Z',
        workers: [],
        sites: [],
        attendance: [],
        advances: [],
      });

      const success = await SyncManager.triggerSync();
      expect(success).toBe(true);

      // Successfully removed from queue
      expect(mockDb.tables.sync_queue.length).toBe(0);

      // Locally marked SYNCED
      const att = mockDb.tables.attendance.find((r) => r.id === 'att_success_01');
      expect(att.sync_status).toBe('SYNCED');

      pushSpy.mockRestore();
      pullSpy.mockRestore();
    });

    it('aborts sync immediately if local database is bound to a different account', async () => {
      // Local DB bound to contractor 1
      setLocalAccountId('contractor_acc_001');

      // Session belongs to contractor 2
      await AuthStorage.saveSession('jwt_token_456', 'contractor_acc_002', '+919999999999');

      const pushSpy = jest.spyOn(ApiClient, 'syncPush');

      const success = await SyncManager.triggerSync();
      expect(success).toBe(false);
      // Sync push was NOT called!
      expect(pushSpy).not.toHaveBeenCalled();

      pushSpy.mockRestore();
    });
  });
});
