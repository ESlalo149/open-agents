# Pixel Agents

Pixel Agents is a pixel-art browser office that visualizes coding sessions from
[OpenCode](https://opencode.ai/). OpenCode creates and runs sessions; Pixel
Agents observes supported events and represents sessions as animated
characters. It does not launch sessions or provide a terminal.

![Pixel Agents office](webview-ui/public/office.png)

## Features

- See OpenCode sessions and their reported tool activity in a customizable
  pixel-art office.
- Visualize waiting, permission requests, and context usage when OpenCode emits
  the corresponding events.
- Customize the office layout, furniture, areas, pets, and external assets.
- Open the browser office from another device with deliberate network and host
  configuration.

## Requirements

- Node.js 20 or later
- OpenCode 2.2.6 for the project-local event integration

## Run from this checkout

In a terminal at the repository root:

```bash
npm install
npm run package
node dist/cli.js
```

Open the tokenized URL printed by the server. It grants access to office
controls, so keep it private. The server binds to `127.0.0.1` by default.

In a second terminal, start OpenCode **with this repository as its working
directory** and create a new session. OpenCode 2.2.6 auto-discovers the plugin
under `.opencode/plugins/pixel-agents/`; the root `opencode.jsonc` does not need
an explicit plugin entry. The new session should appear in the open browser
office. Existing sessions are not backfilled automatically.

## npm package

The `pixel-agents` npm CLI starts the browser office server:

```bash
npx pixel-agents
```

The OpenCode plugin is currently included in this source checkout, **not** in
the npm package. To observe sessions with the npm CLI, the plugin must also be
installed in the OpenCode project's `.opencode/plugins/` directory. See the
[integration guide](docs/opencode-integration.md) for the current setup and
limitations.

## Security and data

Settings, layout, and server discovery records are stored under
`~/.pixel-agents/`. The plugin reads the local server registry and forwards
events to an authenticated loopback endpoint; it does not install hooks or
change OpenCode configuration. Treat the browser token and session activity as
sensitive. Do not expose the server to a network unless you understand the
`--host` and `--allowed-host` options. See [SECURITY.md](SECURITY.md).

## Development

```bash
npm install
npm run package
npm test
npm run check-types
npm run lint
npm run asyncapi:validate
```

The AsyncAPI contract in `core/asyncapi.yaml` defines browser/server messages;
regenerate its TypeScript types with `npm run asyncapi:generate`. Unit tests
cover the server's OpenCode event mapping. A full real-session OpenCode 2.2.6
smoke test remains manual, as described in the integration guide.

Use the commands above to build and validate changes. This checkout uses the MIT
license; see [LICENSE](LICENSE).
