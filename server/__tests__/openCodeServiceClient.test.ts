import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenCodeServiceClient } from '../src/openCodeServiceClient.js';

describe('OpenCodeServiceClient', () => {
  let directory = '';

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = '';
  });

  it('accepts the OpenCode 2.2.6 bare project array and canonical directory field', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pixel-opencode-service-'));
    const serviceFile = path.join(directory, 'service.json');
    await writeFile(
      serviceFile,
      JSON.stringify({
        version: '2.2.6',
        url: 'http://127.0.0.1:28894',
        password: 'test-secret',
      }),
    );
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Basic ${Buffer.from('opencode:test-secret').toString('base64')}`,
      );
      return new Response(
        JSON.stringify([
          { id: 'project-1', canonical: 'C:\\work\\demo' },
          { id: 'invalid-project' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const client = new OpenCodeServiceClient(serviceFile, fetchImpl);

    await expect(client.listProjects()).resolves.toEqual([
      { id: 'project-1', canonical: 'C:\\work\\demo', directory: 'C:\\work\\demo' },
    ]);
  });

  it('lists OpenCode 2.2.6 models with their per-model variants', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pixel-opencode-models-'));
    const serviceFile = path.join(directory, 'service.json');
    await writeFile(
      serviceFile,
      JSON.stringify({
        version: '2.2.6',
        url: 'http://127.0.0.1:28894',
        password: 'test-secret',
      }),
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      expect(new URL(String(input)).pathname).toBe('/api/model');
      return Response.json({
        data: [
          {
            id: 'gpt-test',
            providerID: 'openai',
            name: 'GPT Test',
            enabled: true,
            status: 'active',
            variants: [{ id: 'low' }, { id: 'high' }],
          },
          { id: 'malformed' },
        ],
      });
    });
    const client = new OpenCodeServiceClient(serviceFile, fetchImpl);

    await expect(client.listModels()).resolves.toEqual([
      {
        id: 'gpt-test',
        providerID: 'openai',
        name: 'GPT Test',
        enabled: true,
        status: 'active',
        variants: [{ id: 'low' }, { id: 'high' }],
      },
    ]);
  });

  it('sends PromptInput directly to the OpenCode 2.2.6 session prompt route', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pixel-opencode-prompt-'));
    const projectDirectory = path.join(directory, 'project');
    const serviceFile = path.join(directory, 'service.json');
    await writeFile(
      serviceFile,
      JSON.stringify({
        version: '2.2.6',
        url: 'http://127.0.0.1:28894',
        password: 'test-secret',
      }),
    );
    let promptBody: unknown;
    let promptSent = false;
    const mockSession = {
      id: 'ses_test',
      agent: 'qa',
      location: { directory: projectDirectory },
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/agent') {
        return Response.json({ data: [{ id: 'qa', name: 'QA', hidden: false }] });
      }
      if (url.pathname === '/api/project') {
        return Response.json([{ id: 'project-1', canonical: projectDirectory }]);
      }
      if (url.pathname === '/api/session' && init?.method === 'POST') {
        return Response.json({ data: mockSession });
      }
      if (url.pathname === '/api/session/ses_test' && init?.method !== 'POST') {
        return Response.json({ data: mockSession });
      }
      if (url.pathname === '/api/session/ses_test/message') {
        return Response.json({
          data: promptSent
            ? [
                {
                  id: 'msg_assistant',
                  type: 'assistant',
                  time: { created: 101, completed: 102 },
                  content: [{ type: 'text', text: 'Hi there' }],
                },
                {
                  id: 'msg_user',
                  type: 'user',
                  time: { created: 100 },
                  content: [{ type: 'text', text: 'hello' }],
                },
              ]
            : [],
        });
      }
      if (url.pathname === '/api/session/ses_test/prompt') {
        promptBody = JSON.parse(String(init?.body));
        promptSent = true;
        return new Response(null, { status: 204 });
      }
      if (url.pathname === '/api/session/active') return Response.json({ data: {} });
      throw new Error(`Unexpected OpenCode request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    let now = 1_000;
    const client = new OpenCodeServiceClient(
      serviceFile,
      fetchImpl,
      () => now,
      async (ms) => {
        now += ms;
      },
    );

    const result = await client.sendMessage({
      agentId: 'qa',
      directory: projectDirectory,
      text: 'hello',
    });

    expect(promptBody).toEqual({ text: 'hello' });
    expect(result.sessionId).toBe('ses_test');
    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Hi there' });
  });

  it('deletes only a matching Pixel Agents conversation using OpenCode 2.2.6 DELETE session route', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pixel-opencode-delete-'));
    const projectDirectory = path.join(directory, 'project');
    const serviceFile = path.join(directory, 'service.json');
    await writeFile(
      serviceFile,
      JSON.stringify({
        version: '2.2.6',
        url: 'http://127.0.0.1:28894',
        password: 'test-secret',
      }),
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/session/ses_test' && (!init?.method || init.method === 'GET')) {
        return Response.json({
          data: {
            id: 'ses_test',
            title: 'Pixel Agents · qa',
            agent: 'qa',
            location: { directory: projectDirectory },
          },
        });
      }
      if (url.pathname === '/api/session/ses_test' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected OpenCode request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    const client = new OpenCodeServiceClient(serviceFile, fetchImpl);

    await expect(
      client.deleteConversation('ses_test', 'qa', projectDirectory),
    ).resolves.toBeUndefined();

    expect(
      fetchImpl.mock.calls.map(([input, init]) => [
        new URL(String(input)).pathname,
        init?.method ?? 'GET',
      ]),
    ).toEqual([
      ['/api/session/ses_test', 'GET'],
      ['/api/session/ses_test', 'DELETE'],
    ]);
  });

  it('refuses to delete a session that does not belong to the requested agent and project', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pixel-opencode-delete-guard-'));
    const projectDirectory = path.join(directory, 'project');
    const serviceFile = path.join(directory, 'service.json');
    await writeFile(
      serviceFile,
      JSON.stringify({
        version: '2.2.6',
        url: 'http://127.0.0.1:28894',
        password: 'test-secret',
      }),
    );
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: {
          id: 'ses_test',
          title: 'Personal session',
          agent: 'qa',
          location: { directory: projectDirectory },
        },
      }),
    );
    const client = new OpenCodeServiceClient(serviceFile, fetchImpl);

    await expect(client.deleteConversation('ses_test', 'qa', projectDirectory)).rejects.toThrow(
      'This is not a Pixel Agents conversation',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
