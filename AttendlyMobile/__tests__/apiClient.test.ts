import { ApiClient, ApiError } from '../src/api/client';
import { ApiConfig } from '../src/api/config';
import { SecureStorage } from '../src/storage/secureStorage';

describe('ApiClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    ApiConfig.resetBaseUrl();
    await SecureStorage.clearToken();
    ApiClient.setSessionExpiredHandler(null);
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('reads backend base URL from ApiConfig and appends endpoint', async () => {
    ApiConfig.setBaseUrl('http://192.168.1.50:8000/api/v1');

    let requestedUrl = '';
    (globalThis as any).fetch = jest.fn().mockImplementation((url) => {
      requestedUrl = url;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ is_setup: true, message: 'Account is ready for MPIN login' }),
      });
    });

    const status = await ApiClient.getAuthStatus();
    expect(requestedUrl).toBe('http://192.168.1.50:8000/api/v1/auth/status');
    expect(status.is_setup).toBe(true);
  });

  it('attaches Bearer token from SecureStorage to headers', async () => {
    await SecureStorage.saveToken('jwt_valid_session_token');

    let capturedHeaders: Record<string, string> = {};
    (globalThis as any).fetch = jest.fn().mockImplementation((_url, options) => {
      capturedHeaders = options.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });
    });

    await ApiClient.getWorkers();
    expect(capturedHeaders.Authorization).toBe('Bearer jwt_valid_session_token');
    expect(capturedHeaders['Content-Type']).toBe('application/json');
  });

  it('handles HTTP error responses and parses detail message', async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ detail: 'Attendance record already exists' }),
      });
    });

    await expect(
      ApiClient.recordAttendance({ worker_id: 'w1', site_id: 's1', date: '2026-10-10', work_units: 1.0 })
    ).rejects.toThrow('Attendance record already exists');
  });

  it('triggers session expired handler on 401 response', async () => {
    let sessionExpiredCalled = false;
    ApiClient.setSessionExpiredHandler(() => {
      sessionExpiredCalled = true;
    });

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: 'Token expired' }),
      });
    });

    await expect(ApiClient.getMe()).rejects.toThrow('Token expired');
    expect(sessionExpiredCalled).toBe(true);
  });

  it('handles network failures with isNetworkError flag', async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      return Promise.reject(new Error('Network request failed'));
    });

    try {
      await ApiClient.getWorkers();
      fail('Expected ApiError to be thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.isNetworkError).toBe(true);
      expect(err.status).toBe(0);
    }
  });
});
