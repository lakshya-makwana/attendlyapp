import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { Colors, Spacing, BorderRadius } from '../theme/tokens';
import { OfflineBanner } from '../components/Cards';
import { WorkerRepository } from '../repositories/workerRepository';
import { SiteRepository } from '../repositories/siteRepository';
import { AttendanceRepository } from '../repositories/attendanceRepository';
import { AdvanceRepository } from '../repositories/advanceRepository';
import { SyncManager } from '../sync/syncManager';
import { ApiClient } from '../api/client';
import {
  toLocalDateString,
  getMonthDateRange,
  formatDateIndian,
  formatCurrency,
} from '../utils/dateUtils';
import { Icon } from '../components/Icon';

export interface SiteOverviewItem {
  site_id: string;
  site_name: string;
  is_active: boolean;
  unique_worker_count: number;
  total_work_units: number;
  total_labour_expense: number;
}

interface DashboardScreenProps {
  accountId: string;
  onNavigate: (tab: 'attendance' | 'workers' | 'sites' | 'payroll' | 'advances') => void;
  onLogout: () => void;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  accountId,
  onNavigate,
  onLogout,
}) => {
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(currentDate.getMonth() + 1); // 1-indexed

  const [refreshing, setRefreshing] = useState(false);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [lockDialogVisible, setLockDialogVisible] = useState(false);

  const [syncState, setSyncState] = useState({
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncTime: null as string | null,
  });

  // Financial summary metrics
  const [monthWorkUnits, setMonthWorkUnits] = useState<number>(0);
  const [grossLabour, setGrossLabour] = useState<number>(0);
  const [advancesDeducted, setAdvancesDeducted] = useState<number>(0);
  const [netPayable, setNetPayable] = useState<number>(0);

  // Today's activity metrics
  const [todayMarkedWorkers, setTodayMarkedWorkers] = useState<number>(0);
  const [todayUnits, setTodayUnits] = useState<number>(0);
  const [activeSitesCount, setActiveSitesCount] = useState<number>(0);

  // Site-wise cost breakdown
  const [sitesBreakdown, setSitesBreakdown] = useState<SiteOverviewItem[]>([]);

  // Calculate list of available months (past 12 months)
  const availableMonths = React.useMemo(() => {
    const list = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      list.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
      });
    }
    return list;
  }, []);

  const loadData = useCallback(async () => {
    const todayStr = toLocalDateString();
    const { startDate, endDate } = getMonthDateRange(selectedYear, selectedMonth - 1);

    // 1. Compute instant local figures from SQLite
    const activeSites = SiteRepository.getAll(accountId, true);
    const allSites = SiteRepository.getAll(accountId, false);
    setActiveSitesCount(activeSites.length);

    // Today's attendance
    const todayAtt = AttendanceRepository.getByDate(todayStr, accountId);
    setTodayMarkedWorkers(todayAtt.length);
    const unitsToday = todayAtt.reduce((sum, a) => sum + Number(a.work_units || 0), 0);
    setTodayUnits(unitsToday);

    // Selected Month Attendance & Gross Labour
    const monthAtt = AttendanceRepository.getByDateRange(startDate, endDate, accountId);
    const allWorkers = WorkerRepository.getAll(accountId, false);
    const wageMap = new Map(allWorkers.map(w => [w.id, Number(w.daily_wage || 0)]));

    let totalUnits = 0;
    let totalGross = 0;

    // Site breakdown calculation from local DB
    const siteStatsMap = new Map<
      string,
      { uniqueWorkers: Set<string>; units: number; expense: number }
    >();

    for (const a of monthAtt) {
      const units = Number(a.work_units || 0);
      const wage = wageMap.get(a.worker_id) || 0;
      const earnings = units * wage;

      totalUnits += units;
      totalGross += earnings;

      if (a.site_id) {
        let stats = siteStatsMap.get(a.site_id);
        if (!stats) {
          stats = { uniqueWorkers: new Set<string>(), units: 0, expense: 0 };
          siteStatsMap.set(a.site_id, stats);
        }
        if (units > 0) {
          stats.uniqueWorkers.add(a.worker_id);
        }
        stats.units += units;
        stats.expense += earnings;
      }
    }

    setMonthWorkUnits(totalUnits);
    setGrossLabour(totalGross);

    // Selected Month Advances
    const monthAdv = AdvanceRepository.getByDateRange(startDate, endDate, accountId);
    const totalAdv = monthAdv.reduce((sum, adv) => sum + Number(adv.amount || 0), 0);
    setAdvancesDeducted(totalAdv);

    const calculatedNet = Math.max(0, totalGross - totalAdv);
    setNetPayable(calculatedNet);

    // Build local site breakdown list
    const localSitesList: SiteOverviewItem[] = [];
    for (const site of allSites) {
      const stats = siteStatsMap.get(site.id) || {
        uniqueWorkers: new Set<string>(),
        units: 0,
        expense: 0,
      };
      if (site.is_active || stats.units > 0) {
        localSitesList.push({
          site_id: site.id,
          site_name: site.name,
          is_active: site.is_active,
          unique_worker_count: stats.uniqueWorkers.size,
          total_work_units: stats.units,
          total_labour_expense: stats.expense,
        });
      }
    }
    localSitesList.sort((a, b) => {
      if (a.total_work_units > 0 && b.total_work_units === 0) return -1;
      if (a.total_work_units === 0 && b.total_work_units > 0) return 1;
      return b.total_labour_expense - a.total_labour_expense;
    });
    setSitesBreakdown(localSitesList);

    // 2. Fetch remote summary from backend if online
    try {
      const remote = await ApiClient.getDashboardSummary({
        date: todayStr,
        year: selectedYear,
        month: selectedMonth,
      });

      if (remote) {
        if (remote.today) {
          if (remote.today.marked_workers !== undefined) {
            setTodayMarkedWorkers(remote.today.marked_workers);
          }
          if (remote.today.total_work_units !== undefined) {
            setTodayUnits(Number(remote.today.total_work_units));
          }
          if (remote.today.active_sites !== undefined) {
            setActiveSitesCount(remote.today.active_sites);
          }
        }

        if (remote.month) {
          if (remote.month.total_work_units !== undefined) {
            setMonthWorkUnits(Number(remote.month.total_work_units));
          }
          if (remote.month.gross_earnings !== undefined) {
            setGrossLabour(Number(remote.month.gross_earnings));
          }
          if (remote.month.total_advances !== undefined) {
            setAdvancesDeducted(Number(remote.month.total_advances));
          }
          if (remote.month.net_payable !== undefined) {
            setNetPayable(Number(remote.month.net_payable));
          }

          if (Array.isArray(remote.month.sites_breakdown)) {
            const mappedBreakdown: SiteOverviewItem[] = remote.month.sites_breakdown.map((s: any) => ({
              site_id: s.site_id,
              site_name: s.site_name,
              is_active: Boolean(s.is_active),
              unique_worker_count: Number(s.unique_worker_count || 0),
              total_work_units: Number(s.total_work_units || 0),
              total_labour_expense: Number(s.total_labour_expense || 0),
            }));
            setSitesBreakdown(mappedBreakdown);
          }
        }
      }
    } catch {
      // Offline or network error: retain local SQLite figures transparently
    }
  }, [accountId, selectedYear, selectedMonth]);

  useEffect(() => {
    loadData();
    const unsub = SyncManager.subscribe(state => {
      setSyncState(state);
      loadData();
    });
    return unsub;
  }, [loadData]);

  async function handleRefresh() {
    setRefreshing(true);
    await SyncManager.triggerSync();
    await loadData();
    setRefreshing(false);
  }

  function handleSelectMonth(year: number, month: number) {
    setSelectedYear(year);
    setSelectedMonth(month);
    setMonthPickerVisible(false);
  }

  const selectedMonthLabel = `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`;
  const todayIndianDate = formatDateIndian(new Date());

  return (
    <View style={styles.container}>
      {/* 1. Header & Context Month Selector */}
      <View style={styles.headerContainer}>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle}>Overview</Text>
          <Text style={styles.headerSubtitle}>Operations & Financial Snapshot</Text>
        </View>

        <View style={styles.headerRightActions}>
          {/* Month Selector Pill */}
          <TouchableOpacity
            style={styles.monthPill}
            onPress={() => setMonthPickerVisible(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Select Month, current is ${selectedMonthLabel}`}
          >
            <Text style={styles.monthPillText}>{selectedMonthLabel}</Text>
            <Icon name="chevron-down" size={13} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>

          {/* Lock / Logout Button */}
          <TouchableOpacity
            style={styles.lockButton}
            onPress={() => setLockDialogVisible(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Lock Application"
          >
            <Icon name="lock" size={15} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Offline / Sync Banner */}
      <OfflineBanner isOnline={syncState.isOnline} pendingCount={syncState.pendingCount} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {/* 2. Premium Minimal Financial Summary: Net Payable Hero Card */}
        <View style={styles.heroCard}>
          {/* Hero Header: Month Label & Muted Navy Accent Detail */}
          <View style={styles.heroHeaderRow}>
            <View style={styles.heroAccentBadge}>
              <View style={styles.heroNavyDot} />
              <Text style={styles.heroLabelText}>Net Payable</Text>
            </View>
            <View style={styles.heroPeriodPill}>
              <Text style={styles.heroPeriodText}>{selectedMonthLabel}</Text>
            </View>
          </View>

          {/* Prominent Rupee Amount */}
          <Text style={styles.heroAmount}>{formatCurrency(netPayable)}</Text>

          {/* Explanation Subtitle */}
          <Text style={styles.heroExplanation}>
            Disbursable balance after advances deducted
          </Text>

          {/* Hairline Hero Divider */}
          <View style={styles.heroDivider} />

          {/* Supporting Figures: Gross Labour & Advances Deducted */}
          <View style={styles.heroBreakdownRow}>
            <View style={styles.heroBreakdownCol}>
              <Text style={styles.heroSubLabel}>Gross Labour</Text>
              <Text style={styles.heroSubValue}>{formatCurrency(grossLabour)}</Text>
            </View>

            <View style={styles.heroVerticalDivider} />

            <View style={styles.heroBreakdownCol}>
              <Text style={styles.heroSubLabel}>Advances Deducted</Text>
              <Text style={styles.heroSubValue}>{formatCurrency(advancesDeducted)}</Text>
            </View>
          </View>
        </View>

        {/* Supporting Metric Card: Total Work Units */}
        <View style={styles.workUnitsCard}>
          <View style={styles.workUnitsLeft}>
            <View style={styles.workUnitsIconBadge}>
              <Icon name="grid-2x2" size={16} color={Colors.navyAccent} strokeWidth={2} />
            </View>
            <View style={styles.workUnitsTextGroup}>
              <Text style={styles.workUnitsLabel}>Total Work Units</Text>
              <Text style={styles.workUnitsSubtext}>{selectedMonthLabel} cumulative</Text>
            </View>
          </View>
          <View style={styles.workUnitsRight}>
            <Text style={styles.workUnitsValue}>{monthWorkUnits.toFixed(1)}</Text>
            <Text style={styles.workUnitsUnitLabel}>units</Text>
          </View>
        </View>

        {/* 3. Today's Activity Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeaderLeft}>
              <View style={styles.navyActivityDot} />
              <Text style={styles.sectionHeading}>TODAY'S ACTIVITY</Text>
            </View>
            <Text style={styles.sectionHeaderDate}>{todayIndianDate}</Text>
          </View>

          <View style={styles.activityGrid}>
            {/* Box 1: Marked Workers */}
            <View style={styles.activityCard}>
              <View style={styles.activityCardTop}>
                <Text style={styles.activityCardValue}>{todayMarkedWorkers}</Text>
                <View style={styles.activityIconBadgeMuted}>
                  <Icon name="users" size={14} color={Colors.textSecondary} strokeWidth={1.8} />
                </View>
              </View>
              <Text style={styles.activityCardLabel}>Marked Workers</Text>
            </View>

            {/* Box 2: Today Units (Navy Restrained Accent) */}
            <View style={[styles.activityCard, styles.activityCardNavy]}>
              <View style={styles.activityCardTop}>
                <Text style={styles.activityCardValue}>{todayUnits.toFixed(1)}</Text>
                <View style={styles.activityIconBadgeNavy}>
                  <Icon name="calendar-check" size={14} color={Colors.navyAccent} strokeWidth={2} />
                </View>
              </View>
              <Text style={[styles.activityCardLabel, styles.activityCardLabelNavy]}>
                Today Units
              </Text>
            </View>

            {/* Box 3: Active Sites */}
            <View style={styles.activityCard}>
              <View style={styles.activityCardTop}>
                <Text style={styles.activityCardValue}>{activeSitesCount}</Text>
                <View style={styles.activityIconBadgeMuted}>
                  <Icon name="building-2" size={14} color={Colors.textSecondary} strokeWidth={1.8} />
                </View>
              </View>
              <Text style={styles.activityCardLabel}>Active Sites</Text>
            </View>
          </View>
        </View>

        {/* 4. Quick Actions Section */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeading}>QUICK ACTIONS</Text>

          <View style={styles.quickActionsGrid}>
            {/* Action 1: Attendance */}
            <TouchableOpacity
              style={styles.quickActionTile}
              onPress={() => onNavigate('attendance')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Navigate to Attendance"
            >
              <View style={styles.quickActionIconBadge}>
                <Icon name="calendar-check" size={18} color={Colors.navyAccent} strokeWidth={2} />
              </View>
              <Text style={styles.quickActionLabel}>Attendance</Text>
            </TouchableOpacity>

            {/* Action 2: Workers */}
            <TouchableOpacity
              style={styles.quickActionTile}
              onPress={() => onNavigate('workers')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Navigate to Workers"
            >
              <View style={styles.quickActionIconBadge}>
                <Icon name="users" size={18} color={Colors.navyAccent} strokeWidth={2} />
              </View>
              <Text style={styles.quickActionLabel}>Workers</Text>
            </TouchableOpacity>

            {/* Action 3: Advances */}
            <TouchableOpacity
              style={styles.quickActionTile}
              onPress={() => onNavigate('advances')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Navigate to Advances"
            >
              <View style={styles.quickActionIconBadge}>
                <Icon name="wallet-cards" size={18} color={Colors.navyAccent} strokeWidth={2} />
              </View>
              <Text style={styles.quickActionLabel}>Advances</Text>
            </TouchableOpacity>

            {/* Action 4: Sites */}
            <TouchableOpacity
              style={styles.quickActionTile}
              onPress={() => onNavigate('sites')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Navigate to Sites"
            >
              <View style={styles.quickActionIconBadge}>
                <Icon name="building-2" size={18} color={Colors.navyAccent} strokeWidth={2} />
              </View>
              <Text style={styles.quickActionLabel}>Sites</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 5. Site Overview (Workforce & Cost Breakdown) */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeading}>SITE OVERVIEW</Text>
            <TouchableOpacity
              onPress={() => onNavigate('sites')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="View all sites"
            >
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.siteListCard}>
            {sitesBreakdown.length === 0 ? (
              <View style={styles.emptySiteContainer}>
                <View style={styles.emptySiteIconBadge}>
                  <Icon name="building-2" size={22} color={Colors.textMuted} strokeWidth={1.8} />
                </View>
                <Text style={styles.emptySiteTitle}>No active work sites</Text>
                <Text style={styles.emptySiteSubtitle}>
                  Sites with recorded attendance or active status will appear here.
                </Text>
              </View>
            ) : (
              sitesBreakdown.slice(0, 5).map((site, index) => (
                <View key={site.site_id}>
                  {index > 0 && <View style={styles.siteDivider} />}
                  <TouchableOpacity
                    style={styles.siteRow}
                    onPress={() => onNavigate('sites')}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${site.site_name}, ${site.unique_worker_count} workers, ${site.total_work_units.toFixed(1)} units, ${formatCurrency(site.total_labour_expense)}`}
                  >
                    <View style={styles.siteRowLeft}>
                      <View style={styles.siteIconBadge}>
                        <Icon name="building-2" size={16} color={Colors.navyAccent} strokeWidth={1.8} />
                      </View>
                      <View style={styles.siteTextGroup}>
                        <Text style={styles.siteName} numberOfLines={1} ellipsizeMode="tail">
                          {site.site_name}
                        </Text>
                        <Text style={styles.siteSubtext}>
                          {site.unique_worker_count} workers · {site.total_work_units.toFixed(1)} units
                        </Text>
                      </View>
                    </View>

                    <View style={styles.siteRowRight}>
                      <Text style={styles.siteExpense}>
                        {formatCurrency(site.total_labour_expense)}
                      </Text>
                      <Icon name="chevron-right" size={15} color={Colors.textMuted} strokeWidth={2} />
                    </View>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      {/* Month Selection Modal */}
      <Modal
        visible={monthPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMonthPickerVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setMonthPickerVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select Month</Text>
                  <TouchableOpacity
                    onPress={() => setMonthPickerVisible(false)}
                    style={styles.modalCloseBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Close Month Picker"
                  >
                    <Icon name="close" size={18} color={Colors.textSecondary} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.monthListScroll}>
                  {availableMonths.map(item => {
                    const isSelected =
                      item.year === selectedYear && item.month === selectedMonth;
                    return (
                      <TouchableOpacity
                        key={`${item.year}-${item.month}`}
                        style={[
                          styles.monthOption,
                          isSelected && styles.monthOptionSelected,
                        ]}
                        onPress={() => handleSelectMonth(item.year, item.month)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.monthOptionText,
                            isSelected && styles.monthOptionTextSelected,
                          ]}
                        >
                          {item.label}
                        </Text>
                        {isSelected && (
                          <Icon name="check" size={16} color={Colors.navyAccent} strokeWidth={2.5} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Lock Application Confirmation Modal */}
      <Modal
        visible={lockDialogVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLockDialogVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setLockDialogVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.lockModalContent}>
                <Text style={styles.lockModalTitle}>Lock Application?</Text>
                <Text style={styles.lockModalText}>
                  Your session will be closed. You will need to enter your MPIN to access Attendly
                  again.
                </Text>
                <View style={styles.lockModalActions}>
                  <TouchableOpacity
                    style={styles.lockCancelBtn}
                    onPress={() => setLockDialogVisible(false)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.lockCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.lockConfirmBtn}
                    onPress={() => {
                      setLockDialogVisible(false);
                      onLogout();
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.lockConfirmText}>Lock Now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background, // #faf9f6 warm ivory
  },
  headerContainer: {
    backgroundColor: Colors.surface, // #ffffff
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border, // #e4e4e7
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitles: {
    flex: 1,
    minWidth: 0,
    marginRight: Spacing.sm,
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: Colors.textPrimary, // #09090b
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary, // #71717a
    marginTop: 2,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  monthPill: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  monthPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  lockButton: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.lg,
  },

  // 1. Net Payable Hero Card (Charcoal #18181B)
  heroCard: {
    backgroundColor: Colors.heroBg, // #18181b
    borderRadius: BorderRadius.xl, // 18
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.heroDivider, // #27272a
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroAccentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(51, 75, 103, 0.45)', // muted navy tint detail
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
  },
  heroNavyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7195be', // soft navy accent light
  },
  heroLabelText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.heroTextSecondary, // #d4d4d8
  },
  heroPeriodPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  heroPeriodText: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.heroTextSecondary,
  },
  heroAmount: {
    fontSize: 34,
    fontWeight: '800',
    color: Colors.heroText, // #ffffff
    letterSpacing: -0.8,
    marginTop: 14,
  },
  heroExplanation: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.heroTextSecondary, // #d4d4d8
    marginTop: 4,
  },
  heroDivider: {
    height: 1,
    backgroundColor: Colors.heroDivider, // #27272a
    marginVertical: 14,
  },
  heroBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroBreakdownCol: {
    flex: 1,
  },
  heroSubLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: Colors.heroTextSecondary,
  },
  heroSubValue: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.heroText,
    marginTop: 3,
    letterSpacing: -0.2,
  },
  heroVerticalDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.heroDivider,
    marginHorizontal: Spacing.md,
  },

  // Supporting Compact Card: Total Work Units
  workUnitsCard: {
    backgroundColor: Colors.surface, // #ffffff
    borderRadius: BorderRadius.lg, // 14
    borderWidth: 1,
    borderColor: Colors.border, // #e4e4e7
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  workUnitsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  workUnitsIconBadge: {
    width: 34,
    height: 34,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.navyAccentLight, // #f0f4f8
    justifyContent: 'center',
    alignItems: 'center',
  },
  workUnitsTextGroup: {
    justifyContent: 'center',
  },
  workUnitsLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  workUnitsSubtext: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  workUnitsRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  workUnitsValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  workUnitsUnitLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
  },

  // 3. Today's Activity Section
  sectionContainer: {
    gap: Spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  navyActivityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.navyAccent, // #334b67
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.textSecondary,
  },
  sectionHeaderDate: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  activityGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  activityCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 2,
    elevation: 1,
  },
  activityCardNavy: {
    borderColor: Colors.navyAccentBorder,
  },
  activityCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activityCardValue: {
    fontWeight: '700',
    fontSize: 18,
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  activityIconBadgeMuted: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: Colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityIconBadgeNavy: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: Colors.navyAccentLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityCardLabel: {
    color: Colors.textSecondary,
    fontWeight: '600',
    marginTop: 6,
    fontSize: 11,
  },
  activityCardLabelNavy: {
    color: Colors.navyAccent,
  },

  // 4. Quick Actions (Light Surfaces, Consistent Outline Icons)
  quickActionsGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  quickActionTile: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 78,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  quickActionIconBadge: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.navyAccentLight, // subtle navy tint
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  quickActionLabel: {
    fontWeight: '600',
    color: Colors.textPrimary,
    fontSize: 11,
    textAlign: 'center',
  },

  // 5. Site Overview Card & Scannable Rows
  viewAllText: {
    color: Colors.navyAccent,
    fontWeight: '600',
    fontSize: 12,
  },
  siteListCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  emptySiteContainer: {
    padding: Spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySiteIconBadge: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  emptySiteTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  emptySiteSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: Spacing.md,
  },
  siteRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  siteDivider: {
    height: 1,
    backgroundColor: '#f4f4f5',
  },
  siteRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
    minWidth: 0,
  },
  siteIconBadge: {
    width: 34,
    height: 34,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.navyAccentLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  siteTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  siteName: {
    fontWeight: '600',
    color: Colors.textPrimary,
    fontSize: 14,
  },
  siteSubtext: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  siteRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: Spacing.sm,
  },
  siteExpense: {
    fontWeight: '700',
    color: Colors.textPrimary,
    fontSize: 14,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  modalContent: {
    width: '100%',
    maxHeight: '60%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalCloseBtn: {
    padding: 4,
  },
  monthListScroll: {
    marginTop: Spacing.sm,
  },
  monthOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  monthOptionSelected: {
    backgroundColor: Colors.navyAccentLight,
  },
  monthOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  monthOptionTextSelected: {
    fontWeight: '700',
    color: Colors.navyAccent,
  },

  // Lock Application Modal
  lockModalContent: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
  },
  lockModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  lockModalText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.xl,
  },
  lockModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  lockCancelBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  lockCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  lockConfirmBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.heroBg, // #18181b
  },
  lockConfirmText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textInverse,
  },
});
