import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import { ApiClient } from '../src/api/client';
import { SecureStorage } from '../src/storage/secureStorage';

describe('App Root', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders initial AuthScreen when no authenticated session exists', async () => {
    jest.spyOn(SecureStorage, 'getToken').mockResolvedValue(null);
    jest.spyOn(ApiClient, 'getAuthStatus').mockResolvedValue({
      is_setup: false,
      message: 'Setup required',
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      // Allow async initApp and checkInstallationStatus to resolve
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 50));
    });

    expect(renderer!.toJSON()).toBeTruthy();
  });
});
