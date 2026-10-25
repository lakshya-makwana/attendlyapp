# Attendly Mobile — Decisions

## D001 — Separate Mobile Project
**Decision:** Build a completely separate React Native CLI project.

**Reason:** The existing Attendly PWA is production-ready and should not be disturbed.

## D002 — Separate Backend
**Decision:** The mobile app gets a new FastAPI backend.

**Reason:** The mobile product is becoming an independently distributable application for multiple contractors.

## D003 — Separate Database
**Decision:** The mobile backend gets a new PostgreSQL database.

**Reason:** Mobile data and future contractor accounts should be isolated from the existing production system.

## D004 — Multi-Tenant Product
**Decision:** Multiple contractors can create accounts and use the app independently.

**Reason:** The product should be usable by other contractors, not only the original user.

## D005 — Simple Authentication
**Decision:** Account creation uses phone number + 4-digit MPIN + confirmation.

**Reason:** Keep onboarding simple.

## D006 — MPIN-Only Returning Login
**Decision:** On a recognized device, returning login asks only for the 4-digit MPIN.

**Reason:** The contractor should not repeatedly type the phone number.

## D007 — No Complex Auth Initially
**Decision:** No email/password, OAuth, or unnecessary verification flow in the initial product.

**Reason:** Avoid complexity until a real product requirement exists.

## D008 — Local-First
**Decision:** React Native uses SQLite for local data and immediate UI.

**Reason:** The core goal is a very fast iPhone experience and reliable offline operation.

## D009 — Server Authority
**Decision:** PostgreSQL remains the authoritative permanent database.

**Reason:** Device storage is a local cache/working store and must not become the only copy.

## D010 — Background Sync
**Decision:** Local writes happen first, then synchronize with the server.

**Reason:** Attendance entry should not wait for network latency.

## D011 — Incremental Development
**Decision:** Build in phases rather than implementing the entire app at once.

**Reason:** Validate the iPhone foundation, backend, auth, data layer, and sync system independently.

## D012 — Design Direction
**Decision:** Modern black-and-white interface with a small amount of accent color.

**Reason:** The desired product feel is clean, premium, practical, and easy to use.

## D013 — Existing Project Boundary
**Decision:** No modifications to the existing Attendly PWA/backend/database unless explicitly requested.

**Reason:** Production stability and data safety.

## D014 — Single Contractor / Admin Account
**Decision:** Attendly Mobile has ONE contractor/admin account only. No multi-tenant architecture, account_id fields on every business table, account switching, or multiple contractor accounts.

**Reason:** Aligns directly with product requirements to keep mobile models focused, fast, and unencumbered by unnecessary multi-tenant complexity.

## D015 — Attendance Deletion Safety & Financial History Preservation
**Decision:** Irreversible hard deletion of attendance records via the API is disabled (returning HTTP 409 Conflict). Record corrections must be performed non-destructively by updating `work_units` to `0` (Absent) or modifying the record.

**Reason:** Attendance entries represent historical wage calculations and earnings. Hard-deleting them permanently erases financial audit trails. Without a separate audit/soft-delete schema, preserving the record and allowing work units to be corrected to 0 provides the safest, audit-compliant financial history.


## D016 — Four-Digit MPIN for PWA Parity
**Decision:** Standardize all contractor authentication to exactly 4 numeric digits for setup, confirmation, and returning login.

**Reason:** Aligns directly with the existing Attendly PWA reference system and provides high-speed, familiar contractor ergonomics. Security is maintained through standard Bcrypt hashing, signed JWT access tokens stored exclusively in the hardware-backed iOS Keychain, zero client-side MPIN persistence, and strict in-memory brute-force rate-limiting (5 consecutive failed attempts trigger an enforced 300-second lockout).
