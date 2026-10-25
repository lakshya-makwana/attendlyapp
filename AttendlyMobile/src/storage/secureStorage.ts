import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { NativeModules } from 'react-native';

const KEYCHAIN_SERVICE = 'com.attendly.mobile.auth';
const KEYCHAIN_USERNAME = 'attendly_jwt_token';
const FALLBACK_KEY = '@attendly_secure_token_fallback';

let isKeychainAvailable: boolean | null = null;

async function checkKeychainSupport(): Promise<boolean> {
  if (isKeychainAvailable !== null) {
    return isKeychainAvailable;
  }
  isKeychainAvailable = !!(NativeModules && NativeModules.RNKeychainManager);
  return isKeychainAvailable;
}

/**
 * Secure Session Storage
 * Uses iOS Keychain (via react-native-keychain) for encrypted credential storage.
 * Never stores the MPIN. Only stores the authenticated JWT access token.
 */
export const SecureStorage = {
  /**
   * Save the JWT access token securely in Keychain
   */
  async saveToken(token: string): Promise<void> {
    if (!token) {
      await this.clearToken();
      return;
    }

    const available = await checkKeychainSupport();
    if (available) {
      try {
        await Keychain.setGenericPassword(KEYCHAIN_USERNAME, token, {
          service: KEYCHAIN_SERVICE,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        return;
      } catch (error) {
        console.warn('Keychain save failed, using fallback storage:', error);
      }
    }

    // Fallback for tests or environments without native Keychain
    await AsyncStorage.setItem(FALLBACK_KEY, token);
  },

  /**
   * Retrieve the JWT access token securely from Keychain
   */
  async getToken(): Promise<string | null> {
    const available = await checkKeychainSupport();
    if (available) {
      try {
        const credentials = await Keychain.getGenericPassword({
          service: KEYCHAIN_SERVICE,
        });
        if (credentials && credentials.password) {
          return credentials.password;
        }
      } catch (error) {
        console.warn('Keychain read failed, trying fallback storage:', error);
      }
    }

    // Fallback for tests or environments without native Keychain
    return await AsyncStorage.getItem(FALLBACK_KEY);
  },

  /**
   * Clear the JWT access token securely on logout
   */
  async clearToken(): Promise<void> {
    const available = await checkKeychainSupport();
    if (available) {
      try {
        await Keychain.resetGenericPassword({
          service: KEYCHAIN_SERVICE,
        });
      } catch (error) {
        console.warn('Keychain clear failed:', error);
      }
    }

    await AsyncStorage.removeItem(FALLBACK_KEY);
  },

  /**
   * Check if an active token exists
   */
  async hasToken(): Promise<boolean> {
    const token = await this.getToken();
    return !!token && token.length > 0;
  },
};
