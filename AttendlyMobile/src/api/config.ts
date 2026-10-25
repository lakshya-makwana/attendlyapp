/**
 * Attendly Mobile API Configuration
 * Supports environment-based configuration and runtime overrides.
 */

// Default URL for iOS Simulator development
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000/api/v1';

declare const process: { env?: { API_BASE_URL?: string } } | undefined;

let currentApiBaseUrl: string =
  (typeof process !== 'undefined' && process?.env?.API_BASE_URL) ||
  DEFAULT_API_BASE_URL;

export const ApiConfig = {
  getBaseUrl(): string {
    return currentApiBaseUrl;
  },

  setBaseUrl(url: string): void {
    if (!url) return;
    // Strip trailing slashes
    currentApiBaseUrl = url.replace(/\/+$/, '');
  },

  resetBaseUrl(): void {
    currentApiBaseUrl = DEFAULT_API_BASE_URL;
  },
};
