/** OpenCode-backed agent lifecycle and activity bridge. */
import { createAgentState } from './agentState.js';
import type { AgentStateStore } from './agentStateStore.js';
import { DEFAULT_MAX_CONTEXT_TOKENS } from './constants.js';
import { assignPaletteIfNeeded } from './paletteAssigner.js';

export class AgentRuntime {
  constructor(private readonly store: AgentStateStore) {}

  handleOpenCodeEvent(envelope: Record<string, unknown>): void {
    if (envelope.source !== 'opencode' || typeof envelope.type !== 'string') return;
    const data = asRecord(envelope.data);
    const sessionId = stringValue(data?.sessionID);
    if (!data || !sessionId) return;

    let agent = [...this.store.values()].find((item) => item.sessionId === sessionId);
    const location = asRecord(envelope.location);
    const directory =
      stringValue(envelope.projectDirectory) ??
      stringValue(asRecord(data.location)?.directory) ??
      stringValue(location?.directory) ??
      process.cwd();
    if (!agent && isSessionLifecycleEvent(envelope.type)) {
      const parentSessionId = stringValue(data.parentID);
      const parent = parentSessionId
        ? [...this.store.values()].find((item) => item.sessionId === parentSessionId)
        : undefined;
      const id = this.store.nextAgentId.current++;
      agent = createAgentState({
        id,
        sessionId,
        isExternal: true,
        projectDir: directory,
        agentName: stringValue(data.title) ?? stringValue(data.slug),
        leadAgentId: parent?.id,
        jsonlFile: '',
      });
      agent.providerId = 'opencode';
      agent.maxContextTokens = DEFAULT_MAX_CONTEXT_TOKENS;
      assignPaletteIfNeeded(agent, this.store);
      if (parent) {
        parent.isTeamLead = true;
        this.store.broadcast({ type: 'agentTeamInfo', id: parent.id, isTeamLead: true });
      }
      this.store.set(id, agent);
      this.store.persist();
    }
    if (!agent) return;

    const type = envelope.type;
    if (type === 'session.execution.started' || type === 'session.step.started') {
      agent.isWaiting = false;
      agent.permissionSent = false;
      this.store.broadcast({ type: 'agentStatus', id: agent.id, status: 'active' });
    } else if (type === 'session.tool.input.started') {
      const toolId = stringValue(data.id);
      if (!toolId) return;
      const tool = stringValue(data.name) ?? 'Tool';
      const input = {};
      const status = formatToolStatus(tool, input);
      const alreadyActive = agent.activeToolIds.has(toolId);
      agent.activeToolIds.add(toolId);
      if (tool !== 'Tool') agent.activeToolNames.set(toolId, tool);
      if (Object.keys(input).length || !agent.activeToolStatuses.has(toolId)) {
        agent.activeToolStatuses.set(toolId, status);
      }
      agent.hadToolsInTurn = true;
      agent.isWaiting = false;
      if (!alreadyActive) {
        this.store.broadcast({
          type: 'agentToolStart',
          id: agent.id,
          toolId,
          toolName: tool,
          status,
        });
      }
      this.store.broadcast({ type: 'agentStatus', id: agent.id, status: 'active' });
    } else if (type === 'session.tool.called') {
      const toolId = stringValue(data.id);
      if (!toolId) return;
      const input = asRecord(data.input) ?? {};
      const tool = agent.activeToolNames.get(toolId) ?? 'Tool';
      const status = formatToolStatus(tool, input);
      agent.activeToolStatuses.set(toolId, status);
      this.store.broadcast({
        type: 'agentToolStart',
        id: agent.id,
        toolId,
        toolName: tool,
        status,
      });
    } else if (type === 'session.tool.progress') {
      const toolId = stringValue(data.id);
      if (toolId) {
        const toolData = asRecord(data.metadata);
        const status = formatToolStatus(
          agent.activeToolNames.get(toolId) ?? 'Tool',
          toolData ?? {},
        );
        agent.activeToolStatuses.set(toolId, status);
        this.store.broadcast({ type: 'agentToolStart', id: agent.id, toolId, status });
      }
    } else if (type === 'session.tool.success' || type === 'session.tool.failed') {
      const toolId = stringValue(data.id);
      if (!toolId) return;
      agent.activeToolIds.delete(toolId);
      agent.activeToolNames.delete(toolId);
      agent.activeToolStatuses.delete(toolId);
      this.store.broadcast({ type: 'agentToolDone', id: agent.id, toolId });
    } else if (type === 'permission.asked') {
      agent.permissionSent = true;
      this.store.broadcast({ type: 'agentToolPermission', id: agent.id });
    } else if (type === 'permission.replied') {
      agent.permissionSent = false;
      this.store.broadcast({ type: 'agentToolPermissionClear', id: agent.id });
    } else if (type === 'session.step.ended' || type === 'session.step.failed') {
      const usage = asRecord(data.tokens);
      if (usage) {
        const contextTokens =
          numberValue(usage.input) +
          numberValue(usage.output) +
          numberValue(asRecord(usage.cache)?.read) +
          numberValue(asRecord(usage.cache)?.write);
        if (contextTokens > 0) {
          agent.contextTokens = contextTokens;
          this.store.broadcast({
            type: 'agentContextUsage',
            id: agent.id,
            contextTokens,
            maxContextTokens: agent.maxContextTokens,
          });
        }
      }
    } else if (type === 'session.status') {
      const status = asRecord(data.status);
      if (status?.type === 'idle') {
        agent.isWaiting = true;
        this.store.broadcast({ type: 'agentStatus', id: agent.id, status: 'waiting' });
      }
    } else if (
      type === 'session.execution.succeeded' ||
      type === 'session.execution.failed' ||
      type === 'session.execution.interrupted' ||
      type === 'session.idle'
    ) {
      for (const toolId of agent.activeToolIds) {
        this.store.broadcast({ type: 'agentToolDone', id: agent.id, toolId });
      }
      agent.activeToolIds.clear();
      agent.activeToolNames.clear();
      agent.activeToolStatuses.clear();
      agent.isWaiting = true;
      agent.permissionSent = false;
      this.store.broadcast({ type: 'agentToolsClear', id: agent.id });
      this.store.broadcast({ type: 'agentStatus', id: agent.id, status: 'waiting' });
    } else if (type === 'session.deleted' || type === 'session.archived') {
      this.removeAgent(agent.id);
    }
  }

