# Attendly Mobile — Design System

## 1. Design Direction

Modern, minimal, premium contractor-management app.

Visual character:
- predominantly black and white;
- soft neutral greys;
- one restrained accent color;
- clean typography;
- strong hierarchy;
- generous but efficient spacing;
- native-feeling interactions;
- optimized for one-handed use.

Avoid:
- excessive gradients;
- neon colors;
- excessive cards;
- visual clutter;
- tiny controls;
- decorative UI with no functional purpose.

## 2. Color System

Base:
- Background: near-white
- Surface: white
- Primary text: near-black
- Secondary text: dark grey
- Borders: light grey
- Muted surface: very light grey

Accent:
- Use one tasteful accent color consistently.
- Recommended direction: electric blue or blue-violet.
- Accent should be used for primary actions, selected states, important highlights, and progress—not as a page-wide background.

Semantic colors:
- Success: restrained green
- Warning: restrained amber
- Error: restrained red
- Offline: neutral/amber indicator

The UI should still look coherent if the accent is removed.

## 3. Typography
Use a modern, highly legible system font.

Hierarchy:
- large screen title;
- medium section heading;
- compact card/row title;
- readable body;
- small metadata/caption.

Avoid excessively thin text. Financial values and attendance values should be highly legible.

## 4. Layout
Use a consistent spacing scale.

Prefer:
- 16–20px screen horizontal padding;
- comfortable touch targets;
- clear vertical rhythm;
- bottom-sheet/modal interactions where appropriate;
- thumb-reachable primary actions.

Minimum interactive target should be approximately 44pt.

## 5. Navigation
Use a simple mobile navigation model.

Recommended primary destinations:
- Home
- Attendance
- Workers
- Sites
- Payroll

Secondary sections such as Advances can be accessed from relevant areas or a simple More/settings destination.

Do not create deep navigation stacks when a sheet or detail view is clearer.

## 6. Login
### Login screen
Minimal:
- app mark/name;
- MPIN input;
- large numeric keypad or secure numeric input;
- primary login action;
- account/recovery option only if implemented.

The login screen should not ask for the phone number on every normal login.

### Create Account
Simple step-based form:
1. Phone number.
2. MPIN.
3. Confirm MPIN.

Keep the number of visible fields small.

## 7. Dashboard
Prioritize the contractor's immediate questions:
- What is happening today?
- How many workers worked?
- How much has been earned?
- What is payable?
- What needs attention?

Use:
- compact summary blocks;
- today's attendance;
- current-month financial summary;
- quick actions.

Avoid turning the dashboard into a dense analytics dashboard.

## 8. Attendance
Attendance is the highest-frequency interaction.

Design goal: mark a worker's attendance with as few taps as practical.

Suggested interaction:
- date at top;
- site filter/selection;
- worker list;
- highly visible work-unit controls;
- instant visual confirmation;
- subtle synced/offline state.

Work-unit controls should make:
`0`, `0.5`, `1`, `1.5`, `2`
easy to select.

Do not require opening a complex form for every worker.

## 9. Workers
Use clean rows:
- worker name;
- wage;
- current status/relevant summary;
- optional avatar/initial.

Worker detail should clearly separate:
- profile;
- attendance;
- earnings;
- site history.

## 10. Sites
Keep site management simple:
- active sites first;
- inactive sites visually subdued;
- obvious add/edit controls;
- historical references must remain understandable.

## 11. Payroll
Use strong financial hierarchy:
- gross;
- advances;
- net payable.

Month selection should be easy.

Do not hide important amounts behind multiple taps.

## 12. Advances
Make worker selection, amount, date, and note easy to enter.

Use clear confirmation before destructive actions.

## 13. Offline State
The app must communicate offline status without becoming annoying.

Examples:
- small persistent offline pill/banner;
- "Saved on this device" after a local attendance change;
- sync indicator when pending changes exist.

Avoid blocking the user merely because the network is unavailable.

## 14. Loading States
Prefer skeletons or immediate cached content.

Do not show a full-screen spinner when cached local data is available.

Use skeleton/loading states only for genuinely unavailable content.

## 15. Empty States
Every empty state should explain:
- what is empty;
- why it matters;
- what action creates the first item.

Keep copy short.

## 16. Error States
Errors should be actionable and calm.

Example:
"Couldn't sync 2 changes. Your attendance is saved on this device. We'll retry automatically."

Never imply that locally saved data is lost unless it actually is.

## 17. Motion
Use subtle, fast animations:
- selection;
- success confirmation;
- navigation;
- bottom sheets.

Avoid animation that delays interaction.

## 18. Accessibility
- high text/background contrast;
- touch targets ≥44pt;
- support Dynamic Type where practical;
- do not communicate state with color alone;
- labels for icons;
- accessible form errors.

## 19. Component Style
Prefer reusable primitives:
- AppHeader
- PrimaryButton
- SecondaryButton
- NumericInput
- StatusPill
- SummaryCard
- ListRow
- EmptyState
- ErrorState
- OfflineIndicator
- SyncIndicator
- BottomSheet
- ConfirmationDialog

Components should remain simple and composable.

## 20. Overall Feel
The final product should feel:
**fast, calm, premium, practical, and unmistakably mobile.**
