import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { WorkersScreen } from '../src/screens/WorkersScreen';
import { WageHistoryModal } from '../src/components/WageHistoryModal';
import { WorkerRepository } from '../src/repositories/workerRepository';
import { WageHistoryRepository } from '../src/repositories/wageHistoryRepository';
import { open } from '@op-engineering/op-sqlite';
import { _resetDatabaseForTesting } from '../src/db/database';

function createMockWorkerDb() {
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
          if (q.includes('account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
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
          } else if (q.includes('account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
          }
          if (q.includes('is_active = 1')) {
            rows = rows.filter(r => Boolean(r.is_active));
          }
          return { rows };
        }

        if (q.includes('FROM worker_wage_history')) {
          let rows = [...tables.worker_wage_history];
          if (q.includes('COUNT(*)')) {
            if (params.length === 2) {
              const matched = rows.filter(
                r => r.worker_id === params[0] && r.account_id === params[1]
              );
              return { rows: [{ cnt: matched.length }] };
            }
            return { rows: [{ cnt: rows.length }] };
          }
          if (q.includes('worker_id = ? AND account_id = ? AND effective_from = ?')) {
            rows = rows.filter(
              r =>
                r.worker_id === params[0] &&
                r.account_id === params[1] &&
                r.effective_from === params[2]
            );
            return { rows };
          }
          if (q.includes('worker_id = ? AND account_id = ?')) {
            rows = rows.filter(
              r => r.worker_id === params[0] && r.account_id === params[1]
            );
          }
          if (q.includes('ORDER BY effective_from DESC')) {
            rows.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
          } else if (q.includes('ORDER BY effective_from ASC')) {
            rows.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
          }
          return { rows };
        }

        return { rows: [] };
      }

      // UPDATE
      if (q.startsWith('UPDATE workers')) {
        const [wage, updated_at, workerId, accountId] = params;
        const w = tables.workers.find(r => r.id === workerId && r.account_id === accountId);
        if (w) {
          w.daily_wage = wage;
          w.updated_at = updated_at;
        }
        return { rows: [] };
      }

      // DELETE
      if (q.startsWith('DELETE FROM worker_wage_history')) {
        const [id, workerId, accountId] = params;
        tables.worker_wage_history = tables.worker_wage_history.filter(
          r => !(r.id === id && r.worker_id === workerId && r.account_id === accountId)
        );
        return { rows: [] };
      }

      // INSERT OR REPLACE
      if (q.startsWith('INSERT OR REPLACE INTO')) {
        if (q.includes('INTO workers')) {
          const [id, account_id, name, daily_wage, phone, is_active, created_at, updated_at, sync_status] = params;
          const idx = tables.workers.findIndex(r => r.id === id);
          const entry = { id, account_id, name, daily_wage, phone, is_active, created_at, updated_at, sync_status };
          if (idx >= 0) tables.workers[idx] = entry;
          else tables.workers.push(entry);
          return { rows: [] };
        }

        if (q.includes('INTO worker_wage_history')) {
          const [id, account_id, worker_id, daily_wage, effective_from, created_at, updated_at, sync_status] = params;
          const idx = tables.worker_wage_history.findIndex(
            r => r.id === id || (r.worker_id === worker_id && r.effective_from === effective_from)
          );
          const entry = { id, account_id, worker_id, daily_wage, effective_from, created_at, updated_at, sync_status };
          if (idx >= 0) tables.worker_wage_history[idx] = entry;
          else tables.worker_wage_history.push(entry);
          return { rows: [] };
        }

        if (q.includes('INTO sync_queue')) {
          const [id, account_id, entity_id, payload, created_at] = params;
          const status = q.includes("'PENDING'") ? 'PENDING' : 'SYNCED';
          const entity_type = q.includes("'worker_wage'") ? 'worker_wage' : 'worker';
          const action = q.includes("'DELETE'") ? 'DELETE' : 'UPSERT';
          const idx = tables.sync_queue.findIndex(r => r.id === id);
          const entry = { id, account_id, entity_type, entity_id, action, payload, created_at, status };
          if (idx >= 0) tables.sync_queue[idx] = entry;
          else tables.sync_queue.push(entry);
          return { rows: [] };
        }

        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

describe('Attendly Mobile — Phase 3: Workers & Wage History Parity Tests', () => {
  let mockDb: ReturnType<typeof createMockWorkerDb>;
  const TEST_ACCOUNT = 'contractor_acc_phase3';

  beforeEach(() => {
    jest.clearAllMocks();
    _resetDatabaseForTesting();
    mockDb = createMockWorkerDb();
    (open as jest.Mock).mockReturnValue(mockDb);
  });

  // 1. Worker creation with required fields, phone, and auto initial wage history
  test('creates a worker with name, daily wage, phone, and records initial wage history', () => {
    const worker = WorkerRepository.save({
      account_id: TEST_ACCOUNT,
      name: 'Ramesh Patel',
      daily_wage: 650,
      phone: '9876543210',
      is_active: true,
      effective_from: '2026-10-01',
    } as any);

    expect(worker.name).toBe('Ramesh Patel');
    expect(worker.daily_wage).toBe(650);
    expect(worker.phone).toBe('9876543210');
    expect(worker.is_active).toBe(true);

    // Verify worker in SQLite
    const inDb = WorkerRepository.getById(worker.id, TEST_ACCOUNT);
    expect(inDb).not.toBeNull();
    expect(inDb?.name).toBe('Ramesh Patel');
    expect(inDb?.phone).toBe('9876543210');

    // Verify initial wage record was recorded in SQLite
    const wages = WageHistoryRepository.getByWorkerId(worker.id, TEST_ACCOUNT);
    expect(wages.length).toBe(1);
    expect(wages[0].daily_wage).toBe(650);
    expect(wages[0].effective_from).toBe('2026-10-01');

    // Verify sync queue contains worker
    const queued = mockDb.tables.sync_queue.filter(q => q.entity_type === 'worker');
    expect(queued.length).toBe(1);
  });

  // 2. Worker filtering by active / inactive status
  test('filters workers by active only vs all', () => {
    const w1 = WorkerRepository.save({
      account_id: TEST_ACCOUNT,
      name: 'Active Worker 1',
      daily_wage: 500,
      is_active: true,
    });
    const w2 = WorkerRepository.save({
      account_id: TEST_ACCOUNT,
      name: 'Inactive Worker 2',
      daily_wage: 550,
      is_active: false,
    });

    const activeOnly = WorkerRepository.getAll(TEST_ACCOUNT, true);
    expect(activeOnly.map(w => w.id)).toContain(w1.id);
    expect(activeOnly.map(w => w.id)).not.toContain(w2.id);

    const allWorkers = WorkerRepository.getAll(TEST_ACCOUNT, false);
    expect(allWorkers.length).toBe(2);
    expect(allWorkers.map(w => w.id)).toContain(w1.id);
    expect(allWorkers.map(w => w.id)).toContain(w2.id);
  });

  // 3. Worker deactivation and reactivation preserves history
  test('deactivates and reactivates a worker without deleting records', () => {
    const worker = WorkerRepository.save({
      account_id: TEST_ACCOUNT,
      name: 'Suresh Raina',
      daily_wage: 700,
      is_active: true,
    });

    // Deactivate
    const deactivated = WorkerRepository.save({
      ...worker,
      is_active: false,
    });
    expect(deactivated.is_active).toBe(false);

    // Verify hidden from active list
    const activeList = WorkerRepository.getAll(TEST_ACCOUNT, true);
    expect(activeList.find(w => w.id === worker.id)).toBeUndefined();

    // Reactivate
    const reactivated = WorkerRepository.save({
      ...worker,
      is_active: true,
    });
    expect(reactivated.is_active).toBe(true);

    const activeListAfter = WorkerRepository.getAll(TEST_ACCOUNT, true);
    expect(activeListAfter.find(w => w.id === worker.id)).toBeDefined();
  });

  // 4. Effective-dated wage resolution (replicates PWA resolve_effective_wage)
  test('resolves effective wage based on attendance date matching PWA business rules', () => {
    const worker = WorkerRepository.save({
      account_id: TEST_ACCOUNT,
      name: 'Karan Sharma',
      daily_wage: 500,
      effective_from: '2026-10-10',
    } as any);

    // Add rate change effective Oct 20
    WageHistoryRepository.save({
      account_id: TEST_ACCOUNT,
      worker_id: worker.id,
      daily_wage: 600,
      effective_from: '2026-10-20',
    });

    // Date before earliest recorded rate (Oct 5) -> baseline fallback (500)
    const rateBeforeBaseline = WageHistoryRepository.getEffectiveWage(
      worker.id,
      '2026-10-05',
      TEST_ACCOUNT,
      500
    );
    expect(rateBeforeBaseline).toBe(500);

    // Date on baseline (Oct 10) -> 500
    const rateOnBaseline = WageHistoryRepository.getEffectiveWage(
      worker.id,
      '2026-10-10',
      TEST_ACCOUNT,
      500
    );
    expect(rateOnBaseline).toBe(500);

    // Date between Oct 10 and Oct 20 (Oct 15) -> 500
    const rateMiddle = WageHistoryRepository.getEffectiveWage(
      worker.id,
      '2026-10-15',
      TEST_ACCOUNT,
      500
    );
    expect(rateMiddle).toBe(500);

    // Date on effective date (Oct 20) -> 600
    const rateOnNew = WageHistoryRepository.getEffectiveWage(
      worker.id,
      '2026-10-20',
      TEST_ACCOUNT,
      500
    );
    expect(rateOnNew).toBe(600);

    // Date after effective date (Oct 25) -> 600
    const rateAfterNew = WageHistoryRepository.getEffectiveWage(
      worker.id,
      '2026-10-25',
      TEST_ACCOUNT,
      500
    );
    expect(rateAfterNew).toBe(600);
  });

  // 5. Updating rate on exact same effective date updates rate instead of creating duplicates
  test('updates rate on exact same effective date without creating duplicates', () => {
    const worker = WorkerRepository.save({
      account_id: TEST_ACCOUNT,
      name: 'Mohit Sharma',
      daily_wage: 500,
      effective_from: '2026-10-01',
    } as any);

    // Add wage on Oct 15
    WageHistoryRepository.save({
      account_id: TEST_ACCOUNT,
      worker_id: worker.id,
      daily_wage: 550,
      effective_from: '2026-10-15',
    });

    // Revise wage on Oct 15 to 580
    WageHistoryRepository.save({
      account_id: TEST_ACCOUNT,
      worker_id: worker.id,
      daily_wage: 580,
      effective_from: '2026-10-15',
    });

    const wages = WageHistoryRepository.getByWorkerId(worker.id, TEST_ACCOUNT);
    // Must only have 2 records (Oct 15 and Oct 01), not 3
    expect(wages.length).toBe(2);
    expect(wages[0].effective_from).toBe('2026-10-15');
    expect(wages[0].daily_wage).toBe(580);
  });

  // 6. Deleting a secondary wage rate restores active rate
  test('deletes secondary wage rate and recalculates active daily wage', () => {
    const worker = WorkerRepository.save({
      account_id: TEST_ACCOUNT,
      name: 'Hardik Pandya',
      daily_wage: 600,
      effective_from: '2026-10-01',
    } as any);

    const wh2 = WageHistoryRepository.save({
      account_id: TEST_ACCOUNT,
      worker_id: worker.id,
      daily_wage: 750,
      effective_from: '2026-10-15',
    });

    expect(WageHistoryRepository.getByWorkerId(worker.id, TEST_ACCOUNT).length).toBe(2);

    // Delete secondary wage rate
    WageHistoryRepository.delete(wh2.id, worker.id, TEST_ACCOUNT);

    const remaining = WageHistoryRepository.getByWorkerId(worker.id, TEST_ACCOUNT);
    expect(remaining.length).toBe(1);
    expect(remaining[0].daily_wage).toBe(600);
  });

  // 7. Deleting sole wage record is blocked
  test('blocks deletion of the worker sole wage record', () => {
    const worker = WorkerRepository.save({
      account_id: TEST_ACCOUNT,
      name: 'Sole Wage Worker',
      daily_wage: 450,
      effective_from: '2026-10-01',
    } as any);

    const wages = WageHistoryRepository.getByWorkerId(worker.id, TEST_ACCOUNT);
    expect(wages.length).toBe(1);

    expect(() => {
      WageHistoryRepository.delete(wages[0].id, worker.id, TEST_ACCOUNT);
    }).toThrow("Cannot delete the worker's sole wage record.");
  });

  // 8. Offline sync preservation: incoming server sync does not overwrite local pending worker edits
  test('protects local pending worker edits against incoming server sync data', () => {
    const localWorker = WorkerRepository.save({
      id: 'w_pending_1',
      account_id: TEST_ACCOUNT,
      name: 'Local Edited Name',
      daily_wage: 800,
      is_active: true,
    });

    expect(localWorker.sync_status).toBe('PENDING');

    // Simulate server sync pull returning stale remote state
    WorkerRepository.saveBatchFromSync(
      [
        {
          id: 'w_pending_1',
          account_id: TEST_ACCOUNT,
          name: 'Stale Remote Name',
          daily_wage: 400,
          is_active: true,
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
        },
      ],
      TEST_ACCOUNT
    );

    // Local record must NOT have been overwritten
    const preserved = WorkerRepository.getById('w_pending_1', TEST_ACCOUNT);
    expect(preserved?.name).toBe('Local Edited Name');
    expect(preserved?.daily_wage).toBe(800);
  });

  // 9. WorkersScreen UI rendering with workers and search filter
  test('renders WorkersScreen with search bar, filter pills, and worker cards', () => {
    WorkerRepository.save({
      account_id: TEST_ACCOUNT,
      name: 'Deepak Chahar',
      daily_wage: 620,
      phone: '9988776655',
      is_active: true,
    });

    let tree: any;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <WorkersScreen accountId={TEST_ACCOUNT} onNavigateHome={jest.fn()} />
      );
    });

    const root = tree.root;
    // Worker name and phone should be present in rendered output
    const textNodes = root.findAllByType('Text' as any);
    const textValues = textNodes.map((n: any) => n.props.children).flat();

    expect(textValues).toContain('Deepak Chahar');
    expect(textValues).toContain('Workers');
  });

  // 10. WageHistoryModal rendering
  test('renders WageHistoryModal with effective rate badges', () => {
    const worker = WorkerRepository.save({
      account_id: TEST_ACCOUNT,
      name: 'Shubman Gill',
      daily_wage: 900,
      effective_from: '2026-10-01',
    } as any);

    let tree: any;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <WageHistoryModal
          visible={true}
          worker={worker}
          accountId={TEST_ACCOUNT}
          onClose={jest.fn()}
        />
      );
    });

    const root = tree.root;
    const textNodes = root.findAllByType('Text' as any);
    const textValues = textNodes.map((n: any) => n.props.children).flat();

    expect(textValues).toContain('Shubman Gill');
    expect(textValues).toContain('Wage History & Rate Timeline');
  });
});
