import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { DashboardScreen } from '../src/screens/DashboardScreen';
import { WorkerRepository } from '../src/repositories/workerRepository';
import { SiteRepository } from '../src/repositories/siteRepository';
import { AttendanceRepository } from '../src/repositories/attendanceRepository';
import { AdvanceRepository } from '../src/repositories/advanceRepository';
import { ApiClient } from '../src/api/client';
import { formatDateIndian, formatCurrency } from '../src/utils/dateUtils';

describe('Dashboard and Navigation Parity', () => {
  const accountId = 'acc_test_contractor_001';
  let onNavigateMock: jest.Mock;
  let onLogoutMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    onNavigateMock = jest.fn();
    onLogoutMock = jest.fn();

    // Default mock data in repositories
    jest.spyOn(SiteRepository, 'getAll').mockImplementation((_accId, onlyActive) => {
      const all = [
        {
          id: 'site_001',
          account_id: accountId,
          name: 'Metro Line Pier 42',
          location: 'Delhi',
          is_active: true,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
          sync_status: 'SYNCED' as const,
        },
        {
          id: 'site_002',
          account_id: accountId,
          name: 'Sunrise Residency Tower B',
          location: 'Noida',
          is_active: true,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
          sync_status: 'SYNCED' as const,
        },
      ];
      return onlyActive ? all.filter(s => s.is_active) : all;
    });

    jest.spyOn(WorkerRepository, 'getAll').mockReturnValue([
      {
        id: 'w_001',
        account_id: accountId,
        name: 'Ramesh Kumar',
        daily_wage: 600,
        phone: '9876543210',
        is_active: true,
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
        sync_status: 'SYNCED' as const,
      },
      {
        id: 'w_002',
        account_id: accountId,
        name: 'Suresh Yadav',
        daily_wage: 800,
        phone: '9876543211',
        is_active: true,
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
        sync_status: 'SYNCED' as const,
      },
    ]);

    jest.spyOn(AttendanceRepository, 'getByDate').mockReturnValue([
      {
        id: 'att_001',
        account_id: accountId,
        worker_id: 'w_001',
        site_id: 'site_001',
        date: '2026-10-25',
        work_units: 1.0,
        created_at: '2026-10-25T08:00:00Z',
        updated_at: '2026-10-25T08:00:00Z',
        sync_status: 'SYNCED' as const,
      },
      {
        id: 'att_002',
        account_id: accountId,
        worker_id: 'w_002',
        site_id: 'site_002',
        date: '2026-10-25',
        work_units: 0.5,
        created_at: '2026-10-25T08:00:00Z',
        updated_at: '2026-10-25T08:00:00Z',
        sync_status: 'SYNCED' as const,
      },
    ]);

    jest.spyOn(AttendanceRepository, 'getByDateRange').mockReturnValue([
      {
        id: 'att_001',
        account_id: accountId,
        worker_id: 'w_001',
        site_id: 'site_001',
        date: '2026-10-25',
        work_units: 1.0,
        created_at: '2026-10-25T08:00:00Z',
        updated_at: '2026-10-25T08:00:00Z',
        sync_status: 'SYNCED' as const,
      },
      {
        id: 'att_002',
        account_id: accountId,
        worker_id: 'w_002',
        site_id: 'site_002',
        date: '2026-10-25',
        work_units: 0.5,
        created_at: '2026-10-25T08:00:00Z',
        updated_at: '2026-10-25T08:00:00Z',
        sync_status: 'SYNCED' as const,
      },
      {
        id: 'att_003',
        account_id: accountId,
        worker_id: 'w_001',
        site_id: 'site_001',
        date: '2026-10-10',
        work_units: 1.5,
        created_at: '2026-10-10T08:00:00Z',
        updated_at: '2026-10-10T08:00:00Z',
        sync_status: 'SYNCED' as const,
      },
    ]);

    jest.spyOn(AdvanceRepository, 'getByDateRange').mockReturnValue([
      {
        id: 'adv_001',
        account_id: accountId,
        worker_id: 'w_001',
        amount: 500,
        date: '2026-10-12',
        note: 'Festival advance',
        created_at: '2026-10-12T00:00:00Z',
        updated_at: '2026-10-12T00:00:00Z',
        sync_status: 'SYNCED' as const,
      },
    ]);

    jest.spyOn(ApiClient, 'getDashboardSummary').mockResolvedValue({
      today: {
        date: '2026-10-25',
        active_workers: 2,
        present_workers: 2,
        absent_workers: 0,
        marked_workers: 2,
        active_sites: 2,
        total_work_units: 1.5,
        total_earnings: 1000.0,
      },
      month: {
        year: 2026,
        month: 10,
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        total_work_units: 3.0,
        gross_earnings: 1900.0,
        total_advances: 500.0,
        net_payable: 1400.0,
        sites_breakdown: [
          {
            site_id: 'site_001',
            site_name: 'Metro Line Pier 42',
            is_active: true,
            unique_worker_count: 1,
            total_work_units: 2.5,
            total_labour_expense: 1500.0,
          },
          {
            site_id: 'site_002',
            site_name: 'Sunrise Residency Tower B',
            is_active: true,
            unique_worker_count: 1,
            total_work_units: 0.5,
            total_labour_expense: 400.0,
          },
        ],
      },
      overview: {
        active_workers: 2,
        active_sites: 2,
        total_workers: 2,
        total_sites: 2,
      },
    });
  });

  test('utility formatDateIndian formats correctly', () => {
    expect(formatDateIndian('2026-10-25')).toBe('25/10/2026');
    expect(formatDateIndian(new Date(2026, 9, 5))).toBe('05/10/2026');
  });

  test('utility formatCurrency formats Indian Rupees correctly', () => {
    expect(formatCurrency(0)).toBe('₹0');
    expect(formatCurrency(248500)).toBe('₹2,48,500');
    expect(formatCurrency('1900.50')).toBe('₹1,901');
    expect(formatCurrency(null)).toBe('₹0');
  });

  test('renders all 4 financial summary cards with accurate calculations', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DashboardScreen
          accountId={accountId}
          onNavigate={onNavigateMock}
          onLogout={onLogoutMock}
        />
      );
      // Wait for async loadData to complete
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    });

    const root = renderer!.root;

    // Check financial card labels
    const textNodes = root.findAllByType(Text).map(node => node.props.children);
    expect(textNodes).toContain('Total Work Units');
    expect(textNodes).toContain('Gross Labour');
    expect(textNodes).toContain('Advances Deducted');
    expect(textNodes).toContain('Net Payable');

    // Values: 3.0 units, ₹1,900 gross, ₹500 advances, ₹1,400 net
    expect(textNodes).toContain('3.0');
    expect(textNodes).toContain('₹1,900');
    expect(textNodes).toContain('₹500');
    expect(textNodes).toContain('₹1,400');
  });

  test('renders today activity statistics and Indian date', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DashboardScreen
          accountId={accountId}
          onNavigate={onNavigateMock}
          onLogout={onLogoutMock}
        />
      );
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    });

    const root = renderer!.root;
    const textNodes = root.findAllByType(Text).map(node => node.props.children);

    expect(textNodes).toContain("TODAY'S ACTIVITY");
    expect(textNodes).toContain('Marked Workers');
    expect(textNodes).toContain('Today Units');
    expect(textNodes).toContain('Active Sites');

    // Today marked workers = 2, today units = 1.5, active sites = 2
    expect(textNodes).toContain(2);
    expect(textNodes).toContain('1.5');
  });

  test('renders 4 quick action cards and navigates to correct destinations', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DashboardScreen
          accountId={accountId}
          onNavigate={onNavigateMock}
          onLogout={onLogoutMock}
        />
      );
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    });

    const root = renderer!.root;

    // Find touchable actions
    const touchables = root.findAllByProps({ accessibilityRole: 'button' });

    // Find Quick Actions
    const attendanceBtn = touchables.find(t => t.props.accessibilityLabel === 'Navigate to Attendance');
    expect(attendanceBtn).toBeTruthy();
    ReactTestRenderer.act(() => {
      attendanceBtn!.props.onPress();
    });
    expect(onNavigateMock).toHaveBeenCalledWith('attendance');

    const workersBtn = touchables.find(t => t.props.accessibilityLabel === 'Navigate to Workers');
    expect(workersBtn).toBeTruthy();
    ReactTestRenderer.act(() => {
      workersBtn!.props.onPress();
    });
    expect(onNavigateMock).toHaveBeenCalledWith('workers');

    const advancesBtn = touchables.find(t => t.props.accessibilityLabel === 'Navigate to Advances');
    expect(advancesBtn).toBeTruthy();
    ReactTestRenderer.act(() => {
      advancesBtn!.props.onPress();
    });
    expect(onNavigateMock).toHaveBeenCalledWith('advances');

    const sitesBtn = touchables.find(t => t.props.accessibilityLabel === 'Navigate to Sites');
    expect(sitesBtn).toBeTruthy();
    ReactTestRenderer.act(() => {
      sitesBtn!.props.onPress();
    });
    expect(onNavigateMock).toHaveBeenCalledWith('sites');
  });

  test('renders site overview breakdown and handles empty state', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DashboardScreen
          accountId={accountId}
          onNavigate={onNavigateMock}
          onLogout={onLogoutMock}
        />
      );
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    });

    const root = renderer!.root;
    const textNodes = root.findAllByType(Text).map(node => node.props.children);

    expect(textNodes).toContain('SITE OVERVIEW');
    expect(textNodes).toContain('View All');
    expect(textNodes).toContain('Metro Line Pier 42');
    expect(textNodes).toContain('Sunrise Residency Tower B');
    expect(textNodes).toContain('₹1,500');
    expect(textNodes).toContain('₹400');

    // Test empty state
    jest.spyOn(SiteRepository, 'getAll').mockReturnValue([]);
    jest.spyOn(ApiClient, 'getDashboardSummary').mockResolvedValue({
      today: { marked_workers: 0, total_work_units: 0, active_sites: 0 },
      month: { total_work_units: 0, gross_earnings: 0, total_advances: 0, net_payable: 0, sites_breakdown: [] },
      overview: { active_workers: 0, active_sites: 0, total_workers: 0, total_sites: 0 },
    });

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DashboardScreen
          accountId={accountId}
          onNavigate={onNavigateMock}
          onLogout={onLogoutMock}
        />
      );
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    });

    const emptyTextNodes = renderer!.root.findAllByType(Text).map(node => node.props.children);
    expect(emptyTextNodes).toContain('No active work sites');
    expect(emptyTextNodes).toContain('Sites with recorded attendance or active status will appear here.');
  });

  test('offline resilience: calculates values from SQLite when backend is unreachable', async () => {
    jest.spyOn(ApiClient, 'getDashboardSummary').mockRejectedValue(new Error('Network offline'));

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DashboardScreen
          accountId={accountId}
          onNavigate={onNavigateMock}
          onLogout={onLogoutMock}
        />
      );
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    });

    const root = renderer!.root;
    const textNodes = root.findAllByType(Text).map(node => node.props.children);

    // Should display local calculated values without error:
    // Units: 1.0 + 0.5 + 1.5 = 3.0
    // Gross: (1.0*600) + (0.5*800) + (1.5*600) = 600 + 400 + 900 = 1900
    // Advances: 500
    // Net: 1400
    expect(textNodes).toContain('3.0');
    expect(textNodes).toContain('₹1,900');
    expect(textNodes).toContain('₹500');
    expect(textNodes).toContain('₹1,400');
  });
});
