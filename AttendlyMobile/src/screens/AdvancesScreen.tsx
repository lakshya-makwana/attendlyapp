import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';
import { OfflineBanner } from '../components/Cards';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { WorkerRepository, LocalWorker } from '../repositories/workerRepository';
import { AdvanceRepository, LocalAdvance } from '../repositories/advanceRepository';
import { SyncManager, SyncState } from '../sync/syncManager';
import { toLocalDateString, getMonthDateRange } from '../utils/dateUtils';
import { Icon } from '../components/Icon';

interface AdvancesScreenProps {
  accountId: string;
  onNavigateHome?: () => void;
  initialWorkerId?: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

export const AdvancesScreen: React.FC<AdvancesScreenProps> = ({
  accountId,
  onNavigateHome,
  initialWorkerId,
}) => {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [workers, setWorkers] = useState<LocalWorker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(initialWorkerId || null);
  const [advances, setAdvances] = useState<LocalAdvance[]>([]);
  const [allAdvances, setAllAdvances] = useState<LocalAdvance[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Sync state
  const [syncState, setSyncState] = useState<SyncState>({
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncTime: null,
  });

  // Feedback Toast
  const [feedback, setFeedback] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const showFeedback = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setFeedback({ message, type });
    setTimeout(() => {
      setFeedback(prev => (prev?.message === message ? null : prev));
    }, 3500);
  }, []);

