import type { GlobalAgentProfile } from './opencodeAgentProfiles.js';
import type { OpenCodeAgent } from './openCodeServiceClient.js';

export interface GlobalAgentRosterEntry {
  id: string;
  name: string;
  description: string;
  mode: string;
  profile: GlobalAgentProfile;
  available: boolean;
}

/** Permanent roster: only user-managed global profiles become office members. */
export function buildGlobalAgentRoster(
  profiles: GlobalAgentProfile[],
  openCodeAgents: OpenCodeAgent[],
): GlobalAgentRosterEntry[] {
  const availableById = new Map(
    openCodeAgents.filter((agent) => !agent.hidden).map((agent) => [agent.id, agent]),
  );

  return profiles.map((profile) => {
    const agent = availableById.get(profile.id);
    return {
      id: profile.id,
      name: displayName(profile.id, agent?.name),
      description: profile.description || agent?.description || '',
      mode: profile.mode || agent?.mode || 'subagent',
      profile,
      available: Boolean(agent),
    };
  });
}

function displayName(id: string, configuredName?: string): string {
  if (id.toLowerCase() === 'qa') return 'Quality Assurance';
  if (id.toLowerCase() === 'representante') return 'General Manager';
  if (configuredName && configuredName.toLowerCase() !== id.toLowerCase()) return configuredName;
  return id
    .split(/[\/_-]+/)
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : ''))
    .join(' ');
}
