const avatarIdByAgentId = new Map<string, number>();
const agentIdByAvatarId = new Map<number, string>();
let nextGlobalAvatarId = 1_900_000_000;

/** Stable office-only numeric identity, separate from OpenCode session IDs. */
export function globalAgentAvatarId(agentId: string): number {
  const current = avatarIdByAgentId.get(agentId);
  if (current !== undefined) return current;
  const avatarId = nextGlobalAvatarId--;
  avatarIdByAgentId.set(agentId, avatarId);
  agentIdByAvatarId.set(avatarId, agentId);
  return avatarId;
}

export function isGlobalAgentAvatar(id: number): boolean {
  return agentIdByAvatarId.has(id);
}
