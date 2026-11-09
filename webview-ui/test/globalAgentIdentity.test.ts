import { describe, expect, it } from 'vitest';

import { globalAgentAvatarId, isGlobalAgentAvatar } from '../src/office/globalAgentIdentity.js';

describe('global OpenCode avatar identity', () => {
  it('keeps permanent profile IDs stable and separate', () => {
    const qa = globalAgentAvatarId('qa');
    const architect = globalAgentAvatarId('architect');

    expect(globalAgentAvatarId('qa')).toBe(qa);
    expect(architect).not.toBe(qa);
    expect(isGlobalAgentAvatar(qa)).toBe(true);
    expect(isGlobalAgentAvatar(42)).toBe(false);
  });
});
