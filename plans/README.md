# Implementation plans

[Focus Sessions master plan](focus-sessions-master-plan.md) — in progress.

## Progress

- Plan persistence and agent guidance: in progress.
- [ ] [01-db-and-persistence](subplans/01-db-and-persistence.md)
- [ ] [02-domain-validation-security](subplans/02-domain-validation-security.md)
- [ ] [03-state-machine-escape](subplans/03-state-machine-escape.md)
- [ ] [04-native-enforcers-macos-windows](subplans/04-native-enforcers-macos-windows.md)
- [ ] [05-timer-controller-interception](subplans/05-timer-controller-interception.md)
- [ ] [06-ipc-contract-stores](subplans/06-ipc-contract-stores.md)
- [ ] [07-ui-selector-titlebar](subplans/07-ui-selector-titlebar.md)
- [ ] [08-ui-settings-sessions](subplans/08-ui-settings-sessions.md)
- [ ] [09-ui-emergency-exit](subplans/09-ui-emergency-exit.md)
- [ ] [10-e2e-system-tests](subplans/10-e2e-system-tests.md)

## Execution decisions

- Existing uncommitted AGENTS.md migration is preserved; implementation uses feature/focus-sessions in this workspace.
- Rust monotonic time, not frontend elapsed milliseconds, authorizes emergency holds.
- Cargo accepts one test filter per command; run validation and security filters separately. TypeScript uses boolean, not bool.
- Native hosts-file blocking has DNS/connection coverage limits; do not claim encrypted DNS or established sockets are blocked. Privileged runtime checks require authorization.
- Progress below records only observed evidence, not expected results.
