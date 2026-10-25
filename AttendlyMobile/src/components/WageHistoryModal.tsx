import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { Colors, Spacing, BorderRadius } from '../theme/tokens';
import { LocalWorker } from '../repositories/workerRepository';
import { WageHistoryRepository, LocalWageHistory } from '../repositories/wageHistoryRepository';
import { SyncManager } from '../sync/syncManager';
import { toLocalDateString, formatDateIndian } from '../utils/dateUtils';
import { Icon } from './Icon';

interface WageHistoryModalProps {
  visible: boolean;
  worker: LocalWorker | null;
  accountId: string;
  onClose: () => void;
  onWageUpdated?: () => void;
}

export const WageHistoryModal: React.FC<WageHistoryModalProps> = ({
  visible,
  worker,
  accountId,
  onClose,
  onWageUpdated,
}) => {
  const [wages, setWages] = useState<LocalWageHistory[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [view, setView] = useState<'list' | 'add'>('list');
  const [newWage, setNewWage] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState<string>(() => toLocalDateString());
  const [formError, setFormError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const loadWages = useCallback(() => {
    if (!worker) return;
    try {
      setLoading(true);
      const list = WageHistoryRepository.getByWorkerId(worker.id, accountId);
      setWages(list);
    } catch {
      setNotice({ message: 'Failed to load local wage history.', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [worker, accountId]);

  useEffect(() => {
    if (visible && worker) {
      setView('list');
      setNewWage('');
      setEffectiveDate(toLocalDateString());
      setFormError('');
      setNotice(null);
      loadWages();
    }
  }, [visible, worker, loadWages]);

  const handleOpenAdd = () => {
    setNewWage('');
    setEffectiveDate(toLocalDateString());
    setFormError('');
    setNotice(null);
    setView('add');
  };

  const handleSaveWage = async () => {
    if (!worker) return;
    const trimmedWage = newWage.trim();
    if (!trimmedWage) {
      setFormError('Please enter a daily wage amount.');
      return;
    }
    const wageNum = parseFloat(trimmedWage);
    if (isNaN(wageNum) || wageNum <= 0) {
      setFormError('Daily wage must be greater than ₹0.');
      return;
    }
    if (wageNum > 100000) {
      setFormError('Daily wage cannot exceed ₹1,00,000.');
      return;
    }
    const wageParts = trimmedWage.split('.');
    if (wageParts.length > 1 && wageParts[1].length > 2) {
      setFormError('Daily wage cannot have more than 2 decimal places.');
      return;
    }

    const trimmedDate = effectiveDate.trim();
    if (!trimmedDate || !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      setFormError('Please enter a valid date in YYYY-MM-DD format.');
      return;
    }
    const [y, m, d] = trimmedDate.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) {
      setFormError('Please enter a valid calendar date.');
      return;
    }
    const checkDate = new Date(y, m - 1, d);
    if (checkDate.getFullYear() !== y || checkDate.getMonth() !== m - 1 || checkDate.getDate() !== d) {
      setFormError('Please enter a valid calendar date.');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');
      WageHistoryRepository.save({
        account_id: accountId,
        worker_id: worker.id,
        daily_wage: wageNum,
        effective_from: trimmedDate,
      });

      setNotice({
        message: `Wage rate of ₹${wageNum} recorded effective ${formatDateIndian(trimmedDate)}.`,
        type: 'success',
      });
      setView('list');
      loadWages();
      if (onWageUpdated) {
        onWageUpdated();
      }
      SyncManager.triggerSync();
    } catch (err: any) {
      setFormError(err.message || 'Failed to record wage change.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteWage = (wage: LocalWageHistory) => {
    if (!worker) return;
    if (wages.length <= 1) {
      Alert.alert('Action Denied', "Cannot delete the worker's sole wage record.");
      return;
    }

    Alert.alert(
      'Delete Wage Rate?',
      `Are you sure you want to remove the rate of ₹${wage.daily_wage}/day effective from ${formatDateIndian(
        wage.effective_from
      )}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            try {
              WageHistoryRepository.delete(wage.id, worker.id, accountId);
              setNotice({ message: 'Wage record removed successfully.', type: 'success' });
              loadWages();
              if (onWageUpdated) {
                onWageUpdated();
              }
              SyncManager.triggerSync();
            } catch (err: any) {
              setNotice({ message: err.message || 'Failed to delete record.', type: 'error' });
            }
          },
        },
      ]
    );
  };

  if (!worker) return null;

  const todayStr = toLocalDateString();
  let currentActiveIndex = -1;
  for (let i = 0; i < wages.length; i++) {
    if (wages[i].effective_from <= todayStr) {
      currentActiveIndex = i;
      break;
    }
  }
  if (currentActiveIndex === -1 && wages.length > 0) {
    currentActiveIndex = wages.length - 1;
  }

  const activeWageEntry = currentActiveIndex >= 0 ? wages[currentActiveIndex] : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleGroup}>
              <Text style={styles.workerName}>{worker.name}</Text>
              <Text style={styles.modalSubtitle}>Wage History & Rate Timeline</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityLabel="Close wage history modal"
              accessibilityRole="button"
            >
              <Icon name="close" size={18} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {/* Feedback notice */}
          {notice && (
            <View
              style={[
                styles.noticeBanner,
                notice.type === 'success' ? styles.noticeSuccess : styles.noticeError,
              ]}
            >
              <Text
                style={[
                  styles.noticeText,
                  notice.type === 'success' ? styles.noticeTextSuccess : styles.noticeTextError,
                ]}
              >
                {notice.message}
              </Text>
            </View>
          )}

          {view === 'list' ? (
            /* Rate History List View */
            <View style={styles.contentArea}>
              {/* Prominent Current Daily Wage Summary */}
              <View style={styles.currentWageBanner}>
                <View style={styles.currentWageLeft}>
                  <Text style={styles.currentWageTitle}>CURRENT ACTIVE RATE</Text>
                  <Text style={styles.currentWageValue}>
                    ₹{worker.daily_wage}
                    <Text style={styles.currentWageUnit}> / day</Text>
                  </Text>
                  <Text style={styles.currentWageEffective}>
                    {activeWageEntry
                      ? `Effective from ${formatDateIndian(activeWageEntry.effective_from)}`
                      : 'Applicable today'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.updateRateBtn}
                  onPress={handleOpenAdd}
                  accessibilityLabel="Update daily wage rate"
                  accessibilityRole="button"
                >
                  <Icon name="rupee" size={13} color="#ffffff" strokeWidth={2.2} />
                  <Text style={styles.updateRateBtnText}>Update Rate</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.listHeaderBar}>
                <Text style={styles.sectionLabel}>EFFECTIVE RATE TIMELINE</Text>
                <TouchableOpacity
                  style={styles.addRateBtn}
                  onPress={handleOpenAdd}
                  accessibilityLabel="Add new wage rate"
                  accessibilityRole="button"
                >
                  <Icon name="plus" size={13} color="#ffffff" strokeWidth={2.5} />
                  <Text style={styles.addRateBtnText}>Add Rate</Text>
                </TouchableOpacity>
              </View>

              {loading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="small" color={Colors.textPrimary} />
                  <Text style={styles.loadingText}>Loading rates...</Text>
                </View>
              ) : wages.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTitle}>No Wage Records</Text>
                  <Text style={styles.emptySubtitle}>
                    Initial rate ₹{worker.daily_wage}/day will be recorded upon adding.
                  </Text>
                </View>
              ) : (
                <ScrollView style={styles.scrollList} showsVerticalScrollIndicator={false}>
                  {wages.map((w, index) => {
                    const isCurrent = index === currentActiveIndex;
                    const isFuture = w.effective_from > todayStr;
                    const isPast = !isCurrent && !isFuture;

                    return (
                      <View
                        key={w.id}
                        style={[
                          styles.rateItem,
                          isCurrent && styles.rateItemCurrent,
                        ]}
                      >
                        <View style={styles.rateInfoCol}>
                          <View style={styles.rateTopRow}>
                            <Text style={styles.rateAmount}>₹{w.daily_wage}</Text>
                            <Text style={styles.ratePerDay}>/ day</Text>

                            {isCurrent && (
                              <View style={styles.activePill}>
                                <Text style={styles.activePillText}>Active Rate</Text>
                              </View>
                            )}
                            {isFuture && (
                              <View style={styles.scheduledPill}>
                                <Text style={styles.scheduledPillText}>Scheduled</Text>
                              </View>
                            )}
                            {isPast && (
                              <View style={styles.pastPill}>
                                <Text style={styles.pastPillText}>Past Rate</Text>
                              </View>
                            )}
                          </View>

                          <Text style={styles.effectiveText}>
                            Effective from <Text style={styles.effectiveDateBold}>{formatDateIndian(w.effective_from)}</Text>
                          </Text>
                          {w.created_at ? (
                            <Text style={styles.auditMetaText}>
                              Recorded on {formatDateIndian(w.created_at.split('T')[0])}
                            </Text>
                          ) : null}
                        </View>

                        {wages.length > 1 && (
                          <TouchableOpacity
                            style={styles.deleteWageBtn}
                            onPress={() => handleDeleteWage(w)}
                            accessibilityLabel={`Delete rate of ₹${w.daily_wage}`}
                            accessibilityRole="button"
                          >
                            <Icon name="trash" size={15} color="#ef4444" strokeWidth={1.8} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              )}

              <TouchableOpacity
                style={styles.doneBtn}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Text style={styles.doneBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Add / Update Rate Form View */
            <View style={styles.contentArea}>
              <View style={styles.formContextCard}>
                <Text style={styles.contextTitle}>
                  Current Active Rate: <Text style={styles.contextBold}>₹{worker.daily_wage}/day</Text>
                </Text>
                <Text style={styles.contextNote}>
                  Attendance shifts on or after the effective date will use the new rate. Past records remain preserved.
                </Text>
              </View>

              <Text style={styles.inputLabel}>New Daily Wage (₹)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. 750"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                value={newWage}
                onChangeText={setNewWage}
                autoFocus
              />

              <Text style={styles.inputLabel}>Effective From Date (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
                value={effectiveDate}
                onChangeText={setEffectiveDate}
              />
              <Text style={styles.helperText}>
                Date format: YYYY-MM-DD (e.g. {toLocalDateString()})
              </Text>

              {formError ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{formError}</Text>
                </View>
              ) : null}

              <View style={styles.formActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setView('list')}
                  disabled={submitting}
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelBtnText}>Back to List</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.applyBtn, submitting && styles.applyBtnDisabled]}
                  onPress={handleSaveWage}
                  disabled={submitting}
                  accessibilityRole="button"
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.applyBtnText}>Apply New Wage</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  headerTitleGroup: {
    flex: 1,
  },
  workerName: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  noticeBanner: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  noticeSuccess: {
    backgroundColor: Colors.successLight,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  noticeError: {
    backgroundColor: Colors.errorLight,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
  },
  noticeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  noticeTextSuccess: {
    color: Colors.success,
  },
  noticeTextError: {
    color: Colors.errorText,
  },
  contentArea: {
    minHeight: 280,
  },
  currentWageBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.accentBorder,
    marginBottom: Spacing.md,
  },
  currentWageLeft: {
    flex: 1,
  },
  currentWageTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.accent,
    letterSpacing: 0.5,
  },
  currentWageValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  currentWageUnit: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  currentWageEffective: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  updateRateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.textPrimary,
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: 4,
  },
  updateRateBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  listHeaderBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: Colors.textSecondary,
  },
  addRateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
  },
  addRateBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  scrollList: {
    maxHeight: 320,
    marginBottom: Spacing.md,
  },
  rateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceMuted,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rateItemCurrent: {
    borderColor: Colors.accentBorder,
    backgroundColor: '#fffaf5',
  },
  rateInfoCol: {
    flex: 1,
  },
  rateTopRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 4,
  },
  rateAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  ratePerDay: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginRight: 8,
  },
  activePill: {
    backgroundColor: '#ffedd5',
    borderColor: '#fed7aa',
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  activePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9a3412',
  },
  scheduledPill: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  scheduledPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  pastPill: {
    backgroundColor: '#f4f4f5',
    borderColor: '#e4e4e7',
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pastPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#71717a',
  },
  effectiveText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  effectiveDateBold: {
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  auditMetaText: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  deleteWageBtn: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: Spacing.sm,
  },
  deleteWageIcon: {
    fontSize: 16,
  },
  doneBtn: {
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  formContextCard: {
    backgroundColor: Colors.surfaceMuted,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  contextTitle: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  contextBold: {
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  contextNote: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 4,
    lineHeight: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 6,
    marginTop: Spacing.sm,
  },
  textInput: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  helperText: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
    marginBottom: Spacing.sm,
  },
  errorBanner: {
    backgroundColor: Colors.errorLight,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  errorText: {
    fontSize: 12,
    color: Colors.errorText,
    fontWeight: '600',
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  applyBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  applyBtnDisabled: {
    opacity: 0.6,
  },
  applyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
});
