import AsyncStorage from '@react-native-async-storage/async-storage';
import { SecureStorage } from './secureStorage';

const ACCOUNT_ID_KEY = '@attendly_account_id';
const PHONE_KEY = '@attendly_phone';

export interface StoredSession {
  token: string | null;
  accountId: string | null;
  phone: string | null;
}

/**
 * Authentication and Device Session Storage
 * Sensitive token is saved in iOS Keychain via SecureStorage.
 * Non-sensitive device context (recognized account ID and phone number)
 * is kept in AsyncStorage for quick MPIN-only returning login.
 * Never stores the plaintext MPIN.
 */
export const AuthStorage = {
  async saveSession(token: string, accountId: string, phone: string): Promise<void> {
    await SecureStorage.saveToken(token);
    await AsyncStorage.setItem(ACCOUNT_ID_KEY, accountId);
    await AsyncStorage.setItem(PHONE_KEY, phone);
  },

  async getSession(): Promise<StoredSession> {
    const token = await SecureStorage.getToken();
    const accountId = await AsyncStorage.getItem(ACCOUNT_ID_KEY);
    const phone = await AsyncStorage.getItem(PHONE_KEY);
    return {
      token,
      accountId,
      phone,
    };
  },

  async clearSession(): Promise<void> {
    await SecureStorage.clearToken();
  },

  async resetDevice(): Promise<void> {
    await SecureStorage.clearToken();
    await AsyncStorage.removeItem(ACCOUNT_ID_KEY);
    await AsyncStorage.removeItem(PHONE_KEY);
  },
};
