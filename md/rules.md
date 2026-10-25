# Attendly Mobile — Development Rules

## Absolute Rules

1. This is a NEW React Native CLI project.
2. Do not modify the existing Attendly PWA.
3. Do not modify the existing Attendly backend.
4. Do not use the existing production Neon database.
5. Do not modify the existing Vercel deployment.
6. Do not migrate existing production data unless explicitly requested.
7. Do not expose production credentials, MPINs, JWT secrets, or hashes.
8. Do not hardcode secrets.
9. Do not introduce unnecessary product complexity.

## Architecture Rules
10. New app uses a new FastAPI backend.
11. New backend uses a new PostgreSQL database.
12. React Native uses local SQLite for local-first operation.
13. PostgreSQL is authoritative.
14. SQLite is the device working/cache/offline store.
15. Backend authorization is responsible for tenant isolation.
16. Never trust a client-supplied `account_id` for authorization.
17. Every contractor-owned record must be account-scoped.

## Authentication Rules
18. Account creation uses phone number + 4-digit MPIN + confirmation.
19. Returning login on a recognized device uses MPIN only.
20. MPIN must be hashed securely server-side.
21. MPIN must never be stored in plaintext.
22. Session/JWT secrets must use secure device storage.
23. Do not add email/password/OAuth unless explicitly requested.

## Sync Rules
24. Local writes should update the UI immediately.
25. Sync happens in the background.
26. Failed sync remains retryable.
27. Sync operations must be idempotent where possible.
28. Prevent duplicate attendance records.
29. Do not overwrite newer data with stale data.
30. Never silently discard a local change.
31. Offline mode must be a supported operating mode, not an error mode.

## Code Rules
32. Prefer small, focused modules.
33. Avoid giant files.
34. Avoid premature abstractions.
35. Do not install libraries without a clear need.
36. Remove unused imports/code.
37. Keep TypeScript/JavaScript conventions consistent with the project choice.
38. Validate API responses.
39. Handle loading, empty, error, and offline states.
40. Do not ignore runtime warnings or errors.

## UI Rules
41. Black/white/grey is the visual foundation.
42. Use one restrained accent color.
43. Keep screens uncluttered.
44. Optimize frequent actions for one-handed use.
45. Use large, clear touch targets.
46. Do not make every element a card.
47. Avoid unnecessary gradients and decoration.
48. Prefer native-feeling controls and navigation.

## Testing Rules
49. Run focused tests after each feature.
50. Run tenant-isolation tests for every relevant backend feature.
51. Test offline writes and later synchronization.
52. Test duplicate/retry behavior.
53. Test on iOS Simulator.
54. Test on a physical iPhone.
55. Never declare a feature complete only because it works in one happy-path demo.

## Git Rules
56. Keep commits small and feature-focused.
57. Do not commit `.env` or credentials.
58. Do not commit generated secrets.
59. Do not modify unrelated files.
60. Do not perform giant refactors while implementing a feature.
