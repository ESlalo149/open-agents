# Security Policy

## Supported Versions

| Version               | Supported          |
| --------------------- | ------------------ |
| Current `1.x` release | :white_check_mark: |

## Reporting a Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for the repository where this project is hosted. **Do not open a public issue for a security vulnerability.**

The maintainer will acknowledge reports as promptly as practical and coordinate remediation. If private vulnerability reporting is unavailable, contact the repository maintainer privately.

## Security boundaries

Pixel Agents runs a local web server and receives OpenCode session events through a project-local plugin. The office can expose session metadata and activity, so treat it as sensitive even though it does not receive or display a terminal stream.

Security issues in scope include:

- Unauthorized access to or modification of office state through HTTP/WebSocket endpoints.
- Authentication, bearer-token handling, host validation, or DNS-rebinding bypasses.
- Exposure of session identifiers, project paths, prompts, tool inputs, or other sensitive event data.
- Cross-site scripting or unsafe rendering in the browser office.
- Arbitrary file access or writes through layout, asset, import, or persistence features.
- Unsafe handling of events forwarded by the OpenCode plugin.

## Operator guidance

- The server binds to `127.0.0.1` by default. Do not bind it to a network interface unless you understand the consequences.
- Treat the tokenized browser URL and server registry token as secrets. Do not paste them into issues, screenshots, logs, or shared shell history.
- Remote access requires deliberate host/proxy configuration. Use an explicit `--allowed-host` for a trusted reverse proxy and avoid exposing the bearer token to untrusted networks.
- The OpenCode plugin forwards events to loopback and authenticates with the local server token. It does not install hooks or modify OpenCode settings.
- Do not include real prompts, private source code, credentials, or tokens in synthetic integration tests.
