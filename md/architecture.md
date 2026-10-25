# Attendly Mobile — Architecture

## 1. System Boundary

This is a completely separate application.

Existing system:
`Existing Attendly PWA → Existing FastAPI → Existing Neon PostgreSQL`

New system:
`React Native → Local SQLite ↔ New FastAPI → New PostgreSQL`

The systems must not share the production database or backend.

## 2. High-Level Architecture

```text
                    iPhone
┌─────────────────────────────────────────┐
│             React Native CLI             │
│                                         │
│  Screens / Navigation                   │
│          ↓                              │
│  View Models / Services                 │
│          ↓                              │
│  Local Repositories                     │
│          ↓                              │
│       SQLite                            │
│          ↕                              │
│     Sync Manager                        │
└──────────┬──────────────────────────────┘
           │ HTTPS
           ↓
┌─────────────────────────────────────────┐
│            New FastAPI Backend           │
│                                         │
│ Auth / Accounts                         │
│ Workers / Sites                         │
│ Attendance / Advances                   │
│ Payroll / Analytics                    │
│ Account-scoped authorization            │
└────────────────┬────────────────────────┘
                 ↓
        New PostgreSQL DB
```

## 3. React Native Layers

Recommended separation:

```text
src/
├── navigation/
├── screens/
├── components/
├── features/
│   ├── auth/
│   ├── dashboard/
│   ├── attendance/
│   ├── workers/
│   ├── sites/
│   ├── payroll/
│   └── advances/
├── db/
├── repositories/
├── services/
├── sync/
├── api/
├── storage/
└── utils/
```

Do not create an unnecessarily complex architecture framework. Keep boundaries understandable.

## 4. Local SQLite

Local tables should approximately include:
- accounts/session metadata;
- workers;
- sites;
- attendance;
- advances;
- payroll/month summaries where useful;
- sync queue/state.

Example:

```text
attendance
-----------
id
server_id
account_id
worker_id
site_id
date
work_units
updated_at
sync_status
```

Use stable server IDs where available. Local-only records need a deterministic temporary ID strategy until the server assigns/acknowledges the record.

## 5. Sync Manager

Suggested states:

```text
PENDING → SYNCING → SYNCED
              ↓
            FAILED
              ↓
            PENDING
```

Responsibilities:
- detect connectivity;
- pick pending changes;
- send idempotent requests;
- process server acknowledgement;
- retry failures;
- avoid duplicate records;
- detect conflicts;
- update local state after successful synchronization.

Sync should be background work, not something the user has to manually trigger for normal operation.

## 6. Backend

New FastAPI service with:
- API routing;
- authentication;
- account/tenant authorization;
- service/business layer where useful;
- SQLAlchemy;
- Alembic migrations;
- PostgreSQL;
- request validation;
- structured error responses.

Do not copy the existing backend wholesale. Reuse business concepts where useful, but implement the new service cleanly for the mobile product.

## 7. Database Model

Core entities:

```text
Account
  ├── Worker
  ├── Site
  ├── Attendance
  ├── Advance
  └── Payroll/Month Summary
```

Every contractor-owned entity must be account-scoped.

Foreign-key relationships should enforce integrity.

## 8. Authentication Architecture

Account creation:
`POST /auth/register`

Returning login on a recognized device:
`POST /auth/login-mpin`

The device should securely retain the account/session association needed to show the MPIN login for that account.

Do not store the MPIN itself in plaintext.

JWT/session credentials should be stored using secure device storage rather than ordinary SQLite/plain preferences.

## 9. API Principles
- JSON over HTTPS.
- Consistent status codes.
- Account scope derived from authenticated identity, never trusted from arbitrary client input.
- Validate ownership of every referenced worker/site/attendance/advance.
- Idempotent mutation behavior where synchronization can retry.
- Pagination for growing collections.
- Explicit timestamps/version fields where needed for synchronization.

## 10. Conflict Strategy
The initial system should prefer simple deterministic rules.

Every syncable record should have enough metadata to identify:
- record identity;
- server version or update timestamp;
- local pending state.

Never blindly overwrite a newer server record with an older local record.

If a complex conflict occurs, preserve data and surface a safe recoverable state rather than silently losing a change.

## 11. Deployment
The new backend and database are independent from the existing Attendly infrastructure.

The final deployment provider can be selected later. Local development must work without depending on production infrastructure.

## 12. Performance Principles
- SQLite first for normal reads.
- Avoid unnecessary network requests.
- Batch synchronization where practical.
- Avoid N+1 database queries.
- Index only after observing actual query patterns.
- Keep API payloads focused.
- Paginate unbounded data.

## 13. Security Boundary
The client is untrusted.

The backend is responsible for:
- authentication;
- authorization;
- account isolation;
- data validation;
- ownership checks.

Never rely on `account_id` supplied by the client to authorize access.
