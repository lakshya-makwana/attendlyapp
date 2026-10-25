import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography, BorderRadius } from '../theme/tokens';
import { Button } from '../components/primitives/Button';
import { ApiClient } from '../api/client';
import { SetupScreen } from './auth/SetupScreen';
import { LoginScreen } from './auth/LoginScreen';

interface AuthScreenProps {
  onLoginSuccess: (accountId: string) => void;
}

/**
 * Authentication Flow Orchestrator
 * Checks backend status:
 * - If no account exists (is_setup = false) -> Displays SetupScreen.
 * - If account exists (is_setup = true) -> Displays LoginScreen with 4-digit MPIN.
 * 
 * Strict Single Contractor Architecture:
 * - No multi-account switching.
 * - No demo or guest bypass.
 * - MPIN is never saved on device.
 */
export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess }) => {
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [isSetup, setIsSetup] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    checkInstallationStatus();
  }, []);

  async function checkInstallationStatus() {
    setLoadingStatus(true);
    setStatusError(null);

    try {
      const statusRes = await ApiClient.getAuthStatus();
      setIsSetup(statusRes.is_setup);
    } catch (err: any) {
      if (err.isNetworkError) {
        setStatusError('Unable to connect to Attendly server. Please check your network connection.');
      } else {
        setStatusError(err.message || 'Unable to check installation status.');
      }
    } finally {
      setLoadingStatus(false);
    }
  }

  if (loadingStatus) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={Colors.accent} testID="auth-status-loading" />
          <Text style={styles.loadingText}>Connecting to Attendly...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (statusError && isSetup === null) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <View style={styles.errorCard}>
          <View style={styles.squircleContainer}>
            <View style={styles.lockShackle} />
            <View style={styles.lockBody} />
            <View style={styles.orangeDot} />
          </View>
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorMessage}>{statusError}</Text>
          <Button
            title="Retry Connection"
            onPress={checkInstallationStatus}
            variant="primary"
            size="md"
            style={styles.retryBtn}
            testID="auth-status-retry-button"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (isSetup === false) {
    return <SetupScreen onSuccess={onLoginSuccess} />;
  }

  return <LoginScreen onSuccess={onLoginSuccess} />;
};

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...Typography.bodyMedium,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
  },
  errorCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  squircleContainer: {
    position: 'relative',
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#18181b',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  lockShackle: {
    width: 13,
    height: 9,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderWidth: 2,
    borderColor: '#ffffff',
    borderBottomWidth: 0,
    marginBottom: -1,
  },
  lockBody: {
    width: 17,
    height: 12,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  orangeDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.accent,
    borderWidth: 1.5,
    borderColor: '#18181b',
  },
  errorTitle: {
    ...Typography.titleMedium,
    marginBottom: Spacing.xs,
  },
  errorMessage: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  retryBtn: {
    minWidth: 160,
  },
});
