import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import { Colors, Spacing, BorderRadius } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';
import { WorkUnitSelector } from '../components/WorkUnitSelector';
import { OfflineBanner } from '../components/Cards';
import { WorkerRepository, LocalWorker } from '../repositories/workerRepository';
import { WageHistoryRepository } from '../repositories/wageHistoryRepository';
import { SiteRepository, LocalSite } from '../repositories/siteRepository';
import { AttendanceRepository, LocalAttendance } from '../repositories/attendanceRepository';
import { SyncManager } from '../sync/syncManager';
import {
  toLocalDateString,
  shiftDays,
  formatDateIndian,
  formatDisplayDate,
} from '../utils/dateUtils';
import { Icon } from '../components/Icon';

interface AttendanceScreenProps {
  accountId: string;
  onNavigateHome: () => void;
}

interface WorkerDraftRecord {
  work_units: number | null; // null represents Unmarked/Pending
  site_id: string | null;
  notes?: string | null;
  sync_status?: 'SYNCED' | 'PENDING' | 'FAILED';
}

export const AttendanceScreen: React.FC<AttendanceScreenProps> = ({
  accountId,
  onNavigateHome,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(() => toLocalDateString());
  const [workers, setWorkers] = useState<LocalWorker[]>([]);
  const [sites, setSites] = useState<LocalSite[]>([]);
  const [selectedSiteFilter, setSelectedSiteFilter] = useState<string>('all');
  const [records, setRecords] = useState<Record<string, WorkerDraftRecord>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  // Modal states
  const [bulkSiteModalVisible, setBulkSiteModalVisible] = useState<boolean>(false);
  const [bulkSiteId, setBulkSiteId] = useState<string>('');
  const [workerSiteModal, setWorkerSiteModal] = useState<{
    visible: boolean;
    workerId: string | null;
    workerName: string;
  }>({ visible: false, workerId: null, workerName: '' });

  const [syncState, setSyncState] = useState({
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncTime: null as string | null,
  });

  const showFeedback = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setFeedback({ message, type });
    setTimeout(() => {
      setFeedback(prev => (prev?.message === message ? null : prev));
    }, 3500);
  }, []);

  const loadData = useCallback(() => {
    try {
      setIsLoading(true);
      const wList = WorkerRepository.getAll(accountId, true);
      const sList = SiteRepository.getAll(accountId, true);
      setWorkers(wList);
      setSites(sList);

      if (sList.length > 0 && !bulkSiteId) {
        setBulkSiteId(sList[0].id);
      }

      // Load attendance records for this date from local SQLite
      const existing = AttendanceRepository.getByDate(selectedDate, accountId);
      const map: Record<string, LocalAttendance> = {};
      for (const r of existing) {
        map[r.worker_id] = r;
      }

      const initialDraft: Record<string, WorkerDraftRecord> = {};
      for (const w of wList) {
        const saved = map[w.id];
        if (saved) {
          initialDraft[w.id] = {
            work_units: Number(saved.work_units),
            site_id: saved.site_id,
            notes: saved.notes || null,
            sync_status: saved.sync_status,
          };
        } else {
          // Unmarked / Pending according to PWA contract
          initialDraft[w.id] = {
            work_units: null,
            site_id: sList.length > 0 ? sList[0].id : null,
            notes: null,
            sync_status: undefined,
          };
        }
      }
      setRecords(initialDraft);
    } catch {
      showFeedback('Failed to load local attendance records.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [accountId, selectedDate, bulkSiteId, showFeedback]);

  useEffect(() => {
    loadData();
    const unsub = SyncManager.subscribe(state => {
      setSyncState(state);
    });
    return unsub;
  }, [loadData]);

  // Date Navigation
  const handlePrevDay = () => {
    setSelectedDate(prev => shiftDays(prev, -1));
  };

  const handleNextDay = () => {
    setSelectedDate(prev => shiftDays(prev, 1));
  };

  const handleGoToToday = () => {
    setSelectedDate(toLocalDateString());
  };

  // Work unit controls
  const handleWorkUnitSelect = (workerId: string, val: number) => {
    setRecords(prev => {
      const current = prev[workerId] || { work_units: null, site_id: null, notes: null };
      const defaultSite = current.site_id || (sites.length > 0 ? sites[0].id : null);
      return {
        ...prev,
        [workerId]: {
          ...current,
          work_units: val,
          // Absent records have null site attribution consistently with the PWA
          site_id: val > 0 ? defaultSite : null,
        },
      };
    });
  };

  // Assign worker site
  const handleAssignWorkerSite = (workerId: string, siteId: string) => {
    setRecords(prev => ({
      ...prev,
      [workerId]: {
        ...(prev[workerId] || { work_units: null, notes: null }),
        site_id: siteId,
      },
    }));
    setWorkerSiteModal({ visible: false, workerId: null, workerName: '' });
  };

  // Fast action: Mark all 1.0 (Full Day)
  const handleMarkAllFullDay = () => {
    if (workers.length === 0) return;
    setRecords(prev => {
      const updated = { ...prev };
      const defaultSite = sites.length > 0 ? sites[0].id : null;
      for (const w of workers) {
        updated[w.id] = {
          ...(updated[w.id] || { notes: null }),
          work_units: 1.0,
          site_id: updated[w.id]?.site_id || defaultSite,
        };
      }
      return updated;
    });
    showFeedback('Marked all workers as 1.0 (Full Day).', 'info');
  };

  // Fast action: Bulk Site
  const handleApplyBulkSite = () => {
    if (!bulkSiteId) return;
    setRecords(prev => {
      const updated = { ...prev };
      for (const w of workers) {
        const curUnits = updated[w.id]?.work_units;
        updated[w.id] = {
          ...(updated[w.id] || { work_units: null, notes: null }),
          // If already absent (0), site remains null; otherwise assign selected site
          site_id: curUnits === 0 ? null : bulkSiteId,
        };
      }
      return updated;
    });
    const chosenSite = sites.find(s => s.id === bulkSiteId);
    setBulkSiteModalVisible(false);
    showFeedback(`Assigned all workers to ${chosenSite?.name || 'selected site'}.`, 'info');
  };

  // Sticky Save Action
  const handleSave = () => {
    const markedEntries = Object.entries(records).filter(
      ([_, data]) => data.work_units !== null && data.work_units !== undefined
    );

    if (markedEntries.length === 0) {
      showFeedback('No attendance marked to save.', 'info');
      return;
    }

    setIsSaving(true);
    try {
      const itemsToSave = markedEntries.map(([workerId, data]) => ({
        account_id: accountId,
        worker_id: workerId,
        site_id: data.work_units! > 0 ? data.site_id : null,
        date: selectedDate,
        work_units: data.work_units!,
        notes: data.notes || null,
      }));

      // Atomic batch save to SQLite
      AttendanceRepository.recordAttendanceBatch(itemsToSave);

      // Trigger sync in background if online
      SyncManager.triggerSync();

      showFeedback(`Saved attendance for ${itemsToSave.length} workers.`, 'success');
      loadData();
    } catch {
      showFeedback('Error saving attendance records locally.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Computed metrics (matching PWA)
  const markedWorkerEntries = Object.values(records).filter(
    r => r.work_units !== null && r.work_units !== undefined
  );
  const totalWorkUnits = markedWorkerEntries.reduce(
    (sum, r) => sum + Number(r.work_units || 0),
    0
  );
  const fullDayCount = markedWorkerEntries.filter(r => Number(r.work_units) >= 1.0).length;
  const halfDayCount = markedWorkerEntries.filter(
    r => Number(r.work_units) > 0 && Number(r.work_units) < 1.0
  ).length;
  const absentCount = markedWorkerEntries.filter(r => Number(r.work_units) === 0).length;
  const percentDone =
    workers.length > 0 ? Math.round((markedWorkerEntries.length / workers.length) * 100) : 0;

  // Filtered workers list
  const filteredWorkers = workers.filter(w => {
    if (!w.is_active) return false;
    if (selectedSiteFilter === 'all') return true;
    const rec = records[w.id];
    return rec?.site_id === selectedSiteFilter;
  });

  const isToday = selectedDate === toLocalDateString();
  const siteMap = new Map<string, string>();
  for (const s of sites) {
    siteMap.set(s.id, s.name);
  }

  return (
    <View style={styles.container}>
      <AppHeader
        title="Attendance"
        subtitle={`Date: ${formatDisplayDate(selectedDate)}`}
        rightActionText="Done"
        onRightAction={onNavigateHome}
        isOnline={syncState.isOnline}
        pendingCount={syncState.pendingCount}
      />

      <OfflineBanner
        isOnline={syncState.isOnline}
        pendingCount={syncState.pendingCount}
      />

      {/* Floating feedback toast */}
      {feedback && (
        <View
          style={[
            styles.feedbackBanner,
            feedback.type === 'success' && styles.feedbackSuccess,
            feedback.type === 'error' && styles.feedbackError,
            feedback.type === 'info' && styles.feedbackInfo,
          ]}
        >
          <Text
            style={[
              styles.feedbackText,
              feedback.type === 'success' && styles.feedbackTextSuccess,
              feedback.type === 'error' && styles.feedbackTextError,
              feedback.type === 'info' && styles.feedbackTextInfo,
            ]}
          >
            {feedback.message}
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Top Operational Bar: Date Capsule & Live Sync State */}
        <View style={styles.topOpBar}>
          <View style={styles.dateCapsule}>
            <TouchableOpacity
              style={styles.dateNavBtn}
              onPress={handlePrevDay}
              accessibilityLabel="Previous day"
              accessibilityRole="button"
            >
              <Icon name="chevron-left" size={18} color={Colors.textPrimary} strokeWidth={2} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dateCenterBtn}
              onPress={handleGoToToday}
              accessibilityLabel={`Selected date ${formatDateIndian(selectedDate)}. Tap to go to today.`}
              accessibilityRole="button"
            >
              <Icon name="calendar" size={15} color={Colors.textPrimary} strokeWidth={2} />
              <Text style={styles.dateText}>{formatDateIndian(selectedDate)}</Text>
              {isToday && (
                <View style={styles.todayPill}>
                  <Text style={styles.todayPillText}>Today</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dateNavBtn}
              onPress={handleNextDay}
              accessibilityLabel="Next day"
              accessibilityRole="button"
            >
              <Icon name="chevron-right" size={18} color={Colors.textPrimary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {/* Live Sync Status */}
          <View style={styles.liveSyncBadge}>
            <View
              style={[
                styles.liveSyncDot,
                syncState.pendingCount > 0
                  ? styles.liveSyncDotPending
                  : styles.liveSyncDotOnline,
              ]}
            />
            <Text style={styles.liveSyncText}>
              {syncState.pendingCount > 0 ? `${syncState.pendingCount} Unsynced` : 'Live Sync'}
            </Text>
          </View>
        </View>

        {/* 2. Site Filter Chips (Horizontal Scroll) */}
        {sites.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterChipList}
            style={styles.filterChipScroll}
          >
            <TouchableOpacity
              style={[
                styles.filterChip,
                selectedSiteFilter === 'all' && styles.filterChipActive,
              ]}
              onPress={() => setSelectedSiteFilter('all')}
              accessibilityRole="button"
              accessibilityLabel="Filter by all sites"
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedSiteFilter === 'all' && styles.filterChipTextActive,
                ]}
              >
                All Sites
              </Text>
            </TouchableOpacity>

            {sites.map(s => {
              const isSelected = selectedSiteFilter === s.id;
              const siteWorkerCount = workers.filter(
                w => records[w.id]?.site_id === s.id
              ).length;

              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.filterChip, isSelected && styles.filterChipActive]}
                  onPress={() => setSelectedSiteFilter(s.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter by site ${s.name}`}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isSelected && styles.filterChipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {s.name}
                  </Text>
                  <View
                    style={[
                      styles.chipCountBadge,
                      isSelected && styles.chipCountBadgeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipCountText,
                        isSelected && styles.chipCountTextActive,
                      ]}
                    >
                      {siteWorkerCount}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* 3. Roster Overview Metrics Card (Matching PWA) */}
        <View style={styles.metricsCard}>
          <View style={styles.metricsTopRow}>
            <View style={styles.metricsLeft}>
              <Text style={styles.metricsBigNumber}>{markedWorkerEntries.length}</Text>
              <Text style={styles.metricsTotalText}>
                / {workers.length} Marked · {totalWorkUnits.toFixed(1)} units
              </Text>
            </View>
            <View style={styles.percentBadge}>
              <Text style={styles.percentBadgeText}>{percentDone}% Done</Text>
            </View>
          </View>

          {/* Segmented Micro Progress Bar */}
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFull,
                {
                  flex: workers.length > 0 ? fullDayCount / workers.length : 0,
                },
              ]}
            />
            <View
              style={[
                styles.progressBarHalf,
                {
                  flex: workers.length > 0 ? halfDayCount / workers.length : 0,
                },
              ]}
            />
            <View
              style={[
                styles.progressBarAbsent,
                {
                  flex: workers.length > 0 ? absentCount / workers.length : 0,
                },
              ]}
            />
          </View>

          {/* 3 Quick Breakdown Metric Cards */}
          <View style={styles.metricsBreakdownGrid}>
            <View style={styles.breakdownBox}>
              <Text style={styles.breakdownLabel}>Full Day (1.0)</Text>
              <Text style={styles.breakdownValue}>{fullDayCount}</Text>
            </View>

            <View style={styles.breakdownBox}>
              <Text style={styles.breakdownLabel}>Half Day (0.5)</Text>
              <Text style={styles.breakdownValue}>{halfDayCount}</Text>
            </View>

            <View style={styles.breakdownBox}>
              <Text style={styles.breakdownLabel}>Absent (0)</Text>
              <Text style={styles.breakdownValue}>{absentCount}</Text>
            </View>
          </View>
        </View>

        {/* 4. Section Label & Fast Actions */}
        <View style={styles.rosterHeaderBar}>
          <View style={styles.rosterLabelGroup}>
            <Text style={styles.rosterSectionTitle}>ROSTER UNITS</Text>
            <View style={styles.rosterDot} />
            <Text style={styles.rosterCountText}>{filteredWorkers.length} visible</Text>
          </View>

          <View style={styles.fastActionGroup}>
            <TouchableOpacity
              style={styles.fastActionBtn}
              onPress={handleMarkAllFullDay}
              accessibilityLabel="Mark all workers as full day 1.0"
              accessibilityRole="button"
            >
              <Icon name="check" size={13} color={Colors.textPrimary} strokeWidth={2.2} />
              <Text style={styles.fastActionText}>All 1.0</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.fastActionBtn, styles.fastActionBtnSecondary]}
              onPress={() => setBulkSiteModalVisible(true)}
              accessibilityLabel="Bulk set site for all workers"
              accessibilityRole="button"
            >
              <Icon name="pin" size={13} color={Colors.textSecondary} strokeWidth={2} />
              <Text style={styles.fastActionTextSecondary}>Bulk Site</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 5. Worker Attendance Cards List */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={Colors.textPrimary} />
            <Text style={styles.loadingText}>Loading attendance roster...</Text>
          </View>
        ) : filteredWorkers.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No Workers Found</Text>
            <Text style={styles.emptySubtitle}>
              {workers.length === 0
                ? 'Add workers to your team to start logging daily attendance.'
                : 'No workers match the selected site filter.'}
            </Text>
          </View>
        ) : (
          filteredWorkers.map(item => {
            const currentRecord = records[item.id] || { work_units: null, site_id: null };
            const currentUnits = currentRecord.work_units;
            const isUnmarked = currentUnits === null || currentUnits === undefined;
            const currentSiteName = currentRecord.site_id
              ? siteMap.get(currentRecord.site_id)
              : null;
            const effectiveWage = WageHistoryRepository.getEffectiveWage(
              item.id,
              selectedDate,
              accountId,
              Number(item.daily_wage)
            );
            const earnedAmount = Math.round(
              (currentUnits || 0) * effectiveWage
            );

            // Badge styling
            const isFullDayOrMore = !isUnmarked && currentUnits >= 1.0;
            const isHalfDay = !isUnmarked && currentUnits > 0 && currentUnits < 1.0;
            const isAbsent = !isUnmarked && currentUnits === 0;

            return (
              <View key={item.id} style={styles.workerCard}>
                {/* Worker Top Row */}
                <View style={styles.workerTopRow}>
                  <View style={styles.workerInfoCol}>
                    <Text style={styles.workerName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.workerMeta} numberOfLines={1}>
                      ₹{item.daily_wage}/day {currentSiteName ? `• ${currentSiteName}` : '• No site'}
                    </Text>
                  </View>

                  {/* Status Badge */}
                  <View
                    style={[
                      styles.statusBadge,
                      isUnmarked && styles.statusBadgePending,
                      isFullDayOrMore && styles.statusBadgeFull,
                      isHalfDay && styles.statusBadgeHalf,
                      isAbsent && styles.statusBadgeAbsent,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        isUnmarked && styles.statusBadgeTextPending,
                        isFullDayOrMore && styles.statusBadgeTextFull,
                        isHalfDay && styles.statusBadgeTextHalf,
                        isAbsent && styles.statusBadgeTextAbsent,
                      ]}
                    >
                      {isUnmarked ? 'Pending' : `${currentUnits} Unit`}
                    </Text>
                  </View>
                </View>

                {/* Segmented Work Unit Controls (Exact parity with PWA) */}
                <WorkUnitSelector
                  currentValue={currentUnits}
                  onSelect={val => handleWorkUnitSelect(item.id, val)}
                />

                {/* Worker Site & Earnings Row */}
                <View style={styles.workerBottomRow}>
                  <TouchableOpacity
                    style={[
                      styles.workerSiteBtn,
                      currentUnits === 0 && styles.workerSiteBtnDisabled,
                    ]}
                    onPress={() => {
                      if (currentUnits !== 0) {
                        setWorkerSiteModal({
                          visible: true,
                          workerId: item.id,
                          workerName: item.name,
                        });
                      }
                    }}
                    disabled={currentUnits === 0}
                    accessibilityRole="button"
                    accessibilityLabel={`Assigned site: ${currentSiteName || 'Select Site'}`}
                  >
                    <Icon
                      name="pin"
                      size={12}
                      color={currentUnits === 0 ? Colors.textMuted : Colors.textSecondary}
                      strokeWidth={1.8}
                    />
                    <Text
                      style={[
                        styles.workerSiteName,
                        currentUnits === 0 && styles.workerSiteNameDisabled,
                      ]}
                      numberOfLines={1}
                    >
                      {currentSiteName || 'Select Site'}
                    </Text>
                    <Icon
                      name="chevron-down"
                      size={13}
                      color={currentUnits === 0 ? Colors.textMuted : Colors.textSecondary}
                      strokeWidth={2}
                    />
                  </TouchableOpacity>

                  <View style={styles.workerEarningsCol}>
                    <Text style={styles.workerWageText}>Rate: ₹{effectiveWage}/day</Text>
                    <Text style={styles.workerEarnedText}>
                      Earned: <Text style={styles.workerEarnedBold}>₹{earnedAmount}</Text>
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* 6. Floating Sticky Save Action (Positioned above bottom nav) */}
      <View style={styles.stickySaveContainer}>
        <View style={styles.stickySaveCard}>
          <TouchableOpacity
            style={[
              styles.saveBtn,
              (isSaving || isLoading) && styles.saveBtnDisabled,
            ]}
            onPress={handleSave}
            disabled={isSaving || isLoading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Save attendance. ${markedWorkerEntries.length} workers marked.`}
          >
            <View style={styles.saveBtnLeft}>
              {isSaving ? (
                <ActivityIndicator size="small" color="#ffffff" style={styles.saveSpinner} />
              ) : (
                <Icon name="check" size={16} color="#ffffff" strokeWidth={2.5} />
              )}
              <Text style={styles.saveBtnText}>
                {isSaving ? 'Saving...' : 'Save Attendance'}
              </Text>
            </View>

            <View
              style={[
                styles.saveCountBadge,
                markedWorkerEntries.length > 0 && styles.saveCountBadgeActive,
              ]}
            >
              <Text style={styles.saveCountText}>
                {markedWorkerEntries.length} Marked
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bulk Site Assignment Modal */}
      <Modal
        visible={bulkSiteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBulkSiteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Set Site for All Workers</Text>
            <Text style={styles.modalSubtitle}>
              Assign all workers to this site for {formatDateIndian(selectedDate)}.
            </Text>

            <ScrollView style={styles.modalSiteList} showsVerticalScrollIndicator={false}>
              {sites.map(s => {
                const isSelected = bulkSiteId === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[
                      styles.modalSiteOption,
                      isSelected && styles.modalSiteOptionSelected,
                    ]}
                    onPress={() => setBulkSiteId(s.id)}
                  >
                    <Text
                      style={[
                        styles.modalSiteOptionText,
                        isSelected && styles.modalSiteOptionTextSelected,
                      ]}
                    >
                      {s.name}
                    </Text>
                    {isSelected && <Icon name="check" size={16} color={Colors.accent} strokeWidth={2.5} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setBulkSiteModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalConfirmBtn,
                  !bulkSiteId && styles.modalConfirmBtnDisabled,
                ]}
                onPress={handleApplyBulkSite}
                disabled={!bulkSiteId}
              >
                <Text style={styles.modalConfirmText}>Apply to All</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Individual Worker Site Selection Modal */}
      <Modal
        visible={workerSiteModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setWorkerSiteModal({ visible: false, workerId: null, workerName: '' })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Assign Job Site</Text>
            <Text style={styles.modalSubtitle}>
              Select site for {workerSiteModal.workerName} on {formatDateIndian(selectedDate)}.
            </Text>

            <ScrollView style={styles.modalSiteList} showsVerticalScrollIndicator={false}>
              {sites.map(s => {
                const currentSiteId = workerSiteModal.workerId
                  ? records[workerSiteModal.workerId]?.site_id
                  : null;
                const isSelected = currentSiteId === s.id;

                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[
                      styles.modalSiteOption,
                      isSelected && styles.modalSiteOptionSelected,
                    ]}
                    onPress={() => {
                      if (workerSiteModal.workerId) {
                        handleAssignWorkerSite(workerSiteModal.workerId, s.id);
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.modalSiteOptionText,
                        isSelected && styles.modalSiteOptionTextSelected,
                      ]}
                    >
                      {s.name}
                    </Text>
                    {isSelected && <Icon name="check" size={16} color={Colors.accent} strokeWidth={2.5} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setWorkerSiteModal({ visible: false, workerId: null, workerName: '' })}
              >
                <Text style={styles.modalCancelText}>Close</Text>
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
    backgroundColor: Colors.background,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: 120, // ensure space for sticky save button and bottom nav
  },

  // Feedback Toast
  feedbackBanner: {
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackSuccess: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  feedbackError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  feedbackInfo: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  feedbackText: {
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackTextSuccess: {
    color: '#065f46',
  },
  feedbackTextError: {
    color: '#991b1b',
  },
  feedbackTextInfo: {
    color: '#1e40af',
  },

  // 1. Top Operational Bar
  topOpBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  dateCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  dateNavBtn: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateNavIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  dateCenterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    gap: 6,
  },
  calendarIcon: {
    fontSize: 14,
  },
  dateText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  todayPill: {
    backgroundColor: '#fff7ed',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  todayPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#c2410c',
  },
  liveSyncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  liveSyncDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveSyncDotOnline: {
    backgroundColor: '#16a34a',
  },
  liveSyncDotPending: {
    backgroundColor: '#ea580c',
  },
  liveSyncText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },

  // 2. Site Filter Chips
  filterChipScroll: {
    marginBottom: Spacing.md,
  },
  filterChipList: {
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  filterChipActive: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  filterChipTextActive: {
    color: Colors.textInverse,
  },
  chipCountBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.full,
    backgroundColor: '#f4f4f5',
  },
  chipCountBadgeActive: {
    backgroundColor: '#27272a',
  },
  chipCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  chipCountTextActive: {
    color: '#a1a1aa',
  },

  // 3. Roster Overview Metrics Card
  metricsCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  metricsTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  metricsLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  metricsBigNumber: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    lineHeight: 30,
  },
  metricsTotalText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  percentBadge: {
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  percentBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  progressBarTrack: {
    flexDirection: 'row',
    height: 6,
    backgroundColor: '#e4e4e7',
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
    marginVertical: Spacing.md,
  },
  progressBarFull: {
    backgroundColor: '#000000',
    height: '100%',
  },
  progressBarHalf: {
    backgroundColor: '#71717a',
    height: '100%',
  },
  progressBarAbsent: {
    backgroundColor: '#d4d4d8',
    height: '100%',
  },
  metricsBreakdownGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  breakdownBox: {
    flex: 1,
    backgroundColor: '#f4f4f5',
    padding: 10,
    borderRadius: 8,
  },
  breakdownLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  breakdownValue: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 2,
  },

  // 4. Section Header & Fast Actions
  rosterHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  rosterLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rosterSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: Colors.textSecondary,
  },
  rosterDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d4d4d8',
  },
  rosterCountText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  fastActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fastActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  fastActionBtnSecondary: {
    paddingLeft: 4,
  },
  fastActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  fastActionTextSecondary: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },

  // 5. Worker Card
  workerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  workerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  workerInfoCol: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  workerName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  workerMeta: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginTop: 2,
  },

  // Status Badges
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgePending: {
    backgroundColor: '#f4f4f5',
    borderColor: '#e4e4e7',
  },
  statusBadgeFull: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  statusBadgeHalf: {
    backgroundColor: '#f4f4f5',
    borderColor: '#d4d4d8',
  },
  statusBadgeAbsent: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadgeTextPending: {
    color: '#71717a',
  },
  statusBadgeTextFull: {
    color: '#ffffff',
  },
  statusBadgeTextHalf: {
    color: '#09090b',
  },
  statusBadgeTextAbsent: {
    color: '#991b1b',
  },

  // Worker Site & Rate Row
  workerBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
    paddingTop: Spacing.xs,
  },
  workerSiteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    maxWidth: '55%',
    gap: 4,
  },
  workerSiteBtnDisabled: {
    opacity: 0.45,
  },
  workerSitePin: {
    fontSize: 12,
  },
  workerSiteName: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  workerSiteNameDisabled: {
    color: Colors.textSecondary,
  },
  workerSiteChevron: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  workerEarningsCol: {
    alignItems: 'flex-end',
  },
  workerWageText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  workerEarnedText: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  workerEarnedBold: {
    fontWeight: '700',
    color: Colors.textPrimary,
  },

  bottomSpacer: {
    height: 40,
  },

  // 6. Sticky Floating Save Action
  stickySaveContainer: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
  },
  stickySaveCard: {
    width: '100%',
    maxWidth: 500,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    padding: 6,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  saveBtn: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  saveBtnDisabled: {
    backgroundColor: '#a1a1aa',
  },
  saveBtnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveBtnIcon: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  saveSpinner: {
    marginRight: 2,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  saveCountBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  saveCountBadgeActive: {
    backgroundColor: Colors.accent,
  },
  saveCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
  },
  modalSiteList: {
    maxHeight: 240,
    marginBottom: Spacing.lg,
  },
  modalSiteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 8,
  },
  modalSiteOptionSelected: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  modalSiteOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  modalSiteOptionTextSelected: {
    color: '#ffffff',
  },
  modalCheckmark: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  modalConfirmBtn: {
    backgroundColor: '#000000',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalConfirmBtnDisabled: {
    backgroundColor: '#a1a1aa',
  },
  modalConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },

  // Loading & Empty States
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 260,
  },
});
