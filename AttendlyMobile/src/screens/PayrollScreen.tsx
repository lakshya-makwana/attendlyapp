import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Colors, Spacing, BorderRadius } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { WorkerRepository, LocalWorker } from '../repositories/workerRepository';
import { AttendanceRepository } from '../repositories/attendanceRepository';
import { AdvanceRepository } from '../repositories/advanceRepository';
import { WageHistoryRepository } from '../repositories/wageHistoryRepository';
import { ApiClient } from '../api/client';
import { SyncManager } from '../sync/syncManager';
import { getMonthDateRange } from '../utils/dateUtils';

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

export interface WageRateBreakdownItem {
  rate: number;
  work_units: number;
  earnings: number;
}

export interface WorkerPayrollRowItem {
  worker_id: string;
  worker_name: string;
  phone?: string | null;
  daily_wage: number;
  total_work_units: number;
  gross_earnings: number;
  total_advances: number;
  net_payable: number;
  active: boolean;
  wage_breakdown: WageRateBreakdownItem[];
}

export interface SiteWorkedItem {
  site_id: string | null;
  site_name: string;
  work_units: number;
  earnings: number;
}

interface PayrollScreenProps {
  accountId: string;
  onNavigateHome?: () => void;
}

export const PayrollScreen: React.FC<PayrollScreenProps> = ({
  accountId,
  onNavigateHome: _onNavigateHome,
}) => {
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1); // 1-12
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Authoritative Payroll Totals & Rows
  const [totalWorkUnits, setTotalWorkUnits] = useState(0);
  const [totalGrossWages, setTotalGrossWages] = useState(0);
  const [totalAdvances, setTotalAdvances] = useState(0);
  const [totalNetPayable, setTotalNetPayable] = useState(0);
  const [workerCount, setWorkerCount] = useState(0);
  const [rows, setRows] = useState<WorkerPayrollRowItem[]>([]);

  // Salary Slip Modal
  const [slipModalOpen, setSlipModalOpen] = useState(false);
  const [selectedSlipWorker, setSelectedSlipWorker] = useState<WorkerPayrollRowItem | null>(null);
  const [slipLoading, setSlipLoading] = useState(false);
  const [slipSites, setSlipSites] = useState<SiteWorkedItem[]>([]);
  const [slipWageBreakdown, setSlipWageBreakdown] = useState<WageRateBreakdownItem[]>([]);

  // Calculation Standard Details Modal
  const [calcInfoOpen, setCalcInfoOpen] = useState(false);

  // Month navigation
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

  // Local-first calculation matching PWA wage resolution & inactive rules
  const computeLocalPayroll = useCallback(() => {
    const { startDate, endDate } = getMonthDateRange(selectedYear, selectedMonth - 1);
    const allWorkers: LocalWorker[] = WorkerRepository.getAll(accountId, false);
    const attendances = AttendanceRepository.getByDateRangeWithSites(startDate, endDate, accountId);
    const advances = AdvanceRepository.getByDateRange(startDate, endDate, accountId);

    // Group attendances by worker
    const workerAttMap = new Map<string, typeof attendances>();
    for (const a of attendances) {
      const list = workerAttMap.get(a.worker_id) || [];
      list.push(a);
      workerAttMap.set(a.worker_id, list);
    }

    // Group advances by worker
    const workerAdvMap = new Map<string, typeof advances>();
    for (const adv of advances) {
      const list = workerAdvMap.get(adv.worker_id) || [];
      list.push(adv);
      workerAdvMap.set(adv.worker_id, list);
    }

    let gUnits = 0;
    let gGross = 0;
    let gAdvances = 0;
    const computedRows: WorkerPayrollRowItem[] = [];

    for (const w of allWorkers) {
      const wAtts = workerAttMap.get(w.id) || [];
      const wAdvs = workerAdvMap.get(w.id) || [];

      const isWorkerActive = w.is_active !== undefined ? Boolean(w.is_active) : true;
      // Inactive worker inclusion rule matching PWA:
      // Worker included if active OR has attendance this month OR has advances this month
      if (!isWorkerActive && wAtts.length === 0 && wAdvs.length === 0) {
        continue;
      }

      let wUnits = 0;
      let wGross = 0;
      const rateMap = new Map<number, { units: number; earnings: number }>();

      for (const att of wAtts) {
        const u = Number(att.work_units || 0);
        wUnits += u;
        const effWage = WageHistoryRepository.getEffectiveWage(
          w.id,
          att.date,
          accountId,
          Number(w.daily_wage || 0)
        );
        const shiftEarnings = Math.round(u * effWage * 100) / 100;
        wGross += shiftEarnings;

        const existingRate = rateMap.get(effWage) || { units: 0, earnings: 0 };
        existingRate.units += u;
        existingRate.earnings += shiftEarnings;
        rateMap.set(effWage, existingRate);
      }

      let wAdvances = 0;
      for (const adv of wAdvs) {
        wAdvances += Number(adv.amount || 0);
      }
      wAdvances = Math.round(wAdvances * 100) / 100;

      const wNet = Math.round((wGross - wAdvances) * 100) / 100;

      gUnits += wUnits;
      gGross += wGross;
      gAdvances += wAdvances;

      const wageBreakdown: WageRateBreakdownItem[] = Array.from(rateMap.entries()).map(
        ([rate, data]) => ({
          rate,
          work_units: data.units,
          earnings: Math.round(data.earnings * 100) / 100,
        })
      );

      // Latest daily wage for display
      const currentRate =
        wAtts.length > 0
          ? WageHistoryRepository.getEffectiveWage(
              w.id,
              endDate,
              accountId,
              Number(w.daily_wage || 0)
            )
          : Number(w.daily_wage || 0);

      computedRows.push({
        worker_id: w.id,
        worker_name: w.name,
        phone: w.phone,
        daily_wage: currentRate,
        total_work_units: Math.round(wUnits * 10) / 10,
        gross_earnings: Math.round(wGross * 100) / 100,
        total_advances: wAdvances,
        net_payable: wNet,
        active: isWorkerActive,
        wage_breakdown: wageBreakdown,
      });
    }

    // Sort by name ASC
    computedRows.sort((a, b) => a.worker_name.localeCompare(b.worker_name));

    setTotalWorkUnits(Math.round(gUnits * 10) / 10);
    setTotalGrossWages(Math.round(gGross * 100) / 100);
    setTotalAdvances(Math.round(gAdvances * 100) / 100);
    setTotalNetPayable(Math.round((gGross - gAdvances) * 100) / 100);
    setWorkerCount(computedRows.length);
    setRows(computedRows);
  }, [accountId, selectedYear, selectedMonth]);

  // Server sync fetch
  const fetchAuthoritativePayroll = useCallback(async () => {
    try {
      const res = await ApiClient.getMonthlyPayroll(selectedYear, selectedMonth);
      if (res && res.rows) {
        setTotalWorkUnits(Number(res.total_work_units || 0));
        setTotalGrossWages(Number(res.total_gross_wages || res.total_gross || 0));
        setTotalAdvances(Number(res.total_advances || 0));
        setTotalNetPayable(Number(res.total_net_payable || 0));
        setWorkerCount(res.worker_count || res.rows.length);

        const mappedRows: WorkerPayrollRowItem[] = res.rows.map((r: any) => ({
          worker_id: r.worker_id,
          worker_name: r.worker_name,
          phone: r.phone,
          daily_wage: Number(r.daily_wage || 0),
          total_work_units: Number(r.total_work_units || r.total_days || 0),
          gross_earnings: Number(r.gross_earnings || 0),
          total_advances: Number(r.total_advances || 0),
          net_payable: Number(r.net_payable || 0),
          active: r.active !== undefined ? Boolean(r.active) : true,
          wage_breakdown: (r.wage_breakdown || []).map((wb: any) => ({
            rate: Number(wb.rate),
            work_units: Number(wb.work_units),
            earnings: Number(wb.earnings),
          })),
        }));
        mappedRows.sort((a, b) => a.worker_name.localeCompare(b.worker_name));
        setRows(mappedRows);
      }
    } catch {
      // Offline fallback: already loaded via computeLocalPayroll
    }
  }, [selectedYear, selectedMonth]);

  const loadPayroll = useCallback(async () => {
    computeLocalPayroll();
    setLoading(true);
    await fetchAuthoritativePayroll();
    setLoading(false);
  }, [computeLocalPayroll, fetchAuthoritativePayroll]);

  useEffect(() => {
    loadPayroll();
    const unsub = SyncManager.subscribe(() => {
      computeLocalPayroll();
      fetchAuthoritativePayroll();
    });
    return unsub;
  }, [loadPayroll, computeLocalPayroll, fetchAuthoritativePayroll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPayroll();
    setRefreshing(false);
  };

  // Salary slip opening & site breakdown calculation
  const handleOpenSlip = async (row: WorkerPayrollRowItem) => {
    setSelectedSlipWorker(row);
    setSlipModalOpen(true);
    setSlipLoading(true);
    setSlipSites([]);
    setSlipWageBreakdown(row.wage_breakdown || []);

    try {
      const detail = await ApiClient.getWorkerMonthly(row.worker_id, selectedYear, selectedMonth);
      if (detail && detail.sites_worked) {
        setSlipSites(
          detail.sites_worked.map((s: any) => ({
            site_id: s.site_id,
            site_name: s.site_name,
            work_units: Number(s.work_units),
            earnings: Number(s.earnings),
          }))
        );
        if (detail.wage_breakdown) {
          setSlipWageBreakdown(
            detail.wage_breakdown.map((wb: any) => ({
              rate: Number(wb.rate),
              work_units: Number(wb.work_units),
              earnings: Number(wb.earnings),
            }))
          );
        }
        setSlipLoading(false);
        return;
      }
    } catch {
      // Fallback to local computation
    }

    // Local site breakdown
    const { startDate, endDate } = getMonthDateRange(selectedYear, selectedMonth - 1);
    const atts = AttendanceRepository.getByDateRangeWithSites(startDate, endDate, accountId).filter(
      a => a.worker_id === row.worker_id
    );

    const siteMap: { [key: string]: SiteWorkedItem } = {};
    for (const a of atts) {
      const units = Number(a.work_units || 0);
      if (units <= 0) continue;
      const key = a.site_id || 'no_site';
      const name = a.site_name || 'No site assigned';
      const effWage = WageHistoryRepository.getEffectiveWage(
        row.worker_id,
        a.date,
        accountId,
        row.daily_wage
      );
      const earned = Math.round(units * effWage * 100) / 100;

      if (!siteMap[key]) {
        siteMap[key] = {
          site_id: a.site_id || null,
          site_name: name,
          work_units: 0,
          earnings: 0,
        };
      }
      siteMap[key].work_units += units;
      siteMap[key].earnings += earned;
    }

    setSlipSites(Object.values(siteMap));
    setSlipLoading(false);
  };

  const monthLabel = `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`;

  const formatCurrency = (val: number) => {
    const isNeg = val < 0;
    const absVal = Math.abs(val);
    const formatted = '₹' + absVal.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    return isNeg ? `-${formatted}` : formatted;
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title="Monthly Payroll"
        subtitle={monthLabel}
      />

      {/* Month Selector Capsule */}
      <View style={styles.monthCapsuleWrapper}>
        <View style={styles.monthCapsule}>
          <TouchableOpacity
            style={styles.monthNavBtn}
            onPress={handlePrevMonth}
            accessibilityLabel="Previous month"
            accessibilityRole="button"
          >
            <Icon name="chevron-left" size={18} color={Colors.textSecondary} strokeWidth={2.4} />
          </TouchableOpacity>

          <View style={styles.monthLabelContainer}>
            <Text style={styles.monthCapsuleText}>{monthLabel}</Text>
          </View>

          <TouchableOpacity
            style={styles.monthNavBtn}
            onPress={handleNextMonth}
            accessibilityLabel="Next month"
            accessibilityRole="button"
          >
            <Icon name="chevron-right" size={18} color={Colors.textSecondary} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={item => item.worker_id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerComponent}>
            {/* 4 Summary Cards Grid */}
            <View style={styles.summaryGrid}>
              {/* Card 1: Units Logged */}
              <View style={styles.summaryCard}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.iconCircleMuted}>
                    <Icon name="users" size={14} color={Colors.textPrimary} strokeWidth={2.2} />
                  </View>
                  <Text style={styles.cardHeaderLabel}>UNITS LOGGED</Text>
                </View>
                <Text style={styles.cardPrimaryValue}>{totalWorkUnits.toFixed(1)}</Text>
                <Text style={styles.cardSubtitle}>Days worked</Text>
              </View>

              {/* Card 2: Gross Labour */}
              <View style={styles.summaryCard}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.iconCircleMuted}>
                    <Icon name="banknote" size={14} color={Colors.textPrimary} strokeWidth={2.2} />
                  </View>
                  <Text style={styles.cardHeaderLabel}>GROSS LABOUR</Text>
                </View>
                <Text style={styles.cardPrimaryValue}>{formatCurrency(totalGrossWages)}</Text>
                <Text style={styles.cardSubtitle}>Earned wages</Text>
              </View>

              {/* Card 3: Advances Deducted */}
              <View style={styles.summaryCard}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.iconCircleRed}>
                    <Icon name="circle-minus" size={14} color={Colors.error} strokeWidth={2.2} />
                  </View>
                  <Text style={styles.cardHeaderLabel}>ADVANCES</Text>
                </View>
                <Text style={[styles.cardPrimaryValue, { color: Colors.error }]}>
                  {formatCurrency(totalAdvances)}
                </Text>
                <Text style={styles.cardSubtitle}>Cash deductions</Text>
              </View>

              {/* Card 4: Net Payable */}
              <View style={[styles.summaryCard, styles.summaryCardNet]}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.iconCircleOrange}>
                    <Icon name="file-text" size={14} color={Colors.accent} strokeWidth={2.2} />
                  </View>
                  <Text style={[styles.cardHeaderLabel, { color: Colors.accent }]}>NET PAYABLE</Text>
                </View>
                <Text style={[styles.cardPrimaryValue, { color: Colors.accent }]}>
                  {formatCurrency(totalNetPayable)}
                </Text>
                <Text style={styles.cardSubtitle}>Disbursable total</Text>
              </View>
            </View>

            {/* Section Header: Worker-wise Breakdown */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderTitle}>WORKER-WISE BREAKDOWN</Text>
              <Text style={styles.sectionHeaderCount}>
                {workerCount} workers · {totalWorkUnits.toFixed(1)} units
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="small" color={Colors.accent} />
              <Text style={styles.emptyText}>Computing monthly payroll...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBox}>
                <Icon name="calendar" size={24} color={Colors.textMuted} strokeWidth={2} />
              </View>
              <Text style={styles.emptyTitle}>No Worker Activity</Text>
              <Text style={styles.emptyText}>
                No worker activity recorded for {monthLabel}.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const hasAdvance = item.total_advances > 0;
          const multipleRates = item.wage_breakdown && item.wage_breakdown.length > 1;

          return (
            <TouchableOpacity
              style={styles.workerCard}
              activeOpacity={0.7}
              onPress={() => handleOpenSlip(item)}
              accessibilityRole="button"
              accessibilityLabel={`Salary slip for ${item.worker_name}`}
            >
              {/* Top Row: Initial Avatar + Name + Rates + Net Payable */}
              <View style={styles.workerCardTopRow}>
                <View style={styles.workerIdentityContainer}>
                  <View style={styles.avatarBox}>
                    <Text style={styles.avatarText}>
                      {item.worker_name ? item.worker_name.charAt(0).toUpperCase() : 'W'}
                    </Text>
                  </View>
                  <View style={styles.workerMetaBox}>
                    <Text style={styles.workerNameText} numberOfLines={1}>
                      {item.worker_name}
                    </Text>
                    <View style={styles.wageRateRow}>
                      <Text style={styles.wageRateText}>
                        Wage: {formatCurrency(item.daily_wage)}/day
                      </Text>
                      {multipleRates && (
                        <View style={styles.splitRateBadge}>
                          <Text style={styles.splitRateText}>
                            {item.wage_breakdown.length} rates
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>

                {/* Net Payable Column */}
                <View style={styles.workerNetBox}>
                  <Text style={styles.workerNetValue}>
                    {formatCurrency(item.net_payable)}
                  </Text>
                  <Text style={styles.workerNetLabel}>NET PAYABLE</Text>
                </View>
              </View>

              {/* 3-Column Metrics Strip: Units, Gross, Advances */}
              <View style={styles.metricStrip}>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Units</Text>
                  <Text style={styles.metricValue}>{item.total_work_units.toFixed(1)}</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Gross</Text>
                  <Text style={styles.metricValue}>{formatCurrency(item.gross_earnings)}</Text>
                </View>
                <View style={[styles.metricItem, { alignItems: 'flex-end' }]}>
                  <Text style={styles.metricLabel}>Advances</Text>
                  <Text
                    style={[
                      styles.metricValue,
                      hasAdvance ? { color: Colors.error } : { color: Colors.textSecondary },
                    ]}
                  >
                    {hasAdvance ? `-${formatCurrency(item.total_advances)}` : '₹0'}
                  </Text>
                </View>
              </View>

              {/* View Salary Slip Footer */}
              <View style={styles.cardFooterRow}>
                <Text style={styles.viewSlipText}>View Salary Slip</Text>
                <Icon name="chevron-right" size={14} color={Colors.accent} strokeWidth={2.4} />
              </View>
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={
          rows.length > 0 ? (
            <View style={styles.calcStandardBox}>
              <View style={styles.calcStandardLeft}>
                <Icon name="info" size={18} color={Colors.accent} strokeWidth={2.2} />
                <View style={styles.calcStandardTextContainer}>
                  <Text style={styles.calcStandardTitle}>Calculation Standard</Text>
                  <Text style={styles.calcStandardSubtitle}>
                    Net Payable = (Work Units × Daily Wage) − Advances
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setCalcInfoOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Details"
              >
                <Text style={styles.calcStandardDetailsLink}>Details</Text>
              </TouchableOpacity>
            </View>
          ) : undefined
        }
      />

      {/* Salary Slip Modal */}
      <Modal
        visible={slipModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSlipModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalHeaderTitle}>Salary Slip</Text>
                <Text style={styles.modalHeaderBrand}>Attendly</Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setSlipModalOpen(false)}
                accessibilityLabel="Close salary slip"
              >
                <Icon name="close" size={20} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {selectedSlipWorker && (
              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                {/* Worker Identity Card */}
                <View style={styles.slipIdentityCard}>
                  <Text style={styles.slipWorkerName}>{selectedSlipWorker.worker_name}</Text>
                  <Text style={styles.slipMonthSubtitle}>Month: {monthLabel}</Text>
                  <Text style={styles.slipWageSubtitle}>
                    {slipWageBreakdown.length > 1
                      ? `Wage Rates: ${slipWageBreakdown
                          .map(wb => `${formatCurrency(wb.rate)}/day`)
                          .join(', ')}`
                      : `Daily Wage: ${formatCurrency(selectedSlipWorker.daily_wage)} / day`}
                  </Text>
                </View>

                {/* Sites Worked Section */}
                <View style={styles.slipSection}>
                  <View style={styles.slipSectionHeader}>
                    <Text style={styles.slipSectionTitle}>Sites Worked</Text>
                    {slipLoading && (
                      <ActivityIndicator size="small" color={Colors.accent} />
                    )}
                  </View>

                  {slipLoading && slipSites.length === 0 ? (
                    <View style={styles.slipPlaceholderBox}>
                      <Text style={styles.slipPlaceholderText}>Loading site breakdown...</Text>
                    </View>
                  ) : slipSites.length === 0 ? (
                    <View style={styles.slipPlaceholderBox}>
                      <Text style={styles.slipPlaceholderText}>No sites worked this month</Text>
                    </View>
                  ) : (
                    <View style={styles.slipTable}>
                      <View style={styles.slipTableHeaderRow}>
                        <Text style={[styles.slipTableHeadCol, { flex: 2 }]}>Site Name</Text>
                        <Text style={[styles.slipTableHeadCol, { flex: 1, textAlign: 'center' }]}>
                          Units
                        </Text>
                        <Text style={[styles.slipTableHeadCol, { flex: 1.2, textAlign: 'right' }]}>
                          Earnings
                        </Text>
                      </View>
                      {slipSites.map((s, idx) => (
                        <View
                          key={s.site_id || idx}
                          style={[
                            styles.slipTableRow,
                            idx === slipSites.length - 1 && { borderBottomWidth: 0 },
                          ]}
                        >
                          <Text style={[styles.slipTableCell, { flex: 2, fontWeight: '600' }]}>
                            {s.site_name}
                          </Text>
                          <Text
                            style={[
                              styles.slipTableCell,
                              { flex: 1, textAlign: 'center', color: Colors.textSecondary },
                            ]}
                          >
                            {s.work_units.toFixed(1)}
                          </Text>
                          <Text
                            style={[
                              styles.slipTableCell,
                              { flex: 1.2, textAlign: 'right', fontWeight: '600' },
                            ]}
                          >
                            {formatCurrency(s.earnings)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Wage Rates Breakdown Table (if multiple rates applied) */}
                {slipWageBreakdown.length > 1 && (
                  <View style={styles.slipSection}>
                    <Text style={styles.slipSectionTitle}>Effective Wage Breakdown</Text>
                    <View style={styles.slipTable}>
                      <View style={styles.slipTableHeaderRow}>
                        <Text style={[styles.slipTableHeadCol, { flex: 1.5 }]}>Rate / day</Text>
                        <Text style={[styles.slipTableHeadCol, { flex: 1, textAlign: 'center' }]}>
                          Units
                        </Text>
                        <Text style={[styles.slipTableHeadCol, { flex: 1.2, textAlign: 'right' }]}>
                          Earned
                        </Text>
                      </View>
                      {slipWageBreakdown.map((wb, idx) => (
                        <View
                          key={idx}
                          style={[
                            styles.slipTableRow,
                            idx === slipWageBreakdown.length - 1 && { borderBottomWidth: 0 },
                          ]}
                        >
                          <Text style={[styles.slipTableCell, { flex: 1.5, fontWeight: '600' }]}>
                            {formatCurrency(wb.rate)}/day
                          </Text>
                          <Text
                            style={[
                              styles.slipTableCell,
                              { flex: 1, textAlign: 'center', color: Colors.textSecondary },
                            ]}
                          >
                            {wb.work_units.toFixed(1)}
                          </Text>
                          <Text
                            style={[
                              styles.slipTableCell,
                              { flex: 1.2, textAlign: 'right', fontWeight: '600' },
                            ]}
                          >
                            {formatCurrency(wb.earnings)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Financial Summary */}
                <View style={styles.slipFinancialCard}>
                  <View style={styles.slipFinancialRow}>
                    <Text style={styles.slipFinancialLabel}>Gross Wages Earned</Text>
                    <Text style={styles.slipFinancialValue}>
                      {formatCurrency(selectedSlipWorker.gross_earnings)}
                    </Text>
                  </View>
                  <View style={styles.slipFinancialRow}>
                    <Text style={styles.slipFinancialLabel}>Advances Deducted</Text>
                    <Text
                      style={[
                        styles.slipFinancialValue,
                        selectedSlipWorker.total_advances > 0 ? { color: Colors.error } : null,
                      ]}
                    >
                      {selectedSlipWorker.total_advances > 0
                        ? `-${formatCurrency(selectedSlipWorker.total_advances)}`
                        : '₹0'}
                    </Text>
                  </View>
                  <View style={styles.slipFinancialDivider} />
                  <View style={[styles.slipFinancialRow, { marginTop: 4 }]}>
                    <Text style={styles.slipNetLabel}>Net Payable</Text>
                    <Text style={styles.slipNetValue}>
                      {formatCurrency(selectedSlipWorker.net_payable)}
                    </Text>
                  </View>
                </View>

                {/* Close Button */}
                <TouchableOpacity
                  style={styles.modalPrimaryBtn}
                  onPress={() => setSlipModalOpen(false)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.modalPrimaryBtnText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Calculation Standard Info Modal */}
      <Modal
        visible={calcInfoOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setCalcInfoOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.calcModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeaderTitle}>Financial Calculation Standard</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setCalcInfoOpen(false)}
              >
                <Icon name="close" size={20} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.calcModalContent}>
              <Text style={styles.calcSectionTitle}>1. Daily Earnings</Text>
              <Text style={styles.calcBodyText}>
                Daily earnings = Work Units × Effective Daily Wage.
                Allowed work units are 0 (Absent), 0.5 (Half Day), 1.0 (Full Day), 1.5, and 2.0.
              </Text>

              <Text style={[styles.calcSectionTitle, { marginTop: Spacing.md }]}>
                2. Effective Wage Resolution
              </Text>
              <Text style={styles.calcBodyText}>
                When a worker’s wage changes during the month, attendance dates prior to the change
                use the rate in effect on that date. Attendance dates on or after the effective date
                use the revised rate.
              </Text>

              <Text style={[styles.calcSectionTitle, { marginTop: Spacing.md }]}>
                3. Advances & Net Payable
              </Text>
              <Text style={styles.calcBodyText}>
                Net Payable = Gross Labour − Total Advances.
                Advances are deducted exactly once during the month in which they occurred.
                If advances exceed gross earnings, the net payable reflects the negative outstanding
                balance.
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalPrimaryBtn, { marginTop: Spacing.md }]}
              onPress={() => setCalcInfoOpen(false)}
            >
              <Text style={styles.modalPrimaryBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  monthCapsuleWrapper: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  monthCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  monthNavBtn: {
    padding: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  monthLabelContainer: {
    flex: 1,
    alignItems: 'center',
  },
  monthCapsuleText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  headerComponent: {
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  summaryCard: {
    flexBasis: '47.5%',
    flexGrow: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md + 2,
  },
  summaryCardNet: {
    backgroundColor: Colors.accentLight,
    borderColor: Colors.accentBorder,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    marginBottom: Spacing.xs + 2,
  },
  iconCircleMuted: {
    width: 24,
    height: 24,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleRed: {
    width: 24,
    height: 24,
    borderRadius: BorderRadius.sm,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleOrange: {
    width: 24,
    height: 24,
    borderRadius: BorderRadius.sm,
    backgroundColor: '#ffedd5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.4,
  },
  cardPrimaryValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.4,
    lineHeight: 26,
  },
  cardSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
    marginBottom: Spacing.xs,
  },
  sectionHeaderTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  sectionHeaderCount: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  workerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  workerCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  workerIdentityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
    paddingRight: Spacing.sm,
  },
  avatarBox: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  workerMetaBox: {
    flex: 1,
  },
  workerNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
  },
  wageRateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    marginTop: 2,
  },
  wageRateText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  splitRateBadge: {
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: Colors.accentBorder,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.xs + 1,
    paddingVertical: 1,
  },
  splitRateText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.accent,
  },
  workerNetBox: {
    alignItems: 'flex-end',
  },
  workerNetValue: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.accent,
    letterSpacing: -0.3,
  },
  workerNetLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  metricStrip: {
    flexDirection: 'row',
    backgroundColor: '#fafaf9',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#f5f5f4',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  metricItem: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  cardFooterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.md,
  },
  viewSlipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.accent,
  },
  calcStandardBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceMuted,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  calcStandardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
    flex: 1,
  },
  calcStandardTextContainer: {
    flex: 1,
  },
  calcStandardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  calcStandardSubtitle: {
    fontSize: 10.5,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  calcStandardDetailsLink: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
    paddingLeft: Spacing.sm,
  },
  emptyContainer: {
    paddingVertical: Spacing.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconBox: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '85%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalHeaderBrand: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: Spacing.xs,
  },
  modalScroll: {
    padding: Spacing.lg,
  },
  slipIdentityCard: {
    backgroundColor: Colors.surfaceMuted,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  slipWorkerName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  slipMonthSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  slipWageSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  slipSection: {
    marginBottom: Spacing.lg,
  },
  slipSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs + 2,
  },
  slipSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs + 2,
  },
  slipPlaceholderBox: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceMuted,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  slipPlaceholderText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  slipTable: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  slipTableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceMuted,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  slipTableHeadCol: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  slipTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  slipTableCell: {
    fontSize: 12,
    color: Colors.textPrimary,
  },
  slipFinancialCard: {
    backgroundColor: '#fff7ed',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accentBorder,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  slipFinancialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  slipFinancialLabel: {
    fontSize: 12,
    color: '#78716c',
  },
  slipFinancialValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  slipFinancialDivider: {
    height: 1,
    backgroundColor: Colors.accentBorder,
    marginVertical: Spacing.xs + 2,
  },
  slipNetLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#c2410c',
  },
  slipNetValue: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.accent,
  },
  modalPrimaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  modalPrimaryBtnText: {
    color: Colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  calcModalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    maxHeight: '70%',
  },
  calcModalContent: {
    marginTop: Spacing.md,
  },
  calcSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  calcBodyText: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
