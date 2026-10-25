import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { PayrollScreen } from '../src/screens/PayrollScreen';
import { ApiClient } from '../src/api/client';
import { open } from '@op-engineering/op-sqlite';
import { _resetDatabaseForTesting } from '../src/db/database';

jest.mock('../src/api/client', () => ({
  ApiClient: {
    getMonthlyPayroll: jest.fn(),
    getWorkerMonthly: jest.fn(),
    syncPush: jest.fn(),
    syncPull: jest.fn(),
  },
}));

function createMockPayrollDb() {
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

        if (q.includes('FROM workers')) {
          let rows = [...tables.workers];
          if (q.includes('is_active = 1')) {
            rows = rows.filter(r => r.is_active === 1 || r.is_active === true);
          }
          if (q.includes('account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
          }
          if (q.includes('WHERE id = ?') || q.includes('workers WHERE id = ?')) {
            rows = rows.filter(r => r.id === params[0]);
          }
          return { rows };
        }

        if (q.includes('FROM worker_wage_history')) {
          let rows = [...tables.worker_wage_history];
          if (q.includes('worker_id = ? AND account_id = ?')) {
            rows = rows.filter(r => r.worker_id === params[0] && r.account_id === params[1]);
          }
          if (q.includes('ORDER BY effective_from ASC')) {
            rows.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
          } else if (q.includes('ORDER BY effective_from DESC')) {
            rows.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
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

        if (q.includes('FROM attendance')) {
          let rows = tables.attendance.map(a => {
            const site = tables.sites.find(s => s.id === a.site_id);
            return {
              ...a,
              site_name: site ? site.name : null,
            };
          });

          if (q.includes('date >= ?') && q.includes('date <= ?') && q.includes('account_id = ?')) {
            rows = rows.filter(
              r => r.date >= params[0] && r.date <= params[1] && r.account_id === params[2]
            );
          }
          return { rows };
        }

        if (q.includes('FROM advances')) {
          let rows = [...tables.advances];
          if (q.includes('date >= ?') && q.includes('date <= ?') && q.includes('account_id = ?')) {
            rows = rows.filter(
              r => r.date >= params[0] && r.date <= params[1] && r.account_id === params[2]
            );
          }
          return { rows };
        }
      }

      // INSERT OR REPLACE INTO attendance
      if (q.includes('INSERT OR REPLACE INTO attendance')) {
        const [id, account_id, worker_id, site_id, date, work_units, notes, created_at, updated_at, sync_status] = params;
        const record = {
          id,
          account_id,
          worker_id,
          site_id,
          date,
          work_units: Number(work_units),
          notes,
          created_at,
          updated_at,
          sync_status,
        };
        const idx = tables.attendance.findIndex(r => r.id === id);
        if (idx >= 0) tables.attendance[idx] = record;
        else tables.attendance.push(record);
        return { rows: [] };
      }

      // INSERT OR REPLACE INTO advances
      if (q.includes('INSERT OR REPLACE INTO advances')) {
        const [id, account_id, worker_id, amount, date, note, created_at, updated_at, sync_status] = params;
        const record = {
          id,
          account_id,
          worker_id,
          amount: Number(amount),
          date,
          note,
          created_at,
          updated_at,
          sync_status,
        };
        const idx = tables.advances.findIndex(r => r.id === id);
        if (idx >= 0) tables.advances[idx] = record;
        else tables.advances.push(record);
        return { rows: [] };
      }

      // INSERT OR REPLACE INTO worker_wage_history
      if (q.includes('INSERT OR REPLACE INTO worker_wage_history')) {
        const [id, account_id, worker_id, daily_wage, effective_from, created_at, updated_at, sync_status] = params;
        const record = {
          id,
          account_id,
          worker_id,
          daily_wage: Number(daily_wage),
          effective_from,
          created_at,
          updated_at,
          sync_status,
        };
        const idx = tables.worker_wage_history.findIndex(r => r.id === id);
        if (idx >= 0) tables.worker_wage_history[idx] = record;
        else tables.worker_wage_history.push(record);
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

describe('Attendly Mobile — Phase 6: Payroll Parity & Financial Integrity', () => {
  const accountId = 'acc_payroll_test_001';
  let mockDb: ReturnType<typeof createMockPayrollDb>;

  beforeEach(() => {
    jest.clearAllMocks();
    _resetDatabaseForTesting();
    mockDb = createMockPayrollDb();
    (open as jest.Mock).mockReturnValue(mockDb);

    // Default metadata: bound to accountId
    mockDb.tables.app_metadata.push({
      key: 'bound_account_id',
      value: accountId,
    });

    // Default mock API responses (offline fallback to local DB)
    (ApiClient.getMonthlyPayroll as jest.Mock).mockRejectedValue(new Error('Network offline'));
  });

  it('1. Monthly payroll totals and worker-level reconciliation', async () => {
    // Setup 2 workers
    mockDb.tables.workers.push(
      {
        id: 'w1',
        account_id: accountId,
        name: 'Ramesh Kumar',
        daily_wage: 500,
        is_active: 1,
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
        sync_status: 'SYNCED',
      },
      {
        id: 'w2',
        account_id: accountId,
        name: 'Suresh Patel',
        daily_wage: 700,
        is_active: 1,
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
        sync_status: 'SYNCED',
      }
    );

    // Initial wage history records
    mockDb.tables.worker_wage_history.push(
      {
        id: 'wh1',
        account_id: accountId,
        worker_id: 'w1',
        daily_wage: 500,
        effective_from: '2026-09-01',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
        sync_status: 'SYNCED',
      },
      {
        id: 'wh2',
        account_id: accountId,
        worker_id: 'w2',
        daily_wage: 700,
        effective_from: '2026-09-01',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
        sync_status: 'SYNCED',
      }
    );

    mockDb.tables.sites.push({
      id: 's1',
      account_id: accountId,
      name: 'Project Alpha',
      location: 'Sector 4',
      is_active: 1,
    });

    // Attendance for W1: 3 days of 1.0 = 3 * 500 = 1500
    mockDb.tables.attendance.push(
      { id: 'a1', account_id: accountId, worker_id: 'w1', site_id: 's1', date: '2026-10-01', work_units: 1.0 },
      { id: 'a2', account_id: accountId, worker_id: 'w1', site_id: 's1', date: '2026-10-02', work_units: 1.0 },
      { id: 'a3', account_id: accountId, worker_id: 'w1', site_id: 's1', date: '2026-10-03', work_units: 1.0 }
    );

    // Attendance for W2: 2 days of 1.5 = 2 * (1.5 * 700) = 2100
    mockDb.tables.attendance.push(
      { id: 'a4', account_id: accountId, worker_id: 'w2', site_id: 's1', date: '2026-10-01', work_units: 1.5 },
      { id: 'a5', account_id: accountId, worker_id: 'w2', site_id: 's1', date: '2026-10-02', work_units: 1.5 }
    );

    // Advances: W1 = 400, W2 = 500
    mockDb.tables.advances.push(
      { id: 'adv1', account_id: accountId, worker_id: 'w1', amount: 400, date: '2026-10-02' },
      { id: 'adv2', account_id: accountId, worker_id: 'w2', amount: 500, date: '2026-10-02' }
    );

    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(<PayrollScreen accountId={accountId} />);
    });

    const textNodes = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    const textDump = JSON.stringify(textNodes);

    // Check monthly summary totals:
    // Units: 3.0 + 3.0 = 6.0
    expect(textDump).toContain('6.0');
    // Gross: 1500 + 2100 = 3600
    expect(textDump).toContain('₹3,600');
    // Advances: 400 + 500 = 900
    expect(textDump).toContain('₹900');
    // Net Payable: 3600 - 900 = 2700
    expect(textDump).toContain('₹2,700');

    // Worker level breakdown
    // W1: net = 1500 - 400 = 1100
    expect(textDump).toContain('₹1,100');
    // W2: net = 2100 - 500 = 1600
    expect(textDump).toContain('₹1,600');
  });

  it('2. Wage changes during a month and effective wage rate resolution', async () => {
    mockDb.tables.workers.push({
      id: 'w1',
      account_id: accountId,
      name: 'Ramesh Kumar',
      daily_wage: 500,
      is_active: 1,
    });

    // Wage was 500 from Sept 1, then revised to 650 on Oct 15
    mockDb.tables.worker_wage_history.push(
      { id: 'wh1', account_id: accountId, worker_id: 'w1', daily_wage: 500, effective_from: '2026-09-01' },
      { id: 'wh2', account_id: accountId, worker_id: 'w1', daily_wage: 650, effective_from: '2026-10-15' }
    );

    // 2 days worked before revision (Oct 10, Oct 11) -> 2 * 500 = 1000
    // 2 days worked after revision (Oct 15, Oct 16) -> 2 * 650 = 1300
    mockDb.tables.attendance.push(
      { id: 'a1', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-10-10', work_units: 1.0 },
      { id: 'a2', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-10-11', work_units: 1.0 },
      { id: 'a3', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-10-15', work_units: 1.0 },
      { id: 'a4', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-10-16', work_units: 1.0 }
    );

    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(<PayrollScreen accountId={accountId} />);
    });

    const textNodes = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    const textDump = JSON.stringify(textNodes);

    // Total gross: 1000 + 1300 = 2300
    expect(textDump).toContain('₹2,300');
    // Multiple rates badge should be visible: '2 rates'
    expect(textDump).toContain('rates');
  });

  it('3. Work unit variations: half-day, full-day, overtime, and double shifts', async () => {
    mockDb.tables.workers.push({
      id: 'w1',
      account_id: accountId,
      name: 'Varied Units Worker',
      daily_wage: 600,
      is_active: 1,
    });
    mockDb.tables.worker_wage_history.push({
      id: 'wh1',
      account_id: accountId,
      worker_id: 'w1',
      daily_wage: 600,
      effective_from: '2026-09-01',
    });

    // Day 1: 0.0 units (absent) -> 0
    // Day 2: 0.5 units (half day) -> 300
    // Day 3: 1.0 units (full day) -> 600
    // Day 4: 1.5 units (overtime) -> 900
    // Day 5: 2.0 units (double shift) -> 1200
    mockDb.tables.attendance.push(
      { id: 'a1', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-10-01', work_units: 0.0 },
      { id: 'a2', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-10-02', work_units: 0.5 },
      { id: 'a3', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-10-03', work_units: 1.0 },
      { id: 'a4', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-10-04', work_units: 1.5 },
      { id: 'a5', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-10-05', work_units: 2.0 }
    );

    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(<PayrollScreen accountId={accountId} />);
    });

    const textNodes = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    const textDump = JSON.stringify(textNodes);

    // Total units: 0 + 0.5 + 1.0 + 1.5 + 2.0 = 5.0
    expect(textDump).toContain('5.0');
    // Total gross: 0 + 300 + 600 + 900 + 1200 = 3000
    expect(textDump).toContain('₹3,000');
  });

  it('4. Advances exceeding gross earnings preserves negative net payable', async () => {
    mockDb.tables.workers.push({
      id: 'w1',
      account_id: accountId,
      name: 'Advance Exceed Worker',
      daily_wage: 500,
      is_active: 1,
    });
    mockDb.tables.worker_wage_history.push({
      id: 'wh1',
      account_id: accountId,
      worker_id: 'w1',
      daily_wage: 500,
      effective_from: '2026-09-01',
    });

    // 1 day worked: 500 gross
    mockDb.tables.attendance.push({
      id: 'a1',
      account_id: accountId,
      worker_id: 'w1',
      site_id: null,
      date: '2026-10-01',
      work_units: 1.0,
    });

    // Advance given: 1200
    mockDb.tables.advances.push({
      id: 'adv1',
      account_id: accountId,
      worker_id: 'w1',
      amount: 1200,
      date: '2026-10-02',
    });

    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(<PayrollScreen accountId={accountId} />);
    });

    const textNodes = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    const textDump = JSON.stringify(textNodes);

    // Net payable must be -₹700 (not clamped to 0)
    expect(textDump).toContain('-₹700');
  });

  it('5. Inactive workers with attendance are included, inactive without attendance are excluded', async () => {
    mockDb.tables.workers.push(
      {
        id: 'w1',
        account_id: accountId,
        name: 'Inactive Worked Worker',
        daily_wage: 500,
        is_active: 0, // Deactivated
      },
      {
        id: 'w2',
        account_id: accountId,
        name: 'Inactive Idle Worker',
        daily_wage: 500,
        is_active: 0, // Deactivated, no attendance or advances
      }
    );

    // Only W1 worked in October
    mockDb.tables.attendance.push({
      id: 'a1',
      account_id: accountId,
      worker_id: 'w1',
      site_id: null,
      date: '2026-10-01',
      work_units: 1.0,
    });

    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(<PayrollScreen accountId={accountId} />);
    });

    const textNodes = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    const textDump = JSON.stringify(textNodes);

    // W1 is included
    expect(textDump).toContain('Inactive Worked Worker');
    // W2 is excluded
    expect(textDump).not.toContain('Inactive Idle Worker');
  });

  it('6. Calendar month boundary filtering isolates months', async () => {
    mockDb.tables.workers.push({
      id: 'w1',
      account_id: accountId,
      name: 'Boundary Worker',
      daily_wage: 500,
      is_active: 1,
    });

    // Attendance outside October: Sept 30 and Nov 1
    mockDb.tables.attendance.push(
      { id: 'a1', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-09-30', work_units: 1.0 },
      { id: 'a2', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-10-15', work_units: 1.0 },
      { id: 'a3', account_id: accountId, worker_id: 'w1', site_id: null, date: '2026-11-01', work_units: 1.0 }
    );

    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(<PayrollScreen accountId={accountId} />);
    });

    const textNodes = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    const textDump = JSON.stringify(textNodes);

    // October has exactly 1 unit (1.0), not 3.0
    expect(textDump).toContain('1.0');
    expect(textDump).toContain('₹500');
  });

  it('7. Salary Slip modal shows sites worked and financial summary', async () => {
    mockDb.tables.workers.push({
      id: 'w1',
      account_id: accountId,
      name: 'Slip Test Worker',
      daily_wage: 500,
      is_active: 1,
    });
    mockDb.tables.sites.push({
      id: 's1',
      account_id: accountId,
      name: 'Site Metro Line',
      is_active: 1,
    });
    mockDb.tables.attendance.push({
      id: 'a1',
      account_id: accountId,
      worker_id: 'w1',
      site_id: 's1',
      date: '2026-10-05',
      work_units: 1.0,
    });
    mockDb.tables.advances.push({
      id: 'adv1',
      account_id: accountId,
      worker_id: 'w1',
      amount: 200,
      date: '2026-10-06',
    });

    (ApiClient.getWorkerMonthly as jest.Mock).mockResolvedValue({
      worker_id: 'w1',
      worker_name: 'Slip Test Worker',
      daily_wage: 500,
      total_work_units: 1.0,
      gross_earnings: 500,
      total_advances: 200,
      net_payable: 300,
      sites_worked: [
        {
          site_id: 's1',
          site_name: 'Site Metro Line',
          work_units: 1.0,
          earnings: 500,
        },
      ],
      wage_breakdown: [
        {
          rate: 500,
          work_units: 1.0,
          earnings: 500,
        },
      ],
    });

    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(<PayrollScreen accountId={accountId} />);
    });

    // Tap worker card to open salary slip modal
    const { TouchableOpacity } = require('react-native');
    const touchables = renderer.root.findAllByType(TouchableOpacity);
    const workerCard = touchables.find(
      (t: any) => t.props.accessibilityLabel === 'Salary slip for Slip Test Worker'
    );
    expect(workerCard).toBeDefined();

    await act(async () => {
      workerCard.props.onPress();
    });

    const textNodes = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    const textDump = JSON.stringify(textNodes);

    // Salary slip modal content
    expect(textDump).toContain('Salary Slip');
    expect(textDump).toContain('Sites Worked');
    expect(textDump).toContain('Site Metro Line');
    expect(textDump).toContain('Gross Wages Earned');
    expect(textDump).toContain('-₹200');
    expect(textDump).toContain('₹300');
  });

  it('8. Calculation standard info modal opens and displays financial rules', async () => {
    mockDb.tables.workers.push({
      id: 'w1',
      account_id: accountId,
      name: 'Ramesh Kumar',
      daily_wage: 500,
      is_active: 1,
    });

    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(<PayrollScreen accountId={accountId} />);
    });

    const { TouchableOpacity } = require('react-native');
    const touchables = renderer.root.findAllByType(TouchableOpacity);
    const detailsBtn = touchables.find((t: any) => t.props.accessibilityLabel === 'Details');
    expect(detailsBtn).toBeDefined();

    // Trigger details modal
    await act(async () => {
      detailsBtn.props.onPress();
    });

    const textNodes = renderer.root.findAllByType('Text').map((t: any) => t.props.children);
    const textDump = JSON.stringify(textNodes);

    expect(textDump).toContain('Financial Calculation Standard');
    expect(textDump).toContain('Daily Earnings');
    expect(textDump).toContain('Effective Wage Resolution');
    expect(textDump).toContain('Advances & Net Payable');
  });
});