  removeAgent(id: number): void {
    const agent = this.store.get(id);
    if (!agent) return;
    if (agent.isTeamLead) {
      for (const [childId, child] of this.store.entries()) {
        if (child.leadAgentId === id) this.removeAgent(childId);
      }
    }
    this.store.delete(id);
    this.store.persist();

    if (agent.leadAgentId !== undefined) {
      const parent = this.store.get(agent.leadAgentId);
      const hasChildren = [...this.store.values()].some(
        (candidate) => candidate.leadAgentId === agent.leadAgentId,
      );
      if (parent && !hasChildren && parent.isTeamLead) {
        parent.isTeamLead = false;
        this.store.broadcast({ type: 'agentTeamInfo', id: parent.id, isTeamLead: false });
      }
    }
  }

  dispose(): void {}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isSessionLifecycleEvent(type: string): boolean {
  return (
    type === 'session.created' ||
    type === 'session.execution.started' ||
    type === 'session.execution.succeeded' ||
    type === 'session.execution.failed' ||
    type === 'session.execution.interrupted' ||
    type === 'session.step.started' ||
    type === 'session.step.ended' ||
    type === 'session.step.failed' ||
    type === 'session.tool.called' ||
    type === 'session.tool.input.started' ||
    type === 'session.tool.progress' ||
    type === 'session.tool.success' ||
    type === 'session.tool.failed' ||
    type === 'session.idle' ||
    type === 'session.status'
  );
}

function formatToolStatus(tool: string, input: Record<string, unknown>): string {
  const file = input.filePath ?? input.file_path ?? input.path;
  const base = typeof file === 'string' ? (file.split(/[\\/]/).pop() ?? '') : '';
  const command = input.command;
  if (tool === 'read') return base ? `Reading ${base}` : 'Reading files';
  if (tool === 'edit') return base ? `Editing ${base}` : 'Editing files';
  if (tool === 'write') return base ? `Writing ${base}` : 'Writing files';
  if ((tool === 'bash' || tool === 'shell') && typeof command === 'string') {
    return `Running: ${command.slice(0, 30)}${command.length > 30 ? '…' : ''}`;
  }
  return `Using ${tool}`;
}
