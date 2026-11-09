import { describe, expect, it } from 'vitest';

import {
  clearLegacyGlobalAgentSessions,
  globalAgentSessionKey,
  readGlobalAgentSession,
  removeGlobalAgentSession,
  saveGlobalAgentSession,
  type SessionStorageLike,
} from '../src/components/globalAgentConversationStore.js';

function memoryStorage(): SessionStorageLike {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe('global agent conversation storage', () => {
  it('stores separate OpenCode sessions for each agent and project', () => {
    const storage = memoryStorage();
    saveGlobalAgentSession(storage, 'qa', 'C:\\work\\one', 'ses_qa_one');
    saveGlobalAgentSession(storage, 'developer', 'C:\\work\\one', 'ses_dev_one');
    saveGlobalAgentSession(storage, 'qa', 'C:\\work\\two', 'ses_qa_two');

    expect(readGlobalAgentSession(storage, 'qa', 'C:\\work\\one')).toBe('ses_qa_one');
    expect(readGlobalAgentSession(storage, 'developer', 'C:\\work\\one')).toBe('ses_dev_one');
    expect(readGlobalAgentSession(storage, 'qa', 'C:\\work\\two')).toBe('ses_qa_two');
    expect(readGlobalAgentSession(storage, 'architect', 'C:\\work\\one')).toBe('');
  });

  it('encodes IDs and paths so delimiters cannot collide', () => {
    expect(globalAgentSessionKey('agent:one', 'C:\\work:one')).not.toBe(
      globalAgentSessionKey('agent', 'one:C:\\work:one'),
    );
  });

  it('removes the saved link after its OpenCode session was deleted', () => {
    const storage = memoryStorage();
    saveGlobalAgentSession(storage, 'qa', 'C:\\work\\one', 'ses_qa_one');

    removeGlobalAgentSession(storage, 'qa', 'C:\\work\\one');

    expect(readGlobalAgentSession(storage, 'qa', 'C:\\work\\one')).toBe('');
  });

  it('clears obsolete saved session links without clearing current ones', () => {
    const storage = memoryStorage();
    storage.setItem('pixel-agents:global-agent-session:v1:qa:project', 'ses_deleted');
    saveGlobalAgentSession(storage, 'developer', 'C:\\work\\one', 'ses_keep');

    clearLegacyGlobalAgentSessions(storage);

    expect(storage.getItem('pixel-agents:global-agent-session:v1:qa:project')).toBeNull();
    expect(readGlobalAgentSession(storage, 'developer', 'C:\\work\\one')).toBe('ses_keep');
  });

  it('fails safely when browser storage is unavailable', () => {
    const unavailable: SessionStorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readGlobalAgentSession(unavailable, 'qa', 'C:\\work\\one')).toBe('');
    expect(() =>
      saveGlobalAgentSession(unavailable, 'qa', 'C:\\work\\one', 'ses_test'),
    ).not.toThrow();
    expect(() => removeGlobalAgentSession(unavailable, 'qa', 'C:\\work\\one')).not.toThrow();
  });
});
