# Attendly Mobile — Task Plan

## Phase 0 — Project Setup
- [ ] Create separate `AttendlyMobile/` React Native CLI project.
- [ ] Initialize Git repository.
- [ ] Configure iOS project.
- [ ] Verify Metro/build tooling.
- [ ] Run default app on iOS Simulator.
- [ ] Run default app on physical iPhone.
- [ ] Confirm existing Attendly repository is untouched.

## Phase 1 — App Foundation
- [ ] Create `src/` structure.
- [ ] Add navigation.
- [ ] Add design tokens.
- [ ] Add base reusable components.
- [ ] Add environment/config handling.
- [ ] Add error boundary/global error handling.
- [ ] Establish clean development scripts.

## Phase 2 — New Backend
- [x] Create separate FastAPI project.
- [x] Create separate PostgreSQL development database.
- [x] Configure SQLAlchemy.
- [x] Configure Alembic.
- [x] Create Account model.
- [x] Create Worker model.
- [x] Create WorkerWageHistory model.
- [x] Create Site model.
- [x] Create Attendance model.
- [ ] Create Advance model (Phase 9/Advances).
- [ ] Create payroll/month-summary model if required (Phase 10/Payroll).
- [x] Add migrations.
- [x] Add health endpoint.

## Phase 3 — Authentication
- [x] Implement account registration / setup.
- [x] Validate phone number.
- [x] Validate 4-digit MPIN.
- [x] Hash MPIN securely.
- [x] Implement MPIN login.
- [x] Issue JWT/session credentials.
- [x] Implement authenticated-user dependency.
- [x] Implement single contractor account scoping & brute-force protection.
- [x] Store session securely on iPhone (Keychain via SecureStorage & AuthStorage).
- [x] Build Create Account screen (Phase 5/SetupScreen).
- [x] Build MPIN login screen (Phase 5/LoginScreen).

## Phase 4 — Core APIs
- [x] Workers CRUD & wage history.
- [x] Sites CRUD & deactivation.
- [x] Attendance read/write.
- [ ] Advances CRUD.
- [ ] Payroll/month summary.
- [x] Dashboard summary.
- [ ] Site analytics.
- [x] Add validation and ownership checks.
- [ ] Add pagination where needed.
- [ ] Add idempotency strategy for syncable writes.

## Phase 5 — API Integration & Authentication Screens
- [x] Create centralized API client with Bearer token injection and 401 session expiry.
- [x] Implement auth client & authentication screens (SetupScreen, LoginScreen, AuthScreen).
- [ ] Implement worker repository.
- [ ] Implement site repository.
- [ ] Implement attendance repository.
- [ ] Implement advances repository.
- [ ] Implement payroll repository.
- [x] Handle API errors consistently (401, 429 rate limit, network failure).

## Phase 6 — SQLite
- [ ] Select minimal stable SQLite library.
- [ ] Create local schema.
- [ ] Add migrations/versioning.
- [ ] Create local repositories.
- [ ] Cache authenticated account state.
- [ ] Store workers locally.
- [ ] Store sites locally.
- [ ] Store attendance locally.
- [ ] Store advances locally.
- [ ] Store relevant payroll summaries locally.
- [ ] Store sync queue/state.

## Phase 7 — Sync
- [ ] Implement connectivity detection.
- [ ] Implement pending queue.
- [ ] Implement sync worker.
- [ ] Implement retry behavior.
- [ ] Implement server acknowledgement handling.
- [ ] Implement idempotent attendance synchronization.
- [ ] Implement conflict detection.
- [ ] Add sync status UI.
- [ ] Test airplane-mode workflow.
- [ ] Test reconnect workflow.

## Phase 8 — Dashboard + Attendance
- [ ] Build Dashboard.
- [ ] Load dashboard from local data.
- [ ] Background refresh/sync.
- [ ] Build Attendance screen.
- [ ] Build fast work-unit controls.
- [ ] Save attendance locally immediately.
- [ ] Queue attendance sync.
- [ ] Add offline indicator.
- [ ] Add saved/syncing/synced feedback.

## Phase 9 — Workers + Sites
- [ ] Build Workers list.
- [ ] Add/edit worker.
- [ ] Build Worker Detail.
- [ ] Build Sites list.
- [ ] Add/edit site.
- [ ] Activate/deactivate site.
- [ ] Build Site Analytics.

## Phase 10 — Payroll + Advances
- [ ] Build Payroll screen.
- [ ] Build month selector.
- [ ] Show gross/advances/net payable.
- [ ] Build Advances screen.
- [ ] Add advance.
- [ ] Edit/delete advance safely.
- [ ] Verify calculations against backend.

## Phase 11 — Reliability
- [ ] Test account isolation.
- [ ] Test duplicate requests.
- [ ] Test failed requests.
- [ ] Test retries.
- [ ] Test conflicting updates.
- [ ] Test app restart with pending sync.
- [ ] Test offline for extended periods.
- [ ] Test database migration paths.

## Phase 12 — Performance
- [ ] Measure cold start.
- [ ] Measure local screen load time.
- [ ] Measure network sync time.
- [ ] Measure attendance entry responsiveness.
- [ ] Compare with PWA.
- [ ] Profile slow database queries.
- [ ] Optimize only measured bottlenecks.

## Phase 13 — Release Readiness
- [ ] Security review.
- [ ] Credential review.
- [ ] Tenant-isolation test suite passes.
- [ ] Offline test suite passes.
- [ ] iOS Simulator verification.
- [ ] Physical iPhone verification.
- [ ] Crash/error review.
- [ ] Production backend/database deployment.
- [ ] App release build.
