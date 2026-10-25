import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SitesScreen } from '../src/screens/SitesScreen';
import { SiteRepository } from '../src/repositories/siteRepository';
import { open } from '@op-engineering/op-sqlite';
import { _resetDatabaseForTesting } from '../src/db/database';

function createMockSiteDb() {
  const tables: Record<string, any[]> = {
    app_metadata: [],
    sites: [],
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

        if (q.includes('FROM attendance')) {
          let rows = [...tables.attendance];
          if (q.includes('site_id = ?')) {
            rows = rows.filter(r => r.site_id === params[0]);
          }
          if (q.includes('account_id = ?')) {
            const accIdx = q.indexOf('site_id = ?') !== -1 ? 1 : 0;
            rows = rows.filter(r => r.account_id === params[accIdx]);
          }
          if (q.includes('COUNT(*)')) {
            return { rows: [{ count: rows.length }] };
          }
          return { rows };
        }

        if (q.includes('FROM sites')) {
          let rows = [...tables.sites];
          if (q.includes('WHERE id = ? AND account_id = ?')) {
            rows = rows.filter(r => r.id === params[0] && r.account_id === params[1]);
          } else if (q.includes('WHERE id = ?')) {
            rows = rows.filter(r => r.id === params[0]);
          } else if (q.includes('WHERE account_id = ? AND is_active = 1')) {
            rows = rows.filter(r => r.account_id === params[0] && r.is_active === 1);
          } else if (q.includes('WHERE account_id = ?')) {
            rows = rows.filter(r => r.account_id === params[0]);
          }
          return { rows };
        }
      }

      // INSERT OR REPLACE INTO sites
      if (q.includes('INSERT OR REPLACE INTO sites')) {
        const [id, account_id, name, location, is_active, created_at, updated_at, sync_status] = params;
        const existingIdx = tables.sites.findIndex(r => r.id === id);
        const record = {
          id,
          account_id,
          name,
          location,
          is_active: Number(is_active),
          created_at,
          updated_at,
          sync_status: sync_status || (q.includes("'SYNCED'") ? 'SYNCED' : 'PENDING'),
        };
        if (existingIdx >= 0) {
          tables.sites[existingIdx] = record;
        } else {
          tables.sites.push(record);
        }
        return { rows: [] };
      }

      // INSERT OR REPLACE INTO sync_queue
      if (q.includes('INSERT OR REPLACE INTO sync_queue')) {
        let id: string,
          account_id: string,
          entity_type: string,
          entity_id: string,
          action: string,
          payload: string,
          created_at: string,
          status: string;

        if (params.length === 5) {
          [id, account_id, entity_id, payload, created_at] = params;
          entity_type = 'site';
          action = q.includes("'DELETE'") ? 'DELETE' : 'UPSERT';
          status = 'PENDING';
        } else {
          [id, account_id, entity_type, entity_id, action, payload, created_at, status] = params;
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
          status,
        };
        if (existingIdx >= 0) {
          tables.sync_queue[existingIdx] = record;
        } else {
          tables.sync_queue.push(record);
        }
        return { rows: [] };
      }

      // DELETE FROM sites
      if (q.startsWith('DELETE FROM sites')) {
        const [id, account_id] = params;
        tables.sites = tables.sites.filter(r => !(r.id === id && r.account_id === account_id));
        return { rows: [] };
      }

      // DELETE FROM sync_queue
      if (q.startsWith('DELETE FROM sync_queue')) {
        if (q.includes('entity_id = ? AND account_id = ?')) {
          const [entity_id, account_id] = params;
          tables.sync_queue = tables.sync_queue.filter(
            r => !(r.entity_id === entity_id && r.account_id === account_id)
          );
        } else if (q.includes('WHERE id = ?')) {
          tables.sync_queue = tables.sync_queue.filter(r => r.id !== params[0]);
        }
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

describe('Sites Management Parity — Repository, Persistence, and Business Rules', () => {
  let mockDb: ReturnType<typeof createMockSiteDb>;
  const testAccountId = 'contractor_site_acc_001';

  beforeEach(() => {
    mockDb = createMockSiteDb();
    _resetDatabaseForTesting();
    (open as jest.Mock).mockReturnValue(mockDb);
  });

  test('creates a new work site with name, location, and queues durable UPSERT', () => {
    const site = SiteRepository.save({
      account_id: testAccountId,
      name: 'Bandra Horizon Tower',
      location: 'Near Metro Station, Sector 4',
      is_active: true,
    });

    expect(site.id).toBeDefined();
    expect(site.name).toBe('Bandra Horizon Tower');
    expect(site.location).toBe('Near Metro Station, Sector 4');
    expect(site.is_active).toBe(true);

    // Verify persisted in SQLite
    const inDb = mockDb.tables.sites.find(s => s.id === site.id);
    expect(inDb).toBeDefined();
    expect(inDb.name).toBe('Bandra Horizon Tower');
    expect(inDb.location).toBe('Near Metro Station, Sector 4');
    expect(inDb.is_active).toBe(1);

    // Verify queued for sync
    const queueItem = mockDb.tables.sync_queue.find(q => q.entity_id === site.id);
    expect(queueItem).toBeDefined();
    expect(queueItem.action).toBe('UPSERT');
    const payload = JSON.parse(queueItem.payload);
    expect(payload.name).toBe('Bandra Horizon Tower');
    expect(payload.location).toBe('Near Metro Station, Sector 4');
    expect(payload.active).toBe(true);
  });

  test('edits a site while preserving stable site ID and updating timestamps', () => {
    const original = SiteRepository.save({
      account_id: testAccountId,
      name: 'Original Site Name',
      location: 'Old Address',
      is_active: true,
    });

    const updated = SiteRepository.save({
      id: original.id,
      account_id: testAccountId,
      name: 'Renamed Site Name',
      location: 'New Address, Sector 12',
      is_active: true,
      created_at: original.created_at,
    });

    expect(updated.id).toBe(original.id);
    expect(updated.name).toBe('Renamed Site Name');
    expect(updated.location).toBe('New Address, Sector 12');

    const inDb = mockDb.tables.sites.find(s => s.id === original.id);
    expect(inDb.name).toBe('Renamed Site Name');
    expect(inDb.location).toBe('New Address, Sector 12');
  });

  test('toggles site status between active and inactive without destroying history', () => {
    const site = SiteRepository.save({
      account_id: testAccountId,
      name: 'Metro Line 3',
      is_active: true,
    });

    // Toggle 1 -> Inactive
    const deactivated = SiteRepository.toggleStatus(site.id, testAccountId);
    expect(deactivated?.is_active).toBe(false);

    let inDb = mockDb.tables.sites.find(s => s.id === site.id);
    expect(inDb.is_active).toBe(0);

    // Toggle 2 -> Reactivate
    const reactivated = SiteRepository.toggleStatus(site.id, testAccountId);
    expect(reactivated?.is_active).toBe(true);

    inDb = mockDb.tables.sites.find(s => s.id === site.id);
    expect(inDb.is_active).toBe(1);
  });

  test('blocks hard deletion of a site when historical attendance exists', () => {
    const site = SiteRepository.save({
      account_id: testAccountId,
      name: 'Historic Project Alpha',
      is_active: true,
    });

    // Add historical attendance record referencing this site
    mockDb.tables.attendance.push({
      id: 'att_001',
      account_id: testAccountId,
      site_id: site.id,
      worker_id: 'w_001',
      date: '2026-10-15',
      work_units: 1.0,
    });

    expect(SiteRepository.getAttendanceCount(site.id, testAccountId)).toBe(1);

    // Attempt delete
    expect(() => {
      SiteRepository.delete(site.id, testAccountId);
    }).toThrow(
      "Cannot delete 'Historic Project Alpha' because it has 1 historical attendance records. Please deactivate the site instead."
    );

    // Verify site is still present in database
    const inDb = mockDb.tables.sites.find(s => s.id === site.id);
    expect(inDb).toBeDefined();
  });

  test('safely deletes an unused site with 0 historical attendance records and enqueues DELETE', () => {
    const site = SiteRepository.save({
      account_id: testAccountId,
      name: 'Unused Test Site',
      is_active: true,
    });

    expect(SiteRepository.getAttendanceCount(site.id, testAccountId)).toBe(0);

    SiteRepository.delete(site.id, testAccountId);

    // Verify removed from database
    const inDb = mockDb.tables.sites.find(s => s.id === site.id);
    expect(inDb).toBeUndefined();

    // Verify DELETE operation queued for backend sync
    const delQueue = mockDb.tables.sync_queue.find(
      q => q.entity_id === site.id && q.action === 'DELETE'
    );
    expect(delQueue).toBeDefined();
  });

  test('saveBatchFromSync preserves pending local edits against stale server pulls', () => {
    // 1. Local site with pending unsynced changes
    mockDb.tables.sites.push({
      id: 'site_sync_001',
      account_id: testAccountId,
      name: 'Local Unsynced Name',
      location: 'Local Location',
      is_active: 1,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-25T10:00:00.000Z',
      sync_status: 'PENDING',
    });

    // 2. Server pull sends stale name
    SiteRepository.saveBatchFromSync(
      [
        {
          id: 'site_sync_001',
          name: 'Stale Server Name',
          location: 'Old Server Loc',
          active: true,
          created_at: '2026-10-01T00:00:00.000Z',
          updated_at: '2026-10-20T00:00:00.000Z',
        },
      ],
      testAccountId
    );

    // Verify local record was NOT overwritten
    const site = mockDb.tables.sites.find(s => s.id === 'site_sync_001');
    expect(site.name).toBe('Local Unsynced Name');
    expect(site.location).toBe('Local Location');
  });
});

describe('SitesScreen Component Visual and Interaction Parity', () => {
  let mockDb: ReturnType<typeof createMockSiteDb>;
  const testAccountId = 'contractor_site_acc_001';

  beforeEach(() => {
    mockDb = createMockSiteDb();
    _resetDatabaseForTesting();
    (open as jest.Mock).mockReturnValue(mockDb);

    mockDb.tables.sites.push(
      {
        id: 's_1',
        account_id: testAccountId,
        name: 'Palm Residency Block A',
        location: 'Sector 62, Noida',
        is_active: 1,
        created_at: '2026-10-01',
        updated_at: '2026-10-01',
        sync_status: 'SYNCED',
      },
      {
        id: 's_2',
        account_id: testAccountId,
        name: 'Metro Station Plot 14',
        location: 'Line 3 Depot',
        is_active: 0,
        created_at: '2026-10-02',
        updated_at: '2026-10-02',
        sync_status: 'SYNCED',
      }
    );
  });

  test('renders sites list with active counts and site cards', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <SitesScreen accountId={testAccountId} onNavigateHome={() => {}} />
      );
    });

    const root = renderer!.root;
    const textNodes = root.findAllByType(Text).map(node => node.props.children);
    const textContent = textNodes.flat().join(' ');

    expect(textContent).toContain('Job Sites');
    expect(textContent).toContain('1 Active · 2 Total');
    expect(textContent).toContain('Palm Residency Block A');
    expect(textContent).toContain('Metro Station Plot 14');
    expect(textContent).toContain('Sector 62, Noida');
  });

  test('renders filter pills and search bar with proper accessibility', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <SitesScreen accountId={testAccountId} onNavigateHome={() => {}} />
      );
    });

    const root = renderer!.root;
    const allPill = root.findByProps({ accessibilityLabel: 'All sites, 2' });
    const activePill = root.findByProps({ accessibilityLabel: 'Active sites, 1' });
    const inactivePill = root.findByProps({ accessibilityLabel: 'Inactive sites, 1' });

    expect(allPill).toBeDefined();
    expect(activePill).toBeDefined();
    expect(inactivePill).toBeDefined();
  });

  test('filters sites when selecting inactive filter pill', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <SitesScreen accountId={testAccountId} onNavigateHome={() => {}} />
      );
    });

    const root = renderer!.root;
    const inactivePill = root.findByProps({ accessibilityLabel: 'Inactive sites, 1' });

    act(() => {
      inactivePill.props.onPress();
    });

    const textNodes = root.findAllByType(Text).map(node => node.props.children);
    const textContent = textNodes.flat().join(' ');

    expect(textContent).toContain('Metro Station Plot 14');
    expect(textContent).not.toContain('Palm Residency Block A');
  });
});
