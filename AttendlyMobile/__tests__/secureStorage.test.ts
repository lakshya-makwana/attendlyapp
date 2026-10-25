import { SecureStorage } from '../src/storage/secureStorage';

describe('SecureStorage', () => {
  beforeEach(async () => {
    await SecureStorage.clearToken();
  });

  it('saves, retrieves, and checks token presence', async () => {
    expect(await SecureStorage.hasToken()).toBe(false);
    expect(await SecureStorage.getToken()).toBeNull();

    await SecureStorage.saveToken('jwt_secure_access_token_xyz');

    expect(await SecureStorage.hasToken()).toBe(true);
    expect(await SecureStorage.getToken()).toBe('jwt_secure_access_token_xyz');
  });

  it('clears token on logout', async () => {
    await SecureStorage.saveToken('jwt_secure_access_token_xyz');
    expect(await SecureStorage.hasToken()).toBe(true);

    await SecureStorage.clearToken();

    expect(await SecureStorage.hasToken()).toBe(false);
    expect(await SecureStorage.getToken()).toBeNull();
  });

  it('handles empty or null token correctly', async () => {
    await SecureStorage.saveToken('token_1');
    await SecureStorage.saveToken('');

    expect(await SecureStorage.hasToken()).toBe(false);
    expect(await SecureStorage.getToken()).toBeNull();
  });
});
