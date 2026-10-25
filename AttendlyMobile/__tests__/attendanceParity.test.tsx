import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { WorkUnitSelector, WORK_UNIT_VALUES } from '../src/components/WorkUnitSelector';
import { AttendanceScreen } from '../src/screens/AttendanceScreen';
import { AttendanceRepository } from '../src/repositories/attendanceRepository';
import { open } from '@op-engineering/op-sqlite';
import { shiftDays, formatDateIndian } from '../src/utils/dateUtils';
import { _resetDatabaseForTesting } from '../src/db/database';

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

      if (q.startsWith('PRAGMA user_version')) {
        if (q.includes('=')) return { rows: [] };
        return { rows: [{ user_version: 1 }] };
      }
      if (q.startsWith('PRAGMA') || q.startsWith('CREATE TABLE') || q.startsWith('CREATE INDEX') || q.startsWith('ALTER TABLE')) {
        return { rows: [] };
      }

      // SELECT
      if (q.startsWith('SELECT')) {
        if (q.includes('FROM app_metadata')) {
          const row = tables.app_metadata.find(r => r.key === 'bound_account_id');
          return { rows: row ? [row] : [] };
        }

        if (q.includes('FROM sync_queue')) {
          let rows = [...tables.sync_queue];
          if (q.includes("status = 'PENDING'")) {
            rows = rows.filter(r => r.status === 'PENDING');
          }
          if (q.includes('account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
          }
          if (q.includes('COUNT(*)')) {
            return { rows: [{ count: rows.length }] };
          }
          return { rows };
        }

        if (q.includes('FROM attendance')) {
          let rows = [...tables.attendance];
          if (q.includes("sync_status = 'PENDING'")) {
            if (params.length === 3) {
              const [id, workerId, dt] = params;
              rows = rows.filter(
                r => (r.id === id || (r.worker_id === workerId && r.date === dt)) && r.sync_status === 'PENDING'
              );
            } else {
              rows = rows.filter(r => r.sync_status === 'PENDING');
            }
          } else if (q.includes('account_id = ? AND worker_id = ? AND date = ?')) {
            rows = rows.filter(
              r => r.account_id === params[0] && r.worker_id === params[1] && r.date === params[2]
            );
          } else if (q.includes('date = ? AND account_id = ?')) {
            rows = rows.filter(r => r.date === params[0] && r.account_id === params[1]);
          }
          return { rows };
        }

        if (q.includes('FROM workers')) {
          let rows = [...tables.workers];
          if (q.includes('account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
          }
          return { rows };
        }

        if (q.includes('FROM sites')) {
          let rows = [...tables.sites];
          if (q.includes('account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
          }
          return { rows };
        }

        return { rows: [] };
      }

      // INSERT OR REPLACE
      if (q.startsWith('INSERT OR REPLACE INTO')) {
        if (q.includes('INTO attendance')) {
          const [id, account_id, worker_id, site_id, date, work_units, notes, created_at, updated_at] = params;
          const sync_status = q.includes("'PENDING'") ? 'PENDING' : 'SYNCED';
          const idx = tables.attendance.findIndex(
            r => r.id === id || (r.account_id === account_id && r.worker_id === worker_id && r.date === date)
          );
          const entry = {
            id,
            account_id,
            worker_id,
            site_id,
            date,
            work_units,
            notes,
            created_at,
            updated_at,
            sync_status,
          };
          if (idx >= 0) tables.attendance[idx] = entry;
          else tables.attendance.push(entry);
          return { rows: [] };
        }

        if (q.includes('INTO sync_queue')) {
          const [id, account_id, entity_id, payload, created_at] = params;
          const status = q.includes("'PENDING'") ? 'PENDING' : 'SYNCED';
          const idx = tables.sync_queue.findIndex(r => r.id === id);
          const entry = { id, account_id, entity_type: 'attendance', entity_id, action: 'UPSERT', payload, created_at, status };
          if (idx >= 0) tables.sync_queue[idx] = entry;
          else tables.sync_queue.push(entry);
          return { rows: [] };
        }

        if (q.includes('INTO workers')) {
          const [id, account_id, name, daily_wage, phone, is_active, created_at, updated_at, sync_status] = params;
          const idx = tables.workers.findIndex(r => r.id === id);
          const entry = { id, account_id, name, daily_wage, phone, is_active, created_at, updated_at, sync_status };
          if (idx >= 0) tables.workers[idx] = entry;
          else tables.workers.push(entry);
          return { rows: [] };
        }

        if (q.includes('INTO sites')) {
          const [id, account_id, name, location, is_active, created_at, updated_at, sync_status] = params;
          const idx = tables.sites.findIndex(r => r.id === id);
          const entry = { id, account_id, name, location, is_active, created_at, updated_at, sync_status };
          if (idx >= 0) tables.sites[idx] = entry;
          else tables.sites.push(entry);
          return { rows: [] };
        }

        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

describe('Attendance Feature Parity & Business Rules', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    _resetDatabaseForTesting();
    mockDb = createMockDb();
    (open as jest.Mock).mockReturnValue(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Work Unit Values and Controls', () => {
    it('defines exactly the 5 allowed work-unit values [0, 0.5, 1, 1.5, 2]', () => {
      const allowedValues = WORK_UNIT_VALUES.map(u => u.value);
      expect(allowedValues).toEqual([0.0, 0.5, 1.0, 1.5, 2.0]);
    });

    it('renders all 5 buttons and fires onSelect with correct unit value', () => {
      const onSelect = jest.fn();
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <WorkUnitSelector currentValue={1.0} onSelect={onSelect} />
        );
      });

      const btn0 = tree!.root.findByProps({ testID: 'unit_btn_0' });
      const btnHalf = tree!.root.findByProps({ testID: 'unit_btn_0.5' });
      const btnFull = tree!.root.findByProps({ testID: 'unit_btn_1' });
      const btn1Half = tree!.root.findByProps({ testID: 'unit_btn_1.5' });
      const btnDbl = tree!.root.findByProps({ testID: 'unit_btn_2' });

      expect(btn0).toBeTruthy();
      expect(btnHalf).toBeTruthy();
      expect(btnFull).toBeTruthy();
      expect(btn1Half).toBeTruthy();
      expect(btnDbl).toBeTruthy();

      // Tap 0.5
      ReactTestRenderer.act(() => {
        btnHalf.props.onPress();
      });
      expect(onSelect).toHaveBeenCalledWith(0.5);

      // Tap 0 (Absent)
      ReactTestRenderer.act(() => {
        btn0.props.onPress();
      });
      expect(onSelect).toHaveBeenCalledWith(0.0);
    });

    it('correctly reflects unmarked state when currentValue is null', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <WorkUnitSelector currentValue={null} onSelect={jest.fn()} />
        );
      });

      const buttons = [
        tree!.root.findByProps({ testID: 'unit_btn_0' }),
        tree!.root.findByProps({ testID: 'unit_btn_0.5' }),
        tree!.root.findByProps({ testID: 'unit_btn_1' }),
        tree!.root.findByProps({ testID: 'unit_btn_1.5' }),
        tree!.root.findByProps({ testID: 'unit_btn_2' }),
      ];
      for (const btn of buttons) {
        expect(btn.props.accessibilityState.selected).toBe(false);
      }
    });
  });

  describe('2. Date Navigation & Indian Date Formatting', () => {
    it('shifts days forward and backward correctly', () => {
      expect(shiftDays('2026-10-15', 1)).toBe('2026-10-16');
      expect(shiftDays('2026-10-15', -1)).toBe('2026-10-14');
      expect(shiftDays('2026-10-31', 1)).toBe('2026-11-01');
      expect(shiftDays('2026-11-01', -1)).toBe('2026-10-31');
    });

    it('formats date in Indian DD/MM/YYYY format matching PWA', () => {
      expect(formatDateIndian('2026-10-25')).toBe('25/10/2026');
      expect(formatDateIndian('2026-05-04')).toBe('04/05/2026');
    });
  });

  describe('3. Attendance Repository: Duplicate Prevention & Non-destructive Updates', () => {
    it('creates attendance and prevents duplicate records for same (worker, date)', () => {
      const accId = 'acc_test_1';
      const workerId = 'worker_1';
      const date = '2026-10-25';

      // Record first attendance (1.0 unit on site A)
      const rec1 = AttendanceRepository.recordAttendance({
        account_id: accId,
        worker_id: workerId,
        site_id: 'site_A',
        date,
        work_units: 1.0,
      });

      expect(rec1.work_units).toBe(1.0);
      expect(rec1.site_id).toBe('site_A');
      expect(rec1.sync_status).toBe('PENDING');

      // Update same worker and date to 1.5 units on site B
      const rec2 = AttendanceRepository.recordAttendance({
        account_id: accId,
        worker_id: workerId,
        site_id: 'site_B',
        date,
        work_units: 1.5,
      });

      // Same ID reused, updated non-destructively
      expect(rec2.id).toBe(rec1.id);
      expect(rec2.work_units).toBe(1.5);
      expect(rec2.site_id).toBe('site_B');

      // Exactly 1 record exists in table
      const stored = AttendanceRepository.getByDate(date, accId);
      expect(stored).toHaveLength(1);
      expect(stored[0].work_units).toBe(1.5);
    });

    it('allows absent records (work_units = 0) with nullable site_id', () => {
      const accId = 'acc_test_1';
      const workerId = 'worker_absent_1';
      const date = '2026-10-25';

      const rec = AttendanceRepository.recordAttendance({
        account_id: accId,
        worker_id: workerId,
        site_id: null,
        date,
        work_units: 0.0,
      });

      expect(rec.work_units).toBe(0.0);
      expect(rec.site_id).toBeNull();
    });

    it('records batch attendance atomically and queues for sync', () => {
      const accId = 'acc_test_1';
      const date = '2026-10-25';

      const batch = [
        { account_id: accId, worker_id: 'w1', site_id: 's1', date, work_units: 1.0 },
        { account_id: accId, worker_id: 'w2', site_id: 's2', date, work_units: 0.5 },
        { account_id: accId, worker_id: 'w3', site_id: null, date, work_units: 0.0 },
      ];

      const saved = AttendanceRepository.recordAttendanceBatch(batch);
      expect(saved).toHaveLength(3);

      const all = AttendanceRepository.getByDate(date, accId);
      expect(all).toHaveLength(3);

      // Verify sync queue has all 3 pending items
      const queuePending = mockDb.tables.sync_queue.filter(q => q.status === 'PENDING');
      expect(queuePending).toHaveLength(3);
    });
  });

  describe('4. Offline Sync Protection: Pending Local Edits Never Overwritten', () => {
    it('does not allow incoming sync pull data to overwrite local PENDING edits', () => {
      const accId = 'acc_test_1';
      const workerId = 'w_pending_1';
      const date = '2026-10-25';

      // 1. User records 1.5 units locally while offline
      AttendanceRepository.recordAttendance({
        account_id: accId,
        worker_id: workerId,
        site_id: 'site_local',
        date,
        work_units: 1.5,
      });

      // 2. Incoming server pull has stale 1.0 unit
      const serverPullData = [
        {
          id: 'server_att_1',
          account_id: accId,
          worker_id: workerId,
          site_id: 'site_server',
          date,
          work_units: 1.0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      AttendanceRepository.saveBatchFromSync(serverPullData, accId);

      // 3. Local 1.5 unit MUST remain intact!
      const records = AttendanceRepository.getByDate(date, accId);
      expect(records).toHaveLength(1);
      expect(records[0].work_units).toBe(1.5);
      expect(records[0].site_id).toBe('site_local');
      expect(records[0].sync_status).toBe('PENDING');
    });
  });

  describe('5. Attendance Screen Component Verification', () => {
    it('renders empty state when no workers exist', async () => {
      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <AttendanceScreen accountId="acc_empty" onNavigateHome={jest.fn()} />
        );
      });

      const root = renderer!.root;
      const textNodes = root.findAll(el => typeof el.props.children === 'string');
      const texts = textNodes.map(t => t.props.children);
      expect(texts).toContain('No Workers Found');
    });

    it('renders populated state with date capsule, metrics card, and save action', async () => {
      const accId = 'acc_populated';
      // Seed mock workers & sites
      mockDb.tables.workers = [
        { id: 'w1', account_id: accId, name: 'Ramesh Kumar', daily_wage: 600, is_active: 1, created_at: '', updated_at: '', sync_status: 'SYNCED' },
        { id: 'w2', account_id: accId, name: 'Suresh Patel', daily_wage: 750, is_active: 1, created_at: '', updated_at: '', sync_status: 'SYNCED' },
      ];
      mockDb.tables.sites = [
        { id: 's1', account_id: accId, name: 'Metro Tower Phase 2', is_active: 1, created_at: '', updated_at: '', sync_status: 'SYNCED' },
      ];

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <AttendanceScreen accountId={accId} onNavigateHome={jest.fn()} />
        );
      });

      const root = renderer!.root;
      const textNodes = root.findAll(el => typeof el.props.children === 'string');
      const texts = textNodes.map(t => t.props.children);

      // Verify worker names rendered
      expect(texts).toContain('Ramesh Kumar');
      expect(texts).toContain('Suresh Patel');

      // Verify PWA sections present
      expect(texts).toContain('All Sites');
      expect(texts).toContain('Save Attendance');
      expect(texts).toContain('ROSTER UNITS');
    });
  });
});