  // Modal: Give Advance
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [formWorkerId, setFormWorkerId] = useState<string>('');
  const [formAmount, setFormAmount] = useState<string>('');
  const [formDate, setFormDate] = useState<string>(() => toLocalDateString());
  const [formNote, setFormNote] = useState<string>('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<boolean>(false);

  // Modal: Delete Advance Confirmation
  const [deleteModalVisible, setDeleteModalVisible] = useState<boolean>(false);
  const [advanceToDelete, setAdvanceToDelete] = useState<LocalAdvance | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Load Data
  const loadData = useCallback(() => {
    try {
      setLoading(true);
      // Load active and all workers
      const workersList = WorkerRepository.getAll(accountId, false);
      setWorkers(workersList);

      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const { startDate, endDate } = getMonthDateRange(year, month);

      // Load advances for selected month & optional worker filter
      const monthlyList = AdvanceRepository.getByDateRange(
        startDate,
        endDate,
        accountId,
        selectedWorkerId || undefined
      );
      setAdvances(monthlyList);

      // Load all-time advances for calculating total advances stat
      let allList: LocalAdvance[] = [];
      if (selectedWorkerId) {
        allList = AdvanceRepository.getByWorkerId(selectedWorkerId, accountId);
      } else {
        allList = AdvanceRepository.getAll(accountId);
      }
      setAllAdvances(allList);
    } catch {
      showFeedback('Failed to load advances ledger.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accountId, selectedDate, selectedWorkerId, showFeedback]);

  useEffect(() => {
    loadData();
    const unsub = SyncManager.subscribe(state => {
      setSyncState(state);
      loadData();
    });
    return unsub;
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    SyncManager.triggerSync().finally(() => {
      loadData();
    });
  }, [loadData]);

  // Month navigation
  const changeMonth = (delta: number) => {
    const next = new Date(selectedDate);
    next.setMonth(next.getMonth() + delta);
    setSelectedDate(next);
  };

  const monthLabel = useMemo(() => {
    return `${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;
  }, [selectedDate]);

  // Totals calculations
  const monthlyTotal = useMemo(() => {
    return advances.reduce((sum, a) => sum + Number(a.amount || 0), 0);
  }, [advances]);

  const allTimeTotal = useMemo(() => {
    return allAdvances.reduce((sum, a) => sum + Number(a.amount || 0), 0);
  }, [allAdvances]);

  // Open Give Advance Modal
  const handleOpenGiveModal = () => {
    const activeWorkers = workers.filter(w => w.is_active);
    const defaultWorker = selectedWorkerId || (activeWorkers.length > 0 ? activeWorkers[0].id : '');
    setFormWorkerId(defaultWorker);
    setFormAmount('');
    setFormDate(toLocalDateString());
    setFormNote('');
    setFormErrors({});
    setModalVisible(true);
  };

  // Form Validation & Save
  const handleSaveAdvance = async () => {
    const errors: Record<string, string> = {};
    if (!formWorkerId) {
      errors.workerId = 'Please select a worker.';
    }
    const amt = parseFloat(formAmount);
    if (isNaN(amt) || amt <= 0) {
      errors.amount = 'Please enter a valid amount greater than ₹0.';
    }
    if (!formDate || !/^\d{4}-\d{2}-\d{2}$/.test(formDate)) {
      errors.date = 'Date must be in YYYY-MM-DD format.';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      AdvanceRepository.recordAdvance({
        account_id: accountId,
        worker_id: formWorkerId,
        amount: amt,
        date: formDate,
        note: formNote.trim() || undefined,
      });

      setModalVisible(false);
      showFeedback(`Advance of ₹${amt.toLocaleString('en-IN')} recorded successfully.`, 'success');
      loadData();

      // Trigger sync in background
      SyncManager.triggerSync();
    } catch {
      showFeedback('Failed to record advance payment.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Delete Advance
  const handleConfirmDelete = (advance: LocalAdvance) => {
    setAdvanceToDelete(advance);
    setDeleteModalVisible(true);
  };

  const executeDelete = async () => {
    if (!advanceToDelete) return;
    setDeleting(true);
    try {
      AdvanceRepository.delete(advanceToDelete.id, accountId);
      setDeleteModalVisible(false);
      setAdvanceToDelete(null);
      showFeedback('Advance payment deleted. Payroll has been restored.', 'info');
      loadData();
      SyncManager.triggerSync();
    } catch {
      showFeedback('Failed to delete advance.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const getWorkerName = (workerId: string, fallback?: string): string => {
    if (fallback) return fallback;
    const found = workers.find(w => w.id === workerId);
    return found ? found.name : 'Unknown Worker';
  };

  const formatDateLabel = (dateStr: string) => {
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const year = parts[0];
        const monthIdx = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        return `${day} ${MONTH_NAMES[monthIdx].substring(0, 3)} ${year}`;
      }
    } catch {}
    return dateStr;
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title="Advances"
        subtitle={monthLabel}
        rightActionText="+ Give Advance"
        onRightAction={handleOpenGiveModal}
        onBack={onNavigateHome}
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
            feedback.type === 'error' && styles.feedbackError,
            feedback.type === 'success' && styles.feedbackSuccess,
          ]}
        >
          <Icon
            name={
              feedback.type === 'error'
                ? 'alert-circle'
                : feedback.type === 'success'
                ? 'check'
                : 'sync'
            }
            size={16}
            color="#ffffff"
            strokeWidth={2}
          />
          <Text style={styles.feedbackText}>{feedback.message}</Text>
        </View>
      )}

      {/* Month Navigation Bar */}
      <View style={styles.monthBar}>
        <TouchableOpacity
          style={styles.monthNavBtn}
          onPress={() => changeMonth(-1)}
          accessibilityRole="button"
          accessibilityLabel="Previous Month"
        >
          <Icon name="chevron-left" size={18} color={Colors.textPrimary} strokeWidth={2.2} />
          <Text style={styles.monthNavText}>Previous</Text>
        </TouchableOpacity>

        <View style={styles.monthCenter}>
          <Icon name="calendar" size={15} color={Colors.textSecondary} strokeWidth={2} />
          <Text style={styles.monthTitle}>{monthLabel}</Text>
        </View>

        <TouchableOpacity
          style={styles.monthNavBtn}
          onPress={() => changeMonth(1)}
          accessibilityRole="button"
          accessibilityLabel="Next Month"
        >
          <Text style={styles.monthNavText}>Next</Text>
          <Icon name="chevron-right" size={18} color={Colors.textPrimary} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>

      {/* Worker Filter Horizontal Bar */}
      <View style={styles.workerFilterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.workerFilterScroll}
        >
          <TouchableOpacity
            style={[
              styles.filterChip,
              selectedWorkerId === null && styles.filterChipActive,
            ]}
            onPress={() => setSelectedWorkerId(null)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Filter by all workers"
          >
            <Text
              style={[
                styles.filterChipText,
                selectedWorkerId === null && styles.filterChipTextActive,
              ]}
            >
              All Workers ({workers.length})
            </Text>
          </TouchableOpacity>

          {workers.map(w => {
            const isSelected = selectedWorkerId === w.id;
            return (
              <TouchableOpacity
                key={w.id}
                style={[styles.filterChip, isSelected && styles.filterChipActive]}
                onPress={() => setSelectedWorkerId(w.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${w.name}`}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isSelected && styles.filterChipTextActive,
                  ]}
                >
                  {w.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Ledger FlatList */}
      <FlatList
        data={advances}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerStatsContainer}>
            {/* Split KPI Summary Card (PWA Parity) */}
            <View style={styles.statsCard}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Monthly Advances</Text>
                <Text style={styles.statValue}>
                  ₹{monthlyTotal.toLocaleString('en-IN')}
                </Text>
                <Text style={styles.statSub}>
                  {advances.length} {advances.length === 1 ? 'entry' : 'entries'} this month
                </Text>
              </View>

              <View style={styles.statDivider} />

              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Total Advances</Text>
                <Text style={styles.statValue}>
                  ₹{allTimeTotal.toLocaleString('en-IN')}
                </Text>
                <Text style={styles.statSub}>
                  {allAdvances.length} {allAdvances.length === 1 ? 'entry' : 'entries'} all-time
                </Text>
              </View>
            </View>

            <View style={styles.ledgerHeaderRow}>
              <Text style={styles.ledgerHeading}>ADVANCE TRANSACTIONS</Text>
              <Text style={styles.ledgerCount}>
                {advances.length} {advances.length === 1 ? 'record' : 'records'}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="small" color={Colors.accent} />
              <Text style={styles.emptySubtitle}>Loading advances ledger...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBadge}>
                <Icon name="wallet" size={32} color={Colors.textMuted} strokeWidth={1.5} />
              </View>
              <Text style={styles.emptyTitle}>No Advances Recorded</Text>
              <Text style={styles.emptySubtitle}>
                {selectedWorkerId
                  ? 'No advance payments found for this worker in the selected period.'
                  : 'No advance payments recorded for workers in this period.'}
              </Text>
              <TouchableOpacity
                style={styles.emptyActionBtn}
                onPress={handleOpenGiveModal}
                activeOpacity={0.8}
              >
                <Icon name="plus" size={16} color="#ffffff" strokeWidth={2.2} />
                <Text style={styles.emptyActionText}>Give Advance</Text>
              </TouchableOpacity>
            </View>
          )
        }
        renderItem={({ item }) => {
          const workerName = getWorkerName(item.worker_id, item.worker_name);
          const initial = workerName.charAt(0).toUpperCase() || 'W';
          const isPending = item.sync_status === 'PENDING';

          return (
            <View style={styles.advanceCard}>
              <View style={styles.cardLeft}>
                <View style={styles.avatarBadge}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
                <View style={styles.cardDetails}>
                  <Text style={styles.workerNameText}>{workerName}</Text>
                  <View style={styles.dateRow}>
                    <Icon name="calendar" size={12} color={Colors.textMuted} strokeWidth={2} />
                    <Text style={styles.dateText}>{formatDateLabel(item.date)}</Text>
                    {isPending && (
                      <View style={styles.pendingBadge}>
                        <Icon name="refresh-cw" size={10} color={Colors.accent} strokeWidth={2} />
                        <Text style={styles.pendingText}>Queued</Text>
                      </View>
                    )}
                  </View>
                  {item.note ? (
                    <Text style={styles.noteText} numberOfLines={2}>
                      {item.note}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.cardRight}>
                <Text style={styles.amountText}>
                  -₹{Number(item.amount).toLocaleString('en-IN')}
                </Text>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleConfirmDelete(item)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete advance of ₹${item.amount} for ${workerName}`}
                >
                  <Icon name="trash" size={16} color={Colors.error} strokeWidth={1.8} />
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />

      {/* Give Advance Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Give Advance</Text>
                <Text style={styles.modalSubtitle}>
                  Disburse cash advance to be deducted from payroll
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close dialog"
              >
                <Icon name="close" size={20} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollBody}
            >
              {/* Select Worker */}
              <Text style={styles.inputLabel}>
                Worker <Text style={styles.requiredStar}>*</Text>
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.workerSelectScroll}
              >
                {workers
                  .filter(w => w.is_active || w.id === formWorkerId)
                  .map(w => {
                    const isSelected = formWorkerId === w.id;
                    return (
                      <TouchableOpacity
                        key={w.id}
                        style={[
                          styles.workerSelectChip,
                          isSelected && styles.workerSelectChipActive,
                        ]}
                        onPress={() => {
                          setFormWorkerId(w.id);
                          if (formErrors.workerId) {
                            setFormErrors(prev => ({ ...prev, workerId: '' }));
                          }
                        }}
                      >
                        <Text
                          style={[
                            styles.workerSelectChipText,
                            isSelected && styles.workerSelectChipTextActive,
                          ]}
                        >
                          {w.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>
              {formErrors.workerId ? (
                <Text style={styles.errorText}>{formErrors.workerId}</Text>
              ) : null}

              {/* Quick Amount Preset Chips */}
              <Text style={styles.inputLabel}>Quick Amount</Text>
              <View style={styles.quickAmountsRow}>
                {QUICK_AMOUNTS.map(amt => (
                  <TouchableOpacity
                    key={amt}
                    style={[
                      styles.quickAmountChip,
                      formAmount === String(amt) && styles.quickAmountChipActive,
                    ]}
                    onPress={() => {
                      setFormAmount(String(amt));
                      if (formErrors.amount) {
                        setFormErrors(prev => ({ ...prev, amount: '' }));
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.quickAmountText,
                        formAmount === String(amt) && styles.quickAmountTextActive,
                      ]}
                    >
                      {`₹${amt.toLocaleString('en-IN')}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Amount Input */}
              <Text style={styles.inputLabel}>
                Advance Amount (₹) <Text style={styles.requiredStar}>*</Text>
              </Text>
              <TextInput
                style={[styles.input, formErrors.amount ? styles.inputError : null]}
                placeholder="e.g. 1500"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                value={formAmount}
                onChangeText={txt => {
                  setFormAmount(txt);
                  if (formErrors.amount) {
                    setFormErrors(prev => ({ ...prev, amount: '' }));
                  }
                }}
              />
              {formErrors.amount ? (
                <Text style={styles.errorText}>{formErrors.amount}</Text>
              ) : null}

              {/* Date Input */}
              <Text style={styles.inputLabel}>
                Disbursement Date (YYYY-MM-DD) <Text style={styles.requiredStar}>*</Text>
              </Text>
              <TextInput
                style={[styles.input, formErrors.date ? styles.inputError : null]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
                value={formDate}
                onChangeText={txt => {
                  setFormDate(txt);
                  if (formErrors.date) {
                    setFormErrors(prev => ({ ...prev, date: '' }));
                  }
                }}
              />
              {formErrors.date ? (
                <Text style={styles.errorText}>{formErrors.date}</Text>
              ) : null}

              {/* Note Input */}
              <Text style={styles.inputLabel}>Note / Reason (Optional)</Text>
              <TextInput
                style={[styles.input, styles.noteInput]}
                placeholder="e.g. Festival advance / medical emergency"
                placeholderTextColor={Colors.textMuted}
                value={formNote}
                onChangeText={setFormNote}
                multiline
                numberOfLines={2}
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <SecondaryButton
                title="Cancel"
                onPress={() => setModalVisible(false)}
                style={{ flex: 1 }}
                disabled={saving}
              />
              <PrimaryButton
                title={saving ? 'Recording...' : 'Record Advance'}
                onPress={handleSaveAdvance}
                style={{ flex: 1 }}
                disabled={saving}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal visible={deleteModalVisible} animationType="fade" transparent>
        <View style={styles.deleteOverlay}>
          <View style={styles.deleteDialog}>
            <View style={styles.deleteIconBadge}>
              <Icon name="trash" size={24} color={Colors.error} strokeWidth={2} />
            </View>

            <Text style={styles.deleteTitle}>Delete Advance</Text>
            <Text style={styles.deleteMessage}>
              Are you sure you want to delete this advance payment of{' '}
              <Text style={styles.deleteHighlight}>
                ₹{advanceToDelete ? Number(advanceToDelete.amount).toLocaleString('en-IN') : '0'}
              </Text>{' '}
              given to{' '}
              <Text style={styles.deleteHighlight}>
                {advanceToDelete ? getWorkerName(advanceToDelete.worker_id, advanceToDelete.worker_name) : ''}
              </Text>{' '}
              on{' '}
              <Text style={styles.deleteHighlight}>
                {advanceToDelete ? formatDateLabel(advanceToDelete.date) : ''}
              </Text>
              ? This deduction will be removed from payroll.
            </Text>

            <View style={styles.deleteActions}>
              <TouchableOpacity
                style={styles.deleteCancelBtn}
                onPress={() => setDeleteModalVisible(false)}
                disabled={deleting}
              >
                <Text style={styles.deleteCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteConfirmBtn}
                onPress={executeDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.deleteConfirmText}>Delete Advance</Text>
                )}
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
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#18181b',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  feedbackError: {
    backgroundColor: '#991b1b',
  },
  feedbackSuccess: {
    backgroundColor: '#166534',
  },
  feedbackText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  monthNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
  },
  monthNavText: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  monthCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  monthTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  workerFilterContainer: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  workerFilterScroll: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceMuted,
  },
  filterChipActive: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: Colors.textInverse,
  },
  listContent: {
    padding: Spacing.xl,
    paddingBottom: 100,
  },
  headerStatsContainer: {
    marginBottom: Spacing.lg,
  },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.error,
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  statSub: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  ledgerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  ledgerHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  ledgerCount: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  advanceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: Spacing.md,
  },
  avatarBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: Spacing.md,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  cardDetails: {
    flex: 1,
  },
  workerNameText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  dateText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.accentLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.full,
    marginLeft: 6,
  },
  pendingText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.accent,
  },
  noteText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  cardRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.error,
  },
  deleteBtn: {
    padding: 6,
    borderRadius: BorderRadius.sm,
    backgroundColor: '#fef2f2',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: Spacing.xl,
  },
  emptyIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: Spacing.xl,
  },
  emptyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.textPrimary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  emptyActionText: {
    color: Colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    ...Typography.titleMedium,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalScrollBody: {
    paddingBottom: Spacing.lg,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    marginBottom: 6,
  },
  requiredStar: {
    color: Colors.error,
  },
  workerSelectScroll: {
    gap: Spacing.sm,
    paddingVertical: 2,
  },
  workerSelectChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceMuted,
  },
  workerSelectChipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  workerSelectChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  workerSelectChipTextActive: {
    color: '#ffffff',
  },
  quickAmountsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  quickAmountChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAmountChipActive: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  quickAmountText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  quickAmountTextActive: {
    color: Colors.textInverse,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    fontSize: 15,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  inputError: {
    borderColor: Colors.error,
  },
  noteInput: {
    height: 64,
    paddingTop: Spacing.sm,
    textAlignVertical: 'top',
  },
  errorText: {
    fontSize: 11,
    color: Colors.error,
    marginTop: 4,
    marginLeft: 2,
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  deleteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  deleteDialog: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
  },
  deleteIconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fef2f2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  deleteTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  deleteMessage: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: Spacing.xl,
  },
  deleteHighlight: {
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  deleteActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
  },
  deleteCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  deleteConfirmBtn: {
    flex: 1.2,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteConfirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});
