export interface AgentState {
  id: number;
  sessionId: string;
  /** Whether this agent was detected from OpenCode's event stream. */
  isExternal: boolean;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  backgroundAgentToolIds: Set<string>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Directory name — the agent's origin label (only set for multi-root workspaces) */
  directoryName?: string;
  /** Timestamp of last JSONL data received (ms since epoch) */
  lastDataAt: number;
  /** Total JSONL lines processed for this agent */
  linesProcessed: number;
  /** Set of record.type values we've already warned about (prevents log spam) */
  seenUnknownRecordTypes: Set<string>;
  /** Event integration that owns this session. */
  providerId?: string;

  // -- Context window usage (server/src/contextUsage.ts) --
  /** Tokens in the agent's context as of its newest turn; 0 until one is seen.
   *  A snapshot, not a running total -- it falls on compaction and /clear. */
  contextTokens: number;
  /** Observational estimate of the window `contextTokens` fits in. Widens as
   *  larger contexts appear, never shrinks. */
  maxContextTokens: number;
  /** True once this transcript produced a main-chain turn, after which
   *  sidechain records belong to sub-agents and stop moving the gauge. */
  sawMainChainUsage?: boolean;

  // -- OpenCode sub-sessions --
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  /** Parent session id for OpenCode child sessions. */
  parentSessionId?: string;

  // -- Avatar customization --
  /** Preferred character palette (0-5). If undefined, auto-assigned for diversity. */
  palette?: number;
  /** Hue shift in degrees (0-360). Rotates the base palette colors. */
  hueShift?: number;
}

export interface PersistedAgent {
  id: number;
  sessionId?: string;
  /** Historical terminal name, retained when loading older state files. */
  terminalName: string;
  /** Whether this agent was detected from an external source */
  isExternal?: boolean;
  jsonlFile: string;
  projectDir: string;
  /** Directory name — the agent's origin label (only set for multi-root workspaces) */
  directoryName?: string;
  /** Pre-Directory spelling of `directoryName`, written by releases up to
   *  v1.4.x. Read as a fallback on restore so an upgrade doesn't strip the
   *  label (and the Area-mapping key) off every agent from the previous
   *  session; never written — the next persist rewrites it as directoryName. */
  folderName?: string;

  // -- OpenCode sub-sessions --
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  /** Live background-spawn tool ids on a lead. Persisted so the spawns'
   *  transcripts are re-adopted after a reload; the spawned children
   *  themselves are derived state and never persisted. */
  backgroundAgentToolIds?: string[];
  /** Preferred character palette (0-5). Persisted so colors stay stable
   *  across server restarts; assignPaletteIfNeeded is a no-op on restore. */
  palette?: number;
  /** Hue shift in degrees (0-360). Persisted alongside palette. */
  hueShift?: number;
}
