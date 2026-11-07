# Pixel Agents — current product vocabulary

This glossary describes the current OpenCode-focused product. Pixel Agents turns observable OpenCode sessions into animated characters in a pixel-art browser office. OpenCode owns session creation and execution; Pixel Agents observes and visualizes them.

## Product and runtime

**Office**: The browser-based simulated world, including its layout, characters, pets, and live state.

**Browser office**: The web application served by Pixel Agents. A tokened connection can view and modify office state; an unauthenticated or non-privileged viewer is read-only.

**Server**: The local Pixel Agents process that serves the office, maintains its state, and broadcasts updates. It binds to loopback by default.

**OpenCode plugin**: The project-local plugin at `.opencode/plugins/pixel-agents/`. OpenCode 2.2.6 auto-discovers it when started from the project. It forwards observed session/permission events; it does not launch sessions or install hooks.

**Event bridge**: The authenticated local path by which the OpenCode plugin forwards event type and payload to the Pixel Agents server.

**Protocol**: The client/server message contract defined in `core/asyncapi.yaml`; generated TypeScript models live in `core/src/messages.ts`.

## Sessions and characters

**Session**: An OpenCode conversation/run. OpenCode owns its lifecycle.

**Agent**: Pixel Agents' tracked representation of an OpenCode session. An agent is office state, not an executable process or terminal.

**Character**: The animated pixel-art figure representing an agent in the office. The character has a position and animation state; the agent has session identity and activity state.

**Select**: Mark a character as the current subject in the office, typically shown with a selection outline.

**Follow**: Camera tracking of a selected character. Manual panning or deselection ends following.

## Activity and status

**Active**: A session is executing or performing a reported tool action.

**Done / waiting**: The latest turn has completed or the session is idle. Exact UI status depends on which OpenCode lifecycle events are available.

**Permission request**: An OpenCode permission event that indicates the session is blocked pending a decision. Pixel Agents displays it; the decision is made in OpenCode.

**Activity label**: Human-readable text describing the agent's latest reported tool activity.

**Context gauge**: A visual estimate based on context/token usage reported in OpenCode events. It is informational and may be unavailable until a session reports usage.

## Office layout

**Layout**: The office's spatial arrangement: tile grid, floors, walls, areas, carpets, and furniture. It can be edited and persisted independently of session execution.

**Area**: A named region of tiles in the office layout.

**Furniture**: Placeable layout items such as desks, chairs, storage, electronics, and decor.

**Seat**: A position derived from chair furniture and assignable to a character.

**Pet**: A decorative animated creature in the office that is not associated with a session.

## Persistence and security

Pixel Agents stores configuration, layout, and server discovery data under `~/.pixel-agents/`. The OpenCode plugin reads server discovery records to find the local endpoint. The bearer token is a capability: keep tokenized URLs private. Remote access should only be configured with an explicit understanding of host validation, proxying, and allowed-host settings.

## Historical terminology

Older releases and preserved research may mention VS Code, Claude Code, hooks, transcripts, terminals, adapters, providers, launch/adopt flows, teams, and consent. These describe prior implementations or research, not current product capabilities. Do not use them as setup instructions for the OpenCode integration.
