# GitNexus

GitNexus is installed globally and registered as a global OpenCode MCP server.
It builds a local code knowledge graph and exposes it through MCP tools.

## Installation and compatibility

- Package: [`gitnexus`](https://www.npmjs.com/package/gitnexus) (currently 1.6.12).
- Upstream: <https://github.com/abhigyanpatwari/GitNexus>.
- Requires Node.js 22.18+ (22.x) or 24.11+ (24.x); current setup uses Node 24.22.2.
- MCP config is user-global at `%USERPROFILE%\.config\opencode\opencode.json`.
- The upstream `gitnexus setup -c opencode` also installs skills globally. Its
  optional OpenCode search-enrichment plugin targets the OpenCode v1 plugin API
  and is not compatible with OpenCode 2.x, so do not install that plugin here.
  The MCP server itself is configured independently and works without it.

## Index this repository

From the repository root, run:

```powershell
gitnexus analyze --index-only
gitnexus status
```

`--index-only` avoids writing GitNexus instruction/skill integration files into
this repository. The graph database is local and should not be committed. Run
`gitnexus analyze --index-only` again after meaningful code changes to refresh
the graph. `gitnexus list` shows all indexed repositories for this user.

## OpenCode MCP tools

The MCP server starts locally over stdio and reads the indexes registered by
GitNexus. OpenCode exposes the upstream tools, including `query`, `context`,
`impact`, `trace`, `detect_changes`, `check`, and `rename`. Review a `rename`
preview before requesting an applied rename. MCP registration is global, so it
is available in all OpenCode projects for this Windows user.

Verify the connection with:

```powershell
opencode mcp list
```

## Windows runtime note

`gitnexus doctor` currently reports that the graph store and local embeddings
load, but the LadybugDB full-text extension cannot load due to a missing native
runtime DLL (Windows error 126); vector search is also unavailable until its
extension is installed. Search therefore falls back to exact scan. The doctor
output recommends installing the Microsoft Visual C++ 2015–2022 Redistributable
(x64) and, if needed, making Git for Windows' `mingw64\bin` OpenSSL DLLs
available on `PATH`. Re-run `gitnexus doctor` after fixing the runtime. This
does not prevent installing or connecting the MCP server.

## License

The upstream repository is licensed under PolyForm Noncommercial 1.0.0.
Check the license and obtain a separate commercial license before using the OSS
package for commercial purposes.

## Official references

- [GitNexus README](https://github.com/abhigyanpatwari/GitNexus)
- [GitNexus editor setup](https://github.com/abhigyanpatwari/GitNexus/blob/main/docs/editor-setup.md)
- [GitNexus MCP reference](https://github.com/abhigyanpatwari/GitNexus/blob/main/docs/mcp-reference.md)
- [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers)
