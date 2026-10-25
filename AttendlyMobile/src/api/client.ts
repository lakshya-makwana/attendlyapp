import { SecureStorage } from '../storage/secureStorage';
import { ApiConfig } from './config';

export class ApiError extends Error {
  status: number;
  data: any;
  isNetworkError: boolean;
  isSessionExpired: boolean;

  constructor(status: number, message: string, data?: any, isNetworkError: boolean = false) {
    super(message);
    this.status = status;
    this.data = data;
    this.isNetworkError = isNetworkError;
    this.isSessionExpired = status === 401;
    this.name = 'ApiError';
  }
}

export interface AuthAccount {
  id: string;
  phone_number: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  account: AuthAccount;
}

export interface AuthStatusResponse {
  is_setup: boolean;
  message: string;
}

type SessionExpiredHandler = () => void;
let onSessionExpiredCallback: SessionExpiredHandler | null = null;

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await SecureStorage.getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const baseUrl = ApiConfig.getBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${cleanEndpoint}`;

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    // Handle 204 No Content
    if (res.status === 204) {
      return {} as T;
    }

    const data = await res.json().catch(() => ({}));

    // Handle session expired (401)
    if (res.status === 401) {
      const isAuthAttempt =
        cleanEndpoint.startsWith('/auth/login') ||
        cleanEndpoint.startsWith('/auth/setup');
      if (onSessionExpiredCallback && !isAuthAttempt) {
        onSessionExpiredCallback();
      }
      const errorMsg = data?.detail || 'Session expired. Please log in again.';
      throw new ApiError(401, errorMsg, data);
    }

    if (!res.ok) {
      const errorMsg = data?.detail || `Request failed with status ${res.status}`;
      throw new ApiError(res.status, errorMsg, data);
    }

    return data as T;
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    // Network or connection failure
    throw new ApiError(0, err?.message || 'Unable to connect to server. Check network connection.', undefined, true);
  }
}

export const ApiClient = {
  /**
   * Listen for expired session events to redirect to login
   */
  setSessionExpiredHandler(handler: SessionExpiredHandler | null) {
    onSessionExpiredCallback = handler;
  },

  // ---------------------------------------------------------------------------
  // Authentication Endpoints
  // ---------------------------------------------------------------------------
  getAuthStatus(): Promise<AuthStatusResponse> {
    return request<AuthStatusResponse>('/auth/status');
  },

  setupAccount(phoneNumber: string, mpin: string, confirmMpin: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ phone_number: phoneNumber, mpin, confirm_mpin: confirmMpin }),
    });
  },

  login(mpin: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ mpin }),
    });
  },

  getMe(): Promise<AuthAccount> {
    return request<AuthAccount>('/auth/me');
  },

  // Backwards compatibility aliases
  register(phone: string, mpin: string, confirmMpin: string) {
    return this.setupAccount(phone, mpin, confirmMpin);
  },

  loginMpin(mpin: string, _accountId?: string | null, _phone?: string | null) {
    return this.login(mpin);
  },

  // ---------------------------------------------------------------------------
  // Workers Endpoints
  // ---------------------------------------------------------------------------
  getWorkers(includeInactive: boolean = false) {
    const query = includeInactive ? '?include_inactive=true' : '';
    return request<any[]>(`/workers${query}`);
  },

  getWorker(id: string) {
    return request<any>(`/workers/${id}`);
  },

  createWorker(data: {
    id?: string;
    name: string;
    phone?: string | null;
    daily_wage: number;
    effective_from?: string;
    active?: boolean;
  }) {
    return request<any>('/workers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateWorker(
    id: string,
    data: {
      name?: string;
      phone?: string | null;
      daily_wage?: number;
      effective_from?: string;
      active?: boolean;
    }
  ) {
    return request<any>(`/workers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  toggleWorkerStatus(id: string) {
    return request<any>(`/workers/${id}/toggle-status`, { method: 'PATCH' });
  },

  deactivateWorker(id: string) {
    return request<any>(`/workers/${id}/deactivate`, { method: 'POST' });
  },

  reactivateWorker(id: string) {
    return request<any>(`/workers/${id}/reactivate`, { method: 'POST' });
  },

  deleteWorker(id: string) {
    return request<any>(`/workers/${id}`, { method: 'DELETE' });
  },

  getWorkerWages(workerId: string) {
    return request<any[]>(`/workers/${workerId}/wages`);
  },

  addWorkerWage(workerId: string, data: { daily_wage: number; effective_from: string }) {
    return request<any>(`/workers/${workerId}/wages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  deleteWorkerWage(workerId: string, wageId: string) {
    return request<any>(`/workers/${workerId}/wages/${wageId}`, {
      method: 'DELETE',
    });
  },

  // ---------------------------------------------------------------------------
  // Sites Endpoints
  // ---------------------------------------------------------------------------
  getSites(includeInactive: boolean = false) {
    const query = includeInactive ? '?include_inactive=true' : '';
    return request<any[]>(`/sites${query}`);
  },

  getSite(id: string) {
    return request<any>(`/sites/${id}`);
  },

  createSite(data: { id?: string; name: string; location?: string | null; address?: string | null; active?: boolean }) {
    return request<any>('/sites', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateSite(id: string, data: { name?: string; location?: string | null; address?: string | null; active?: boolean }) {
    return request<any>(`/sites/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  toggleSiteStatus(id: string) {
    return request<any>(`/sites/${id}/toggle-status`, { method: 'PATCH' });
  },

  deleteSite(id: string) {
    return request<any>(`/sites/${id}`, { method: 'DELETE' });
  },

  deactivateSite(id: string) {
    return request<any>(`/sites/${id}/deactivate`, { method: 'POST' });
  },

  reactivateSite(id: string) {
    return request<any>(`/sites/${id}/reactivate`, { method: 'POST' });
  },

  // ---------------------------------------------------------------------------
  // Attendance Endpoints
  // ---------------------------------------------------------------------------
  getAttendance(params: {
    date?: string;
    start_date?: string;
    end_date?: string;
    worker_id?: string;
    site_id?: string;
  } = {}) {
    const searchParams = new URLSearchParams();
    if (params.date) searchParams.append('date', params.date);
    if (params.start_date) searchParams.append('start_date', params.start_date);
    if (params.end_date) searchParams.append('end_date', params.end_date);
    if (params.worker_id) searchParams.append('worker_id', params.worker_id);
    if (params.site_id) searchParams.append('site_id', params.site_id);
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<any[]>(`/attendance${query}`);
  },

  getAttendanceById(id: string) {
    return request<any>(`/attendance/${id}`);
  },

  getWorkerAttendance(workerId: string, params: { start_date?: string; end_date?: string } = {}) {
    const searchParams = new URLSearchParams();
    if (params.start_date) searchParams.append('start_date', params.start_date);
    if (params.end_date) searchParams.append('end_date', params.end_date);
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<any[]>(`/attendance/worker/${workerId}${query}`);
  },

  getAttendanceByDate(date?: string, activeOnly: boolean = false) {
    const searchParams = new URLSearchParams();
    if (date) searchParams.append('date', date);
    if (activeOnly) searchParams.append('active_only', 'true');
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<any>(`/attendance/by-date${query}`);
  },

  batchSaveAttendance(data: {
    date: string;
    records: Array<{
      worker_id: string;
      site_id?: string | null;
      work_units: number;
      notes?: string | null;
    }>;
  }) {
    return request<any>('/attendance/batch-save', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  recordAttendance(data: { id?: string; worker_id: string; site_id?: string | null; date: string; work_units: number; notes?: string | null }) {
    return request<any>('/attendance', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateAttendance(id: string, data: { site_id?: string; work_units?: number; date?: string }) {
    return request<any>(`/attendance/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteAttendance(id: string) {
    return request<any>(`/attendance/${id}`, {
      method: 'DELETE',
    });
  },

  // ---------------------------------------------------------------------------
  // Advances Endpoints
  // ---------------------------------------------------------------------------
  getAdvances(params: {
    worker_id?: string;
    start_date?: string;
    end_date?: string;
    year?: number;
    month?: number;
  } = {}) {
    const searchParams = new URLSearchParams();
    if (params.worker_id) searchParams.append('worker_id', params.worker_id);
    if (params.start_date) searchParams.append('start_date', params.start_date);
    if (params.end_date) searchParams.append('end_date', params.end_date);
    if (params.year) searchParams.append('year', String(params.year));
    if (params.month) searchParams.append('month', String(params.month));
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<any[]>(`/advances${query}`);
  },

  getAdvance(id: string) {
    return request<any>(`/advances/${id}`);
  },

  recordAdvance(data: {
    id?: string;
    worker_id: string;
    amount: number;
    date: string;
    note?: string | null;
  }) {
    return request<any>('/advances', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateAdvance(
    id: string,
    data: {
      worker_id?: string;
      amount?: number;
      date?: string;
      note?: string | null;
    }
  ) {
    return request<any>(`/advances/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteAdvance(id: string) {
    return request<any>(`/advances/${id}`, {
      method: 'DELETE',
    });
  },

  // ---------------------------------------------------------------------------
  // Dashboard Endpoints
  // ---------------------------------------------------------------------------
  getDashboardSummary(paramOrDate?: string | { date?: string; year?: number; month?: number }) {
    const searchParams = new URLSearchParams();
    if (typeof paramOrDate === 'string') {
      if (paramOrDate) searchParams.append('date', paramOrDate);
    } else if (paramOrDate) {
      if (paramOrDate.date) searchParams.append('date', paramOrDate.date);
      if (paramOrDate.year) searchParams.append('year', String(paramOrDate.year));
      if (paramOrDate.month) searchParams.append('month', String(paramOrDate.month));
    }
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<any>(`/dashboard/summary${query}`);
  },

  // ---------------------------------------------------------------------------
  // Payroll Endpoints
  // ---------------------------------------------------------------------------
  getMonthlyPayroll(year?: number, month?: number) {
    const searchParams = new URLSearchParams();
    if (year) searchParams.append('year', String(year));
    if (month) searchParams.append('month', String(month));
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<any>(`/payroll/monthly${query}`);
  },

  getWorkerMonthly(workerId: string, year?: number, month?: number) {
    const searchParams = new URLSearchParams();
    if (year) searchParams.append('year', String(year));
    if (month) searchParams.append('month', String(month));
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<any>(`/workers/${workerId}/monthly${query}`);
  },

  getWorkerDetail(workerId: string) {
    return request<any>(`/workers/${workerId}/detail`);
  },

  // ---------------------------------------------------------------------------
  // Site Analytics Endpoints
  // ---------------------------------------------------------------------------
  getSiteAnalytics(year?: number, month?: number) {
    const searchParams = new URLSearchParams();
    if (year) searchParams.append('year', String(year));
    if (month) searchParams.append('month', String(month));
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<any>(`/sites/analytics${query}`);
  },

  // ---------------------------------------------------------------------------
  // Sync & Offline Placeholders (Preserved for compatibility)
  // ---------------------------------------------------------------------------
  syncPush(payload: { workers?: any[]; sites?: any[]; attendance?: any[]; advances?: any[] }) {
    return request<any>('/sync/push', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  syncPull() {
    return request<any>('/sync/pull');
  },
};
