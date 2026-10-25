# Attendly Mobile — Test Plan

## 1. Test Strategy

Testing must cover:
- unit behavior;
- API behavior;
- database integrity;
- tenant isolation;
- authentication;
- synchronization;
- offline operation;
- UI behavior;
- iOS device behavior;
- performance.

Do not rely only on manual happy-path testing.

## 2. Authentication Tests

### Registration
- [ ] Valid phone + valid 4-digit MPIN creates account.
- [ ] MPIN confirmation mismatch is rejected.
- [ ] Invalid MPIN length is rejected.
- [ ] Duplicate phone number is rejected safely.
- [ ] MPIN is never returned in API responses.
- [ ] MPIN is stored only as a secure hash.

### Login
- [ ] Correct MPIN logs in.
- [ ] Incorrect MPIN is rejected.
- [ ] Normal recognized-device login requires only MPIN.
- [ ] Session/JWT is stored securely.
- [ ] Logout clears the appropriate local session state.
- [ ] Expired/invalid token is handled correctly.

## 3. Tenant Isolation Tests

Create at least two contractor accounts.

Account A:
- workers;
- sites;
- attendance;
- advances.

Account B:
- different workers;
- different sites;
- different attendance;
- different advances.

Verify:
- [ ] A cannot read B's workers.
- [ ] A cannot read B's sites.
- [ ] A cannot read B's attendance.
- [ ] A cannot read B's advances.
- [ ] A cannot read B's payroll.
- [ ] A cannot modify B's records.
- [ ] A cannot delete B's records.
- [ ] B cannot access A's records.
- [ ] Changing an ID in a request cannot bypass account isolation.
- [ ] Dashboard and analytics remain account-scoped.

## 4. Worker Tests
- [ ] Create worker.
- [ ] Edit worker.
- [ ] Deactivate worker.
- [ ] View worker detail.
- [ ] Worker wage calculations are correct.
- [ ] Worker data remains account-scoped.

## 5. Site Tests
- [ ] Create site.
- [ ] Edit site.
- [ ] Deactivate site.
- [ ] Inactive site cannot be selected for new attendance.
- [ ] Historical attendance retains its original site reference.
- [ ] Site data remains account-scoped.

## 6. Attendance Tests
Test:
- [ ] 0 work units.
- [ ] 0.5 work units.
- [ ] 1 work unit.
- [ ] 1.5 work units.
- [ ] 2 work units.
- [ ] Daily earnings calculation.
- [ ] Duplicate attendance prevention.
- [ ] Attendance references valid worker/site.
- [ ] Attendance rejects cross-account worker/site references.
- [ ] Historical dates work correctly.
- [ ] Month boundaries work correctly.

## 7. Payroll Tests
- [ ] Gross is sum of attendance earnings.
- [ ] Advances reduce net payable.
- [ ] Month starts on the 1st.
- [ ] Previous months remain accessible.
- [ ] Month calculations are account-scoped.
- [ ] Date handling does not shift because of timezone conversion.

## 8. SQLite Tests
- [ ] Local database initializes.
- [ ] Migrations work.
- [ ] Cached data loads without network.
- [ ] Local attendance write succeeds offline.
- [ ] App restart retains pending local changes.
- [ ] Local records have correct sync state.

## 9. Sync Tests
- [ ] Pending record synchronizes when online.
- [ ] Successful sync becomes SYNCED.
- [ ] Failed sync remains retryable.
- [ ] Network failure does not lose local data.
- [ ] Retry does not create duplicate records.
- [ ] App restart preserves pending queue.
- [ ] Multiple pending records synchronize correctly.
- [ ] Reconnect triggers synchronization.
- [ ] Server acknowledgement updates local state.
- [ ] Stale local data cannot silently overwrite newer server data.

## 10. Offline Tests
### Scenario A
1. Open app online.
2. Turn on airplane mode.
3. Open Attendance.
4. Mark several workers.
5. Kill/reopen app.
6. Verify changes remain.
7. Restore internet.
8. Verify synchronization.

### Scenario B
Repeat while starting the app offline.

### Scenario C
Make several local changes, cause sync failure, restore connectivity, and verify retries.

## 11. API Tests
- [ ] Authentication middleware.
- [ ] Input validation.
- [ ] Ownership checks.
- [ ] Correct HTTP status codes.
- [ ] Pagination.
- [ ] Idempotent synchronization requests.
- [ ] Error responses do not leak secrets or internal database details.

## 12. Security Tests
- [ ] No secrets in source control.
- [ ] No plaintext MPIN.
- [ ] No production credentials in app bundle.
- [ ] JWT/session handling is secure.
- [ ] Account isolation passes automated tests.
- [ ] Unauthorized endpoints reject requests.
- [ ] Cross-account IDs return safe errors.
- [ ] Client cannot select another account by changing request parameters.

## 13. UI Tests
- [ ] Create Account flow.
- [ ] MPIN login.
- [ ] Dashboard.
- [ ] Attendance entry.
- [ ] Workers.
- [ ] Worker Detail.
- [ ] Sites.
- [ ] Site Analytics.
- [ ] Payroll.
- [ ] Advances.
- [ ] Empty states.
- [ ] Loading states.
- [ ] Error states.
- [ ] Offline state.
- [ ] Sync state.
- [ ] Confirmation dialogs.

## 14. iOS Tests
- [ ] iOS Simulator launch.
- [ ] Physical iPhone build.
- [ ] Physical iPhone login.
- [ ] App restart.
- [ ] Background/foreground transition.
- [ ] Network switching Wi-Fi/cellular.
- [ ] Airplane mode.
- [ ] Keyboard/input behavior.
- [ ] Safe-area behavior.
- [ ] Different supported screen sizes.

## 15. Performance Tests
Measure:
- app cold start;
- time to first usable screen;
- local Dashboard load;
- local Attendance load;
- attendance interaction latency;
- sync duration;
- API latency;
- backend query duration.

The key requirement is that normal local interaction should not wait for network requests.

## 16. Regression Rule
Before declaring a phase complete:
- focused tests pass;
- no new runtime errors;
- tenant isolation remains intact;
- existing mobile functionality remains intact;
- changes are committed separately.

## 17. Release Gate
Do not release until:
- authentication tests pass;
- tenant isolation tests pass;
- offline tests pass;
- sync tests pass;
- physical iPhone tests pass;
- security review passes;
- no known data-loss path remains.
