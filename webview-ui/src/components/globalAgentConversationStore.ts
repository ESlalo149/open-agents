const STORAGE_PREFIX = 'pixel-agents:global-agent-session:v2:';
const LEGACY_STORAGE_PREFIX = 'pixel-agents:global-agent-session:v1:';

export interface SessionStorageLike {
  readonly length?: number;
  key?(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function globalAgentSessionKey(agentId: string, directory: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(agentId)}:${encodeURIComponent(directory)}`;
}

export function readGlobalAgentSession(
  storage: SessionStorageLike,
  agentId: string,
  directory: string,
): string {
  try {
    return storage.getItem(globalAgentSessionKey(agentId, directory)) ?? '';
  } catch {
    return '';
  }
}

export function saveGlobalAgentSession(
  storage: SessionStorageLike,
  agentId: string,
  directory: string,
  sessionId: string,
): void {
  try {
    storage.setItem(globalAgentSessionKey(agentId, directory), sessionId);
  } catch {
    // The chat remains usable when browser storage is disabled or full.
  }
}

export function removeGlobalAgentSession(
  storage: SessionStorageLike,
  agentId: string,
  directory: string,
): void {
  try {
    storage.removeItem(globalAgentSessionKey(agentId, directory));
  } catch {
    // Ignore storage errors; restoring history is best-effort.
  }
}

export function clearLegacyGlobalAgentSessions(storage: SessionStorageLike): void {
  try {
    const keys = Array.from({ length: getStorageLength(storage) }, (_, index) =>
      getStorageKey(storage, index),
    ).filter((key): key is string => key?.startsWith(LEGACY_STORAGE_PREFIX) ?? false);
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Ignore unavailable browser storage.
  }
}

function getStorageLength(storage: SessionStorageLike): number {
  return typeof storage.length === 'number' ? storage.length : 0;
}

function getStorageKey(storage: SessionStorageLike, index: number): string | null {
  return typeof storage.key === 'function' ? storage.key(index) : null;
}
