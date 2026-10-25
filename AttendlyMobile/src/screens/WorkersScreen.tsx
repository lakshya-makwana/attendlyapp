import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';
import { StatusPill, OfflineBanner } from '../components/Cards';
import { WageHistoryModal } from '../components/WageHistoryModal';
import { UpdateSalaryModal } from '../components/UpdateSalaryModal';
import { WorkerRepository, LocalWorker } from '../repositories/workerRepository';
import { SyncManager } from '../sync/syncManager';
import { toLocalDateString } from '../utils/dateUtils';
import { Icon } from '../components/Icon';

interface WorkersScreenProps {
  accountId: string;
  onNavigateHome: () => void;
  onSelectWorker?: (workerId: string) => void;
}

type StatusFilter = 'all' | 'active' | 'inactive';

export const WorkersScreen: React.FC<WorkersScreenProps> = ({
  accountId,
  onNavigateHome: _onNavigateHome,
  onSelectWorker,
}) => {
  const [workers, setWorkers] = useState<LocalWorker[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Add Worker Modal
  const [addModalVisible, setAddModalVisible] = useState<boolean>(false);
  const [addName, setAddName] = useState<string>('');
  const [addDailyWage, setAddDailyWage] = useState<string>('');
  const [addEffectiveFrom, setAddEffectiveFrom] = useState<string>(() => toLocalDateString());
  const [addPhone, setAddPhone] = useState<string>('');
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [addSaving, setAddSaving] = useState<boolean>(false);

  // Edit Worker Modal
  const [editingWorker, setEditingWorker] = useState<LocalWorker | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editPhone, setEditPhone] = useState<string>('');
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState<boolean>(false);

  // Wage History Modal
  const [wageWorker, setWageWorker] = useState<LocalWorker | null>(null);

  // Update Salary Modal
  const [salaryWorker, setSalaryWorker] = useState<LocalWorker | null>(null);

  // Sync state & Feedback Toast
  const [syncState, setSyncState] = useState({
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncTime: null as string | null,
  });
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

  const loadWorkers = useCallback(() => {
    try {
      setLoading(true);
      const list = WorkerRepository.getAll(accountId, false);
      setWorkers(list);
    } catch {
      showFeedback('Failed to load local workers roster.', 'error');
    } finally {
      setLoading(false);
    }
  }, [accountId, showFeedback]);

  useEffect(() => {
    loadWorkers();
    const unsub = SyncManager.subscribe(state => {
      setSyncState(state);
      loadWorkers();
    });
    return unsub;
  }, [loadWorkers]);

  // Status Counts
  const activeCount = useMemo(() => workers.filter(w => w.is_active).length, [workers]);
  const inactiveCount = useMemo(() => workers.filter(w => !w.is_active).length, [workers]);

  // Filtered workers
  const filteredWorkers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return workers.filter(w => {
      // Status filter
      if (statusFilter === 'active' && !w.is_active) return false;
      if (statusFilter === 'inactive' && w.is_active) return false;

      // Search query
      if (q) {
        const matchesName = w.name.toLowerCase().includes(q);
        const matchesPhone = w.phone ? w.phone.toLowerCase().includes(q) : false;
        return matchesName || matchesPhone;
      }
      return true;
    });
  }, [workers, statusFilter, searchQuery]);

  // ---------------------------------------------------------------------------
  // Add Worker Handler
  // ---------------------------------------------------------------------------
  const handleOpenAdd = () => {
    setAddName('');
    setAddDailyWage('');
    setAddEffectiveFrom(toLocalDateString());
    setAddPhone('');
    setAddErrors({});
    setAddModalVisible(true);
  };

  const handleSaveAdd = async () => {
    const errors: Record<string, string> = {};
    if (!addName.trim()) {
      errors.name = 'Worker name is required';
    }
    const wageNum = parseFloat(addDailyWage);
    if (isNaN(wageNum) || wageNum < 0) {
      errors.daily_wage = 'Valid daily wage is required (₹0 or greater)';
    }
    if (!addEffectiveFrom.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(addEffectiveFrom.trim())) {
      errors.effective_from = 'Effective date must be in YYYY-MM-DD format';
    }

    if (Object.keys(errors).length > 0) {
      setAddErrors(errors);
      return;
    }

    try {
      setAddSaving(true);
      WorkerRepository.save({
        account_id: accountId,
        name: addName.trim(),
        daily_wage: wageNum,
        phone: addPhone.trim() || null,
        is_active: true,
        effective_from: addEffectiveFrom.trim(),
      } as any);

      showFeedback(`Worker ${addName.trim()} added successfully.`, 'success');
      setAddModalVisible(false);
      loadWorkers();
      SyncManager.triggerSync();
    } catch {
      showFeedback('Failed to save worker.', 'error');
    } finally {
      setAddSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Edit Worker Handler
  // ---------------------------------------------------------------------------
  const handleOpenEdit = (worker: LocalWorker) => {
    setEditingWorker(worker);
    setEditName(worker.name);
    setEditPhone(worker.phone || '');
    setEditErrors({});
  };

  const handleSaveEdit = async () => {
    if (!editingWorker) return;
    const errors: Record<string, string> = {};
    if (!editName.trim()) {
      errors.name = 'Worker name is required';
    }

    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      return;
    }

    try {
      setEditSaving(true);
      WorkerRepository.save({
        ...editingWorker,
        name: editName.trim(),
        phone: editPhone.trim() || null,
      });

      showFeedback(`Worker ${editName.trim()} updated successfully.`, 'success');
      setEditingWorker(null);
      loadWorkers();
      SyncManager.triggerSync();
    } catch {
      showFeedback('Failed to update worker.', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Status Toggle with Confirmation
  // ---------------------------------------------------------------------------
  const handleToggleStatus = (worker: LocalWorker) => {
    const isDeactivating = worker.is_active;
    const title = isDeactivating ? 'Deactivate Worker?' : 'Activate Worker?';
    const message = isDeactivating
      ? `Are you sure you want to deactivate ${worker.name}? They will be hidden from the active attendance roster, but all historical attendance and wage records remain intact.`
      : `Restore ${worker.name} to the active workforce roster?`;

    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isDeactivating ? 'Deactivate' : 'Activate',
          style: isDeactivating ? 'destructive' : 'default',
          onPress: () => {
            try {
              WorkerRepository.save({
                ...worker,
                is_active: !worker.is_active,
              });
              showFeedback(
                `Marked ${worker.name} as ${!worker.is_active ? 'active' : 'inactive'}.`,
                'success'
              );
              loadWorkers();
              SyncManager.triggerSync();
            } catch {
              showFeedback('Failed to update worker status.', 'error');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title="Workers"
        subtitle={`${activeCount} Active · ${workers.length} Total`}
        rightActionText="+ Add"
        onRightAction={handleOpenAdd}
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
          <Icon
            name={feedback.type === 'success' ? 'check' : feedback.type === 'error' ? 'alert-circle' : 'refresh-cw'}
            size={14}
            color={feedback.type === 'success' ? Colors.success : feedback.type === 'error' ? Colors.errorText : Colors.accent}
            strokeWidth={2}
          />
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

      {/* Search and Filter Section */}
      <View style={styles.topControlSection}>
        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Icon
            name="search"
            size={16}
            color={Colors.textSecondary}
            strokeWidth={2}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by worker name or phone..."
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.clearSearchBtn}
              accessibilityLabel="Clear search"
            >
              <Icon name="close" size={14} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Chips */}
        <View style={styles.filterPillsRow}>
          <TouchableOpacity
            style={[
              styles.filterPill,
              statusFilter === 'all' && styles.filterPillActive,
            ]}
            onPress={() => setStatusFilter('all')}
            accessibilityRole="button"
            accessibilityState={{ selected: statusFilter === 'all' }}
            accessibilityLabel={`All workers, ${workers.length}`}
          >
            <Text
              style={[
                styles.filterPillText,
                statusFilter === 'all' && styles.filterPillTextActive,
              ]}
            >
              All ({workers.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              statusFilter === 'active' && styles.filterPillActive,
            ]}
            onPress={() => setStatusFilter('active')}
            accessibilityRole="button"
            accessibilityState={{ selected: statusFilter === 'active' }}
            accessibilityLabel={`Active workers, ${activeCount}`}
          >
            <Text
              style={[
                styles.filterPillText,
                statusFilter === 'active' && styles.filterPillTextActive,
              ]}
            >
              Active ({activeCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              statusFilter === 'inactive' && styles.filterPillActive,
            ]}
            onPress={() => setStatusFilter('inactive')}
            accessibilityRole="button"
            accessibilityState={{ selected: statusFilter === 'inactive' }}
            accessibilityLabel={`Inactive workers, ${inactiveCount}`}
          >
            <Text
              style={[
                styles.filterPillText,
                statusFilter === 'inactive' && styles.filterPillTextActive,
              ]}
            >
              Inactive ({inactiveCount})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Workers Roster List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={Colors.textPrimary} />
          <Text style={styles.loadingText}>Loading workers roster...</Text>
        </View>
      ) : filteredWorkers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>
            {workers.length === 0 ? 'No Workers Added' : 'No Matching Workers'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {workers.length === 0
              ? 'Add workers with their daily wage rate to manage attendance and payroll.'
              : `No workers match the current search or filter.`}
          </Text>
          {workers.length === 0 && (
            <TouchableOpacity
              style={styles.addFirstBtn}
              onPress={handleOpenAdd}
              accessibilityRole="button"
              accessibilityLabel="Add first worker"
            >
              <Text style={styles.addFirstBtnText}>+ Add First Worker</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredWorkers}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={[styles.workerCard, !item.is_active && styles.workerCardInactive]}>
              {/* Header row - clickable to open Worker Detail */}
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => onSelectWorker?.(item.id)}
                activeOpacity={onSelectWorker ? 0.7 : 1}
                accessibilityRole="button"
                accessibilityLabel={`View worker details for ${item.name}`}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>

                <View style={styles.workerMainInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.workerName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <StatusPill
                      label={item.is_active ? 'Active' : 'Inactive'}
                      status={item.is_active ? 'active' : 'inactive'}
                    />
                  </View>

                  <View style={styles.subInfoRow}>
                    <View style={styles.wageBadge}>
                      <Text style={styles.wageBadgeText}>
                        Rate: <Text style={styles.wageBadgeBold}>₹{item.daily_wage}/day</Text>
                      </Text>
                    </View>
                    {item.phone ? (
                      <View style={styles.phoneRow}>
                        <Icon name="phone" size={12} color={Colors.textSecondary} strokeWidth={1.8} />
                        <Text style={styles.phoneText}>{item.phone}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {onSelectWorker && (
                  <Icon name="chevron-right" size={18} color={Colors.textMuted} strokeWidth={2} />
                )}
              </TouchableOpacity>

              {/* Action Buttons Row */}
              <View style={styles.cardActionRow}>
                <TouchableOpacity
                  style={[styles.cardActionBtn, styles.cardActionBtnSalary]}
                  onPress={() => setSalaryWorker(item)}
                  accessibilityLabel={`Update salary for ${item.name}`}
                  accessibilityRole="button"
                >
                  <Icon name="rupee" size={13} color={Colors.accent} strokeWidth={2.4} />
                  <Text style={styles.cardActionTextSalary}>Update Salary</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cardActionBtn}
                  onPress={() => setWageWorker(item)}
                  accessibilityLabel={`Wage history for ${item.name}`}
                  accessibilityRole="button"
                >
                  <Icon name="wage-history" size={13} color={Colors.textPrimary} strokeWidth={2} />
                  <Text style={styles.cardActionText}>History</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cardActionBtn}
                  onPress={() => handleOpenEdit(item)}
                  accessibilityLabel={`Edit ${item.name}`}
                  accessibilityRole="button"
                >
                  <Icon name="edit" size={13} color={Colors.textPrimary} strokeWidth={2} />
                  <Text style={styles.cardActionText}>Edit</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.cardActionBtn,
                    item.is_active ? styles.cardActionBtnDestructive : styles.cardActionBtnReactivate,
                  ]}
                  onPress={() => handleToggleStatus(item)}
                  accessibilityLabel={item.is_active ? `Deactivate ${item.name}` : `Activate ${item.name}`}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.cardActionTextStatus,
                      item.is_active ? styles.statusTextDeactivate : styles.statusTextActivate,
                    ]}
                  >
                    {item.is_active ? 'Deactivate' : 'Activate'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* ------------------------------------------------------------------------ */}
      {/* Add Worker Modal */}
      {/* ------------------------------------------------------------------------ */}
      <Modal visible={addModalVisible} animationType="slide" transparent onRequestClose={() => setAddModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalTopBar}>
              <Text style={styles.modalTitle}>Add New Worker</Text>
              <TouchableOpacity
                onPress={() => setAddModalVisible(false)}
                style={styles.modalCloseBtn}
                accessibilityLabel="Close add worker modal"
              >
                <Icon name="close" size={18} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.formLabel}>Worker Name *</Text>
              <TextInput
                style={[styles.formInput, addErrors.name ? styles.formInputError : null]}
                placeholder="e.g. Ramesh Kumar"
                placeholderTextColor={Colors.textMuted}
                value={addName}
                onChangeText={text => {
                  setAddName(text);
                  if (addErrors.name) setAddErrors(prev => ({ ...prev, name: '' }));
                }}
                autoFocus
              />
              {addErrors.name ? <Text style={styles.fieldErrorText}>{addErrors.name}</Text> : null}

              <Text style={styles.formLabel}>Daily Wage (₹) *</Text>
              <TextInput
                style={[styles.formInput, addErrors.daily_wage ? styles.formInputError : null]}
                placeholder="e.g. 600"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                value={addDailyWage}
                onChangeText={text => {
                  setAddDailyWage(text);
                  if (addErrors.daily_wage) setAddErrors(prev => ({ ...prev, daily_wage: '' }));
                }}
              />
              {addErrors.daily_wage ? (
                <Text style={styles.fieldErrorText}>{addErrors.daily_wage}</Text>
              ) : null}

              <Text style={styles.formLabel}>Effective From Date (YYYY-MM-DD) *</Text>
              <TextInput
                style={[styles.formInput, addErrors.effective_from ? styles.formInputError : null]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
                value={addEffectiveFrom}
                onChangeText={text => {
                  setAddEffectiveFrom(text);
                  if (addErrors.effective_from) setAddErrors(prev => ({ ...prev, effective_from: '' }));
                }}
              />
              <Text style={styles.fieldHelperText}>
                Date from which this initial wage applies (default: today).
              </Text>
              {addErrors.effective_from ? (
                <Text style={styles.fieldErrorText}>{addErrors.effective_from}</Text>
              ) : null}

              <Text style={styles.formLabel}>Phone Number (Optional)</Text>
              <TextInput
                style={styles.formInput}
                placeholder="e.g. 9876543210"
                placeholderTextColor={Colors.textMuted}
                keyboardType="phone-pad"
                value={addPhone}
                onChangeText={setAddPhone}
              />

              <View style={styles.modalButtonsRow}>
                <TouchableOpacity
                  style={styles.cancelModalBtn}
                  onPress={() => setAddModalVisible(false)}
                  disabled={addSaving}
                >
                  <Text style={styles.cancelModalBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveModalBtn, addSaving && styles.saveModalBtnDisabled]}
                  onPress={handleSaveAdd}
                  disabled={addSaving}
                >
                  {addSaving ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.saveModalBtnText}>Save Worker</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ------------------------------------------------------------------------ */}
      {/* Edit Worker Modal */}
      {/* ------------------------------------------------------------------------ */}
      <Modal visible={editingWorker !== null} animationType="slide" transparent onRequestClose={() => setEditingWorker(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalTopBar}>
              <Text style={styles.modalTitle}>Edit Worker Details</Text>
              <TouchableOpacity
                onPress={() => setEditingWorker(null)}
                style={styles.modalCloseBtn}
                accessibilityLabel="Close edit worker modal"
              >
                <Icon name="close" size={18} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.formLabel}>Worker Name *</Text>
              <TextInput
                style={[styles.formInput, editErrors.name ? styles.formInputError : null]}
                value={editName}
                onChangeText={text => {
                  setEditName(text);
                  if (editErrors.name) setEditErrors(prev => ({ ...prev, name: '' }));
                }}
              />
              {editErrors.name ? <Text style={styles.fieldErrorText}>{editErrors.name}</Text> : null}

              <Text style={styles.formLabel}>Phone Number (Optional)</Text>
              <TextInput
                style={styles.formInput}
                placeholder="e.g. 9876543210"
                placeholderTextColor={Colors.textMuted}
                keyboardType="phone-pad"
                value={editPhone}
                onChangeText={setEditPhone}
              />

              <View style={styles.editWageNotice}>
                <Text style={styles.editWageNoticeTitle}>
                  Daily Wage: ₹{editingWorker?.daily_wage}/day
                </Text>
                <Text style={styles.editWageNoticeText}>
                  Wage changes are effective-dated to protect historical payroll integrity. Use the "Wage History" button on the worker card to schedule or update rates.
                </Text>
              </View>

              <View style={styles.modalButtonsRow}>
                <TouchableOpacity
                  style={styles.cancelModalBtn}
                  onPress={() => setEditingWorker(null)}
                  disabled={editSaving}
                >
                  <Text style={styles.cancelModalBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveModalBtn, editSaving && styles.saveModalBtnDisabled]}
                  onPress={handleSaveEdit}
                  disabled={editSaving}
                >
                  {editSaving ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.saveModalBtnText}>Save Changes</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ------------------------------------------------------------------------ */}
      {/* Update Salary Modal */}
      {/* ------------------------------------------------------------------------ */}
      <UpdateSalaryModal
        visible={salaryWorker !== null}
        worker={salaryWorker}
        accountId={accountId}
        onClose={() => setSalaryWorker(null)}
        onSalaryUpdated={(newWage, effDate) => {
          showFeedback(
            `Salary for ${salaryWorker?.name} updated to ₹${newWage}/day (effective ${effDate}).`,
            'success'
          );
          setSalaryWorker(null);
          loadWorkers();
        }}
      />

      {/* ------------------------------------------------------------------------ */}
      {/* Wage History & Rate Change Modal */}
      {/* ------------------------------------------------------------------------ */}
      <WageHistoryModal
        visible={wageWorker !== null}
        worker={wageWorker}
        accountId={accountId}
        onClose={() => setWageWorker(null)}
        onWageUpdated={loadWorkers}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  feedbackBanner: {
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackSuccess: {
    backgroundColor: Colors.successLight,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  feedbackError: {
    backgroundColor: Colors.errorLight,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
  },
  feedbackInfo: {
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  feedbackText: {
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackTextSuccess: {
    color: Colors.success,
  },
  feedbackTextError: {
    color: Colors.errorText,
  },
  feedbackTextInfo: {
    color: Colors.textPrimary,
  },
  topControlSection: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    gap: Spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  clearSearchBtn: {
    padding: 4,
  },
  clearSearchText: {
    fontSize: 14,
    color: Colors.textMuted,
    fontWeight: '700',
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: 4,
  },
  filterPill: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterPillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  filterPillTextActive: {
    color: '#ffffff',
  },
  listContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: 40,
    gap: Spacing.md,
  },
  workerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  workerCardInactive: {
    opacity: 0.75,
    backgroundColor: '#fafafa',
  },
  cardHeader: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  workerMainInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  workerName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    flex: 1,
  },
  subInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  wageBadge: {
    backgroundColor: Colors.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  wageBadgeText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  wageBadgeBold: {
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phoneText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    flexWrap: 'wrap',
  },
  cardActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceMuted,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  cardActionBtnSalary: {
    backgroundColor: '#fff7ed',
    borderColor: Colors.accentBorder,
  },
  cardActionTextSalary: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
  },
  cardActionIcon: {
    fontSize: 13,
  },
  cardActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  cardActionBtnDestructive: {
    backgroundColor: '#ffffff',
    borderColor: '#fca5a5',
    marginLeft: 'auto',
  },
  cardActionBtnReactivate: {
    backgroundColor: '#ffffff',
    borderColor: '#86efac',
    marginLeft: 'auto',
  },
  cardActionTextStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusTextDeactivate: {
    color: '#b91c1c',
  },
  statusTextActivate: {
    color: '#15803d',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.titleMedium,
  },
  emptySubtitle: {
    ...Typography.caption,
    textAlign: 'center',
    marginTop: Spacing.xs,
    maxWidth: 280,
  },
  addFirstBtn: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.lg,
  },
  addFirstBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    maxHeight: '85%',
  },
  modalTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    marginBottom: 6,
  },
  formInput: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  formInputError: {
    borderColor: Colors.error,
  },
  fieldErrorText: {
    fontSize: 11,
    color: Colors.errorText,
    marginTop: 4,
    fontWeight: '600',
  },
  fieldHelperText: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
  },
  editWageNotice: {
    backgroundColor: Colors.surfaceMuted,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  editWageNoticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  editWageNoticeText: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  cancelModalBtn: {
    flex: 1,
    height: 48,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelModalBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  saveModalBtn: {
    flex: 1,
    height: 48,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveModalBtnDisabled: {
    opacity: 0.6,
  },
  saveModalBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
});
