import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Colors, Spacing, BorderRadius } from '../theme/tokens';
import { LocalWorker } from '../repositories/workerRepository';
import { WageHistoryRepository } from '../repositories/wageHistoryRepository';
import { SyncManager } from '../sync/syncManager';
import { toLocalDateString, formatDateIndian } from '../utils/dateUtils';
import { Icon } from './Icon';

export interface UpdateSalaryModalProps {
  visible: boolean;
  worker: LocalWorker | null;
  accountId: string;
  onClose: () => void;
  onSalaryUpdated: (newWage: number, effectiveFrom: string) => void;
}

export const UpdateSalaryModal: React.FC<UpdateSalaryModalProps> = ({
  visible,
  worker,
  accountId,
  onClose,
  onSalaryUpdated,
}) => {
  const [newWage, setNewWage] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState<string>(() => toLocalDateString());
  const [errors, setErrors] = useState<{ daily_wage?: string; effective_from?: string }>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>('');

  const todayStr = toLocalDateString();

  useEffect(() => {
    if (visible && worker) {
      setNewWage('');
      setEffectiveDate(toLocalDateString());
      setErrors({});
      setSaveError('');
      setSaving(false);
    }
  }, [visible, worker]);

  if (!worker) return null;

  const validateForm = (): boolean => {
    const errs: { daily_wage?: string; effective_from?: string } = {};

    // 1. Validate wage amount
    const trimmedWage = newWage.trim();
    if (!trimmedWage) {
      errs.daily_wage = 'Daily wage amount is required';
    } else {
      const num = parseFloat(trimmedWage);
      if (isNaN(num)) {
        errs.daily_wage = 'Please enter a valid numeric amount';
      } else if (num <= 0) {
        errs.daily_wage = 'Daily wage must be greater than ₹0';
      } else if (num > 100000) {
        errs.daily_wage = 'Daily wage cannot exceed ₹1,00,000';
      } else {
        // Decimal precision check: at most 2 decimal places
        const parts = trimmedWage.split('.');
        if (parts.length > 1 && parts[1].length > 2) {
          errs.daily_wage = 'Daily wage cannot have more than 2 decimal places';
        }
      }
    }

    // 2. Validate effective date
    const trimmedDate = effectiveDate.trim();
    if (!trimmedDate) {
      errs.effective_from = 'Effective-from date is required';
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      errs.effective_from = 'Date must be formatted as YYYY-MM-DD';
    } else {
      const parts = trimmedDate.split('-').map(Number);
      const y = parts[0];
      const m = parts[1];
      const d = parts[2];
      if (m < 1 || m > 12) {
        errs.effective_from = 'Month must be between 01 and 12';
      } else if (d < 1 || d > 31) {
        errs.effective_from = 'Day must be between 01 and 31';
      } else {
        const testDate = new Date(y, m - 1, d);
        if (
          testDate.getFullYear() !== y ||
          testDate.getMonth() !== m - 1 ||
          testDate.getDate() !== d
        ) {
          errs.effective_from = 'Please enter a valid calendar date';
        }
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    const wageNum = parseFloat(newWage.trim());
    const effDate = effectiveDate.trim();

    try {
      setSaving(true);
      setSaveError('');

      // Save locally to SQLite and queue sync
      WageHistoryRepository.save({
        account_id: accountId,
        worker_id: worker.id,
        daily_wage: wageNum,
        effective_from: effDate,
      });

      // Notify parent to refresh worker and wage history
      onSalaryUpdated(wageNum, effDate);
      SyncManager.triggerSync();
      onClose();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save salary update. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Quick date presets
  const handleSetToday = () => {
    setEffectiveDate(todayStr);
    setErrors(prev => ({ ...prev, effective_from: undefined }));
  };

  const handleSetFirstOfMonth = () => {
    const parts = todayStr.split('-');
    const firstOfMonth = `${parts[0]}-${parts[1]}-01`;
    setEffectiveDate(firstOfMonth);
    setErrors(prev => ({ ...prev, effective_from: undefined }));
  };

  const handleSetTomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const tmrw = d.toISOString().split('T')[0];
    setEffectiveDate(tmrw);
    setErrors(prev => ({ ...prev, effective_from: undefined }));
  };

  // Determine dynamic schedule status notice
  const isFuture = effectiveDate.trim() > todayStr;
  const isPast = effectiveDate.trim() < todayStr && effectiveDate.trim().length === 10;
  const isToday = effectiveDate.trim() === todayStr;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleGroup}>
              <Text style={styles.modalTitle}>Update Salary</Text>
              <Text style={styles.modalSubtitle}>Adjust daily wage & compensation schedule</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityLabel="Cancel and close salary update modal"
              accessibilityRole="button"
            >
              <Icon name="close" size={18} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
            {/* Worker Current Rate Card */}
            <View style={styles.workerSummaryCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{worker.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.workerMeta}>
                <Text style={styles.workerName} numberOfLines={1}>
                  {worker.name}
                </Text>
                <View style={styles.currentWageBadge}>
                  <Text style={styles.currentWageLabel}>Current Rate:</Text>
                  <Text style={styles.currentWageAmount}>₹{worker.daily_wage}/day</Text>
                </View>
              </View>
            </View>

            {/* Save Error Banner */}
            {saveError ? (
              <View style={styles.errorAlert}>
                <Icon name="alert-circle" size={16} color={Colors.error} strokeWidth={2} />
                <Text style={styles.errorAlertText}>{saveError}</Text>
              </View>
            ) : null}

            {/* New Daily Wage Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                NEW DAILY WAGE (₹) <Text style={styles.requiredStar}>*</Text>
              </Text>
              <View
                style={[
                  styles.currencyInputRow,
                  errors.daily_wage ? styles.inputRowError : null,
                ]}
              >
                <Text style={styles.currencyPrefix}>₹</Text>
                <TextInput
                  style={styles.currencyInput}
                  placeholder="e.g. 750"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="decimal-pad"
                  value={newWage}
                  onChangeText={val => {
                    setNewWage(val);
                    if (errors.daily_wage) setErrors(prev => ({ ...prev, daily_wage: undefined }));
                  }}
                  autoFocus
                  accessibilityLabel="New daily wage amount in rupees"
                />
                <Text style={styles.currencySuffix}>/ day</Text>
              </View>
              {errors.daily_wage ? (
                <Text style={styles.inlineError}>{errors.daily_wage}</Text>
              ) : (
                <Text style={styles.fieldHint}>Must be a positive monetary rate (e.g. 650 or 725.50)</Text>
              )}
            </View>

            {/* Effective-From Date Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                EFFECTIVE FROM DATE <Text style={styles.requiredStar}>*</Text>
              </Text>
              <View
                style={[
                  styles.dateInputRow,
                  errors.effective_from ? styles.inputRowError : null,
                ]}
              >
                <Icon name="calendar" size={16} color={Colors.textSecondary} strokeWidth={1.8} />
                <TextInput
                  style={styles.dateInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.textMuted}
                  value={effectiveDate}
                  onChangeText={val => {
                    setEffectiveDate(val);
                    if (errors.effective_from) setErrors(prev => ({ ...prev, effective_from: undefined }));
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Effective from date in YYYY-MM-DD format"
                />
              </View>
              {errors.effective_from ? (
                <Text style={styles.inlineError}>{errors.effective_from}</Text>
              ) : null}

              {/* Quick Date Shortcut Chips */}
              <View style={styles.dateChipsRow}>
                <TouchableOpacity
                  style={[styles.dateChip, isToday && styles.dateChipActive]}
                  onPress={handleSetToday}
                  accessibilityRole="button"
                  accessibilityLabel="Set effective date to today"
                >
                  <Text style={[styles.dateChipText, isToday && styles.dateChipTextActive]}>
                    Today
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dateChip}
                  onPress={handleSetFirstOfMonth}
                  accessibilityRole="button"
                  accessibilityLabel="Set effective date to first of current month"
                >
                  <Text style={styles.dateChipText}>1st of Month</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dateChip}
                  onPress={handleSetTomorrow}
                  accessibilityRole="button"
                  accessibilityLabel="Set effective date to tomorrow"
                >
                  <Text style={styles.dateChipText}>Tomorrow</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Dynamic Informational Schedule Notice */}
            <View style={styles.noticeCard}>
              <Icon
                name={isPast ? 'alert-circle' : 'info'}
                size={16}
                color={isPast ? Colors.warning : Colors.textSecondary}
                strokeWidth={2}
                style={styles.noticeIcon}
              />
              <View style={styles.noticeTextGroup}>
                {isFuture ? (
                  <Text style={styles.noticeMessage}>
                    <Text style={styles.noticeBold}>Scheduled Wage Rate:</Text> Shifts recorded before{' '}
                    <Text style={styles.noticeBold}>{formatDateIndian(effectiveDate.trim())}</Text>{' '}
                    will continue at the current rate (₹{worker.daily_wage}/day). The new rate takes
                    effect on {formatDateIndian(effectiveDate.trim())}.
                  </Text>
                ) : isPast ? (
                  <Text style={styles.noticeMessage}>
                    <Text style={styles.noticeBold}>Retroactive Rate Adjustment:</Text> Shifts on or
                    after <Text style={styles.noticeBold}>{formatDateIndian(effectiveDate.trim())}</Text>{' '}
                    will be recalculated using this rate. Monthly gross payroll and worker ledgers
                    will reflect the updated rate.
                  </Text>
                ) : (
                  <Text style={styles.noticeMessage}>
                    <Text style={styles.noticeBold}>Immediate Effect:</Text> This new rate applies to
                    all attendance shifts recorded for today and ongoing work.
                  </Text>
                )}
              </View>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Cancel salary update"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save updated salary"
            >
              {saving ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.saveButtonText}>Save Rate</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
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
    maxHeight: '90%',
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
  modalTitle: {
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
    padding: Spacing.xs,
  },
  scrollContent: {
    paddingBottom: Spacing.md,
  },
  workerSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceMuted,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff7ed',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.accentBorder,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.accent,
  },
  workerMeta: {
    flex: 1,
  },
  workerName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  currentWageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  currentWageLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  currentWageAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent,
  },
  errorAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  errorAlertText: {
    fontSize: 13,
    color: Colors.error,
    fontWeight: '600',
    flex: 1,
  },
  inputGroup: {
    marginBottom: Spacing.lg,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  requiredStar: {
    color: Colors.accent,
  },
  currencyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
  },
  currencyPrefix: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginRight: 6,
  },
  currencyInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  currencySuffix: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  dateInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    gap: Spacing.xs,
  },
  dateInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  inputRowError: {
    borderColor: Colors.error,
    backgroundColor: '#fffbfa',
  },
  inlineError: {
    fontSize: 12,
    color: Colors.error,
    fontWeight: '500',
    marginTop: 4,
  },
  fieldHint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 4,
  },
  dateChipsRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  dateChip: {
    paddingVertical: 5,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dateChipActive: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  dateChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  dateChipTextActive: {
    color: '#ffffff',
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff7ed',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accentBorder,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  noticeIcon: {
    marginTop: 2,
  },
  noticeTextGroup: {
    flex: 1,
  },
  noticeMessage: {
    fontSize: 12,
    lineHeight: 17,
    color: Colors.textPrimary,
  },
  noticeBold: {
    fontWeight: '700',
    color: Colors.accent,
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  saveButton: {
    flex: 2,
    backgroundColor: Colors.textPrimary,
    paddingVertical: 14,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
});
