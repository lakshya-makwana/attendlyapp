# Attendly Mobile — Product Requirements Document

## 1. Product
Attendly Mobile is a new, standalone React Native CLI mobile application for contractors to manage workers, sites, attendance, wages, payroll, and advances.

It is a separate product/client from the existing Attendly PWA. The existing Attendly project must remain untouched.

## 2. Product Goal
Make contractor attendance and payroll management extremely fast and simple on iPhone, including reliable use when internet connectivity is poor or unavailable.

The core experience is local-first:
- Read local data immediately.
- Let the user make changes immediately.
- Sync changes with the backend in the background.
- PostgreSQL remains the authoritative server database.

## 3. Target Users
Primary user: contractor/admin who manages workers and sites.

The product must support multiple independent contractor accounts. Each contractor must only see and modify their own data.

## 4. Authentication

### Account creation
First-time setup:
1. Enter phone number.
2. Enter 4-digit MPIN.
3. Confirm 4-digit MPIN.
4. Create account.
5. Enter the app.

No email, password, OAuth, or unnecessary onboarding should be added.

### Returning login
On a recognized device:
1. Open app.
2. Enter 4-digit MPIN.
3. Enter dashboard.

The phone number should not be requested on every login.

A later device/account recovery flow may use the phone number, but it is not part of the initial MVP unless required.

MPINs must never be stored in plaintext. Store a secure server-side hash.

## 5. Multi-Tenancy
Every contractor is an account/tenant.

All contractor-owned records must be associated with an `account_id` and all backend queries/mutations must enforce account isolation.

A contractor must never be able to:
- read another contractor's workers;
- read another contractor's sites;
- read another contractor's attendance;
- read another contractor's advances;
- read another contractor's payroll;
- modify/delete another contractor's data.

## 6. Core Modules

### Dashboard
Show useful current-month information:
- attendance/work summary;
- gross/payable amounts;
- advances;
- worker/site overview;
- sync/offline status when relevant.

### Attendance
Fields:
- date;
- worker;
- site;
- work units.

Work units:
- `0` = absent
- `0.5` = half day
- `1` = full day
- `1.5`
- `2`

Daily earnings:
`work_units × daily_wage`

Attendance entry must feel instant and must work offline.

### Workers
- list workers;
- add worker;
- edit worker;
- deactivate/reactivate worker as appropriate;
- view worker detail;
- view attendance/history and earnings.

### Worker Detail
Show:
- worker information;
- wage;
- recent attendance;
- site history;
- earnings/payable information.

### Sites
- list sites;
- create site;
- edit site;
- activate/deactivate site;
- preserve historical attendance references.

Inactive sites must not be selectable for new attendance.

### Site Analytics
Provide useful site-level attendance/work/expense information without making the screen visually dense.

### Payroll
Monthly payroll:
- calendar month is 1st through last day;
- gross = sum of attendance earnings;
- net payable = gross - advances;
- previous months remain historical;
- month changes automatically on the 1st.

The contractor's salary-payment day does not control the monthly reset.

### Advances
- record advances;
- associate advance with worker;
- include advances in net payable calculations;
- retain historical records.

## 7. Offline-First Requirements
The app must remain usable without internet for normal local operations.

When offline:
- cached data remains visible;
- attendance can be entered;
- local changes appear immediately;
- changes are queued for synchronization.

When connectivity returns:
- pending changes sync automatically;
- failed changes remain pending and retry;
- duplicate writes must be prevented;
- newer server/local data must not be silently overwritten by stale data.

## 8. Data Ownership
Server PostgreSQL is authoritative.

Device SQLite is a local working database/cache used for:
- instant reads;
- offline operation;
- local writes;
- pending sync state.

The device database is not the permanent source of truth.

## 9. Initial Delivery Scope
Build incrementally.

Phase 1:
- React Native CLI project;
- iOS Simulator;
- physical iPhone.

Phase 2:
- new FastAPI backend;
- new PostgreSQL database.

Phase 3:
- phone + MPIN account creation;
- MPIN-only returning login;
- JWT/session handling.

Phase 4:
- workers/sites/attendance/advances APIs;
- strict account isolation.

Phase 5:
- React Native API integration.

Phase 6:
- SQLite/local repositories.

Phase 7:
- Dashboard and Attendance.

Phase 8:
- Workers, Worker Detail, Sites, Analytics.

Phase 9:
- Payroll and Advances.

Phase 10:
- robust synchronization/conflict handling.

Phase 11:
- offline and reliability testing.

Phase 12:
- performance comparison against the PWA.

## 10. Non-Goals
Do not:
- convert the existing PWA into React Native;
- reuse the existing production database;
- modify the existing production backend;
- modify the existing Vercel deployment;
- migrate the existing production schema;
- copy production data automatically into the new app;
- introduce unnecessary authentication complexity;
- build every feature before validating the foundation.

## 11. Product Principles
1. Fast first.
2. Local-first interaction.
3. Simple contractor workflow.
4. Strong tenant isolation.
5. Native-feeling mobile UI.
6. Small, deliberate feature set.
7. Reliable synchronization.
8. No unnecessary complexity.
