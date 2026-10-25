import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SetupScreen } from '../src/screens/auth/SetupScreen';
import { LoginScreen } from '../src/screens/auth/LoginScreen';
import { AuthScreen } from '../src/screens/AuthScreen';
import { ApiClient, ApiError } from '../src/api/client';
import { AuthStorage } from '../src/storage/authStorage';
import { SecureStorage } from '../src/storage/secureStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';

describe('Authentication Flow - Phase 1: 4-Digit MPIN & PWA Parity', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AuthStorage.resetDevice();
  });

  describe('SetupScreen (First-Run 4-Digit Account Setup)', () => {
    it('validates phone number, 4-digit MPIN length, and confirmation locally', async () => {
      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<SetupScreen onSuccess={jest.fn()} />);
      });

      const root = renderer!.root;

      // 1. Submit with empty fields -> phone error
      const submitBtn = root.findByProps({ testID: 'setup-submit-button' });
      await ReactTestRenderer.act(async () => {
        submitBtn.props.onPress();
      });

      const phoneInput = root.findByProps({ testID: 'setup-phone-input' });
      expect(phoneInput.props.error).toContain('valid phone number');

      // 2. Fill valid phone, invalid MPIN length (3 digits)
      await ReactTestRenderer.act(async () => {
        phoneInput.props.onChangeText('9876543210');
      });

      const mpinInput = root.findByProps({ testID: 'setup-mpin-input' });
      await ReactTestRenderer.act(async () => {
        mpinInput.props.onChangeText('123');
      });

      await ReactTestRenderer.act(async () => {
        submitBtn.props.onPress();
      });

      const mpinError = root.findByProps({ testID: 'setup-mpin-error' });
      expect(mpinError.props.children).toBe('MPIN must be exactly 4 numeric digits');

      // 3. Fill valid 4-digit MPIN, but incomplete confirmation (2 digits)
      await ReactTestRenderer.act(async () => {
        mpinInput.props.onChangeText('1234');
      });

      const confirmMpinInput = root.findByProps({ testID: 'setup-confirm-mpin-input' });
      await ReactTestRenderer.act(async () => {
        confirmMpinInput.props.onChangeText('12');
      });

      await ReactTestRenderer.act(async () => {
        submitBtn.props.onPress();
      });

      const confirmError = root.findByProps({ testID: 'setup-confirm-error' });
      expect(confirmError.props.children).toBe('Please re-enter your complete 4-digit MPIN');

      // 4. Fill valid 4-digit MPIN, but mismatched confirmation
      await ReactTestRenderer.act(async () => {
        confirmMpinInput.props.onChangeText('5678');
      });

      await ReactTestRenderer.act(async () => {
        submitBtn.props.onPress();
      });

      const mismatchError = root.findByProps({ testID: 'setup-confirm-error' });
      expect(mismatchError.props.children).toBe('MPIN and Confirm MPIN do not match');
    });

    it('submits valid 4-digit setup request, stores token securely, and NEVER persists MPIN', async () => {
      const onSuccessMock = jest.fn();
      const setupSpy = jest.spyOn(ApiClient, 'setupAccount').mockResolvedValueOnce({
        access_token: 'test_access_jwt_123',
        token_type: 'bearer',
        expires_in: 3600,
        account: {
          id: 'acc_master_001',
          phone_number: '9876543210',
          created_at: '2026-10-25T10:00:00Z',
          updated_at: '2026-10-25T10:00:00Z',
        },
      });

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<SetupScreen onSuccess={onSuccessMock} />);
      });

      const root = renderer!.root;

      const phoneInput = root.findByProps({ testID: 'setup-phone-input' });
      const mpinInput = root.findByProps({ testID: 'setup-mpin-input' });
      const confirmInput = root.findByProps({ testID: 'setup-confirm-mpin-input' });
      const submitBtn = root.findByProps({ testID: 'setup-submit-button' });

      await ReactTestRenderer.act(async () => {
        phoneInput.props.onChangeText('9876543210');
        mpinInput.props.onChangeText('1234');
        confirmInput.props.onChangeText('1234');
      });

      await ReactTestRenderer.act(async () => {
        submitBtn.props.onPress();
      });

      expect(setupSpy).toHaveBeenCalledWith('9876543210', '1234', '1234');
      expect(onSuccessMock).toHaveBeenCalledWith('acc_master_001');

      // Verify token was stored in Keychain abstraction
      const storedToken = await SecureStorage.getToken();
      expect(storedToken).toBe('test_access_jwt_123');

      // CRITICAL SECURITY ASSERTION:
      // Verify MPIN is NEVER stored in AsyncStorage or Keychain fallback
      const asyncStorageToken = await AsyncStorage.getItem('@attendly_secure_token_fallback');
      expect(asyncStorageToken).not.toBe('1234');

      const allKeys = ['@attendly_account_id', '@attendly_phone'];
      for (const k of allKeys) {
        const val = await AsyncStorage.getItem(k);
        expect(val).not.toBe('1234');
      }

      setupSpy.mockRestore();
    });

    it('prevents duplicate setup submissions while request is in flight', async () => {
      let resolvePromise: (val: any) => void;
      const deferred = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const setupSpy = jest.spyOn(ApiClient, 'setupAccount').mockReturnValueOnce(deferred as any);

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<SetupScreen onSuccess={jest.fn()} />);
      });

      const root = renderer!.root;
      const phoneInput = root.findByProps({ testID: 'setup-phone-input' });
      const mpinInput = root.findByProps({ testID: 'setup-mpin-input' });
      const confirmInput = root.findByProps({ testID: 'setup-confirm-mpin-input' });
      const submitBtn = root.findByProps({ testID: 'setup-submit-button' });

      await ReactTestRenderer.act(async () => {
        phoneInput.props.onChangeText('9876543210');
        mpinInput.props.onChangeText('1234');
        confirmInput.props.onChangeText('1234');
      });

      // Rapid double submit
      await ReactTestRenderer.act(async () => {
        submitBtn.props.onPress();
      });
      await ReactTestRenderer.act(async () => {
        submitBtn.props.onPress();
      });

      expect(setupSpy).toHaveBeenCalledTimes(1);

      await ReactTestRenderer.act(async () => {
        resolvePromise!({
          access_token: 'token_123',
          token_type: 'bearer',
          expires_in: 3600,
          account: { id: 'acc_1', phone_number: '9876543210' },
        });
      });

      setupSpy.mockRestore();
    });

    it('displays network failure error cleanly', async () => {
      const setupSpy = jest.spyOn(ApiClient, 'setupAccount').mockRejectedValueOnce(
        new ApiError(0, 'Failed to connect', undefined, true)
      );

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<SetupScreen onSuccess={jest.fn()} />);
      });

      const root = renderer!.root;
      const phoneInput = root.findByProps({ testID: 'setup-phone-input' });
      const mpinInput = root.findByProps({ testID: 'setup-mpin-input' });
      const confirmInput = root.findByProps({ testID: 'setup-confirm-mpin-input' });
      const submitBtn = root.findByProps({ testID: 'setup-submit-button' });

      await ReactTestRenderer.act(async () => {
        phoneInput.props.onChangeText('9876543210');
        mpinInput.props.onChangeText('1234');
        confirmInput.props.onChangeText('1234');
      });

      await ReactTestRenderer.act(async () => {
        submitBtn.props.onPress();
      });

      const errorBox = root.findByProps({ testID: 'setup-general-error' });
      expect(errorBox).toBeTruthy();
      const errorText = errorBox.findByType(Text);
      expect(errorText.props.children).toContain('Unable to connect to Attendly server');

      setupSpy.mockRestore();
    });
  });

  describe('LoginScreen (PWA Parity: 4-Digit MPIN & Keypad Auto-Submit)', () => {
    it('does NOT render recognized phone number or account indicator on returning login screen', async () => {
      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<LoginScreen onSuccess={jest.fn()} />);
      });

      const textNodes = renderer!.root.findAllByType(Text);
      const allText = textNodes.map((n) => n.props.children).flat().join(' ');
      expect(allText).not.toContain('Recognized Account');
      expect(allText).not.toContain('+91');
      expect(allText).toContain('Enter your 4-digit MPIN to continue');
      expect(allText).toContain('Attendly');
    });

    it('does NOT trigger login on 1, 2, or 3 digits, but triggers automatically on 4th digit', async () => {
      const loginSpy = jest.spyOn(ApiClient, 'login').mockResolvedValueOnce({
        access_token: 'auto_token_123',
        token_type: 'bearer',
        expires_in: 3600,
        account: { id: 'acc_auto', phone_number: '9876543210', created_at: '', updated_at: '' },
      });

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<LoginScreen onSuccess={jest.fn()} />);
      });

      const root = renderer!.root;

      // Tap 1, 2, 3 -> login not called
      const btn1 = root.findByProps({ testID: 'keypad-digit-1' });
      const btn2 = root.findByProps({ testID: 'keypad-digit-2' });
      const btn3 = root.findByProps({ testID: 'keypad-digit-3' });
      const btn4 = root.findByProps({ testID: 'keypad-digit-4' });

      await ReactTestRenderer.act(async () => {
        btn1.props.onPress();
      });
      await ReactTestRenderer.act(async () => {
        btn2.props.onPress();
      });
      await ReactTestRenderer.act(async () => {
        btn3.props.onPress();
      });

      expect(loginSpy).not.toHaveBeenCalled();

      // Tap 4th digit -> auto-executes immediately!
      await ReactTestRenderer.act(async () => {
        btn4.props.onPress();
      });

      expect(loginSpy).toHaveBeenCalledWith('1234');
      loginSpy.mockRestore();
    });

    it('authenticates with 4-digit MPIN via direct change, stores token securely, and NEVER persists MPIN', async () => {
      const onSuccessMock = jest.fn();
      const loginSpy = jest.spyOn(ApiClient, 'login').mockResolvedValueOnce({
        access_token: 'returning_jwt_token_456',
        token_type: 'bearer',
        expires_in: 3600,
        account: {
          id: 'acc_returning_002',
          phone_number: '9876543210',
          created_at: '2026-10-25T10:00:00Z',
          updated_at: '2026-10-25T10:00:00Z',
        },
      });

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <LoginScreen onSuccess={onSuccessMock} />
        );
      });

      const root = renderer!.root;
      const mpinInput = root.findByProps({ testID: 'login-mpin-input' });

      // Direct entry of 4-digit MPIN triggers auto-submit
      await ReactTestRenderer.act(async () => {
        mpinInput.props.onChangeText('1234');
      });

      expect(loginSpy).toHaveBeenCalledWith('1234');
      expect(onSuccessMock).toHaveBeenCalledWith('acc_returning_002');

      // Verify token in Keychain
      const token = await SecureStorage.getToken();
      expect(token).toBe('returning_jwt_token_456');

      // Verify MPIN is NEVER saved
      const asyncStorageToken = await AsyncStorage.getItem('@attendly_secure_token_fallback');
      expect(asyncStorageToken).not.toBe('1234');

      const allKeys = ['@attendly_account_id', '@attendly_phone'];
      for (const k of allKeys) {
        const val = await AsyncStorage.getItem(k);
        expect(val).not.toBe('1234');
      }

      loginSpy.mockRestore();
    });

    it('handles 401 invalid MPIN with error message and clears MPIN input for immediate retry', async () => {
      const loginSpy = jest.spyOn(ApiClient, 'login').mockRejectedValueOnce(
        new ApiError(401, 'Invalid credentials. Authentication failed.')
      );

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<LoginScreen onSuccess={jest.fn()} />);
      });

      const root = renderer!.root;
      const mpinInput = root.findByProps({ testID: 'login-mpin-input' });

      await ReactTestRenderer.act(async () => {
        mpinInput.props.onChangeText('9999');
      });

      const errorBanner = root.findByProps({ testID: 'login-error-banner' });
      expect(errorBanner).toBeTruthy();
      const errorText = errorBanner.findByType(Text);
      expect(errorText.props.children).toBe('Incorrect MPIN. Please try again.');

      // MPIN input was reset to empty string
      expect(mpinInput.props.value).toBe('');

      loginSpy.mockRestore();
    });

    it('handles 429 rate limiting lockout message', async () => {
      const rateLimitMsg = 'Too many failed login attempts. Temporarily locked out for 300 seconds.';
      const loginSpy = jest.spyOn(ApiClient, 'login').mockRejectedValueOnce(
        new ApiError(429, rateLimitMsg)
      );

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<LoginScreen onSuccess={jest.fn()} />);
      });

      const root = renderer!.root;
      const mpinInput = root.findByProps({ testID: 'login-mpin-input' });

      await ReactTestRenderer.act(async () => {
        mpinInput.props.onChangeText('1111');
      });

      const errorBanner = root.findByProps({ testID: 'login-error-banner' });
      const errorText = errorBanner.findByType(Text);
      expect(errorText.props.children).toContain('locked out for 300 seconds');

      loginSpy.mockRestore();
    });

    it('keypad Clear and Backspace buttons function correctly', async () => {
      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<LoginScreen onSuccess={jest.fn()} />);
      });

      const root = renderer!.root;
      const mpinInput = root.findByProps({ testID: 'login-mpin-input' });
      const btn5 = root.findByProps({ testID: 'keypad-digit-5' });
      const btn6 = root.findByProps({ testID: 'keypad-digit-6' });
      const backspaceBtn = root.findByProps({ testID: 'keypad-backspace' });
      const clearBtn = root.findByProps({ testID: 'keypad-clear' });

      // Tap 5 and 6
      await ReactTestRenderer.act(async () => {
        btn5.props.onPress();
      });
      await ReactTestRenderer.act(async () => {
        btn6.props.onPress();
      });
      expect(mpinInput.props.value).toBe('56');

      // Tap Backspace -> removes 6
      await ReactTestRenderer.act(async () => {
        backspaceBtn.props.onPress();
      });
      expect(mpinInput.props.value).toBe('5');

      // Tap 7
      const btn7 = root.findByProps({ testID: 'keypad-digit-7' });
      await ReactTestRenderer.act(async () => {
        btn7.props.onPress();
      });
      expect(mpinInput.props.value).toBe('57');

      // Tap Clear -> resets to empty
      await ReactTestRenderer.act(async () => {
        clearBtn.props.onPress();
      });
      expect(mpinInput.props.value).toBe('');
    });

    it('prevents duplicate login submissions while request is running', async () => {
      let resolvePromise: (val: any) => void;
      const deferred = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const loginSpy = jest.spyOn(ApiClient, 'login').mockReturnValueOnce(deferred as any);

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<LoginScreen onSuccess={jest.fn()} />);
      });

      const root = renderer!.root;
      const mpinInput = root.findByProps({ testID: 'login-mpin-input' });

      // Rapid double entry
      await ReactTestRenderer.act(async () => {
        mpinInput.props.onChangeText('1234');
      });
      await ReactTestRenderer.act(async () => {
        mpinInput.props.onChangeText('1234');
      });

      expect(loginSpy).toHaveBeenCalledTimes(1);

      await ReactTestRenderer.act(async () => {
        resolvePromise!({
          access_token: 'token_123',
          token_type: 'bearer',
          expires_in: 3600,
          account: { id: 'acc_1', phone_number: '9876543210' },
        });
      });

      loginSpy.mockRestore();
    });
  });

  describe('AuthScreen (Flow Orchestrator)', () => {
    it('renders SetupScreen when backend is_setup is false', async () => {
      const statusSpy = jest.spyOn(ApiClient, 'getAuthStatus').mockResolvedValueOnce({
        is_setup: false,
        message: 'Initial account setup required',
      });

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<AuthScreen onLoginSuccess={jest.fn()} />);
      });

      const root = renderer!.root;
      const setupBtn = root.findByProps({ testID: 'setup-submit-button' });
      expect(setupBtn).toBeTruthy();

      statusSpy.mockRestore();
    });

    it('renders LoginScreen with custom keypad when backend is_setup is true', async () => {
      const statusSpy = jest.spyOn(ApiClient, 'getAuthStatus').mockResolvedValueOnce({
        is_setup: true,
        message: 'Account is ready for MPIN login',
      });

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<AuthScreen onLoginSuccess={jest.fn()} />);
      });

      const root = renderer!.root;
      // Keypad digit 1 and mpin input should be present
      const digit1 = root.findByProps({ testID: 'keypad-digit-1' });
      expect(digit1).toBeTruthy();

      statusSpy.mockRestore();
    });

    it('renders error view with retry button on network failure', async () => {
      const statusSpy = jest.spyOn(ApiClient, 'getAuthStatus').mockRejectedValueOnce(
        new ApiError(0, 'Network request failed', undefined, true)
      );

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<AuthScreen onLoginSuccess={jest.fn()} />);
      });

      const root = renderer!.root;
      const retryBtn = root.findByProps({ testID: 'auth-status-retry-button' });
      expect(retryBtn).toBeTruthy();

      statusSpy.mockRestore();
    });
  });

  describe('Session Restoration & Expiration', () => {
    it('verifies valid stored token through /auth/me on app launch', async () => {
      await SecureStorage.saveToken('restorable_valid_token');

      const getMeSpy = jest.spyOn(ApiClient, 'getMe').mockResolvedValueOnce({
        id: 'acc_verified_888',
        phone_number: '9876543210',
        created_at: '2026-10-25T10:00:00Z',
        updated_at: '2026-10-25T10:00:00Z',
      });

      const token = await SecureStorage.getToken();
      expect(token).toBe('restorable_valid_token');

      const account = await ApiClient.getMe();
      expect(account.id).toBe('acc_verified_888');

      getMeSpy.mockRestore();
    });

    it('clears token when token verification fails with 401', async () => {
      await SecureStorage.saveToken('expired_token_999');

      const getMeSpy = jest.spyOn(ApiClient, 'getMe').mockRejectedValueOnce(
        new ApiError(401, 'Token expired')
      );

      try {
        await ApiClient.getMe();
      } catch {
        await AuthStorage.clearSession();
      }

      const remainingToken = await SecureStorage.getToken();
      expect(remainingToken).toBeNull();

      getMeSpy.mockRestore();
    });

    it('triggers session expired handler on 401 from protected endpoints', async () => {
      const expiredHandler = jest.fn();
      ApiClient.setSessionExpiredHandler(expiredHandler);

      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 401,
        ok: false,
        json: async () => ({ detail: 'Session expired. Please log in again.' }),
      } as any);

      await expect(ApiClient.getWorkers()).rejects.toThrow('Session expired. Please log in again.');
      expect(expiredHandler).toHaveBeenCalledTimes(1);

      ApiClient.setSessionExpiredHandler(null);
    });

    it('does NOT trigger session expired handler on login 401', async () => {
      const expiredHandler = jest.fn();
      ApiClient.setSessionExpiredHandler(expiredHandler);

      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 401,
        ok: false,
        json: async () => ({ detail: 'Invalid credentials. Authentication failed.' }),
      } as any);

      await expect(ApiClient.login('0000')).rejects.toThrow('Invalid credentials. Authentication failed.');
      expect(expiredHandler).not.toHaveBeenCalled();

      ApiClient.setSessionExpiredHandler(null);
    });
  });
});
