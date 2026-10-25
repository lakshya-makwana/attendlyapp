import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AuthScreen } from '../src/screens/AuthScreen';
import { DashboardScreen } from '../src/screens/DashboardScreen';
import { AttendanceScreen } from '../src/screens/AttendanceScreen';
import { WorkersScreen } from '../src/screens/WorkersScreen';
import { SitesScreen } from '../src/screens/SitesScreen';
import { PayrollScreen } from '../src/screens/PayrollScreen';

describe('Screens Rendering', () => {
  it('renders AuthScreen correctly', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<AuthScreen onLoginSuccess={jest.fn()} />);
    });
    expect(renderer!.toJSON()).toBeTruthy();
  });

  it('renders DashboardScreen correctly', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DashboardScreen
          accountId="test_acc_id"
          onNavigate={jest.fn()}
          onLogout={jest.fn()}
        />
      );
    });
    expect(renderer!.toJSON()).toBeTruthy();
  });

  it('renders AttendanceScreen correctly', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AttendanceScreen
          accountId="test_acc_id"
          onNavigateHome={jest.fn()}
        />
      );
    });
    expect(renderer!.toJSON()).toBeTruthy();
  });

  it('renders WorkersScreen correctly', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkersScreen
          accountId="test_acc_id"
          onNavigateHome={jest.fn()}
        />
      );
    });
    expect(renderer!.toJSON()).toBeTruthy();
  });

  it('renders SitesScreen correctly', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SitesScreen
          accountId="test_acc_id"
          onNavigateHome={jest.fn()}
        />
      );
    });
    expect(renderer!.toJSON()).toBeTruthy();
  });

  it('renders PayrollScreen correctly', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <PayrollScreen
          accountId="test_acc_id"
          onNavigateHome={jest.fn()}
        />
      );
    });
    expect(renderer!.toJSON()).toBeTruthy();
  });
});
