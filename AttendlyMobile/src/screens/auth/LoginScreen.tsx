import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, BorderRadius } from '../../theme/tokens';
import { ApiClient } from '../../api/client';
import { AuthStorage } from '../../storage/authStorage';
import { MpinInput, MPIN_LENGTH } from '../../components/primitives/MpinInput';

interface LoginScreenProps {
  onSuccess: (accountId: string) => void;
}

const NUMPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Returning Contractor Login Screen
 * Faithfully reproduces the PWA login UI/UX:
 * - Attendly Obsidian lock squircle with upper-right industrial orange brand dot.
 * - Warm off-white #faf9f6 background.
 * - 4 square tactile MPIN slots in a single horizontal row with shake animation on error.
 * - 3-column on-screen tactile numeric keypad with active/press visual feedback.
 * - Row 4: [ Clear ] [ 0 ] [ Delete ].
 * - Automatic authentication immediately upon entering the 4th digit (no Unlock button).
 * - Full accessibility labels and error states (401 invalid, 429 rate limit lockout).
 * - Security: MPIN is transient memory only; never stored on disk, Keychain, or AsyncStorage.
 * - Single-contractor architecture: No phone number or account indicator shown on returning login.
 */
export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess }) => {
  const [mpin, setMpin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mpinRef = useRef('');
  const isSubmitting = useRef(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const triggerShake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -3, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 3, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 40, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const executeLogin = useCallback(async (pinToSubmit: string) => {
    if (isSubmitting.current || pinToSubmit.length !== MPIN_LENGTH) {
      return;
    }

    isSubmitting.current = true;
    setLoading(true);
    setError(null);

    try {
      const res = await ApiClient.login(pinToSubmit);

      // Save token to Keychain, account info to AuthStorage
      // MPIN is intentionally never stored anywhere
      await AuthStorage.saveSession(
        res.access_token,
        res.account.id,
        res.account.phone_number || ''
      );

      onSuccess(res.account.id);
    } catch (err: any) {
      // Clear MPIN so contractor can re-enter immediately
      mpinRef.current = '';
      setMpin('');
      triggerShake();

      if (err.status === 401) {
        setError('Incorrect MPIN. Please try again.');
      } else if (err.status === 429) {
        setError(err.message || 'Too many failed login attempts. Temporarily locked out.');
      } else if (err.isNetworkError) {
        setError('Unable to connect to Attendly server. Please check your network connection.');
      } else {
        setError(err.message || 'Login failed. Please check your MPIN and try again.');
      }
    } finally {
      setLoading(false);
      isSubmitting.current = false;
    }
  }, [onSuccess, triggerShake]);

  const handleDigitPress = useCallback((digit: string) => {
    if (isSubmitting.current || loading) return;

    const current = mpinRef.current;
    if (current.length < MPIN_LENGTH) {
      const nextPin = current + digit;
      mpinRef.current = nextPin;
      setMpin(nextPin);
      setError(null);

      // Automatic submission on fourth digit
      if (nextPin.length === MPIN_LENGTH) {
        executeLogin(nextPin);
      }
    } else if (error) {
      // If previous error, digit press resets and starts fresh
      mpinRef.current = digit;
      setMpin(digit);
      setError(null);
    }
  }, [error, executeLogin, loading]);

  const handleBackspace = useCallback(() => {
    if (isSubmitting.current || loading) return;

    setError(null);
    const nextPin = mpinRef.current.slice(0, -1);
    mpinRef.current = nextPin;
    setMpin(nextPin);
  }, [loading]);

  const handleClear = useCallback(() => {
    if (isSubmitting.current || loading) return;

    setError(null);
    mpinRef.current = '';
    setMpin('');
  }, [loading]);

  // Programmatic change handler (supports test runners & external input)
  const handleDirectMpinChange = useCallback((text: string) => {
    const digits = text.replace(/[^\d]/g, '').slice(0, MPIN_LENGTH);
    mpinRef.current = digits;
    setMpin(digits);
    setError(null);
    if (digits.length === MPIN_LENGTH) {
      executeLogin(digits);
    }
  }, [executeLogin]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.wrapper}>
          {/* Attendly Branding & Lock Squircle with Orange Accent Dot */}
          <View style={styles.brandHeader}>
            <View style={styles.squircleContainer}>
              {/* Minimal geometric lock shape */}
              <View style={styles.lockShackle} />
              <View style={styles.lockBody} />
              {/* Industrial orange accent dot */}
              <View style={styles.orangeDot} />
            </View>
            <Text style={styles.appTitle}>Attendly</Text>
            <Text style={styles.appSubtitle}>Enter your 4-digit MPIN to continue</Text>
          </View>

          {/* White Card Container */}
          <View style={styles.card}>
            {/* 4 Square Tactile MPIN Slots in ONE Row with Shake Animation */}
            <Animated.View
              style={[
                styles.mpinRowWrapper,
                { transform: [{ translateX: shakeAnim }] },
              ]}
            >
              <MpinInput
                value={mpin}
                onChangeText={handleDirectMpinChange}
                masked={true}
                disabled={loading}
                error={!!error}
                hideNativeKeyboard={true}
                testID="login-mpin-input"
              />
            </Animated.View>

            {/* Error Banner */}
            {error && (
              <View style={styles.errorBox} testID="login-error-banner">
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Verifying Indicator */}
            {loading && (
              <View style={styles.verifyingBox} testID="login-verifying-indicator">
                <ActivityIndicator size="small" color={Colors.accent} />
                <Text style={styles.verifyingText}>Verifying...</Text>
              </View>
            )}

            {/* 3-Column Keypad */}
            <View style={styles.keypadGrid}>
              {NUMPAD_DIGITS.map((digit) => (
                <Pressable
                  key={digit}
                  onPress={() => handleDigitPress(digit)}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel={`Digit ${digit}`}
                  testID={`keypad-digit-${digit}`}
                  style={({ pressed }) => [
                    styles.keyButton,
                    pressed && !loading && styles.keyPressed,
                    loading && styles.keyDisabled,
                  ]}
                >
                  {({ pressed }) => (
                    <Text
                      style={[
                        styles.keyText,
                        pressed && !loading && styles.keyTextPressed,
                        loading && styles.keyTextDisabled,
                      ]}
                    >
                      {digit}
                    </Text>
                  )}
                </Pressable>
              ))}

              {/* Row 4: [ Clear ] [ 0 ] [ Delete ] */}
              {/* Left: Clear */}
              <Pressable
                onPress={handleClear}
                disabled={loading || mpin.length === 0}
                accessibilityRole="button"
                accessibilityLabel="Clear all MPIN digits"
                testID="keypad-clear"
                style={({ pressed }) => [
                  styles.utilityButton,
                  pressed && !loading && mpin.length > 0 && styles.utilityPressed,
                  (loading || mpin.length === 0) && styles.utilityDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.utilityText,
                    (loading || mpin.length === 0) && styles.utilityTextDisabled,
                  ]}
                >
                  Clear
                </Text>
              </Pressable>

              {/* Center: 0 */}
              <Pressable
                onPress={() => handleDigitPress('0')}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Digit 0"
                testID="keypad-digit-0"
                style={({ pressed }) => [
                  styles.keyButton,
                  pressed && !loading && styles.keyPressed,
                  loading && styles.keyDisabled,
                ]}
              >
                {({ pressed }) => (
                  <Text
                    style={[
                      styles.keyText,
                      pressed && !loading && styles.keyTextPressed,
                      loading && styles.keyTextDisabled,
                    ]}
                  >
                    0
                  </Text>
                )}
              </Pressable>

              {/* Right: Delete / Backspace */}
              <Pressable
                onPress={handleBackspace}
                disabled={loading || mpin.length === 0}
                accessibilityRole="button"
                accessibilityLabel="Delete last digit"
                testID="keypad-backspace"
                style={({ pressed }) => [
                  styles.utilityButton,
                  pressed && !loading && mpin.length > 0 && styles.backspacePressed,
                  (loading || mpin.length === 0) && styles.utilityDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.backspaceSymbol,
                    (loading || mpin.length === 0) && styles.utilityTextDisabled,
                  ]}
                >
                  ⌫
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  wrapper: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
  },
  brandHeader: {
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
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  mpinRowWrapper: {
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  errorBox: {
    backgroundColor: Colors.errorLight,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
    borderRadius: 10,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    alignItems: 'center',
  },
  errorText: {
    color: Colors.errorText,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  verifyingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: Spacing.md,
  },
  verifyingText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  keypadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    width: '100%',
  },
  keyButton: {
    width: '30.5%',
    height: 54,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1c1917',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  keyPressed: {
    backgroundColor: Colors.accentLight,
    borderColor: Colors.accentBorder,
    transform: [{ scale: 0.96 }],
  },
  keyDisabled: {
    backgroundColor: Colors.background,
    borderColor: '#f4f4f5',
  },
  keyText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#18181b',
  },
  keyTextPressed: {
    color: Colors.accent,
  },
  keyTextDisabled: {
    color: Colors.borderStrong,
  },
  utilityButton: {
    width: '30.5%',
    height: 54,
    borderRadius: 12,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  utilityPressed: {
    backgroundColor: '#f4f4f5',
    borderColor: Colors.borderStrong,
    transform: [{ scale: 0.96 }],
  },
  backspacePressed: {
    backgroundColor: Colors.accentLight,
    borderColor: Colors.accentBorder,
    transform: [{ scale: 0.96 }],
  },
  utilityDisabled: {
    opacity: 0.35,
  },
  utilityText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  backspaceSymbol: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  utilityTextDisabled: {
    color: Colors.textMuted,
  },
});
