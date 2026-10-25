import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AdvancesScreen } from '../src/screens/AdvancesScreen';
import { AdvanceRepository, LocalAdvance } from '../src/repositories/advanceRepository';
import { WorkerRepository } from '../src/repositories/workerRepository';
import { SyncManager } from '../src/sync/syncManager';
import { ApiClient } from '../src/api/client';
import { open } from '@op-engineering/op-sqlite';
import { _resetDatabaseForTesting } from '../src/db/database';

jest.mock('../src/api/client', () => ({
  ApiClient: {
    getAdvances: jest.fn(),
    getAdvance: jest.fn(),
    recordAdvance: jest.fn(),
    updateAdvance: jest.fn(),
    deleteAdvance: jest.fn(),
    syncPush: jest.fn(),
    syncPull: jest.fn(),
  },
}));

function createMockAdvanceDb() {
  const tables: Record<string, any[]> = {
    app_metadata: [],
    workers: [],
    advances: [],
    attendance: [],
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
          if (q.includes('WHERE account_id = ? AND is_active = 1')) {
            rows = rows.filter(r => r.account_id === params[0] && r.is_active === 1);
          } else if (q.includes('WHERE account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
          }
          return { rows };
        }

        if (q.includes('FROM advances')) {
          let rows = tables.advances.map(a => {
            const w = tables.workers.find(wk => wk.id === a.worker_id);
            return {
              ...a,
              worker_name: w ? w.name : 'Unknown Worker',
            };
          });

          if (q.includes('a.id = ? AND a.account_id = ?')) {
            rows = rows.filter(r => r.id === params[0] && r.account_id === params[1]);
          } else if (q.includes('id = ? AND sync_status = \'PENDING\'')) {
            rows = rows.filter(r => r.id === params[0] && r.sync_status === 'PENDING');
          } else if (q.includes('a.worker_id = ? AND a.account_id = ?')) {
            rows = rows.filter(r => r.worker_id === params[0] && r.account_id === params[1]);
          } else if (q.includes('a.date >= ? AND a.date <= ? AND a.account_id = ? AND a.worker_id = ?')) {
            rows = rows.filter(
              r => r.date >= params[0] && r.date <= params[1] && r.account_id === params[2] && r.worker_id === params[3]
            );
          } else if (q.includes('a.date >= ? AND a.date <= ? AND a.account_id = ?')) {
            rows = rows.filter(
              r => r.date >= params[0] && r.date <= params[1] && r.account_id === params[2]
            );
          } else if (q.includes('a.account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
          } else if (q.includes('WHERE account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
          }

          return { rows };
        }
      }

      // INSERT OR REPLACE INTO advances
      if (q.includes('INSERT OR REPLACE INTO advances')) {
        const [id, account_id, worker_id, amount, date, note, created_at, updated_at, sync_status] = params;
        const existingIdx = tables.advances.findIndex(r => r.id === id);
        const record = {
          id,
          account_id,
          worker_id,
          amount: Number(amount),
          date,
          note,
          created_at,
          updated_at,
          sync_status: sync_status || (q.includes("'SYNCED'") ? 'SYNCED' : 'PENDING'),
        };
        if (existingIdx >= 0) {
          tables.advances[existingIdx] = record;
        } else {
          tables.advances.push(record);
        }
        return { rows: [] };
      }

      // INSERT OR REPLACE INTO sync_queue
      if (q.includes('INSERT OR REPLACE INTO sync_queue')) {
        let id: string, account_id: string, entity_type: string, entity_id: string, action: string, payload: string, created_at: string, status: string;
        if (params.length === 8) {
          [id, account_id, entity_type, entity_id, action, payload, created_at, status] = params;
        } else {
          [id, account_id, entity_id, payload, created_at] = params;
          entity_type = q.includes("'advance'") ? 'advance' : 'unknown';
          action = q.includes("'DELETE'") ? 'DELETE' : 'UPSERT';
          status = 'PENDING';
        }
        const existingIdx = tables.sync_queue.findIndex(r => r.id === id);
        const record = {
          id,
          account_id,
          entity_type,
          entity_id,
          action,
          payload,
          created_at,
          status: status || 'PENDING',
        };
        if (existingIdx >= 0) {
          tables.sync_queue[existingIdx] = record;
        } else {
          tables.sync_queue.push(record);
        }
        return { rows: [] };
      }

      // UPDATE advances SET sync_status
      if (q.includes('UPDATE advances SET sync_status = ? WHERE id = ?')) {
        const [status, id] = params;
        const record = tables.advances.find(r => r.id === id);
        if (record) record.sync_status = status;
        return { rows: [] };
      }
      if (q.includes("UPDATE advances SET sync_status = 'SYNCED' WHERE id = ?")) {
        const [id] = params;
        const record = tables.advances.find(r => r.id === id);
        if (record) record.sync_status = 'SYNCED';
        return { rows: [] };
      }

      // DELETE FROM advances
      if (q.includes('DELETE FROM advances WHERE id = ? AND account_id = ?')) {
        const [id, account_id] = params;
        const idx = tables.advances.findIndex(r => r.id === id && r.account_id === account_id);
        if (idx >= 0) tables.advances.splice(idx, 1);
        return { rows: [] };
      }

      // DELETE FROM sync_queue
      if (q.includes('DELETE FROM sync_queue WHERE id = ?')) {
        const [id] = params;
        const idx = tables.sync_queue.findIndex(r => r.id === id);
        if (idx >= 0) tables.sync_queue.splice(idx, 1);
        return { rows: [] };
      }
      if (q.includes("DELETE FROM sync_queue WHERE entity_type = 'advance' AND entity_id = ? AND account_id = ?")) {
        const [entity_id, account_id] = params;
        tables.sync_queue = tables.sync_queue.filter(
          r => !(r.entity_type === 'advance' && r.entity_id === entity_id && r.account_id === account_id)
        );
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

describe('Advances Management & Ledger Parity', () => {
  let mockDb: ReturnType<typeof createMockAdvanceDb>;
  const testAccountId = 'acc_contractor_test_01';

  beforeEach(() => {
    jest.clearAllMocks();
    _resetDatabaseForTesting();
    mockDb = createMockAdvanceDb();
    (open as jest.Mock).mockReturnValue(mockDb);

    // Bind account
    mockDb.tables.app_metadata.push({
      key: 'bound_account_id',
      value: testAccountId,
      updated_at: new Date().toISOString(),
    });

    // Populate seed workers
    mockDb.tables.workers.push(
      {
        id: 'w1',
        account_id: testAccountId,
        name: 'Ramesh Kumar',
        daily_wage: 650,
        phone: '9876543210',
        is_active: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        sync_status: 'SYNCED',
      },
      {
        id: 'w2',
        account_id: testAccountId,
        name: 'Suresh Patel',
        daily_wage: 700,
        phone: '9876543211',
        is_active: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        sync_status: 'SYNCED',
      }
    );
  });

  test('1. Creates advance with PENDING status and queues UPSERT action in sync_queue', () => {
    const adv = AdvanceRepository.recordAdvance({
      account_id: testAccountId,
      worker_id: 'w1',
      amount: 1500,
      date: '2026-10-15',
      note: 'Medical emergency',
    });

    expect(adv.id).toBeTruthy();
    expect(adv.worker_id).toBe('w1');
    expect(adv.amount).toBe(1500);
    expect(adv.note).toBe('Medical emergency');
    expect(adv.sync_status).toBe('PENDING');

    // Verify stored in advances table
    const stored = mockDb.tables.advances.find(a => a.id === adv.id);
    expect(stored).toBeDefined();
    expect(stored.amount).toBe(1500);

    // Verify sync_queue contains UPSERT
    const queued = mockDb.tables.sync_queue.find(q => q.entity_id === adv.id);
    expect(queued).toBeDefined();
    expect(queued.entity_type).toBe('advance');
    expect(queued.action).toBe('UPSERT');
    const payload = JSON.parse(queued.payload);
    expect(payload.amount).toBe(1500);
    expect(payload.worker_id).toBe('w1');
  });

  test('2. Lists advances joined with worker names and date range filtering', () => {
    AdvanceRepository.recordAdvance({
      account_id: testAccountId,
      worker_id: 'w1',
      amount: 1000,
      date: '2026-10-05',
    });
    AdvanceRepository.recordAdvance({
      account_id: testAccountId,
      worker_id: 'w2',
      amount: 2500,
      date: '2026-10-20',
    });

    const monthAdvances = AdvanceRepository.getByDateRange('2026-10-01', '2026-10-31', testAccountId);
    expect(monthAdvances.length).toBe(2);
    expect(monthAdvances[0].worker_name).toBeTruthy();

    const w1Advances = AdvanceRepository.getByDateRange('2026-10-01', '2026-10-31', testAccountId, 'w1');
    expect(w1Advances.length).toBe(1);
    expect(w1Advances[0].amount).toBe(1000);
  });

  test('3. Deletes advance locally and enqueues DELETE action in sync_queue', () => {
    const adv = AdvanceRepository.recordAdvance({
      account_id: testAccountId,
      worker_id: 'w1',
      amount: 800,
      date: '2026-10-10',
    });

    expect(mockDb.tables.advances.length).toBe(1);

    AdvanceRepository.delete(adv.id, testAccountId);

    expect(mockDb.tables.advances.length).toBe(0);

    // Should have DELETE in sync queue
    const delQueue = mockDb.tables.sync_queue.find(
      q => q.entity_id === adv.id && q.action === 'DELETE'
    );
    expect(delQueue).toBeDefined();
    expect(delQueue.entity_type).toBe('advance');
  });

  test('4. Enforces account isolation for advance queries and mutations', () => {
    const otherAccount = 'acc_contractor_other_99';
    AdvanceRepository.recordAdvance({
      account_id: testAccountId,
      worker_id: 'w1',
      amount: 1200,
      date: '2026-10-12',
    });
    AdvanceRepository.recordAdvance({
      account_id: otherAccount,
      worker_id: 'w1',
      amount: 9999,
      date: '2026-10-12',
    });

    const myAdvances = AdvanceRepository.getAll(testAccountId);
    expect(myAdvances.length).toBe(1);
    expect(myAdvances[0].amount).toBe(1200);

    const otherAdvances = AdvanceRepository.getAll(otherAccount);
    expect(otherAdvances.length).toBe(1);
    expect(otherAdvances[0].amount).toBe(9999);
  });

  test('5. SyncManager processes pending advance deletions via ApiClient.deleteAdvance', async () => {
    (ApiClient.deleteAdvance as jest.Mock).mockResolvedValue({ success: true, message: 'Deleted' });
    (ApiClient.syncPull as jest.Mock).mockResolvedValue({ workers: [], sites: [], attendance: [], advances: [] });

    const adv = AdvanceRepository.recordAdvance({
      account_id: testAccountId,
      worker_id: 'w1',
      amount: 500,
      date: '2026-10-02',
    });

    AdvanceRepository.delete(adv.id, testAccountId);

    // Mock session
    const { AuthStorage } = require('../src/storage/authStorage');
    jest.spyOn(AuthStorage, 'getSession').mockResolvedValue({
      token: 'valid_jwt_token',
      accountId: testAccountId,
      phone: '9876543210',
    });

    const success = await SyncManager.triggerSync();
    expect(success).toBe(true);
    expect(ApiClient.deleteAdvance).toHaveBeenCalledWith(adv.id);
  });

  test('6. AdvancesScreen renders summary cards, list, and handles Give Advance modal', async () => {
    AdvanceRepository.recordAdvance({
      account_id: testAccountId,
      worker_id: 'w1',
      amount: 1500,
      date: '2026-10-15',
      note: 'Diwali bonus advance',
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <AdvancesScreen accountId={testAccountId} onNavigateHome={jest.fn()} />
      );
    });

    const root = renderer!.root;

    // Check title and subtitle
    const textNodes = root.findAllByType(require('react-native').Text);
    const textStrings = textNodes.map(t => t.props.children).flat().filter(Boolean);

    expect(textStrings.some(s => typeof s === 'string' && s.includes('Advances'))).toBe(true);
    expect(textStrings.some(s => typeof s === 'string' && s.includes('Monthly Advances'))).toBe(true);
    expect(textStrings.some(s => typeof s === 'string' && s.includes('Total Advances'))).toBe(true);
    expect(textStrings.some(s => typeof s === 'string' && s.includes('Ramesh Kumar'))).toBe(true);
    expect(textStrings.some(s => typeof s === 'string' && s.includes('1,500'))).toBe(true);

    // Open Give Advance Modal
    const giveBtn = root.findAllByType(require('react-native').TouchableOpacity).find(
      t => t.props.accessibilityLabel === '+ Give Advance' || t.props.accessibilityLabel === 'Give Advance'
    );
    expect(giveBtn).toBeTruthy();

    await act(async () => {
      giveBtn!.props.onPress();
    });

    // Check modal appears with quick amounts (₹500, ₹1,000, ₹2,000, ₹5,000)
    const modalTexts = root.findAllByType(require('react-native').Text).map(t => t.props.children).flat();
    expect(modalTexts.some(s => typeof s === 'string' && s.includes('₹500'))).toBe(true);
    expect(modalTexts.some(s => typeof s === 'string' && s.includes('₹1,000'))).toBe(true);
    expect(modalTexts.some(s => typeof s === 'string' && s.includes('₹2,000'))).toBe(true);
    expect(modalTexts.some(s => typeof s === 'string' && s.includes('₹5,000'))).toBe(true);
  });

  test('7. Delete confirmation dialog displays exact PWA wording with payroll removal warning', async () => {
    const adv = AdvanceRepository.recordAdvance({
      account_id: testAccountId,
      worker_id: 'w1',
      amount: 2000,
      date: '2026-10-25',
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <AdvancesScreen accountId={testAccountId} onNavigateHome={jest.fn()} />
      );
    });

    const root = renderer!.root;

    // Find delete button on advance card
    const deleteBtn = root.findAllByType(require('react-native').TouchableOpacity).find(
      t => t.props.accessibilityLabel && t.props.accessibilityLabel.includes('Delete advance of ₹2000')
    );
    expect(deleteBtn).toBeTruthy();

    await act(async () => {
      deleteBtn!.props.onPress();
    });

    // Verify confirmation modal wording
    const textNodes = root.findAllByType(require('react-native').Text);
    const allText = textNodes.map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : t.props.children)).join(' ');

    expect(allText).toContain('Are you sure you want to delete this advance payment');
    expect(allText).toContain('This deduction will be removed from payroll');
  });
});
