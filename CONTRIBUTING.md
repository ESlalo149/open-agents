# Contributing to Pixel Agents

Bug fixes, features, tests, and documentation improvements are welcome. The project is licensed under [MIT](LICENSE); no CLA or DCO is required.

## Development setup

Requirements: Node.js 20 or later and npm. OpenCode 2.2.6 is needed to manually validate plugin integration, but not for unit tests.

```bash
npm install
npm run package
npm test
```

To run a development checkout, start `node dist/cli.js` after packaging. Start OpenCode separately with this repository as its working directory so it discovers `.opencode/plugins/pixel-agents/`. OpenCode owns session creation; the office observes its events.

## Useful commands

```bash
npm run package             # Generate protocol types, typecheck, lint, build server and UI
npm test                    # Webview, server, and package-contract tests
npm run check-types         # TypeScript checks
npm run lint                # ESLint
npm run asyncapi:validate   # Validate the AsyncAPI contract
npm run asyncapi:generate   # Regenerate core/src/messages.ts
npm run verify:npm-package  # Build/install/test a local npm tarball; does not publish
```

Lint currently reports one known React hook dependency warning in `webview-ui/src/App.tsx`.

## Architecture

| Path                              | Responsibility                                                               |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `core/`                           | AsyncAPI contract, generated message types, shared protocol and schemas.     |
| `server/`                         | Standalone Fastify server, office state, persistence, OpenCode event bridge. |
| `.opencode/plugins/pixel-agents/` | OpenCode 2.2.6 project-local event plugin.                                   |
| `webview-ui/`                     | React/Canvas browser office, editor, assets, WebSocket client.               |
| `scripts/`                        | Build, protocol generation, and package verification.                        |

Keep dependencies flowing from `server/` and `webview-ui/` to `core/`, not in reverse. Before changing OpenCode integration behavior, verify against the **2.2.6** plugin/client types.

## Product boundaries

- Pixel Agents is an observational browser office, not a session launcher or terminal.
- OpenCode remains responsible for creating and executing sessions.
- The plugin forwards events; it does not install hooks or modify OpenCode configuration.
- The event endpoint is authenticated and intended for local loopback traffic.
- Preserve the pixel-art UI and office editor unless a requested change specifically affects them.

## Tests and integration validation

Add unit tests for event mapping, persistence, and UI behavior. The server bridge tests are in `server/__tests__/openCodeEvents.test.ts`. Run `npm test`, `npm run check-types`, and `npm run asyncapi:validate` for relevant changes.

There is currently no browser end-to-end suite. For plugin bridge changes, validate manually with OpenCode 2.2.6: start the server, start OpenCode in the project directory, create a fresh session, and verify that it appears and updates in the office. Do not use sensitive prompts or expose tokenized office URLs in logs.

## Code and UI conventions

- Keep TypeScript strict and avoid unused locals/parameters.
- `core/asyncapi.yaml` is the source of truth for browser/server messages. Regenerate `core/src/messages.ts`; do not hand-edit generated output.
- Follow the pixel-art aesthetic and prefer existing CSS variables/constants over duplicated literals.
- Tests should assert user-visible or protocol behavior.

## Pull requests

Use a focused change, describe what changed and why, and list checks run. Include screenshots for UI changes. Never publish a package or release without explicit authorization. Report security issues privately as described in [SECURITY.md](SECURITY.md).
