import { describe, expect, it } from 'vitest';

import { buildGlobalAgentRoster } from '../src/globalAgentRoster.js';
import type { GlobalAgentProfile } from '../src/opencodeAgentProfiles.js';
import type { OpenCodeAgent } from '../src/openCodeServiceClient.js';

function profile(id: string, description = ''): GlobalAgentProfile {
  return {
    id,
    description,
    mode: 'subagent',
    prompt: `Prompt for ${id}`,
    model: null,
    editable: true,
  };
}

describe('buildGlobalAgentRoster', () => {
  it('shows user profiles only and hides OpenCode built-ins', () => {
    const profiles = [
      profile('qa'),
      profile('architect'),
      profile('developer'),
      profile('representante'),
    ];
    const openCodeAgents: OpenCodeAgent[] = [
      { id: 'build', name: 'Build', mode: 'primary' },
      { id: 'plan', name: 'Plan', mode: 'primary' },
      { id: 'qa', name: 'qa', mode: 'subagent' },
      { id: 'architect', name: 'architect', mode: 'subagent' },
      { id: 'developer', name: 'developer', mode: 'subagent' },
      { id: 'representante', name: 'representante', mode: 'subagent' },
    ];

    const roster = buildGlobalAgentRoster(profiles, openCodeAgents);

    expect(roster.map((agent) => agent.id)).toEqual([
      'qa',
      'architect',
      'developer',
      'representante',
    ]);
    expect(roster.map((agent) => agent.name)).toEqual([
      'Quality Assurance',
      'Architect',
      'Developer',
      'General Manager',
    ]);
    expect(roster.every((agent) => agent.available)).toBe(true);
    expect(roster.some((agent) => agent.id === 'build' || agent.id === 'plan')).toBe(false);
  });

  it('keeps global profiles visible but unavailable while OpenCode is offline', () => {
    const roster = buildGlobalAgentRoster([profile('representante')], []);

    expect(roster).toEqual([
      {
        id: 'representante',
        name: 'General Manager',
        description: '',
        mode: 'subagent',
        profile: profile('representante'),
        available: false,
      },
    ]);
  });

  it('uses descriptive display names while preserving internal agent IDs', () => {
    const roster = buildGlobalAgentRoster([profile('qa')], [{ id: 'qa', name: 'qa' }]);

    expect(roster[0]).toMatchObject({ id: 'qa', name: 'Quality Assurance' });
  });
});
