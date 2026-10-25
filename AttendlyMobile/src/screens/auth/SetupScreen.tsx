import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography, BorderRadius } from '../../theme/tokens';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { MpinInput } from '../../components/primitives/MpinInput';
import { ApiClient } from '../../api/client';
import { AuthStorage } from '../../storage/authStorage';

interface SetupScreenProps {
  onSuccess: (accountId: string) => void;
}

/**
 * First-Time Contractor Setup Screen
 * Used when no contractor account exists on the backend.
 * Registers the single master contractor phone number and 4-digit MPIN.
 * 
 * Visual & Interaction Parity:
 * - Attendly squircle with industrial orange brand dot.
 * - Warm off-white #faf9f6 background with crisp white card.
 * - 4 tactile square MPIN boxes for MPIN and confirmation.
 * - Clean client-side validation and error presentation.
 * 
 * Security:
 * - MPIN and confirm MPIN are transient React states only.
 * - Never logged or stored in AsyncStorage, Keychain, or SQLite.
 * - Signed JWT token is persisted securely to Keychain on success.
 */
export const SetupScreen: React.FC<SetupScreenProps> = ({ onSuccess }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [mpin, setMpin] = useState('');
  const [confirmMpin, setConfirmMpin] = useState('');

  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [mpinError, setMpinError] = useState<string | null>(null);
  const [confirmMpinError, setConfirmMpinError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const isSubmitting = useRef(false);

  function clearErrors() {
    setPhoneError(null);
    setMpinError(null);
    setConfirmMpinError(null);
    setGeneralError(null);
  }

  async function handleSetup() {
    // Prevent duplicate submissions
    if (loading || isSubmitting.current) {
      return;
    }

    clearErrors();

    const cleanedPhone = phoneNumber.replace(/[^\d+]/g, '');
    const digitsOnly = cleanedPhone.replace(/[^\d]/g, '');

    let hasValidationError = false;

    if (!digitsOnly || digitsOnly.length < 10) {
      setPhoneError('Please enter a valid phone number (at least 10 digits)');
      hasValidationError = true;
    }

    if (!/^\d{4}$/.test(mpin)) {
      setMpinError('MPIN must be exactly 4 numeric digits');
      hasValidationError = true;
    }

    if (!/^\d{4}$/.test(confirmMpin)) {
      setConfirmMpinError('Please re-enter your complete 4-digit MPIN');
      hasValidationError = true;
    } else if (mpin !== confirmMpin) {
      setConfirmMpinError('MPIN and Confirm MPIN do not match');
      hasValidationError = true;
    }

    if (hasValidationError) {
      return;
    }

    isSubmitting.current = true;
    setLoading(true);

    try {
      const res = await ApiClient.setupAccount(cleanedPhone, mpin, confirmMpin);
      
      // Store session securely (Token in Keychain, Account ID & phone in AuthStorage)
      // MPIN is intentionally never stored anywhere
      await AuthStorage.saveSession(
        res.access_token,
        res.account.id,
        res.account.phone_number || cleanedPhone
      );

      onSuccess(res.account.id);
    } catch (err: any) {
      if (err.isNetworkError) {
        setGeneralError('Unable to connect to Attendly server. Please check your network connection.');
      } else {
        setGeneralError(err?.message || 'Failed to complete account setup. Please try again.');
      }
    } finally {
      setLoading(false);
      isSubmitting.current = false;
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header Brand */}
            <View style={styles.header}>
              <View style={styles.squircleContainer}>
                <View style={styles.lockShackle} />
                <View style={styles.lockBody} />
                <View style={styles.orangeDot} />
              </View>
              <Text style={styles.appTitle}>Attendly</Text>
              <Text style={styles.appSubtitle}>Master Contractor Setup</Text>
            </View>

            {/* Setup Form Card */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Create Master Account</Text>
              <Text style={styles.cardDescription}>
                Set up your master phone number and 4-digit MPIN to manage your attendance and workers.
              </Text>

              {generalError && (
                <View style={styles.errorBox} testID="setup-general-error">
                  <Text style={styles.errorText}>{generalError}</Text>
                </View>
              )}

              {/* Phone Number Input */}
              <View style={styles.inputSection}>
                <Input
                  label="Mobile Phone Number"
                  placeholder="e.g. 9876543210"
                  keyboardType="phone-pad"
                  maxLength={15}
                  value={phoneNumber}
                  onChangeText={(text) => {
                    setPhoneNumber(text);
                    if (phoneError) setPhoneError(null);
                    if (generalError) setGeneralError(null);
                  }}
                  error={phoneError || undefined}
                  editable={!loading}
                  testID="setup-phone-input"
                  accessibilityLabel="Mobile phone number input"
                />
              </View>

              {/* 4-Digit MPIN Input */}
              <View style={styles.inputSection}>
                <Text style={styles.fieldLabel}>Set 4-Digit MPIN</Text>
                <Text style={styles.fieldHint}>
                  Choose 4 numeric digits you will use to unlock Attendly.
                </Text>
                <MpinInput
                  value={mpin}
                  onChangeText={(val) => {
                    setMpin(val);
                    if (mpinError) setMpinError(null);
                    if (generalError) setGeneralError(null);
                  }}
                  masked={true}
                  disabled={loading}
                  error={!!mpinError}
                  testID="setup-mpin-input"
                />
                {mpinError && (
                  <Text style={styles.fieldErrorText} testID="setup-mpin-error">
                    {mpinError}
                  </Text>
                )}
              </View>

              {/* Confirm 4-Digit MPIN Input */}
              <View style={styles.inputSection}>
                <Text style={styles.fieldLabel}>Confirm 4-Digit MPIN</Text>
                <Text style={styles.fieldHint}>
                  Re-enter the 4 digits to verify.
                </Text>
                <MpinInput
                  value={confirmMpin}
                  onChangeText={(val) => {
                    setConfirmMpin(val);
                    if (confirmMpinError) setConfirmMpinError(null);
                    if (generalError) setGeneralError(null);
                  }}
                  masked={true}
                  disabled={loading}
                  error={!!confirmMpinError}
                  testID="setup-confirm-mpin-input"
                />
                {confirmMpinError && (
                  <Text style={styles.fieldErrorText} testID="setup-confirm-error">
                    {confirmMpinError}
                  </Text>
                )}
              </View>

              {/* Action Button */}
              <Button
                title="Create Contractor Account"
                onPress={handleSetup}
                variant="primary"
                size="lg"
                loading={loading}
                disabled={loading}
                style={styles.submitBtn}
                testID="setup-submit-button"
                accessibilityLabel="Create contractor account"
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    justifyContent: 'center',
    flexGrow: 1,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  squircleContainer: {
    position: 'relative',
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#18181b',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    shadowColor: '#18181b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  lockShackle: {
    width: 14,
    height: 10,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderWidth: 2.2,
    borderColor: '#ffffff',
    borderBottomWidth: 0,
    marginBottom: -1,
  },
  lockBody: {
    width: 18,
    height: 13,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  orangeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
    borderWidth: 2,
    borderColor: '#18181b',
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  appSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginTop: 3,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  cardTitle: {
    ...Typography.titleMedium,
    textAlign: 'center',
  },
  cardDescription: {
    ...Typography.caption,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: Spacing.lg,
  },
  inputSection: {
    marginBottom: Spacing.md,
  },
  fieldLabel: {
    ...Typography.captionMedium,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  fieldHint: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  fieldErrorText: {
    ...Typography.caption,
    color: Colors.errorText,
    marginTop: 2,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: Colors.errorLight,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
  },
  errorText: {
    color: Colors.errorText,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  submitBtn: {
    marginTop: Spacing.md,
  },
});
