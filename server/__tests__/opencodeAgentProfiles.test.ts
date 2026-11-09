import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OpenCodeAgentProfiles } from '../src/opencodeAgentProfiles.js';

describe('OpenCodeAgentProfiles', () => {
  let root = '';

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  async function makeStore(): Promise<OpenCodeAgentProfiles> {
    root = await mkdtemp(path.join(tmpdir(), 'pixel-agent-profiles-'));
    return new OpenCodeAgentProfiles(path.join(root, 'agents'));
  }

  it('creates and lists global profiles with a nested ID', async () => {
    const store = await makeStore();
    await store.save({
      id: 'team/reviewer',
      description: 'Reviews code',
      mode: 'subagent',
      prompt: 'Review carefully.\nDo not edit.',
    });

    await expect(store.list()).resolves.toEqual([
      {
        id: 'team/reviewer',
        description: 'Reviews code',
        mode: 'subagent',
        prompt: 'Review carefully.\nDo not edit.\n',
        model: null,
        editable: true,
      },
    ]);
  });

  it('edits only the Markdown body and preserves existing frontmatter', async () => {
    const store = await makeStore();
    const agentsDir = path.join(root, 'agents');
    await mkdir(agentsDir, { recursive: true });
    const original = [
      '---',
      'description: Existing profile',
      'mode: all',
      'model: openai/gpt-test',
      'custom_option: keep-me',
      '---',
      'Old prompt',
      '',
    ].join('\n');
    await writeFile(path.join(agentsDir, 'reviewer.md'), original);

    await store.save({
      id: 'reviewer',
      prompt: 'New prompt',
      model: { providerID: 'anthropic', modelID: 'claude-test', variant: 'high' },
    });

    await expect(readFile(path.join(agentsDir, 'reviewer.md'), 'utf8')).resolves.toBe(
      original
        .replace('model: openai/gpt-test', 'model: "anthropic/claude-test#high"')
        .replace('Old prompt\n', 'New prompt\n'),
    );

    await expect(store.list()).resolves.toEqual([
      {
        id: 'reviewer',
        description: 'Existing profile',
        mode: 'all',
        prompt: 'New prompt\n',
        model: { providerID: 'anthropic', modelID: 'claude-test', variant: 'high' },
        editable: true,
      },
    ]);
  });

  it('removes an explicit model selection to inherit the OpenCode default', async () => {
    const store = await makeStore();
    await store.save({
      id: 'reviewer',
      prompt: 'Review carefully.',
      model: { providerID: 'openai', modelID: 'gpt-test', variant: 'medium' },
    });

    await store.save({ id: 'reviewer', prompt: 'Review carefully.', model: null });

    const [profile] = await store.list();
    expect(profile?.model).toBeNull();
    expect(await readFile(path.join(root, 'agents', 'reviewer.md'), 'utf8')).not.toContain(
      'model:',
    );
  });

  it('does not add extra blank lines when saving an already parsed prompt', async () => {
    const store = await makeStore();
    await store.save({ id: 'reviewer', prompt: 'Review carefully.' });
    const [profile] = await store.list();

    await store.save({ id: 'reviewer', prompt: profile!.prompt, model: null });

    await expect(readFile(path.join(root, 'agents', 'reviewer.md'), 'utf8')).resolves.toMatch(
      /Review carefully\.\n$/,
    );
  });

  it('removes only an existing Markdown profile', async () => {
    const store = await makeStore();
    await store.save({ id: 'writer', prompt: 'Write.' });
    await store.remove('writer');
    await expect(store.list()).resolves.toEqual([]);
    await expect(store.remove('missing')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects traversal, invalid modes, and oversized prompts', async () => {
    const store = await makeStore();
    await expect(store.save({ id: '../outside', prompt: 'x' })).rejects.toThrow('Agent ID');
    await expect(store.save({ id: 'valid', prompt: 'x', mode: 'invalid' })).rejects.toThrow(
      'Agent mode',
    );
    await expect(store.save({ id: 'valid', prompt: 'x'.repeat(100_001) })).rejects.toThrow(
      'prompt must be at most',
    );
    await expect(
      store.save({ id: 'valid', prompt: 'x', model: { providerID: 'openai/foo', modelID: 'x' } }),
    ).rejects.toThrow('Agent model selection');
  });

  it('does not follow a symlinked profile file', async () => {
    const store = await makeStore();
    const agentsDir = path.join(root, 'agents');
    await mkdir(agentsDir, { recursive: true });
    const outside = path.join(root, 'outside.md');
    await writeFile(outside, 'secret');
    await symlink(outside, path.join(agentsDir, 'linked.md'));

    await expect(store.save({ id: 'linked', prompt: 'overwrite' })).rejects.toThrow('regular file');
    await expect(store.remove('linked')).rejects.toThrow('regular file');
    await expect(readFile(outside, 'utf8')).resolves.toBe('secret');
    await expect(store.list()).resolves.toEqual([]);
  });
});
