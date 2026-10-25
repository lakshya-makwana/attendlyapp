import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SiteAnalyticsScreen } from '../src/screens/SiteAnalyticsScreen';
import { ApiClient } from '../src/api/client';
import { open } from '@op-engineering/op-sqlite';
import { _resetDatabaseForTesting } from '../src/db/database';
import { Share } from 'react-native';

jest.mock('../src/api/client', () => ({
  ApiClient: {
    getSiteAnalytics: jest.fn(),
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

        if (q.includes('FROM sites')) {
          return { rows: tables.sites };
        }

        if (q.includes('FROM workers')) {
          return { rows: tables.workers };
        }

        if (q.includes('FROM worker_wage_history')) {
          return { rows: tables.worker_wage_history };
        }

        if (q.includes('FROM attendance')) {
          let rows = [...tables.attendance];
          if (q.includes('date >= ? AND date <= ? AND account_id = ?')) {
            rows = rows.filter(
              r => r.date >= params[0] && r.date <= params[1] && r.account_id === params[2]
            );
          }
          return { rows };
        }

        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

describe('SiteAnalyticsScreen Parity Suite', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  const accountId = 'acc_test_sanalytics';

  beforeEach(() => {
    jest.clearAllMocks();
    _resetDatabaseForTesting();
    mockDb = createMockDb();
    (open as jest.Mock).mockReturnValue(mockDb);

    // Seed sites
    mockDb.tables.sites.push(
      {
        id: 'site_alpha',
        account_id: accountId,
        name: 'Metro Line Pier 4',
        location: 'Sector 62',
        is_active: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        sync_status: 'SYNCED',
      },
      {
        id: 'site_beta',
        account_id: accountId,
        name: 'Riverside Bridge',
        location: 'North River',
        is_active: 0, // Inactive but had historical work
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        sync_status: 'SYNCED',
      }
    );

    // Seed workers
    mockDb.tables.workers.push(
      {
        id: 'w1',
        account_id: accountId,
        name: 'Amit Sharma',
        daily_wage: 700,
        is_active: 1,
      },
      {
        id: 'w2',
        account_id: accountId,
        name: 'Sunil Kumar',
        daily_wage: 600,
        is_active: 1,
      }
    );

    mockDb.tables.worker_wage_history.push(
      {
        id: 'wh1',
        account_id: accountId,
        worker_id: 'w1',
        daily_wage: 700,
        effective_from: '2026-10-01',
      },
      {
        id: 'wh2',
        account_id: accountId,
        worker_id: 'w2',
        daily_wage: 600,
        effective_from: '2026-10-01',
      }
    );

    // Seed attendance for October 2026
    mockDb.tables.attendance.push(
      {
        id: 'att_s1',
        account_id: accountId,
        worker_id: 'w1',
        site_id: 'site_alpha',
        date: '2026-10-10',
        work_units: 1.0,
      },
      {
        id: 'att_s2',
        account_id: accountId,
        worker_id: 'w2',
        site_id: 'site_alpha',
        date: '2026-10-10',
        work_units: 1.0,
      },
      {
        id: 'att_s3',
        account_id: accountId,
        worker_id: 'w1',
        site_id: 'site_beta',
        date: '2026-10-12',
        work_units: 0.5,
      }
    );

    (ApiClient.getSiteAnalytics as jest.Mock).mockResolvedValue({
      year: 2026,
      month: 10,
      total_active_sites: 1,
      total_unique_workers: 2,
      total_work_units: 2.5,
      total_labour_expense: 1650.0,
      sites: [
        {
          site_id: 'site_alpha',
          site_name: 'Metro Line Pier 4',
          location: 'Sector 62',
          is_active: true,
          unique_worker_count: 2,
          total_work_units: 2.0,
          total_labour_expense: 1300.0,
          worker_breakdown: [
            { worker_id: 'w1', worker_name: 'Amit Sharma', daily_wage: 700, work_units: 1.0, wage_earned: 700 },
            { worker_id: 'w2', worker_name: 'Sunil Kumar', daily_wage: 600, work_units: 1.0, wage_earned: 600 },
          ],
          date_breakdown: [
            { date: '2026-10-10', work_units: 2.0, daily_wage: 650, wage_earned: 1300 },
          ],
        },
        {
          site_id: 'site_beta',
          site_name: 'Riverside Bridge',
          location: 'North River',
          is_active: false,
          unique_worker_count: 1,
          total_work_units: 0.5,
          total_labour_expense: 350.0,
          worker_breakdown: [
            { worker_id: 'w1', worker_name: 'Amit Sharma', daily_wage: 700, work_units: 0.5, wage_earned: 350 },
          ],
          date_breakdown: [
            { date: '2026-10-12', work_units: 0.5, daily_wage: 700, wage_earned: 350 },
          ],
        },
      ],
    });
  });

  it('renders 4 KPI cards: Active Sites, Unique Workers, Total Units, Total Labour Expense', async () => {
    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <SiteAnalyticsScreen
          accountId={accountId}
          onBack={jest.fn()}
        />
      );
    });

    const root = renderer.root;
    const textNodes = root.findAllByType('Text').map((t: any) => t.props.children);
    const textString = JSON.stringify(textNodes);

    expect(textString).toContain('ACTIVE SITES');
    expect(textString).toContain('UNIQUE WORKERS');
    expect(textString).toContain('TOTAL UNITS');
    expect(textString).toContain('TOTAL EXPENSE');
    expect(textString).toContain('₹1,650');
  });

  it('renders site breakdown cards and displays historical attribution for inactive sites', async () => {
    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <SiteAnalyticsScreen
          accountId={accountId}
          onBack={jest.fn()}
        />
      );
    });

    const root = renderer.root;
    const textNodes = root.findAllByType('Text').map((t: any) => t.props.children);
    const textString = JSON.stringify(textNodes);

    expect(textString).toContain('Metro Line Pier 4');
    expect(textString).toContain('Riverside Bridge');
    expect(textString).toContain('Inactive');
  });

  it('opens Site Labour Report modal and supports native Share.share', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);

    let renderer: any;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <SiteAnalyticsScreen
          accountId={accountId}
          onBack={jest.fn()}
        />
      );
    });

    const root = renderer.root;
    const siteCards = root.findAllByProps({ accessibilityRole: 'button' });
    const metroCard = siteCards.find((c: any) =>
      c.props.accessibilityLabel && c.props.accessibilityLabel.includes('Metro Line Pier 4')
    );

    expect(metroCard).toBeTruthy();

    // Tap site card to open modal
    await act(async () => {
      metroCard.props.onPress();
    });

    // Check modal contents
    const modalTexts = root.findAllByType('Text').map((t: any) => t.props.children);
    const modalString = JSON.stringify(modalTexts);
    expect(modalString).toContain('Site Labour Report');
    expect(modalString).toContain('WORKERS DEPLOYED');

    // Tap share report button
    const shareBtn = root.findByProps({ accessibilityLabel: 'Share site report' });
    expect(shareBtn).toBeTruthy();

    await act(async () => {
      shareBtn.props.onPress();
    });

    expect(shareSpy).toHaveBeenCalled();
    shareSpy.mockRestore();
  });
});
