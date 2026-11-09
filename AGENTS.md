# Project instructions

This repository is being adapted to work with OpenCode 2.2.6. Keep the existing
Pixel Agents architecture and add OpenCode support as a provider/integration;
do not replace unrelated Claude Code support unless explicitly requested.

Before changing OpenCode integration behavior, verify compatibility against
OpenCode 2.2.6 rather than assuming APIs from other versions. Keep all project
files inside this repository.

## Team authority and delegation

- The user is the owner. The assistant in the user's planning conversation acts
  as their personal assistant: plan with the user, get approval, and pass the
  approved task to the General Manager.
- General Manager (`representante`) is the team's manager and the only agent who
  delegates work to Quality Assurance, Architect, or Developer by default.
- Do not assign work directly to those specialist agents unless the user
  explicitly asks for a direct assignment.
- Use the existing team profiles and conversations. Do not create separate
  agent sessions or office characters to simulate activity. For team activity,
  ask the General Manager to delegate from its existing team session.
- Preserve existing agent IDs and conversations when changing names or team
  behavior.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **pixel-agents** (3954 symbols, 8019 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource                                      | Use for                                  |
| --------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/pixel-agents/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/pixel-agents/clusters`       | All functional areas                     |
| `gitnexus://repo/pixel-agents/processes`      | All execution flows                      |
| `gitnexus://repo/pixel-agents/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
