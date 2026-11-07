# Pixel Agents

Pixel Agents is a pixel-art office in your browser that visualizes coding sessions running in **OpenCode 2.2.6**. Characters represent sessions and animate as OpenCode reports activity. OpenCode remains responsible for creating and running sessions; Pixel Agents observes them.

![Pixel Agents office](webview-ui/public/office.png)

## What it does

- Shows OpenCode sessions as characters in a customizable office.
- Visualizes tool activity, waiting state, permission requests, and context usage when those events are available.
- Lets you customize the layout, place furniture and pets, define areas, and load external assets.
- Serves the office as a browser app that can also be opened from another device when configured safely.

Pixel Agents does **not** launch OpenCode sessions or embed a terminal. Create and control sessions in OpenCode.

## Requirements

- Node.js 20 or later
- OpenCode **2.2.6** (the plugin event bridge targets this version)

## Run from this checkout

Build and start the office server:

```bash
npm install
npm run package
npx pixel-agents
```

The CLI prints a browser URL containing an access token. Open that URL to access the full office controls. Keep it private: the token grants permission to modify the office state. An untokened same-origin visitor may view the office read-only.

Start OpenCode with this repository as its working directory. OpenCode discovers the local plugin in `.opencode/plugins/pixel-agents/` automatically. Create a new session; Pixel Agents should show it in the browser office. OpenCode and Pixel Agents run as separate processes.

For a development build, use `npm run package` followed by `node dist/cli.js` instead of `npx pixel-agents`.

See [OpenCode integration and troubleshooting](docs/opencode-integration.md) for details.

## Configuration and data

Pixel Agents stores its settings, layout, and server registry in `~/.pixel-agents/`. The OpenCode plugin reads the server registry and sends events to the local authenticated event endpoint. It does not install hooks or modify OpenCode settings.

By default the server binds to `127.0.0.1`. Only expose it beyond the local machine if you understand the security implications; use the tokenized URL and an explicit allowed host when working through a trusted proxy. See [SECURITY.md](SECURITY.md).

## Development

```bash
npm install
npm run package
npm test
npm run check-types
npm run lint
npm run asyncapi:validate
```

The AsyncAPI contract lives in `core/asyncapi.yaml`; regenerate its TypeScript types with `npm run asyncapi:generate`. The server tests include an OpenCode event bridge suite. A full real-session end-to-end run against OpenCode 2.2.6 is still a manual validation step.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project structure and contribution workflow. Release history from the original project may be available in the upstream repository; it is not included in this checkout.

## License

MIT. See [LICENSE](LICENSE).
