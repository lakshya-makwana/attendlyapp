/**
 * Attendly Mobile Navigation Types & Route Definitions
 */

export type RootRoute = 'Auth' | 'Main';

export type MainTabRoute = 'Dashboard' | 'Attendance' | 'Workers' | 'Sites' | 'Payroll';

export type RootStackParamList = {
  Auth: undefined;
  Main: {
    initialTab?: MainTabRoute;
  } | undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Attendance: { date?: string } | undefined;
  Workers: undefined;
  Sites: undefined;
  Payroll: { year?: number; month?: number } | undefined;
};
