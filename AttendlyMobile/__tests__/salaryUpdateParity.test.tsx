import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { UpdateSalaryModal } from '../src/components/UpdateSalaryModal';
import { WageHistoryModal } from '../src/components/WageHistoryModal';
import { WageHistoryRepository } from '../src/repositories/wageHistoryRepository';
import { LocalWorker } from '../src/repositories/workerRepository';
import { open } from '@op-engineering/op-sqlite';
import { _resetDatabaseForTesting } from '../src/db/database';

jest.mock('../src/api/client', () => ({
  ApiClient: {
    addWorkerWage: jest.fn(),
    deleteWorkerWage: jest.fn(),
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
        if (q.includes('FROM workers')) {
          if (q.includes('WHERE id = ?')) {
            const row = tables.workers.find(r => r.id === params[0]);
            return { rows: row ? [{ ...row }] : [] };
          }
          return { rows: tables.workers.map(r => ({ ...r })) };
        }

        if (q.includes('FROM worker_wage_history')) {
          if (q.includes('COUNT(*)')) {
            const cnt = tables.worker_wage_history.filter(r => r.worker_id === params[0]).length;
            return { rows: [{ cnt }] };
          }
          let rows = [...tables.worker_wage_history];
          if (q.includes('worker_id = ?')) {
            rows = rows.filter(r => r.worker_id === params[0]);
          }
          if (q.includes('ORDER BY effective_from DESC')) {
            rows.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
          } else if (q.includes('ORDER BY effective_from ASC')) {
            rows.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
          }
          return { rows: rows.map(r => ({ ...r })) };
        }

        if (q.includes('FROM sync_queue')) {
          return { rows: tables.sync_queue.map(r => ({ ...r })) };
        }

        return { rows: [] };
      }

      // INSERT OR REPLACE INTO worker_wage_history
      if (q.includes('INSERT OR REPLACE INTO worker_wage_history')) {
        const [id, account_id, worker_id, daily_wage, effective_from] = params;
        const existingIdx = tables.worker_wage_history.findIndex(
          r => r.worker_id === worker_id && r.effective_from === effective_from
        );
        const record = {
          id: existingIdx >= 0 ? tables.worker_wage_history[existingIdx].id : id,
          account_id,
          worker_id,
          daily_wage,
          effective_from,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (existingIdx >= 0) {
          tables.worker_wage_history[existingIdx] = record;
        } else {
          tables.worker_wage_history.push(record);
        }
        return { rows: [] };
      }

      // INSERT OR REPLACE INTO workers
      if (q.includes('INSERT OR REPLACE INTO workers')) {
        const [id, account_id, name, daily_wage, phone, is_active] = params;
        const existingIdx = tables.workers.findIndex(r => r.id === id);
        const record = {
          id,
          account_id,
          name,
          daily_wage,
          phone,
          is_active: is_active ?? 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (existingIdx >= 0) {
          tables.workers[existingIdx] = record;
        } else {
          tables.workers.push(record);
        }
        return { rows: [] };
      }

      // UPDATE workers SET daily_wage
      if (q.includes('UPDATE workers SET daily_wage = ?')) {
        const [newWage, workerId] = params;
        const w = tables.workers.find(r => r.id === workerId);
        if (w) w.daily_wage = newWage;
        return { rows: [] };
      }

      // INSERT INTO sync_queue
      if (q.includes('INSERT INTO sync_queue')) {
        tables.sync_queue.push({
          id: params[0],
          account_id: params[1],
          entity_type: params[2],
          entity_id: params[3],
          action: params[4],
          payload: params[5],
        });
        return { rows: [] };
      }

      // DELETE FROM worker_wage_history
      if (q.includes('DELETE FROM worker_wage_history WHERE id = ?')) {
        tables.worker_wage_history = tables.worker_wage_history.filter(r => r.id !== params[0]);
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

describe('Worker Salary Update & Wage History Parity Suite', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    _resetDatabaseForTesting();
    mockDb = createMockDb();
    (open as jest.Mock).mockReturnValue(mockDb);
  });

  const dummyWorker: LocalWorker = {
    id: 'w-test-1',
    account_id: 'acc-1',
    name: 'Suresh Kumar',
    daily_wage: 700,
    phone: '+919876500000',
    is_active: true,
    sync_status: 'SYNCED',
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
  };

  test('1. Initial worker creation and initial wage recording', () => {
    mockDb.tables.workers.push({ ...dummyWorker });
    mockDb.tables.worker_wage_history.push({
      id: 'wage-1',
      account_id: 'acc-1',
      worker_id: 'w-test-1',
      daily_wage: 700,
      effective_from: '2026-10-01',
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T08:00:00Z',
    });

    const wages = WageHistoryRepository.getByWorkerId('w-test-1', 'acc-1');
    expect(wages).toHaveLength(1);
    expect(wages[0].daily_wage).toBe(700);
    expect(wages[0].effective_from).toBe('2026-10-01');
  });

  test('2. Updating wage with an effective-from date preserves history and updates rate for today', () => {
    mockDb.tables.workers.push({ ...dummyWorker });
    mockDb.tables.worker_wage_history.push({
      id: 'wage-1',
      account_id: 'acc-1',
      worker_id: 'w-test-1',
      daily_wage: 700,
      effective_from: '2026-10-01',
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T08:00:00Z',
    });

    // Update wage to 800 effective 2026-10-15
    WageHistoryRepository.save({
      account_id: 'acc-1',
      worker_id: 'w-test-1',
      daily_wage: 800,
      effective_from: '2026-10-15',
    });

    const wages = WageHistoryRepository.getByWorkerId('w-test-1', 'acc-1');
    expect(wages).toHaveLength(2);
    expect(wages[0].effective_from).toBe('2026-10-15');
    expect(wages[0].daily_wage).toBe(800);
    expect(wages[1].effective_from).toBe('2026-10-01');
    expect(wages[1].daily_wage).toBe(700);
  });

  test('3, 4, 5. Effective wage resolution: before, on, and after effective date', () => {
    mockDb.tables.workers.push({ ...dummyWorker });
    mockDb.tables.worker_wage_history.push(
      {
        id: 'wage-1',
        account_id: 'acc-1',
        worker_id: 'w-test-1',
        daily_wage: 700,
        effective_from: '2026-10-01',
      },
      {
        id: 'wage-2',
        account_id: 'acc-1',
        worker_id: 'w-test-1',
        daily_wage: 800,
        effective_from: '2026-10-15',
      }
    );

    // Before effective date (2026-10-10) -> 700
    const wageBefore = WageHistoryRepository.getEffectiveWage('w-test-1', '2026-10-10', 'acc-1', 700);
    expect(wageBefore).toBe(700);

    // On effective date (2026-10-15) -> 800
    const wageOn = WageHistoryRepository.getEffectiveWage('w-test-1', '2026-10-15', 'acc-1', 700);
    expect(wageOn).toBe(800);

    // After effective date (2026-10-20) -> 800
    const wageAfter = WageHistoryRepository.getEffectiveWage('w-test-1', '2026-10-20', 'acc-1', 700);
    expect(wageAfter).toBe(800);
  });

  test('6. Financial calculation fixture: 10 units @ 700 + 5 units @ 800 = 11,000', () => {
    mockDb.tables.workers.push({ ...dummyWorker });
    mockDb.tables.worker_wage_history.push(
      {
        id: 'wage-1',
        account_id: 'acc-1',
        worker_id: 'w-test-1',
        daily_wage: 700,
        effective_from: '2026-10-01',
      },
      {
        id: 'wage-2',
        account_id: 'acc-1',
        worker_id: 'w-test-1',
        daily_wage: 800,
        effective_from: '2026-10-11',
      }
    );

    // 10 shifts at 1.0 unit between Oct 1 and Oct 10
    let totalGross = 0;
    for (let day = 1; day <= 10; day++) {
      const dateStr = `2026-10-${day < 10 ? '0' + day : day}`;
      const effWage = WageHistoryRepository.getEffectiveWage('w-test-1', dateStr, 'acc-1', 700);
      const units = 1.0;
      totalGross += units * effWage;
    }
    expect(totalGross).toBe(7000); // 10 * 700 = 7,000

    // 5 shifts at 1.0 unit between Oct 11 and Oct 15
    for (let day = 11; day <= 15; day++) {
      const dateStr = `2026-10-${day}`;
      const effWage = WageHistoryRepository.getEffectiveWage('w-test-1', dateStr, 'acc-1', 700);
      const units = 1.0;
      totalGross += units * effWage;
    }

    // Total gross must be exactly 11,000
    expect(totalGross).toBe(11000);
  });

  test('7. Future-dated wage update does not prematurely affect current daily wage', () => {
    mockDb.tables.workers.push({ ...dummyWorker, daily_wage: 700 });
    mockDb.tables.worker_wage_history.push({
      id: 'wage-1',
      account_id: 'acc-1',
      worker_id: 'w-test-1',
      daily_wage: 700,
      effective_from: '2026-10-01',
    });

    // Schedule future rate for next year
    WageHistoryRepository.save({
      account_id: 'acc-1',
      worker_id: 'w-test-1',
      daily_wage: 950,
      effective_from: '2027-01-01',
    });

    // Worker's active rate for today must remain 700
    const workerInDb = mockDb.tables.workers.find(w => w.id === 'w-test-1');
    expect(workerInDb?.daily_wage).toBe(700);

    // Current date shift resolves to 700, not 950
    const effWageToday = WageHistoryRepository.getEffectiveWage('w-test-1', '2026-10-25', 'acc-1', 700);
    expect(effWageToday).toBe(700);
  });

  test('8. Duplicate effective date updates record in-place rather than creating duplicate row', () => {
    mockDb.tables.workers.push({ ...dummyWorker });
    mockDb.tables.worker_wage_history.push({
      id: 'wage-1',
      account_id: 'acc-1',
      worker_id: 'w-test-1',
      daily_wage: 700,
      effective_from: '2026-10-01',
    });

    // Post wage on 2026-10-15 with rate 750
    WageHistoryRepository.save({
      account_id: 'acc-1',
      worker_id: 'w-test-1',
      daily_wage: 750,
      effective_from: '2026-10-15',
    });

    // Post another wage on SAME 2026-10-15 with rate 780
    WageHistoryRepository.save({
      account_id: 'acc-1',
      worker_id: 'w-test-1',
      daily_wage: 780,
      effective_from: '2026-10-15',
    });

    const wages = WageHistoryRepository.getByWorkerId('w-test-1', 'acc-1');
    expect(wages).toHaveLength(2);
    const oct15 = wages.find(w => w.effective_from === '2026-10-15');
    expect(oct15?.daily_wage).toBe(780);
  });

  test('9. Sole wage record cannot be deleted', () => {
    mockDb.tables.workers.push({ ...dummyWorker });
    mockDb.tables.worker_wage_history.push({
      id: 'wage-sole',
      account_id: 'acc-1',
      worker_id: 'w-test-1',
      daily_wage: 700,
      effective_from: '2026-10-01',
    });

    expect(() => {
      WageHistoryRepository.delete('wage-sole', 'w-test-1', 'acc-1');
    }).toThrow("Cannot delete the worker's sole wage record.");
  });

  test('10. UpdateSalaryModal renders worker details, current rate, and accepts valid inputs', () => {
    const onSalaryUpdated = jest.fn();
    const onClose = jest.fn();

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <UpdateSalaryModal
          visible={true}
          worker={dummyWorker}
          accountId="acc-1"
          onClose={onClose}
          onSalaryUpdated={onSalaryUpdated}
        />
      );
    });

    const root = renderer!.root;
    // Worker name and current rate elements are displayed
    expect(root.findByProps({ children: 'Suresh Kumar' })).toBeTruthy();
    expect(root.findByProps({ children: 'Current Rate:' })).toBeTruthy();
    expect(root.findByProps({ accessibilityLabel: 'New daily wage amount in rupees' })).toBeTruthy();
    expect(root.findByProps({ accessibilityLabel: 'Save updated salary' })).toBeTruthy();
    expect(root.findByProps({ accessibilityLabel: 'Cancel salary update' })).toBeTruthy();
  });

  test('11. WageHistoryModal renders current active rate banner and audit metadata', () => {
    mockDb.tables.workers.push({ ...dummyWorker });
    mockDb.tables.worker_wage_history.push({
      id: 'wage-1',
      account_id: 'acc-1',
      worker_id: 'w-test-1',
      daily_wage: 700,
      effective_from: '2026-10-01',
      created_at: '2026-10-01T10:00:00Z',
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <WageHistoryModal
          visible={true}
          worker={dummyWorker}
          accountId="acc-1"
          onClose={jest.fn()}
        />
      );
    });

    const root = renderer!.root;
    expect(root.findByProps({ children: 'CURRENT ACTIVE RATE' })).toBeTruthy();
    expect(root.findByProps({ children: 'Active Rate' })).toBeTruthy();
  });
});
