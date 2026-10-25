import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Share,
  Platform,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../theme/tokens';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/Cards';
import { SiteRepository } from '../repositories/siteRepository';
import { AttendanceRepository } from '../repositories/attendanceRepository';
import { WorkerRepository, LocalWorker } from '../repositories/workerRepository';
import { WageHistoryRepository } from '../repositories/wageHistoryRepository';
import { SyncManager, SyncState } from '../sync/syncManager';
import { ApiClient } from '../api/client';

export interface SiteAnalyticsScreenProps {
  accountId: string | null;
  onBack: () => void;
  onNavigateToSites?: () => void;
}

interface DateWorkItem {
  date: string;
  work_units: number;
  daily_wage: number;
  wage_earned: number;
}

interface WorkerDeploymentItem {
  worker_id: string;
  worker_name: string;
  daily_wage: number;
  work_units: number;
  labour_expense: number;
  wage_breakdown: { rate: number; work_units: number; earnings: number }[];
  dates_worked: DateWorkItem[];
}

interface SiteAnalyticsCardItem {
  site_id: string;
  site_name: string;
  location?: string | null;
  is_active: boolean;
  unique_worker_count: number;
  total_work_units: number;
  total_labour_expense: number;
  workers: WorkerDeploymentItem[];
}

export const SiteAnalyticsScreen: React.FC<SiteAnalyticsScreenProps> = ({
  accountId,
  onBack,
  onNavigateToSites,
}) => {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-12
  const [loading, setLoading] = useState(true);

  // Overall metrics
  const [totalSitesUsed, setTotalSitesUsed] = useState(0);
  const [totalUniqueWorkers, setTotalUniqueWorkers] = useState(0);
  const [totalWorkUnits, setTotalWorkUnits] = useState(0);
  const [totalLabourExpense, setTotalLabourExpense] = useState(0);
  const [siteCards, setSiteCards] = useState<SiteAnalyticsCardItem[]>([]);

  // Report Modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [selectedReportSite, setSelectedReportSite] = useState<SiteAnalyticsCardItem | null>(null);

  // Sync state
  const [syncState, setSyncState] = useState<SyncState>({
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncTime: null,
  });

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const selectedMonthLabel = `${monthNames[selectedMonth - 1]} ${selectedYear}`;

  const formatINR = (val: number) => {
    return '₹' + Math.round(val).toLocaleString('en-IN');
  };

  // Local-first calculation
  const computeLocalAnalytics = useCallback(() => {
    const effectiveAccId = accountId || 'default';
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
    const startDate = `${selectedYear}-${pad(selectedMonth)}-01`;
    const endDate = `${selectedYear}-${pad(selectedMonth)}-${pad(lastDay)}`;

    const allSites = SiteRepository.getAll(effectiveAccId, false);
    const allWorkers = WorkerRepository.getAll(effectiveAccId, false);
    const workerMap = new Map<string, LocalWorker>();
    for (const w of allWorkers) workerMap.set(w.id, w);

    const attendances = AttendanceRepository.getByDateRangeWithSites(startDate, endDate, effectiveAccId).filter(
      a => a.site_id && Number(a.work_units || 0) > 0
    );

    // Group attendances by site_id
    const siteAttMap: { [siteId: string]: typeof attendances } = {};
    for (const a of attendances) {
      if (!a.site_id) continue;
      if (!siteAttMap[a.site_id]) siteAttMap[a.site_id] = [];
      siteAttMap[a.site_id].push(a);
    }

    let overallUnits = 0;
    let overallExpense = 0;
    const overallWorkerIds = new Set<string>();
    let sitesUsedCount = 0;
    const computedSites: SiteAnalyticsCardItem[] = [];

    for (const s of allSites) {
      const attList = siteAttMap[s.id] || [];
      if (attList.length > 0) sitesUsedCount++;

      // Group by worker_id within this site
      const workerAttMap: { [wId: string]: typeof attList } = {};
      for (const a of attList) {
        if (!workerAttMap[a.worker_id]) workerAttMap[a.worker_id] = [];
        workerAttMap[a.worker_id].push(a);
        overallWorkerIds.add(a.worker_id);
      }

      let siteUnits = 0;
      let siteExpense = 0;
      const workersDetailList: WorkerDeploymentItem[] = [];

      for (const [wId, wAtts] of Object.entries(workerAttMap)) {
        const workerObj = workerMap.get(wId);
        const baseRate = Number(workerObj?.daily_wage || 0);

        let wUnits = 0;
        let wExpense = 0;
        const tierMap: { [rate: number]: { units: number; earnings: number } } = {};
        const datesWorked: DateWorkItem[] = [];

        for (const a of wAtts) {
          const units = Number(a.work_units || 0);
          wUnits += units;
          const effRate = WageHistoryRepository.getEffectiveWage(wId, a.date, effectiveAccId, baseRate);
          const earned = Math.round(units * effRate * 100) / 100;
          wExpense += earned;

          if (!tierMap[effRate]) tierMap[effRate] = { units: 0, earnings: 0 };
          tierMap[effRate].units += units;
          tierMap[effRate].earnings += earned;

          datesWorked.push({
            date: a.date,
            work_units: units,
            daily_wage: effRate,
            wage_earned: earned,
          });
        }

        // Sort dates worked descending
        datesWorked.sort((a, b) => b.date.localeCompare(a.date));

        const wageBreakdown = Object.entries(tierMap).map(([rate, d]) => ({
          rate: Number(rate),
          work_units: Math.round(d.units * 10) / 10,
          earnings: Math.round(d.earnings * 100) / 100,
        }));
        wageBreakdown.sort((a, b) => b.rate - a.rate);

        const latestRate = WageHistoryRepository.getEffectiveWage(wId, endDate, effectiveAccId, baseRate);

        workersDetailList.push({
          worker_id: wId,
          worker_name: workerObj?.name || 'Unknown Worker',
          daily_wage: latestRate,
          work_units: Math.round(wUnits * 10) / 10,
          labour_expense: Math.round(wExpense * 100) / 100,
          wage_breakdown: wageBreakdown,
          dates_worked: datesWorked,
        });

        siteUnits += wUnits;
        siteExpense += wExpense;
      }

      // Sort workers by expense descending
      workersDetailList.sort((a, b) => b.labour_expense - a.labour_expense);

      overallUnits += siteUnits;
      overallExpense += siteExpense;

      computedSites.push({
        site_id: s.id,
        site_name: s.name,
        location: s.location,
        is_active: s.is_active,
        unique_worker_count: Object.keys(workerAttMap).length,
        total_work_units: Math.round(siteUnits * 10) / 10,
        total_labour_expense: Math.round(siteExpense * 100) / 100,
        workers: workersDetailList,
      });
    }

    // Sort sites: sites with activity first, then by name ASC
    computedSites.sort((a, b) => {
      if (b.total_work_units !== a.total_work_units) {
        return b.total_work_units - a.total_work_units;
      }
      return a.site_name.localeCompare(b.site_name);
    });

    setTotalSitesUsed(sitesUsedCount);
    setTotalUniqueWorkers(overallWorkerIds.size);
    setTotalWorkUnits(Math.round(overallUnits * 10) / 10);
    setTotalLabourExpense(Math.round(overallExpense * 100) / 100);
    setSiteCards(computedSites);
  }, [accountId, selectedYear, selectedMonth]);

  // Server fetch
  const fetchServerAnalytics = useCallback(async () => {
    try {
      const res = await ApiClient.getSiteAnalytics(selectedYear, selectedMonth);
      if (res) {
        setTotalSitesUsed(Number(res.total_sites_used || 0));
        setTotalUniqueWorkers(Number(res.total_unique_workers || 0));
        setTotalWorkUnits(Number(res.total_work_units || 0));
        setTotalLabourExpense(Number(res.total_labour_expense || 0));

        if (res.sites && res.sites.length > 0) {
          const mapped: SiteAnalyticsCardItem[] = res.sites.map((s: any) => ({
            site_id: s.site_id,
            site_name: s.site_name,
            location: s.location,
            is_active: s.is_active !== undefined ? Boolean(s.is_active) : true,
            unique_worker_count: Number(s.unique_worker_count || 0),
            total_work_units: Number(s.total_work_units || 0),
            total_labour_expense: Number(s.total_labour_expense || 0),
            workers: (s.workers || []).map((w: any) => ({
              worker_id: w.worker_id,
              worker_name: w.worker_name,
              daily_wage: Number(w.daily_wage || 0),
              work_units: Number(w.work_units || 0),
              labour_expense: Number(w.labour_expense || 0),
              wage_breakdown: (w.wage_breakdown || []).map((wb: any) => ({
                rate: Number(wb.rate),
                work_units: Number(wb.work_units),
                earnings: Number(wb.earnings),
              })),
              dates_worked: (w.dates_worked || []).map((d: any) => ({
                date: d.date,
                work_units: Number(d.work_units),
                daily_wage: Number(d.daily_wage),
                wage_earned: Number(d.wage_earned),
              })),
            })),
          }));
          setSiteCards(mapped);
        }
      }
    } catch {
      // Offline fallback already loaded via computeLocalAnalytics
    }
  }, [selectedYear, selectedMonth]);

  const loadData = useCallback(async () => {
    setLoading(true);
    computeLocalAnalytics();
    await fetchServerAnalytics();
    setLoading(false);
  }, [computeLocalAnalytics, fetchServerAnalytics]);

  useEffect(() => {
    loadData();
    const unsub = SyncManager.subscribe(state => {
      setSyncState(state);
      computeLocalAnalytics();
      fetchServerAnalytics();
    });
    return unsub;
  }, [loadData, computeLocalAnalytics, fetchServerAnalytics]);

  // Actions
  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear(y => y - 1);
    } else {
      setSelectedMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear(y => y + 1);
    } else {
      setSelectedMonth(m => m + 1);
    }
  };

  const handleOpenReport = (site: SiteAnalyticsCardItem) => {
    setSelectedReportSite(site);
    setReportModalOpen(true);
  };

  const handleShareReport = async () => {
    if (!selectedReportSite) return;
    try {
      const lines = [
        `*Attendly — Site Labour Report*`,
        `Site: ${selectedReportSite.site_name}`,
        selectedReportSite.location ? `Location: ${selectedReportSite.location}` : '',
        `Period: ${selectedMonthLabel}`,
        `Total Man-Days: ${selectedReportSite.total_work_units} units`,
        `Total Labour Expense: ${formatINR(selectedReportSite.total_labour_expense)}`,
        `Workers Deployed: ${selectedReportSite.unique_worker_count}`,
        '',
        `*Worker Breakdown:*`,
        ...selectedReportSite.workers.map(
          w => `• ${w.worker_name}: ${w.work_units} units @ ₹${w.daily_wage}/day = ${formatINR(w.labour_expense)}`
        ),
      ].filter(Boolean);

      await Share.share({
        message: lines.join('\n'),
        title: `Site Labour Report — ${selectedReportSite.site_name} (${selectedMonthLabel})`,
      });
    } catch {
      // Share dismissed
    }
  };

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          accessibilityLabel="Back to previous screen"
          accessibilityRole="button"
        >
          <Icon name="arrow-left" size={18} color={Colors.textPrimary} strokeWidth={2} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Site Analytics
          </Text>
          <Text style={styles.headerSubtitle}>
            Monthly workforce deployment & expenses by site
          </Text>
        </View>

        {onNavigateToSites && (
          <TouchableOpacity
            style={styles.manageSitesBtn}
            onPress={onNavigateToSites}
            accessibilityLabel="Manage job sites"
            accessibilityRole="button"
          >
            <Icon name="building" size={13} color={Colors.textPrimary} strokeWidth={2} />
            <Text style={styles.manageSitesText}>Sites</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Month Selector Capsule */}
        <View style={styles.monthCapsule}>
          <TouchableOpacity
            style={styles.monthArrowBtn}
            onPress={handlePrevMonth}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
          >
            <Icon name="chevron-left" size={18} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>

          <View style={styles.monthCenterContainer}>
            <Text style={styles.monthLabelText}>{selectedMonthLabel}</Text>
          </View>

          <TouchableOpacity
            style={styles.monthArrowBtn}
            onPress={handleNextMonth}
            accessibilityRole="button"
            accessibilityLabel="Next month"
          >
            <Icon name="chevron-right" size={18} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* 4 Summary Metrics Panel Grid */}
        <View style={styles.kpiGrid}>
          {/* Active Sites */}
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>ACTIVE SITES</Text>
            <Text style={styles.kpiValue}>{totalSitesUsed}</Text>
            <Text style={styles.kpiSubtitle}>With labour logged</Text>
          </View>

          {/* Unique Workers */}
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>UNIQUE WORKERS</Text>
            <Text style={styles.kpiValue}>{totalUniqueWorkers}</Text>
            <Text style={styles.kpiSubtitle}>Deployed this month</Text>
          </View>

          {/* Total Units */}
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>TOTAL UNITS</Text>
            <Text style={styles.kpiValue}>{totalWorkUnits.toFixed(1)}</Text>
            <Text style={styles.kpiSubtitle}>Total man-days</Text>
          </View>

          {/* Total Expense (Warm Orange Card) */}
          <View style={[styles.kpiCard, styles.kpiCardExpense]}>
            <Text style={styles.kpiLabelExpense}>TOTAL EXPENSE</Text>
            <Text style={styles.kpiValueExpense}>{formatINR(totalLabourExpense)}</Text>
            <Text style={styles.kpiSubExpense}>Monthly wage cost</Text>
          </View>
        </View>

        {/* Section Header */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeaderTitle}>SITES BREAKDOWN</Text>
          <Text style={styles.sectionHeaderCount}>
            {siteCards.length} site{siteCards.length === 1 ? '' : 's'} · {totalWorkUnits} units
          </Text>
        </View>

        {/* Sites Stream */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={Colors.textPrimary} />
            <Text style={styles.loadingBoxText}>Computing monthly deployment analytics...</Text>
          </View>
        ) : siteCards.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyBoxTitle}>No Sites Configured</Text>
            <Text style={styles.emptyBoxSubtitle}>
              Create work sites to begin analyzing workforce deployment.
            </Text>
          </View>
        ) : (
          siteCards.map(site => (
            <View
              key={site.site_id}
              style={[styles.siteCard, !site.is_active && styles.siteCardInactive]}
            >
              <View style={styles.siteCardTop}>
                <View style={styles.siteCardInfo}>
                  <View style={styles.siteNameRow}>
                    <Text style={styles.siteNameText} numberOfLines={1}>
                      {site.site_name}
                    </Text>
                    <StatusPill
                      label={site.is_active ? 'Active' : 'Inactive'}
                      status={site.is_active ? 'active' : 'inactive'}
                    />
                  </View>

                  {site.location ? (
                    <View style={styles.locationRow}>
                      <Icon name="pin" size={12} color={Colors.textSecondary} strokeWidth={1.8} />
                      <Text style={styles.locationText} numberOfLines={1}>
                        {site.location}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={styles.viewReportBtn}
                  onPress={() => handleOpenReport(site)}
                  accessibilityRole="button"
                  accessibilityLabel={`View labour report for ${site.site_name}`}
                >
                  <Text style={styles.viewReportBtnText}>View Report</Text>
                  <Icon name="chevron-right" size={14} color={Colors.accent} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              {/* 3 Metrics Strip */}
              <View style={styles.metricsStrip}>
                <View style={styles.metricStripCol}>
                  <Text style={styles.metricStripLabel}>EXPENSE</Text>
                  <Text style={styles.metricStripValueBold}>
                    {formatINR(site.total_labour_expense)}
                  </Text>
                </View>

                <View style={styles.metricDivider} />

                <View style={styles.metricStripCol}>
                  <Text style={styles.metricStripLabel}>UNITS</Text>
                  <Text style={styles.metricStripValue}>{site.total_work_units}</Text>
                </View>

                <View style={styles.metricDivider} />

                <View style={styles.metricStripCol}>
                  <Text style={styles.metricStripLabel}>WORKERS</Text>
                  <Text style={styles.metricStripValue}>{site.unique_worker_count}</Text>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Site Labour Report Modal */}
      <Modal
        visible={reportModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setReportModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Top Bar */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleCol}>
                <Text style={styles.modalTitleText}>Site Labour Report</Text>
                <Text style={styles.modalSubtitleText}>
                  {selectedReportSite?.site_name} · {selectedMonthLabel}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => setReportModalOpen(false)}
                style={styles.modalCloseBtn}
                accessibilityRole="button"
              >
                <Icon name="close" size={18} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              {/* Financial Summary Badge */}
              <View style={styles.reportSummaryCard}>
                <View style={styles.reportSummaryRow}>
                  <View>
                    <Text style={styles.reportSummaryLabel}>TOTAL LABOUR EXPENSE</Text>
                    <Text style={styles.reportSummaryExpense}>
                      {formatINR(selectedReportSite?.total_labour_expense || 0)}
                    </Text>
                  </View>

                  <View style={styles.reportSummaryRight}>
                    <Text style={styles.reportSummaryUnits}>
                      {selectedReportSite?.total_work_units || 0} Units
                    </Text>
                    <Text style={styles.reportSummaryWorkers}>
                      {selectedReportSite?.unique_worker_count || 0} Workers
                    </Text>
                  </View>
                </View>
              </View>

              {/* Workers Deployed Breakdown Table */}
              <Text style={styles.modalSectionTitle}>WORKERS DEPLOYED</Text>
              {selectedReportSite?.workers && selectedReportSite.workers.length > 0 ? (
                <View style={styles.tableCard}>
                  <View style={styles.tableHeaderRow}>
                    <Text style={[styles.tableColHeader, { flex: 2 }]}>Worker</Text>
                    <Text style={[styles.tableColHeader, { flex: 1, textAlign: 'center' }]}>
                      Units
                    </Text>
                    <Text style={[styles.tableColHeader, { flex: 1.2, textAlign: 'right' }]}>
                      Expense
                    </Text>
                  </View>

                  {selectedReportSite.workers.map((w, idx) => (
                    <View
                      key={w.worker_id}
                      style={[
                        styles.tableRow,
                        idx === (selectedReportSite.workers.length - 1) && { borderBottomWidth: 0 },
                      ]}
                    >
                      <View style={{ flex: 2 }}>
                        <Text style={styles.workerTableName}>{w.worker_name}</Text>
                        <Text style={styles.workerTableRate}>@ ₹{w.daily_wage}/day</Text>
                      </View>
                      <Text style={[styles.tableCellCenter, { flex: 1 }]}>
                        {w.work_units}
                      </Text>
                      <Text style={[styles.tableCellRightBold, { flex: 1.2 }]}>
                        {formatINR(w.labour_expense)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyTableBox}>
                  <Text style={styles.emptyTableText}>No workers deployed this month.</Text>
                </View>
              )}

              {/* Chronological Dates Worked Detail */}
              {selectedReportSite?.workers && selectedReportSite.workers.some(w => w.dates_worked.length > 0) && (
                <>
                  <Text style={[styles.modalSectionTitle, { marginTop: Spacing.md }]}>
                    DAILY SHIFT LOG
                  </Text>
                  <View style={styles.tableCard}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableColHeader, { flex: 1.2 }]}>Date</Text>
                      <Text style={[styles.tableColHeader, { flex: 1.5 }]}>Worker</Text>
                      <Text style={[styles.tableColHeader, { flex: 0.8, textAlign: 'center' }]}>
                        Units
                      </Text>
                      <Text style={[styles.tableColHeader, { flex: 1, textAlign: 'right' }]}>
                        Earned
                      </Text>
                    </View>

                    {selectedReportSite.workers
                      .flatMap(w =>
                        w.dates_worked.map(d => ({
                          ...d,
                          worker_name: w.worker_name,
                          worker_id: w.worker_id,
                        }))
                      )
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((log, idx, arr) => (
                        <View
                          key={`${log.worker_id}-${log.date}`}
                          style={[
                            styles.tableRow,
                            idx === (arr.length - 1) && { borderBottomWidth: 0 },
                          ]}
                        >
                          <Text style={[styles.tableCellDate, { flex: 1.2 }]}>{log.date}</Text>
                          <Text style={[styles.tableCellWorker, { flex: 1.5 }]} numberOfLines={1}>
                            {log.worker_name}
                          </Text>
                          <Text style={[styles.tableCellCenter, { flex: 0.8 }]}>
                            {log.work_units}
                          </Text>
                          <Text style={[styles.tableCellRightBold, { flex: 1 }]}>
                            {formatINR(log.wage_earned)}
                          </Text>
                        </View>
                      ))}
                  </View>
                </>
              )}
            </ScrollView>

            {/* Modal Bottom Actions */}
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={handleShareReport}
                accessibilityRole="button"
                accessibilityLabel="Share site report"
              >
                <Icon name="share" size={15} color={Colors.textPrimary} strokeWidth={2} />
                <Text style={styles.shareBtnText}>Share Report</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setReportModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close report dialog"
              >
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? 12 : Spacing.md,
    paddingBottom: Spacing.sm,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    marginRight: Spacing.sm,
  },
  headerInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  manageSitesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#ffffff',
    gap: 5,
  },
  manageSitesText: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: 40,
  },
  monthCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: Spacing.md,
  },
  monthArrowBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthCenterContainer: {
    alignItems: 'center',
  },
  monthLabelText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  kpiCard: {
    width: '48.5%',
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.sm + 4,
    justifyContent: 'space-between',
    minHeight: 88,
  },
  kpiCardExpense: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.4,
  },
  kpiLabelExpense: {
    fontSize: 10,
    fontWeight: '700',
    color: '#c2410c',
    letterSpacing: 0.4,
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginVertical: 2,
  },
  kpiValueExpense: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.accent,
    marginVertical: 2,
  },
  kpiSubtitle: {
    fontSize: 10,
    color: Colors.textTertiary,
  },
  kpiSubExpense: {
    fontSize: 10,
    color: '#9a3412',
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  sectionHeaderTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  sectionHeaderCount: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  siteCard: {
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  siteCardInactive: {
    opacity: 0.75,
    backgroundColor: '#fafafa',
  },
  siteCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  siteCardInfo: {
    flex: 1,
  },
  siteNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  siteNameText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  locationText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
  },
  viewReportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#fff7ed',
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  viewReportBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.accent,
  },
  metricsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: BorderRadius.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: Spacing.md,
  },
  metricStripCol: {
    flex: 1,
    alignItems: 'center',
  },
  metricStripLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 0.3,
  },
  metricStripValue: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  metricStripValueBold: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: Colors.accent,
    marginTop: 2,
  },
  metricDivider: {
    width: 1,
    height: 20,
    backgroundColor: Colors.border,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingBoxText: {
    marginTop: 8,
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
  },
  emptyBox: {
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 30,
    alignItems: 'center',
  },
  emptyBoxTitle: {
    fontSize: Typography.fontSize.md,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptyBoxSubtitle: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 24 : Spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalHeaderTitleCol: {
    flex: 1,
  },
  modalTitleText: {
    fontSize: Typography.fontSize.md,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalSubtitleText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalScrollContent: {
    padding: Spacing.md,
  },
  reportSummaryCard: {
    backgroundColor: '#fff7ed',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#fed7aa',
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  reportSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reportSummaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#c2410c',
    letterSpacing: 0.4,
  },
  reportSummaryExpense: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.accent,
    marginTop: 2,
  },
  reportSummaryRight: {
    alignItems: 'flex-end',
  },
  reportSummaryUnits: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  reportSummaryWorkers: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  modalSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  tableCard: {
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tableColHeader: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f4f4f5',
  },
  workerTableName: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  workerTableRate: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  tableCellCenter: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  tableCellRightBold: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '700',
    color: Colors.accent,
    textAlign: 'right',
  },
  tableCellDate: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
  },
  tableCellWorker: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  emptyTableBox: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyTableText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#ffffff',
    gap: 6,
  },
  shareBtnText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  closeBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: '#ffffff',
  },
});
