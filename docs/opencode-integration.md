# OpenCode 2.2.6 integration

Pixel Agents integrates with OpenCode through a project-local plugin at
`.opencode/plugins/pixel-agents/`. OpenCode 2.2.6 discovers plugin directories
under `.opencode/plugins/` automatically when started with the project as its
working directory; the root `opencode.jsonc` does not need an explicit plugin
entry.

## Data flow

The plugin subscribes to OpenCode's event stream and forwards session and
permission events to the Pixel Agents server over an authenticated loopback
HTTP endpoint. It reads the local server registry from `~/.pixel-agents/servers/`
to find active Pixel Agents instances. The server translates supported event
payloads into office state and broadcasts updates to browser clients.

OpenCode remains responsible for creating, running, and responding to sessions.
Pixel Agents is an observational office: it does not launch sessions, embed a
terminal, install OpenCode hooks, or change OpenCode configuration.

## Run from a development checkout

In one terminal:

```bash
npm install
npm run package
node dist/cli.js
```

Open the tokenized browser URL printed by the server. In another terminal,
start OpenCode with this repository as its working directory, then create a new
session. That session should appear in the office. OpenCode and Pixel Agents
must both be running; the browser office can be opened independently.

For the published package, run `npx pixel-agents` instead of `node dist/cli.js`.

## Security notes

- The server binds to `127.0.0.1` by default.
- The plugin sends events to `127.0.0.1` and authenticates with the server's
  bearer token from the local registry.
- Keep the tokenized browser URL private. It grants access to office controls.
- Configure non-local access only after reviewing [SECURITY.md](../SECURITY.md)
  and the CLI's `--host` / `--allowed-host` options.

## Version compatibility and troubleshooting

The plugin API and event payload assumptions are targeted at OpenCode 2.2.6.
Before upgrading OpenCode, check its published plugin/client declarations and
revalidate event subscription, session lifecycle, tool, permission, and usage
events. The plugin is project-local, so ensure OpenCode is started with this
project directory rather than an unrelated working directory.

If no character appears:

1. Confirm the Pixel Agents server is running and its tokenized browser URL
   loads.
2. Confirm OpenCode reports version 2.2.6 and was started in the project root.
3. Create a **new** OpenCode session after startup; historical sessions are not
   automatically backfilled by the plugin.
4. Check that `~/.pixel-agents/servers/` contains a current server registry
   entry and that local loopback traffic is not blocked.
5. Inspect OpenCode and Pixel Agents logs without sharing tokens, prompts, or
   other sensitive session data.

The authenticated event endpoint is covered by server-level tests, but a full
real-session OpenCode 2.2.6 end-to-end scenario is currently a manual validation
step. There is currently no browser end-to-end suite; see
[contributing guidance](../CONTRIBUTING.md).
