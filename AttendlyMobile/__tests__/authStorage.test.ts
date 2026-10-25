import { AuthStorage } from '../src/storage/authStorage';

describe('AuthStorage', () => {
  beforeEach(async () => {
    await AuthStorage.resetDevice();
  });

  it('saves and retrieves user session', async () => {
    await AuthStorage.saveSession('jwt_token_123', 'acc_uuid_456', '+919876543210');
    const session = await AuthStorage.getSession();

    expect(session.token).toBe('jwt_token_123');
    expect(session.accountId).toBe('acc_uuid_456');
    expect(session.phone).toBe('+919876543210');
  });

  it('clears session on logout while preserving saved phone for quick MPIN login', async () => {
    await AuthStorage.saveSession('jwt_token_123', 'acc_uuid_456', '+919876543210');
    await AuthStorage.clearSession();

    const session = await AuthStorage.getSession();
    expect(session.token).toBeNull();
    // Device still recognizes account and phone for MPIN-only login
    expect(session.accountId).toBe('acc_uuid_456');
    expect(session.phone).toBe('+919876543210');
  });

  it('resets entire device when asked', async () => {
    await AuthStorage.saveSession('jwt_token_123', 'acc_uuid_456', '+919876543210');
    await AuthStorage.resetDevice();

    const session = await AuthStorage.getSession();
    expect(session.token).toBeNull();
    expect(session.accountId).toBeNull();
    expect(session.phone).toBeNull();
  });
});
