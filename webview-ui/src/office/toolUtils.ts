/** Map status prefixes back to tool names for animation selection */
const STATUS_TO_TOOL: Record<string, string> = {
  Reading: 'Read',
  Searching: 'Grep',
  Globbing: 'Glob',
  Fetching: 'WebFetch',
  'Searching web': 'WebSearch',
  Writing: 'Write',
  Editing: 'Edit',
  Running: 'Bash',
  Task: 'Task',
};

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

// ── Provider capabilities (tool taxonomy for rendering decisions) ────────────
// Populated once by the `providerCapabilities` postMessage after `webviewReady`.
// Modules classifying tools (character animation, subagent creation gate) read
// from here instead of hardcoding Claude-specific tool names.

const READING_TOOLS = new Set(['read', 'glob', 'grep', 'webfetch', 'websearch']);
const SUBAGENT_TOOLS = new Set(['task', 'subtask', 'agent', 'work']);

export function isReadingToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && READING_TOOLS.has(name.toLowerCase());
}

export function isSubagentToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && SUBAGENT_TOOLS.has(name.toLowerCase());
}
