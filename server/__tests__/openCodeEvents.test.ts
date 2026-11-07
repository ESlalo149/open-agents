import { afterEach, describe, expect, it } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';

describe('OpenCode event bridge', () => {
  const runtimes: AgentRuntime[] = [];
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose();
  });

  it('creates an OpenCode session agent and tracks tool/status lifecycle', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store);
    runtimes.push(runtime);
    const messages: Record<string, unknown>[] = [];
    store.on('broadcast', (message) => messages.push(message));

    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.created',
      projectDirectory: '/workspace/demo',
      data: { sessionID: 'oc-session-1' },
    });
    expect(store.size).toBe(1);
    const agent = [...store.values()][0]!;
    expect(agent.providerId).toBe('opencode');
    expect(agent.projectDir).toBe('/workspace/demo');

    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.tool.input.started',
      data: {
        sessionID: 'oc-session-1',
        id: 'call-1',
        name: 'read',
      },
    });
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'agentToolStart', id: agent.id, toolId: 'call-1' }),
    );

    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.execution.succeeded',
      data: { sessionID: 'oc-session-1' },
    });
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'agentStatus', id: agent.id, status: 'waiting' }),
    );
    expect(agent.activeToolIds.size).toBe(0);
  });

  it('ignores malformed or foreign events', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store);
    runtimes.push(runtime);
    runtime.handleOpenCodeEvent({ source: 'other', type: 'session.created', data: {} });
    runtime.handleOpenCodeEvent({ source: 'opencode', type: 'session.created', data: {} });
    expect(store.size).toBe(0);
  });

  it('accepts the 2.2.6 session.created payload shape', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store);
    runtimes.push(runtime);
    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.created',
      data: { sessionID: 'oc-session-2', location: { directory: '/workspace/real' } },
      projectDirectory: '/workspace/real',
    });
    expect(store.size).toBe(1);
  });

  it('links a child session to its parent and marks the parent as team lead', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store);
    runtimes.push(runtime);
    const messages: Record<string, unknown>[] = [];
    store.on('broadcast', (message) => messages.push(message));

    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.created',
      data: { sessionID: 'oc-parent' },
    });
    const parent = [...store.values()][0]!;

    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.created',
      data: { sessionID: 'oc-child', parentID: 'oc-parent', title: 'Reviewer' },
    });
    const child = [...store.values()].find((agent) => agent.sessionId === 'oc-child')!;

    expect(child.leadAgentId).toBe(parent.id);
    expect(child.agentName).toBe('Reviewer');
    expect(parent.isTeamLead).toBe(true);
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'agentTeamInfo', id: parent.id, isTeamLead: true }),
    );
  });

  it('removes children with a deleted parent and unmarks a parent after its last child', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store);
    runtimes.push(runtime);
    const messages: Record<string, unknown>[] = [];
    store.on('broadcast', (message) => messages.push(message));

    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.created',
      data: { sessionID: 'oc-parent-cleanup' },
    });
    const parent = [...store.values()][0]!;
    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.created',
      data: { sessionID: 'oc-child-cleanup', parentID: 'oc-parent-cleanup' },
    });
    const child = [...store.values()].find((agent) => agent.sessionId === 'oc-child-cleanup')!;

    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.deleted',
      data: { sessionID: 'oc-child-cleanup' },
    });
    expect(store.get(parent.id)?.isTeamLead).toBe(false);
    expect(store.get(child.id)).toBeUndefined();
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'agentTeamInfo', id: parent.id, isTeamLead: false }),
    );

    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.created',
      data: { sessionID: 'oc-child-cleanup-2', parentID: 'oc-parent-cleanup' },
    });
    const secondChild = [...store.values()].find(
      (agent) => agent.sessionId === 'oc-child-cleanup-2',
    )!;
    runtime.handleOpenCodeEvent({
      source: 'opencode',
      type: 'session.archived',
      data: { sessionID: 'oc-parent-cleanup' },
    });

    expect(store.size).toBe(0);
    expect(store.get(secondChild.id)).toBeUndefined();
  });
});
