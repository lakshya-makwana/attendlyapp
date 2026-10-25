import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../theme/tokens';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/Cards';
import { WageHistoryModal } from '../components/WageHistoryModal';
import { UpdateSalaryModal } from '../components/UpdateSalaryModal';
import { WorkerRepository, LocalWorker } from '../repositories/workerRepository';
import { AttendanceRepository } from '../repositories/attendanceRepository';
import { AdvanceRepository } from '../repositories/advanceRepository';
import { WageHistoryRepository } from '../repositories/wageHistoryRepository';
import { SyncManager, SyncState } from '../sync/syncManager';
import { ApiClient } from '../api/client';

export interface WorkerDetailScreenProps {
  workerId: string;
  accountId: string | null;
  onBack: () => void;
}

interface MonthlyAttendanceRow {
  id: string;
  date: string;
  site_id: string | null;
  site_name: string;
  work_units: number;
  daily_wage: number;
  earnings: number;
}

interface MonthlyAdvanceRow {
  id: string;
  date: string;
  amount: number;
  note?: string | null;
}

interface WageTier {
  rate: number;
  work_units: number;
  earnings: number;
}

export const WorkerDetailScreen: React.FC<WorkerDetailScreenProps> = ({
  workerId,
  accountId,
  onBack,
}) => {
  const [worker, setWorker] = useState<LocalWorker | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'attendance' | 'advances'>('attendance');

  // Month navigation
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-12

  // Financial Summary
  const [totalUnits, setTotalUnits] = useState(0);
  const [grossEarnings, setGrossEarnings] = useState(0);
  const [totalAdvances, setTotalAdvances] = useState(0);
  const [netPayable, setNetPayable] = useState(0);
  const [wageTiers, setWageTiers] = useState<WageTier[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<MonthlyAttendanceRow[]>([]);
  const [advanceRows, setAdvanceRows] = useState<MonthlyAdvanceRow[]>([]);

  // Modals
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const [wageHistoryOpen, setWageHistoryOpen] = useState(false);
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceDate, setAdvanceDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [advanceNote, setAdvanceNote] = useState('');
  const [advanceSaving, setAdvanceSaving] = useState(false);
  const [advanceError, setAdvanceError] = useState('');

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
  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === (now.getMonth() + 1);

  // Format Currency
  const formatINR = (val: number) => {
    return '₹' + Math.round(val).toLocaleString('en-IN');
  };

  // Local-first calculation
  const computeLocalRecords = useCallback(() => {
    if (!workerId) return;
    const effectiveAccId = accountId || 'default';
    const w = WorkerRepository.getById(workerId, effectiveAccId);
    if (w) setWorker(w);

    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
    const startDate = `${selectedYear}-${pad(selectedMonth)}-01`;
    const endDate = `${selectedYear}-${pad(selectedMonth)}-${pad(lastDay)}`;

    // Attendance
    const allAtts = AttendanceRepository.getByDateRangeWithSites(startDate, endDate, effectiveAccId);
    const workerAtts = allAtts.filter(a => a.worker_id === workerId);

    let unitsSum = 0;
    let grossSum = 0;
    const tierMap: { [rate: number]: { units: number; earnings: number } } = {};
    const attList: MonthlyAttendanceRow[] = [];

    for (const a of workerAtts) {
      const units = Number(a.work_units || 0);
      unitsSum += units;
      const baseRate = Number(w?.daily_wage || 0);
      const effRate = WageHistoryRepository.getEffectiveWage(workerId, a.date, effectiveAccId, baseRate);
      const earned = Math.round(units * effRate * 100) / 100;
      grossSum += earned;

      if (units > 0) {
        if (!tierMap[effRate]) tierMap[effRate] = { units: 0, earnings: 0 };
        tierMap[effRate].units += units;
        tierMap[effRate].earnings += earned;
      }

      attList.push({
        id: a.id,
        date: a.date,
        site_id: a.site_id,
        site_name: a.site_name || 'No site assigned',
        work_units: units,
        daily_wage: effRate,
        earnings: earned,
      });
    }

    // Sort attendance descending by date
    attList.sort((a, b) => b.date.localeCompare(a.date));

    // Advances
    const allAdvs = AdvanceRepository.getByDateRange(startDate, endDate, effectiveAccId);
    const workerAdvs = allAdvs.filter(adv => adv.worker_id === workerId);
    let advSum = 0;
    const advList: MonthlyAdvanceRow[] = [];

    for (const adv of workerAdvs) {
      const amt = Number(adv.amount || 0);
      advSum += amt;
      advList.push({
        id: adv.id,
        date: adv.date,
        amount: amt,
        note: adv.note,
      });
    }

    // Sort advances descending by date
    advList.sort((a, b) => b.date.localeCompare(a.date));

    const tiers: WageTier[] = Object.entries(tierMap).map(([rate, d]) => ({
      rate: Number(rate),
      work_units: Math.round(d.units * 10) / 10,
      earnings: Math.round(d.earnings * 100) / 100,
    }));
    tiers.sort((a, b) => b.rate - a.rate);

    setTotalUnits(Math.round(unitsSum * 10) / 10);
    setGrossEarnings(Math.round(grossSum * 100) / 100);
    setTotalAdvances(Math.round(advSum * 100) / 100);
    setNetPayable(Math.round((grossSum - advSum) * 100) / 100);
    setWageTiers(tiers);
    setAttendanceRows(attList);
    setAdvanceRows(advList);
  }, [workerId, accountId, selectedYear, selectedMonth]);

  // Server sync fetch
  const fetchServerRecords = useCallback(async () => {
    if (!workerId) return;
    try {
      const [detailRes, monthlyRes] = await Promise.all([
        ApiClient.getWorkerDetail(workerId).catch(() => null),
        ApiClient.getWorkerMonthly(workerId, selectedYear, selectedMonth).catch(() => null),
      ]);

      if (detailRes && detailRes.worker) {
        setWorker(prev => ({
          ...(prev || {
            id: workerId,
            account_id: accountId || 'default',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sync_status: 'SYNCED' as const,
          }),
          name: detailRes.worker.name,
          phone: detailRes.worker.phone,
          daily_wage: detailRes.worker.daily_wage,
          is_active: detailRes.worker.is_active,
        }));
      }

      if (monthlyRes) {
        setTotalUnits(Number(monthlyRes.total_work_units || 0));
        setGrossEarnings(Number(monthlyRes.gross_earnings || 0));
        setTotalAdvances(Number(monthlyRes.total_advances || 0));
        setNetPayable(Number(monthlyRes.net_payable || 0));

        if (monthlyRes.wage_breakdown) {
          setWageTiers(
            monthlyRes.wage_breakdown.map((wb: any) => ({
              rate: Number(wb.rate),
              work_units: Number(wb.work_units),
              earnings: Number(wb.earnings),
            }))
          );
        }

        if (monthlyRes.attendance && monthlyRes.attendance.length > 0) {
          setAttendanceRows(
            monthlyRes.attendance.map((a: any) => ({
              id: a.id,
              date: a.date,
              site_id: a.site_id,
              site_name: a.site_name || 'No site assigned',
              work_units: Number(a.work_units),
              daily_wage: Number(a.daily_wage),
              earnings: Number(a.earnings),
            }))
          );
        }

        if (monthlyRes.advances && monthlyRes.advances.length > 0) {
          setAdvanceRows(
            monthlyRes.advances.map((adv: any) => ({
              id: adv.id,
              date: adv.date,
              amount: Number(adv.amount),
              note: adv.note,
            }))
          );
        }
      }
    } catch {
      // Offline fallback already loaded via computeLocalRecords
    }
  }, [workerId, accountId, selectedYear, selectedMonth]);

  const loadData = useCallback(async () => {
    setLoading(true);
    computeLocalRecords();
    await fetchServerRecords();
    setLoading(false);
  }, [computeLocalRecords, fetchServerRecords]);

  useEffect(() => {
    loadData();
    const unsub = SyncManager.subscribe(state => {
      setSyncState(state);
      computeLocalRecords();
      fetchServerRecords();
    });
    return unsub;
  }, [loadData, computeLocalRecords, fetchServerRecords]);

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

  const handleCurrentMonth = () => {
    setSelectedYear(now.getFullYear());
    setSelectedMonth(now.getMonth() + 1);
  };

  const handlePhoneCall = () => {
    if (!worker?.phone) return;
    const url = `tel:${worker.phone}`;
    Linking.canOpenURL(url).then(supported => {
      if (supported) Linking.openURL(url);
    });
  };

  const handleToggleStatus = () => {
    if (!worker) return;
    const newStatus = !worker.is_active;
    const actionText = newStatus ? 'Activate' : 'Deactivate';

    Alert.alert(
      `${actionText} Worker`,
      `Are you sure you want to mark ${worker.name} as ${newStatus ? 'active' : 'inactive'}? All historical attendance and wage records will remain intact.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: actionText,
          style: newStatus ? 'default' : 'destructive',
          onPress: async () => {
            try {
              WorkerRepository.save({
                ...worker,
                is_active: newStatus,
              });
              setWorker(prev => (prev ? { ...prev, is_active: newStatus } : null));
              await ApiClient.toggleWorkerStatus(worker.id).catch(() => null);
              SyncManager.triggerSync();
            } catch {
              Alert.alert('Error', 'Failed to update worker status.');
            }
          },
        },
      ]
    );
  };

  const handleOpenAddAdvance = () => {
    setAdvanceAmount('');
    setAdvanceNote('');
    setAdvanceDate(new Date().toISOString().split('T')[0]);
    setAdvanceError('');
    setAdvanceModalOpen(true);
  };

  const handleSaveAdvance = async () => {
    const amt = parseFloat(advanceAmount);
    if (isNaN(amt) || amt <= 0) {
      setAdvanceError('Please enter a valid advance amount greater than 0.');
      return;
    }

    setAdvanceSaving(true);
    setAdvanceError('');
    try {
      const effectiveAccId = accountId || 'default';
      AdvanceRepository.recordAdvance({
        account_id: effectiveAccId,
        worker_id: workerId,
        amount: amt,
        date: advanceDate,
        note: advanceNote.trim() || undefined,
      });

      setAdvanceModalOpen(false);
      computeLocalRecords();
      SyncManager.triggerSync();
      await fetchServerRecords();
    } catch {
      setAdvanceError('Failed to record advance.');
    } finally {
      setAdvanceSaving(false);
    }
  };

  const handleDeleteAdvance = (advId: string) => {
    Alert.alert(
      'Delete Advance',
      'Are you sure you want to delete this cash advance record? This will adjust net payable for this month.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const effectiveAccId = accountId || 'default';
              AdvanceRepository.delete(advId, effectiveAccId);
              computeLocalRecords();
              await ApiClient.deleteAdvance(advId).catch(() => null);
              SyncManager.triggerSync();
              fetchServerRecords();
            } catch {
              Alert.alert('Error', 'Failed to delete advance.');
            }
          },
        },
      ]
    );
  };

  const isPositiveNet = netPayable >= 0;

  return (
    <View style={styles.container}>
      {/* Top Bar with Back Button */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          accessibilityLabel="Back to workers roster"
          accessibilityRole="button"
        >
          <Icon name="arrow-left" size={18} color={Colors.textPrimary} strokeWidth={2} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {worker?.name || 'Worker Detail'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {worker?.is_active ? 'Active Worker' : 'Inactive Worker'} · Attendly
          </Text>
        </View>

        {!syncState.isOnline && (
          <View style={styles.offlineBadge}>
            <Icon name="cloud-off" size={12} color={Colors.textSecondary} />
            <Text style={styles.offlineText}>Offline</Text>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Worker Hero Profile Card */}
        <View style={[styles.heroCard, !worker?.is_active && styles.heroCardInactive]}>
          <View style={styles.heroTopRow}>
            <View
              style={[
                styles.avatarLarge,
                !worker?.is_active && styles.avatarInactive,
              ]}
            >
              <Text
                style={[
                  styles.avatarLargeText,
                  !worker?.is_active && styles.avatarTextInactive,
                ]}
              >
                {worker?.name ? worker.name.charAt(0).toUpperCase() : 'W'}
              </Text>
            </View>

            <View style={styles.heroMainDetails}>
              <View style={styles.heroNameRow}>
                <Text style={styles.workerHeroName} numberOfLines={1}>
                  {worker?.name}
                </Text>
                <StatusPill
                  label={worker?.is_active ? 'Active' : 'Inactive'}
                  status={worker?.is_active ? 'active' : 'inactive'}
                />
              </View>

              <View style={styles.heroMetaRow}>
                <TouchableOpacity
                  style={styles.wagePill}
                  onPress={() => setWageHistoryOpen(true)}
                  activeOpacity={0.7}
                  accessibilityLabel="View wage history"
                  accessibilityRole="button"
                >
                  <Text style={styles.wagePillText}>
                    Wage: <Text style={styles.wagePillBold}>₹{worker?.daily_wage || 0}/day</Text>
                  </Text>
                  <Icon name="wage-history" size={12} color={Colors.accent} strokeWidth={2} />
                </TouchableOpacity>

                {worker?.phone ? (
                  <TouchableOpacity
                    style={styles.phonePill}
                    onPress={handlePhoneCall}
                    accessibilityLabel={`Call ${worker.phone}`}
                    accessibilityRole="button"
                  >
                    <Icon name="phone" size={12} color={Colors.textSecondary} strokeWidth={2} />
                    <Text style={styles.phonePillText}>{worker.phone}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>

          {/* Quick Action Buttons Row */}
          <View style={styles.heroActionRow}>
            <TouchableOpacity
              style={styles.actionBtnOutline}
              onPress={() => setSalaryModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Update daily wage salary"
            >
              <Icon name="rupee" size={14} color={Colors.textPrimary} strokeWidth={2.2} />
              <Text style={styles.actionBtnOutlineText}>Update Salary</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtnPrimary}
              onPress={handleOpenAddAdvance}
              accessibilityRole="button"
              accessibilityLabel="Give advance"
            >
              <Icon name="plus" size={14} color="#ffffff" strokeWidth={2.2} />
              <Text style={styles.actionBtnPrimaryText}>Give Advance</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionBtnStatus,
                worker?.is_active ? styles.actionBtnDeactivate : styles.actionBtnActivate,
              ]}
              onPress={handleToggleStatus}
              accessibilityRole="button"
              accessibilityLabel={worker?.is_active ? 'Mark Inactive' : 'Mark Active'}
            >
              <Text
                style={[
                  styles.actionBtnStatusText,
                  worker?.is_active ? styles.textDeactivate : styles.textActivate,
                ]}
              >
                {worker?.is_active ? 'Mark Inactive' : 'Mark Active'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Inactive Worker Warning Banner */}
        {!worker?.is_active && (
          <View style={styles.inactiveBanner}>
            <Icon name="info" size={15} color={Colors.textSecondary} strokeWidth={2} />
            <Text style={styles.inactiveBannerText}>
              This worker is currently inactive and excluded from recording new attendance. All historical shifts, wages, and advances remain intact.
            </Text>
          </View>
        )}

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
            {!isCurrentMonth && (
              <TouchableOpacity
                style={styles.currentMonthBadge}
                onPress={handleCurrentMonth}
                accessibilityRole="button"
                accessibilityLabel="Jump to current month"
              >
                <Text style={styles.currentMonthBadgeText}>Current</Text>
              </TouchableOpacity>
            )}
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

        {/* 4 Financial Summary KPI Cards Grid */}
        <View style={styles.kpiGrid}>
          {/* Total Units */}
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>TOTAL UNITS</Text>
            <Text style={styles.kpiValue}>{totalUnits.toFixed(1)}</Text>
            <Text style={styles.kpiSubtitle}>{selectedMonthLabel}</Text>
          </View>

          {/* Gross Earnings */}
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>GROSS EARNINGS</Text>
            <Text style={styles.kpiValue}>{formatINR(grossEarnings)}</Text>
            <Text
              style={[
                styles.kpiSubtitle,
                wageTiers.length > 1 && styles.multiRateSubtitle,
              ]}
            >
              {wageTiers.length > 1
                ? `${wageTiers.length} rates in month`
                : 'Units × Daily Rate'}
            </Text>
          </View>

          {/* Advances */}
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>ADVANCES</Text>
            <Text style={[styles.kpiValue, totalAdvances > 0 && styles.advancesDueValue]}>
              {formatINR(totalAdvances)}
            </Text>
            <Text style={styles.kpiSubtitle}>Monthly Deductions</Text>
          </View>

          {/* Net Payable */}
          <View style={[styles.kpiCard, isPositiveNet ? styles.kpiCardNetPositive : styles.kpiCardNetNegative]}>
            <Text style={[styles.kpiLabel, isPositiveNet ? styles.kpiLabelNetPositive : styles.kpiLabelNetNegative]}>
              NET PAYABLE
            </Text>
            <Text style={[styles.kpiValue, isPositiveNet ? styles.netPayablePositive : styles.netPayableNegative]}>
              {formatINR(netPayable)}
            </Text>
            <Text style={[styles.kpiSubtitle, isPositiveNet ? styles.netSubPositive : styles.netSubNegative]}>
              {isPositiveNet ? 'Disbursable' : 'Advance Due'}
            </Text>
          </View>
        </View>

        {/* Multi-Wage Rate Breakdown Banner */}
        {wageTiers.length > 1 && (
          <View style={styles.wageBreakdownBanner}>
            <View style={styles.wageBreakdownHeader}>
              <Icon name="info" size={14} color={Colors.accent} strokeWidth={2} />
              <Text style={styles.wageBreakdownTitle}>
                Multiple Wage Rates Applied ({wageTiers.length} rates)
              </Text>
            </View>
            {wageTiers.map(tier => (
              <View key={tier.rate} style={styles.wageTierRow}>
                <Text style={styles.wageTierRate}>₹{tier.rate}/day</Text>
                <Text style={styles.wageTierUnits}>{tier.work_units} units</Text>
                <Text style={styles.wageTierEarned}>{formatINR(tier.earnings)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Tabs: Attendance vs Advances */}
        <View style={styles.tabsHeader}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'attendance' && styles.tabBtnActive]}
            onPress={() => setActiveTab('attendance')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'attendance' }}
            accessibilityLabel={`Attendance tab, ${attendanceRows.length} entries`}
          >
            <Icon
              name="calendar-check"
              size={15}
              color={activeTab === 'attendance' ? Colors.textPrimary : Colors.textSecondary}
              strokeWidth={2}
            />
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'attendance' && styles.tabBtnTextActive,
              ]}
            >
              Attendance ({attendanceRows.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'advances' && styles.tabBtnActive]}
            onPress={() => setActiveTab('advances')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'advances' }}
            accessibilityLabel={`Advances tab, ${advanceRows.length} entries`}
          >
            <Icon
              name="wallet"
              size={15}
              color={activeTab === 'advances' ? Colors.textPrimary : Colors.textSecondary}
              strokeWidth={2}
            />
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'advances' && styles.tabBtnTextActive,
              ]}
            >
              Advances ({advanceRows.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab 1: Attendance List */}
        {activeTab === 'attendance' && (
          <View style={styles.tabContentContainer}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={Colors.textPrimary} />
                <Text style={styles.loadingBoxText}>Loading attendance records...</Text>
              </View>
            ) : attendanceRows.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyBoxTitle}>No Attendance Records</Text>
                <Text style={styles.emptyBoxSubtitle}>
                  No shifts or work units recorded for {selectedMonthLabel}.
                </Text>
              </View>
            ) : (
              attendanceRows.map(row => (
                <View key={row.id} style={styles.recordCard}>
                  <View style={styles.recordLeftCol}>
                    <Text style={styles.recordDate}>{row.date}</Text>
                    <View style={styles.siteRow}>
                      <Icon name="pin" size={12} color={Colors.textSecondary} strokeWidth={1.8} />
                      <Text style={styles.recordSite} numberOfLines={1}>
                        {row.site_name}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.recordRightCol}>
                    <View style={styles.unitsPill}>
                      <Text style={styles.unitsPillText}>
                        {row.work_units === 1
                          ? '1.0 Full'
                          : row.work_units === 0.5
                          ? '0.5 Half'
                          : row.work_units === 0
                          ? 'Absent'
                          : `${row.work_units} Units`}
                      </Text>
                    </View>
                    <Text style={styles.recordEarned}>{formatINR(row.earnings)}</Text>
                    <Text style={styles.recordRate}>@ ₹{row.daily_wage}/day</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Tab 2: Advances List */}
        {activeTab === 'advances' && (
          <View style={styles.tabContentContainer}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={Colors.textPrimary} />
                <Text style={styles.loadingBoxText}>Loading advances ledger...</Text>
              </View>
            ) : advanceRows.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyBoxTitle}>No Advances in {selectedMonthLabel}</Text>
                <Text style={styles.emptyBoxSubtitle}>
                  No cash deductions recorded for this worker in this calendar month.
                </Text>
                <TouchableOpacity
                  style={styles.addAdvanceFirstBtn}
                  onPress={handleOpenAddAdvance}
                  accessibilityRole="button"
                >
                  <Text style={styles.addAdvanceFirstBtnText}>+ Give Advance</Text>
                </TouchableOpacity>
              </View>
            ) : (
              advanceRows.map(adv => (
                <View key={adv.id} style={styles.advanceCard}>
                  <View style={styles.advanceInfo}>
                    <Text style={styles.advanceDate}>{adv.date}</Text>
                    {adv.note ? (
                      <Text style={styles.advanceNote} numberOfLines={2}>
                        {adv.note}
                      </Text>
                    ) : (
                      <Text style={styles.advanceNoteMuted}>Cash advance</Text>
                    )}
                  </View>

                  <View style={styles.advanceRight}>
                    <Text style={styles.advanceAmount}>-{formatINR(adv.amount)}</Text>
                    <TouchableOpacity
                      style={styles.deleteAdvBtn}
                      onPress={() => handleDeleteAdvance(adv.id)}
                      accessibilityRole="button"
                      accessibilityLabel="Delete advance"
                    >
                      <Icon name="trash" size={13} color={Colors.errorText} strokeWidth={1.8} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Give Advance Modal */}
      <Modal
        visible={advanceModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setAdvanceModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalTopBar}>
              <Text style={styles.modalTitle}>Give Advance to {worker?.name}</Text>
              <TouchableOpacity
                onPress={() => setAdvanceModalOpen(false)}
                style={styles.modalCloseBtn}
                accessibilityRole="button"
              >
                <Icon name="close" size={18} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {advanceError ? (
              <View style={styles.modalErrorBanner}>
                <Text style={styles.modalErrorText}>{advanceError}</Text>
              </View>
            ) : null}

            <Text style={styles.inputLabel}>Advance Amount (₹) *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 500"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="numeric"
              value={advanceAmount}
              onChangeText={setAdvanceAmount}
            />

            <Text style={styles.inputLabel}>Date (YYYY-MM-DD) *</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textTertiary}
              value={advanceDate}
              onChangeText={setAdvanceDate}
            />

            <Text style={styles.inputLabel}>Notes / Purpose (Optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="e.g. Festival advance, emergency cash"
              placeholderTextColor={Colors.textTertiary}
              value={advanceNote}
              onChangeText={setAdvanceNote}
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setAdvanceModalOpen(false)}
                disabled={advanceSaving}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleSaveAdvance}
                disabled={advanceSaving}
              >
                {advanceSaving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Record Advance</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Update Salary Modal Integration */}
      {worker && (
        <UpdateSalaryModal
          visible={salaryModalOpen}
          worker={worker}
          accountId={accountId || 'default'}
          onClose={() => setSalaryModalOpen(false)}
          onSalaryUpdated={(_newWage, _effDate) => {
            computeLocalRecords();
            fetchServerRecords();
          }}
        />
      )}

      {/* Wage History Modal Integration */}
      {worker && (
        <WageHistoryModal
          visible={wageHistoryOpen}
          worker={worker}
          accountId={accountId || 'default'}
          onClose={() => setWageHistoryOpen(false)}
          onWageUpdated={() => {
            computeLocalRecords();
            fetchServerRecords();
          }}
        />
      )}
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
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    gap: 4,
  },
  offlineText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  heroCardInactive: {
    opacity: 0.85,
    backgroundColor: '#fafafa',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarLarge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  avatarInactive: {
    backgroundColor: '#f4f4f5',
    borderColor: '#e4e4e7',
  },
  avatarLargeText: {
    fontSize: Typography.fontSize.lg,
    fontWeight: '700',
    color: Colors.accent,
  },
  avatarTextInactive: {
    color: Colors.textSecondary,
  },
  heroMainDetails: {
    flex: 1,
  },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  workerHeroName: {
    fontSize: Typography.fontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
    flex: 1,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  wagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: '#fed7aa',
    gap: 4,
  },
  wagePillText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
  },
  wagePillBold: {
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  phonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  phonePillText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  heroActionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#f4f4f5',
  },
  actionBtnOutline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#ffffff',
    gap: 5,
  },
  actionBtnOutlineText: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  actionBtnPrimary: {
    flex: 1.1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: BorderRadius.md,
    backgroundColor: '#09090b',
    gap: 5,
  },
  actionBtnPrimaryText: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '700',
    color: '#ffffff',
  },
  actionBtnStatus: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnDeactivate: {
    backgroundColor: '#ffffff',
    borderColor: Colors.border,
  },
  actionBtnActivate: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  actionBtnStatusText: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '600',
  },
  textDeactivate: {
    color: Colors.textSecondary,
  },
  textActivate: {
    color: Colors.success,
  },
  inactiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4f5',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  inactiveBannerText: {
    flex: 1,
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 16,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  monthLabelText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  currentMonthBadge: {
    backgroundColor: '#fff7ed',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  currentMonthBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.accent,
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
  kpiCardNetPositive: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
  },
  kpiCardNetNegative: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.4,
  },
  kpiLabelNetPositive: {
    color: '#c2410c',
  },
  kpiLabelNetNegative: {
    color: '#b91c1c',
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginVertical: 2,
  },
  advancesDueValue: {
    color: '#dc2626',
  },
  netPayablePositive: {
    color: Colors.accent,
  },
  netPayableNegative: {
    color: '#dc2626',
  },
  kpiSubtitle: {
    fontSize: 10,
    color: Colors.textTertiary,
  },
  multiRateSubtitle: {
    color: Colors.accent,
    fontWeight: '700',
  },
  netSubPositive: {
    color: '#9a3412',
    fontWeight: '600',
  },
  netSubNegative: {
    color: '#991b1b',
    fontWeight: '600',
  },
  wageBreakdownBanner: {
    backgroundColor: '#fff7ed',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#fed7aa',
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  wageBreakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  wageBreakdownTitle: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '700',
    color: '#c2410c',
  },
  wageTierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  wageTierRate: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  wageTierUnits: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
  },
  wageTierEarned: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '700',
    color: Colors.accent,
  },
  tabsHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.accent,
  },
  tabBtnText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  tabBtnTextActive: {
    color: Colors.textPrimary,
    fontWeight: '700',
  },
  tabContentContainer: {
    paddingTop: 4,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingVertical: 36,
    paddingHorizontal: 20,
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
  addAdvanceFirstBtn: {
    marginTop: 14,
    backgroundColor: '#09090b',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
  },
  addAdvanceFirstBtnText: {
    color: '#ffffff',
    fontSize: Typography.fontSize.xs,
    fontWeight: '700',
  },
  recordCard: {
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recordLeftCol: {
    flex: 1,
  },
  recordDate: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  siteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  recordSite: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
  },
  recordRightCol: {
    alignItems: 'flex-end',
  },
  unitsPill: {
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    marginBottom: 2,
  },
  unitsPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  recordEarned: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  recordRate: {
    fontSize: 10,
    color: Colors.textTertiary,
  },
  advanceCard: {
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  advanceInfo: {
    flex: 1,
  },
  advanceDate: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  advanceNote: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  advanceNoteMuted: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textTertiary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  advanceRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  advanceAmount: {
    fontSize: Typography.fontSize.md,
    fontWeight: '700',
    color: '#dc2626',
  },
  deleteAdvBtn: {
    padding: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  modalTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: Typography.fontSize.md,
    fontWeight: '700',
    color: Colors.textPrimary,
    flex: 1,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalErrorBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 8,
    borderRadius: BorderRadius.sm,
    marginBottom: 10,
  },
  modalErrorText: {
    fontSize: Typography.fontSize.xs,
    color: '#dc2626',
  },
  inputLabel: {
    fontSize: Typography.fontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 4,
    marginTop: 6,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: Typography.fontSize.sm,
    color: Colors.textPrimary,
  },
  textArea: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  modalSubmitBtn: {
    flex: 1.5,
    paddingVertical: 11,
    borderRadius: BorderRadius.sm,
    backgroundColor: '#09090b',
    alignItems: 'center',
  },
  modalSubmitBtnText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: '700',
    color: '#ffffff',
  },
});
