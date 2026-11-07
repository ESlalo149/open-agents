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
});
