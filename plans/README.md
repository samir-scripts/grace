# Implementation plans

[Focus Sessions master plan](focus-sessions-master-plan.md) — completed.

## Progress

- Plan persistence and agent guidance: completed.
- [x] [01-db-and-persistence](subplans/01-db-and-persistence.md)
- [x] [02-domain-validation-security](subplans/02-domain-validation-security.md)
- [x] [03-state-machine-escape](subplans/03-state-machine-escape.md)
- [x] [04-native-enforcers-macos-windows](subplans/04-native-enforcers-macos-windows.md)
- [x] [05-timer-controller-interception](subplans/05-timer-controller-interception.md)
- [x] [06-ipc-contract-stores](subplans/06-ipc-contract-stores.md)
- [x] [07-ui-selector-titlebar](subplans/07-ui-selector-titlebar.md)
- [x] [08-ui-settings-sessions](subplans/08-ui-settings-sessions.md)
- [x] [09-ui-emergency-exit](subplans/09-ui-emergency-exit.md)
- [x] [10-e2e-system-tests](subplans/10-e2e-system-tests.md)

- Focus startup follow-up: browser participants are checked before applications are closed; the Rust bridge is exercised with an isolated Chromium extension, and the macOS application monitor has an opt-in disposable GUI fixture. Native timer-window and other-platform end-to-end checks remain outstanding.

## Execution decisions

- Existing uncommitted AGENTS.md migration is preserved; implementation uses feature/focus-sessions in this workspace.
- Rust monotonic time, not frontend elapsed milliseconds, authorizes emergency holds.
- Cargo accepts one test filter per command; run validation and security filters separately. TypeScript uses boolean, not bool.
- Native hosts-file blocking has DNS/connection coverage limits; do not claim encrypted DNS or established sockets are blocked. Privileged runtime checks require authorization.
- Progress below records only observed evidence, not expected results.
