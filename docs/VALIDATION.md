# Local validation

This checkout was exercised with synthetic data only. These checks do not establish audited financial correctness or live-bank readiness.

## Automated checks

- `npm test`: 76 passing tests for financial calculations, CSV parsing, Plaid normalization and snapshot lifecycle, backup validation, the mocked local connector, all ten scenario fixtures, and practice workspace isolation.
- `npm run typecheck`: TypeScript compilation passed.
- `npm run lint`: ESLint passed with no warnings.
- `npm run build`: production build completed. Vinext reports an informational limitation in automatic route classification.
- `npm run build:pages`: static production build completed with assets and fonts rooted under `/selmio/`.

## Browser checks

Tested the running local application in the Codex browser at desktop size and a 390 × 844 phone viewport:

- Demo loading, purchase calculations, the uncertainty outcome, and a persisted review answer after reload.
- Reopening a previously resolved review and restoring the unresolved alternatives.
- Manual account creation, a dated bill, and updating the protected buffer.
- CSV import, duplicate re-import, and the income filter.
- JSON backup restoration and switching between accounts with different balance snapshot dates.
- Two tabs editing one workspace: the second tab pauses saving, preserves its unsaved copy, and can open the newer saved version.
- Mobile navigation, transaction layout, and the scrolling purchase dialog; the page had no horizontal overflow at 390 pixels.
- The one-command local launcher starts the app on `127.0.0.1:3000` with bank connection correctly shown as unconfigured.
- The static Pages build renders the shared interface, evaluates the uncertain purchase case, persists review answers after reload, and loads its imagery and font from the project URL prefix. Its bank dialog explains the local-app requirement and disables Plaid connections; no connector is called in this build.
- The scenario gallery contains ten distinct, self-guided walkthroughs. The purchase, import, backup recovery, buffer, and savings-goal walkthroughs were completed through the browser; the pending-charge walkthrough was checked through its resolved purchase result. Steps remain visible inside dialogs, and completion is explicitly manual.
- The guided CSV imports four rows once and skips all four on re-import without changing the current balance. The temporary practice copy restores the earlier buffer and projected room.
- Exiting multiple practice sessions and reloading preserved a synthetic personal account, its $9,876.54 balance, its bill, and its $875 buffer. Practice snapshots are not written to personal workspace storage. Reducer tests also reject delayed updates from an exited or restarted session.
- The scenario gallery and active buffer walkthrough were checked at 390 × 844 pixels with no horizontal overflow. Starting a scenario scrolls to the guide, and practice controls remain unobstructed.

Screenshots: [dashboard](screenshots/selmio-overview.jpg), [purchase decision](screenshots/selmio-purchase.jpg).

## Remaining verification

No real bank credentials were supplied. Live institution coverage, Production access, OAuth redirects, provider outages, and actual bank synchronization still require configured Plaid testing. The connector tests use a mocked provider transport.

The current deterministic engine uses explicit alternatives. Automatic obligation discovery and the proposed correlated interpretation algorithm remain research and development work. This release has not undergone an independent security audit, accessibility audit, financial audit, or trademark clearance.
