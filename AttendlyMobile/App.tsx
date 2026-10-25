import React, { useState, useEffect } from 'react';
import {
  StatusBar,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from './src/theme/tokens';
import { AuthScreen } from './src/screens/AuthScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { AttendanceScreen } from './src/screens/AttendanceScreen';
import { WorkersScreen } from './src/screens/WorkersScreen';
import { SitesScreen } from './src/screens/SitesScreen';
import { PayrollScreen } from './src/screens/PayrollScreen';
import { AdvancesScreen } from './src/screens/AdvancesScreen';
import { WorkerDetailScreen } from './src/screens/WorkerDetailScreen';
import { SiteAnalyticsScreen } from './src/screens/SiteAnalyticsScreen';
import { AuthStorage } from './src/storage/authStorage';
import { SecureStorage } from './src/storage/secureStorage';
import { SyncManager } from './src/sync/syncManager';
import { ApiClient } from './src/api/client';
import { Icon, IconName } from './src/components/Icon';

type Tab = 'dashboard' | 'attendance' | 'workers' | 'sites' | 'payroll' | 'advances' | 'site_analytics';

function MainApp() {
  const insets = useSafeAreaInsets();
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Listen for 401 session expiry events across all API calls
    ApiClient.setSessionExpiredHandler(() => {
      handleSessionExpired();
    });

    setSelectedWorkerId(null);
    initApp();

    return () => {
      ApiClient.setSessionExpiredHandler(null);
    };
  }, []);

  async function initApp() {
    setInitializing(true);
    try {
      // Check whether a valid stored token exists in Keychain
      let token = await SecureStorage.getToken();
      if (!token && __DEV__) {
        try {
          const loginRes = await ApiClient.login('1234');
          if (loginRes && loginRes.access_token) {
            await AuthStorage.saveSession(
              loginRes.access_token,
              loginRes.account.id,
              loginRes.account.phone_number
            );
            token = loginRes.access_token;
          }
        } catch {
          // Dev login fallback silent catch
        }
      }
      if (token) {
        // Verify token via authenticated /auth/me endpoint before treating user as authenticated
        try {
          const account = await ApiClient.getMe();
          if (account && account.id) {
            setCurrentAccountId(account.id);
            setSelectedWorkerId(null);
            SyncManager.init();
            SyncManager.triggerSync();
          } else {
            // Unrecognized account format, clear session
            await AuthStorage.clearSession();
            setCurrentAccountId(null);
          }
        } catch (err: any) {
          // Distinguish between temporary offline network outage vs genuine 401 token expiry
          if (err?.isNetworkError) {
            // Offline startup: Preserve credentials and restore local session
            const session = await AuthStorage.getSession();
            if (session.accountId) {
              setCurrentAccountId(session.accountId);
              SyncManager.init();
            } else {
              setCurrentAccountId(null);
            }
          } else if (err?.status === 401 || err?.isSessionExpired) {
            // Genuine session expiry: clear token to require fresh login
            await AuthStorage.clearSession();
            setCurrentAccountId(null);
          } else {
            // Server error: fallback to local session if available
            const session = await AuthStorage.getSession();
            if (session.accountId) {
              setCurrentAccountId(session.accountId);
              SyncManager.init();
            } else {
              await AuthStorage.clearSession();
              setCurrentAccountId(null);
            }
          }
        }
      } else {
        // No stored token found
        setCurrentAccountId(null);
      }
    } catch {
      setCurrentAccountId(null);
    } finally {
      setInitializing(false);
    }
  }

  function handleLoginSuccess(accountId: string) {
    setCurrentAccountId(accountId);
    setActiveTab('dashboard');
    SyncManager.init();
    SyncManager.triggerSync();
  }

  async function handleSessionExpired() {
    await AuthStorage.clearSession();
    setCurrentAccountId(null);
  }

  async function handleLogout() {
    await AuthStorage.clearSession();
    setCurrentAccountId(null);
  }

  if (initializing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  if (!currentAccountId) {
    return <AuthScreen onLoginSuccess={handleLoginSuccess} />;
  }

  if (selectedWorkerId) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <WorkerDetailScreen
          workerId={selectedWorkerId}
          accountId={currentAccountId}
          onBack={() => setSelectedWorkerId(null)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      {/* Screen Body */}
      <View style={styles.screenArea}>
        {activeTab === 'dashboard' && (
          <DashboardScreen
            accountId={currentAccountId}
            onNavigate={tab => setActiveTab(tab)}
            onLogout={handleLogout}
          />
        )}
        {activeTab === 'attendance' && (
          <AttendanceScreen
            accountId={currentAccountId}
            onNavigateHome={() => setActiveTab('dashboard')}
          />
        )}
        {activeTab === 'workers' && (
          <WorkersScreen
            accountId={currentAccountId}
            onNavigateHome={() => setActiveTab('dashboard')}
            onSelectWorker={id => setSelectedWorkerId(id)}
          />
        )}
        {activeTab === 'sites' && (
          <SitesScreen
            accountId={currentAccountId}
            onNavigateHome={() => setActiveTab('dashboard')}
            onNavigateToAnalytics={() => setActiveTab('site_analytics')}
          />
        )}
        {activeTab === 'site_analytics' && (
          <SiteAnalyticsScreen
            accountId={currentAccountId}
            onBack={() => setActiveTab('sites')}
            onNavigateToSites={() => setActiveTab('sites')}
          />
        )}
        {activeTab === 'payroll' && (
          <PayrollScreen
            accountId={currentAccountId}
            onNavigateHome={() => setActiveTab('dashboard')}
          />
        )}
        {activeTab === 'advances' && (
          <AdvancesScreen
            accountId={currentAccountId}
            onNavigateHome={() => setActiveTab('dashboard')}
          />
        )}
      </View>

      {/* Modern Bottom Navigation Bar (Premium Minimal) */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {[
          { id: 'dashboard' as const, label: 'Overview', icon: 'layout-dashboard' as IconName },
          { id: 'attendance' as const, label: 'Attendance', icon: 'calendar-check' as IconName },
          { id: 'workers' as const, label: 'Workers', icon: 'users' as IconName },
          { id: 'sites' as const, label: 'Sites', icon: 'building-2' as IconName },
          { id: 'payroll' as const, label: 'Payroll', icon: 'wallet' as IconName },
        ].map((tab) => {
          const isActive = activeTab === tab.id || (tab.id === 'sites' && activeTab === 'site_analytics');
          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.tabItem}
              onPress={() => {
                setSelectedWorkerId(null);
                setActiveTab(tab.id);
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
            >
              <View style={[styles.tabIconContainer, isActive && styles.tabIconContainerActive]}>
                <Icon
                  name={tab.icon}
                  size={20}
                  color={isActive ? Colors.textPrimary : Colors.textSecondary}
                  strokeWidth={isActive ? 2.2 : 1.8}
                />
                {isActive && <View style={styles.activeIndicatorDot} />}
              </View>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  screenArea: {
    flex: 1,
  },
  bottomBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 6,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  tabIconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  tabIconContainerActive: {
    backgroundColor: Colors.navyAccentLight,
  },
  activeIndicatorDot: {
    position: 'absolute',
    bottom: -1,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.navyAccent, // #334B67
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginTop: 2,
    letterSpacing: 0.1,
  },
  tabLabelActive: {
    color: Colors.textPrimary,
    fontWeight: '700',
  },
});