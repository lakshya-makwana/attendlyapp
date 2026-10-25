import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { WorkerDetailScreen } from '../src/screens/WorkerDetailScreen';
import { WorkerRepository } from '../src/repositories/workerRepository';
import { WageHistoryRepository } from '../src/repositories/wageHistoryRepository';
import { AttendanceRepository } from '../src/repositories/attendanceRepository';
import { AdvanceRepository } from '../src/repositories/advanceRepository';
import { ApiClient } from '../src/api/client';
import { open } from '@op-engineering/op-sqlite';
import { _resetDatabaseForTesting } from '../src/db/database';
import { Linking, Alert } from 'react-native';

jest.mock('../src/api/client', () => ({
  ApiClient: {
    getWorkerDetail: jest.fn(),
    getWorkerMonthly: jest.fn(),
    toggleWorkerStatus: jest.fn(),
    syncPush: jest.fn(),
    syncPull: jest.fn(),
  },
}));

function createMockDb() {
  const tables: Record<string, any[]> = {
    app_metadata: [],
    workers: [],
    worker_wage_history: [],
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
      if (
        q.startsWith('PRAGMA') ||
        q.startsWith('CREATE TABLE') ||
        q.startsWith('CREATE INDEX') ||
        q.startsWith('ALTER TABLE')
      ) {
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
          if (q.includes('COUNT(*)')) {
            return { rows: [{ count: rows.length }] };
          }
          return { rows };
        }

        if (q.includes('FROM workers')) {
          let rows = [...tables.workers];
          if (q.includes('id = ? AND account_id = ?')) {
            rows = rows.filter(r => r.id === params[0] && r.account_id === params[1]);
          } else if (q.includes('WHERE account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
          }
          return { rows };
        }

        if (q.includes('FROM worker_wage_history')) {
          let rows = [...tables.worker_wage_history];
          if (q.includes('worker_id = ? AND account_id = ?')) {
            rows = rows.filter(r => r.worker_id === params[0] && r.account_id === params[1]);
          }
          return { rows };
        }

        if (q.includes('FROM sites')) {
          return { rows: tables.sites };
        }

        if (q.includes('FROM attendance')) {
          let rows = [...tables.attendance];
          if (q.includes('date >= ? AND date <= ? AND account_id = ? AND worker_id = ?')) {
            rows = rows.filter(
              r => r.date >= params[0] && r.date <= params[1] && r.account_id === params[2] && r.worker_id === params[3]
            );
          } else if (q.includes('worker_id = ? AND account_id = ?')) {
            rows = rows.filter(r => r.worker_id === params[0] && r.account_id === params[1]);
          }
          return { rows };
        }

        if (q.includes('FROM advances')) {
          let rows = [...tables.advances];
          if (q.includes('date >= ? AND date <= ? AND account_id = ? AND worker_id = ?')) {
            rows = rows.filter(
              r => r.date >= params[0] && r.date <= params[1] && r.account_id === params[2] && r.worker_id === params[3]
            );
          } else if (q.includes('worker_id = ? AND account_id = ?')) {
            rows = rows.filter(r => r.worker_id === params[0] && r.account_id === params[1]);
          }
          return { rows };
        }

        return { rows: [] };
      }

      // INSERT / REPLACE
      if (q.startsWith('INSERT') || q.startsWith('INSERT OR REPLACE')) {
        if (q.includes('INTO workers')) {
          const item = {
            id: params[0],
            account_id: params[1],
            name: params[2],
            phone: params[3],
            daily_wage: params[4],
            is_active: params[5],
            created_at: params[6],
            updated_at: params[7],
            sync_status: params[8] || 'SYNCED',
          };
          const idx = tables.workers.findIndex(w => w.id === item.id);
          if (idx >= 0) tables.workers[idx] = item;
          else tables.workers.push(item);
          return { rows: [] };
        }

        if (q.includes('INTO worker_wage_history')) {
          const item = {
            id: params[0],
            account_id: params[1],
            worker_id: params[2],
            daily_wage: params[3],
            effective_from: params[4],
            created_at: params[5],
            sync_status: params[6] || 'SYNCED',
          };
          const idx = tables.worker_wage_history.findIndex(h => h.id === item.id);
          if (idx >= 0) tables.worker_wage_history[idx] = item;
          else tables.worker_wage_history.push(item);
          return { rows: [] };
        }

        if (q.includes('INTO attendance')) {
          const item = {
            id: params[0],
            account_id: params[1],
            worker_id: params[2],
            site_id: params[3],
            date: params[4],
            work_units: params[5],
            created_at: params[6],
            updated_at: params[7],
            sync_status: params[8] || 'SYNCED',
          };
          const idx = tables.attendance.findIndex(a => a.id === item.id);
          if (idx >= 0) tables.attendance[idx] = item;
          else tables.attendance.push(item);
          return { rows: [] };
        }

        if (q.includes('INTO advances')) {
          const item = {
            id: params[0],
            account_id: params[1],
            worker_id: params[2],
            amount: params[3],
            date: params[4],
            note: params[5],
            created_at: params[6],
            updated_at: params[7],
            sync_status: params[8] || 'PENDING',
          };
          const idx = tables.advances.findIndex(a => a.id === item.id);
          if (idx >= 0) tables.advances[idx] = item;
          else tables.advances.push(item);
          return { rows: [] };
        }

        if (q.includes('INTO sync_queue')) {
          tables.sync_queue.push({
            id: params[0],
            account_id: params[1],
            entity_type: params[2],
            entity_id: params[3],
            action: params[4],
            payload: params[5],
            status: 'PENDING',
            retry_count: 0,
            created_at: params[6],
          });
          return { rows: [] };
        }
      }

      // DELETE
      if (q.startsWith('DELETE FROM advances')) {
        tables.advances = tables.advances.filter(a => a.id !== params[0]);
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

describe('WorkerDetailScreen Parity Suite', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  const accountId = 'acc_test_wdetail';
  const workerId = 'worker_wdetail_1';

  beforeEach(() => {
    jest.clearAllMocks();
    _resetDatabaseForTesting();
    mockDb = createMockDb();
    (open as jest.Mock).mockReturnValue(mockDb);

    // Seed mock data
    mockDb.tables.workers.push({
      id: workerId,
      account_id: accountId,
      name: 'Ramesh Patel',
      phone: '9876543210',
      daily_wage: 650,
      is_active: 1,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      sync_status: 'SYNCED',
    });

    mockDb.tables.worker_wage_history.push({
      id: 'wwh_1',
      account_id: accountId,
      worker_id: workerId,
      daily_wage: 650,
      effective_from: '2026-10-01',
      created_at: '2026-10-01T00:00:00Z',
      sync_status: 'SYNCED',
    });

    // Attendance entries
    mockDb.tables.attendance.push(
      {
        id: 'att_1',
        account_id: accountId,
        worker_id: workerId,
        site_id: 'site_1',
        date: '2026-10-15',
        work_units: 1.0,
        created_at: '2026-10-15T00:00:00Z',
        updated_at: '2026-10-15T00:00:00Z',
        sync_status: 'SYNCED',
      },
      {
        id: 'att_2',
        account_id: accountId,
        worker_id: workerId,
        site_id: 'site_1',
        date: '2026-10-16',
        work_units: 0.5,
        created_at: '2026-10-16T00:00:00Z',
        updated_at: '2026-10-16T00:00:00Z',
        sync_status: 'SYNCED',
      }
    );

    // Advance entry
    mockDb.tables.advances.push({
      id: 'adv_1',
      account_id: accountId,
      worker_id: workerId,
      amount: 200,
      date: '2026-10-18',
      note: 'Grocery support',
      created_at: '2026-10-18T00:00:00Z',
      updated_at: '2026-10-18T00:00:00Z',
      sync_status: 'SYNCED',
    });

    (ApiClient.getWorkerDetail as jest.Mock).mockResolvedValue({
      worker: {
        id: workerId,
        name: 'Ramesh Patel',
        phone: '9876543210',
        daily_wage: 650,
        is_active: true,
      },
      advances: [],
      recent_attendance: [],
    });

    (ApiClient.getWorkerMonthly as jest.Mock).mockResolvedValue({
      year: 2026,
      month: 10,
      total_work_units: 1.5,
      gross_earnings: 975.0,
      total_advances: 200.0,
      net_payable: 775.0,
      attendance: [],
      advances: [],
    });
  });

function getAllText(root: any): string {
  const textNodes = root.findAllByType('Text');
  return textNodes
    .map((t: any) => {
      const c = t.props.children;
      if (typeof c === 'string' || typeof c === 'number') return String(c);
      if (Array.isArray(c)) return c.filter((x: any) => typeof x === 'string' || typeof x === 'number').join('');
      return '';
    })
    .join(' ');
}

  it('renders worker identity, rate badge, and active status', async () => {
    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkerDetailScreen
          workerId={workerId}
          accountId={accountId}
          onBack={jest.fn()}
        />
      );
    });

    const root = renderer.root;
    const textString = getAllText(root);

    expect(textString).toContain('Ramesh Patel');
    expect(textString).toContain('9876543210');
    expect(textString).toContain('₹650/day');
    expect(textString).toContain('Active');
  });

  it('renders 4 KPI cards: Total Units, Gross, Advances, and Net Payable', async () => {
    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkerDetailScreen
          workerId={workerId}
          accountId={accountId}
          onBack={jest.fn()}
        />
      );
    });

    const root = renderer.root;
    const textString = getAllText(root);

    // 1.5 work units
    expect(textString).toContain('1.5');
    // Gross: 1.5 * 650 = 975
    expect(textString).toContain('₹975');
    // Advances: 200
    expect(textString).toContain('₹200');
    // Net Payable: 975 - 200 = 775
    expect(textString).toContain('₹775');
  });

  it('allows phone call action when worker has phone number', async () => {
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);

    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkerDetailScreen
          workerId={workerId}
          accountId={accountId}
          onBack={jest.fn()}
        />
      );
    });

    const root = renderer.root;
    const callButton = root.findByProps({ accessibilityLabel: 'Call 9876543210' });
    expect(callButton).toBeTruthy();

    await act(async () => {
      callButton.props.onPress();
    });

    expect(openURLSpy).toHaveBeenCalledWith('tel:9876543210');
    openURLSpy.mockRestore();
  });

  it('handles month capsule navigation', async () => {
    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkerDetailScreen
          workerId={workerId}
          accountId={accountId}
          onBack={jest.fn()}
        />
      );
    });

    const root = renderer.root;
    const prevMonthBtn = root.findByProps({ accessibilityLabel: 'Previous month' });
    expect(prevMonthBtn).toBeTruthy();

    await act(async () => {
      prevMonthBtn.props.onPress();
    });

    // Should fetch September 2026 data
    expect(ApiClient.getWorkerMonthly).toHaveBeenCalledWith(workerId, 2026, 9);
  });

  it('calculates historical earnings accurately when wage changes', () => {
    // Add second wage tier starting Oct 16
    mockDb.tables.worker_wage_history.push({
      id: 'wwh_2',
      account_id: accountId,
      worker_id: workerId,
      daily_wage: 800,
      effective_from: '2026-10-16',
      created_at: '2026-10-16T00:00:00Z',
      sync_status: 'SYNCED',
    });

    // Calculate resolved wage on Oct 15 -> should be 650
    const wage15 = WageHistoryRepository.getEffectiveWage(workerId, '2026-10-15', accountId, 650);
    expect(wage15).toBe(650);

    // Calculate resolved wage on Oct 16 -> should be 800
    const wage16 = WageHistoryRepository.getEffectiveWage(workerId, '2026-10-16', accountId, 650);
    expect(wage16).toBe(800);

    // Total gross: (1.0 * 650) + (0.5 * 800) = 650 + 400 = 1050
    const gross = (1.0 * wage15) + (0.5 * wage16);
    expect(gross).toBe(1050);
  });
});
