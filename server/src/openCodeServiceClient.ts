import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

export interface OpenCodeAgent {
  id: string;
  name: string;
  description?: string;
  mode?: string;
  hidden?: boolean;
  model?: unknown;
}

export interface OpenCodeModel {
  id: string;
  providerID: string;
  name: string;
  enabled: boolean;
  status: string;
  variants: Array<{ id: string }>;
}

export interface OpenCodeProject {
  id: string;
  directory: string;
  canonical?: string;
}

export interface OpenCodeConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

interface ServiceFile {
  url?: unknown;
  password?: unknown;
  version?: unknown;
}

interface OpenCodeEnvelope<T> {
  data?: T;
}

interface OpenCodeSession {
  id?: unknown;
  title?: unknown;
  agent?: unknown;
  location?: { directory?: unknown };
}

interface OpenCodeMessage {
  id?: unknown;
  type?: unknown;
  agent?: unknown;
  time?: { created?: unknown; completed?: unknown };
  content?: unknown;
}

const VERSION = '2.2.6';
const RESPONSE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 400;

/** Authenticated client for OpenCode's per-user managed V2 service (2.2.6). */
export class OpenCodeServiceClient {
  constructor(
    private readonly serviceFile = path.join(
      homedir(),
      '.local',
      'state',
      'opencode',
      'service.json',
    ),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly sleep: (milliseconds: number) => Promise<void> = delay,
  ) {}

  async listAgents(): Promise<OpenCodeAgent[]> {
    const response = await this.request<OpenCodeAgent[]>('/api/agent');
    return requireData(response, 'OpenCode did not return its agent list');
  }

  async listModels(): Promise<OpenCodeModel[]> {
    const response = await this.request<OpenCodeModel[]>('/api/model');
    return requireData(response, 'OpenCode did not return its model list')
      .filter(
        (model) =>
          typeof model.id === 'string' &&
          typeof model.providerID === 'string' &&
          typeof model.name === 'string' &&
          typeof model.enabled === 'boolean' &&
          typeof model.status === 'string',
      )
      .map((model) => ({
        ...model,
        variants: Array.isArray(model.variants)
          ? model.variants.filter((variant) => variant && typeof variant.id === 'string')
          : [],
      }));
  }

  async listProjects(): Promise<OpenCodeProject[]> {
    const response = await this.request<OpenCodeProject[]>('/api/project');
    // OpenCode 2.2.6 returns projects as a bare array while most V2 routes
    // return a { data } envelope. Preserve the wire shape rather than assuming
    // every endpoint shares the same wrapper.
    const projects = Array.isArray(response)
      ? (response as unknown as Array<Partial<OpenCodeProject>>)
      : requireData(response, 'OpenCode did not return its project list');
    return projects.flatMap((project) => {
      const directory =
        typeof project.directory === 'string' ? project.directory : project.canonical;
      if (typeof project.id !== 'string' || typeof directory !== 'string') return [];
      return [{ ...project, id: project.id, directory }];
    });
  }

  async conversation(
    sessionId: string,
    agentId: string,
    directory: string,
  ): Promise<OpenCodeConversationMessage[]> {
    const session = requireData(
      await this.request<OpenCodeSession>(`/api/session/${encodeURIComponent(sessionId)}`),
      'OpenCode session was not found',
    );
    this.assertSessionMatches(session, agentId, directory);
    const messages = requireData(
      await this.request<OpenCodeMessage[]>(
        `/api/session/${encodeURIComponent(sessionId)}/message?limit=100`,
      ),
      'OpenCode did not return session messages',
    );
    return messages
      .filter(isConversationMessage)
      .map((message) => ({
        id: message.id as string,
        role: message.type as 'user' | 'assistant',
        text: extractText(message.content),
        createdAt: typeof message.time?.created === 'number' ? message.time.created : 0,
      }))
      .filter((message) => message.text.length > 0)
      .reverse();
  }

  async deleteConversation(sessionId: string, agentId: string, directory: string): Promise<void> {
    const session = requireData(
      await this.request<OpenCodeSession>(`/api/session/${encodeURIComponent(sessionId)}`),
      'OpenCode session was not found',
    );
    this.assertSessionMatches(session, agentId, directory);
    if (typeof session.title !== 'string' || !session.title.startsWith('Pixel Agents')) {
      throw new Error('This is not a Pixel Agents conversation');
    }
    await this.request<unknown>(`/api/session/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  }

  async sendMessage(input: {
    agentId: string;
    directory: string;
    sessionId?: string;
    text: string;
  }): Promise<{ sessionId: string; messages: OpenCodeConversationMessage[] }> {
    const text = input.text.trim();
    if (!text || text.length > 20_000) {
      throw new Error('Message must contain 1–20,000 characters');
    }
    const [agents, projects] = await Promise.all([this.listAgents(), this.listProjects()]);
    const agent = agents.find((item) => item.id === input.agentId && !item.hidden);
    if (!agent) throw new Error('This OpenCode agent is not available');
    const project = projects.find(
      (item) =>
        samePath(item.directory, input.directory) || samePath(item.canonical, input.directory),
    );
    if (!project)
      throw new Error('Choose a project known to OpenCode before starting a conversation');

    const sessionId = input.sessionId ?? (await this.createSession(agent.id, project.directory));
    const session = requireData(
      await this.request<OpenCodeSession>(`/api/session/${encodeURIComponent(sessionId)}`),
      'OpenCode session was not found',
    );
    this.assertSessionMatches(session, agent.id, project.directory);
    const before = await this.messageIds(sessionId);
    const startedAt = this.now();

    await this.request<unknown>(`/api/session/${encodeURIComponent(sessionId)}/prompt`, {
      method: 'POST',
      // OpenCode 2.2.6's session.prompt schema takes PromptInput directly:
      // { text, files?, agents?, ... }, not a { prompt: PromptInput } wrapper.
      body: JSON.stringify({ text }),
    });

    const deadline = startedAt + RESPONSE_TIMEOUT_MS;
    while (this.now() < deadline) {
      await this.sleep(POLL_INTERVAL_MS);
      const [messages, active] = await Promise.all([
        this.request<OpenCodeMessage[]>(
          `/api/session/${encodeURIComponent(sessionId)}/message?limit=100`,
        ),
        this.request<Record<string, unknown>>('/api/session/active'),
      ]);
      const newAssistant = requireData(messages, 'OpenCode did not return session messages')
        .filter(isConversationMessage)
        .filter((message) => message.type === 'assistant' && !before.has(message.id as string))
        .sort((a, b) => numberValue(b.time?.created) - numberValue(a.time?.created));
      const running = Boolean(
        requireData(active, 'OpenCode did not return active sessions')[sessionId],
      );
      const completed = newAssistant.find((message) => numberValue(message.time?.completed) > 0);
      if (completed && !running) {
        return {
          sessionId,
          messages: await this.conversation(sessionId, agent.id, project.directory),
        };
      }
    }
    throw new Error(
      'OpenCode is still working; the reply timed out. The session remains available to continue.',
    );
  }

  private async createSession(agentId: string, directory: string): Promise<string> {
    const created = requireData(
      await this.request<OpenCodeSession>('/api/session', {
        method: 'POST',
        body: JSON.stringify({
          agent: agentId,
          location: { directory },
          title: `Pixel Agents · ${agentId}`,
        }),
      }),
      'OpenCode could not create a session',
    );
    if (typeof created.id !== 'string' || !created.id.startsWith('ses')) {
      throw new Error('OpenCode created a session with an invalid ID');
    }
    return created.id;
  }

  private async messageIds(sessionId: string): Promise<Set<string>> {
    const messages = requireData(
      await this.request<OpenCodeMessage[]>(
        `/api/session/${encodeURIComponent(sessionId)}/message?limit=100`,
      ),
      'OpenCode did not return session messages',
    );
    return new Set(
      messages.flatMap((message) => (typeof message.id === 'string' ? [message.id] : [])),
    );
  }

  private assertSessionMatches(session: OpenCodeSession, agentId: string, directory: string): void {
    if (session.agent !== agentId || !samePath(session.location?.directory, directory)) {
      throw new Error('This conversation does not belong to the selected agent and project');
    }
  }

  private async request<T>(route: string, init: RequestInit = {}): Promise<OpenCodeEnvelope<T>> {
    const service = await this.readServiceFile();
    if (service.version !== VERSION) {
      throw new Error(
        `Pixel Agents requires the OpenCode ${VERSION} service (found ${String(service.version ?? 'unknown')})`,
      );
    }
    const baseUrl = service.url as string;
    const password = service.password as string;
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('OpenCode service URL is invalid');
    }
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
    ) {
      throw new Error('Pixel Agents only connects to a loopback OpenCode service');
    }
    const authorization = Buffer.from(`opencode:${password}`, 'utf8').toString('base64');
    const response = await this.fetchImpl(new URL(route, url), {
      ...init,
      headers: {
        authorization: `Basic ${authorization}`,
        'content-type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => undefined)) as
        { message?: unknown } | undefined;
      const detail = typeof payload?.message === 'string' ? `: ${payload.message}` : '';
      throw new Error(`OpenCode request failed (${response.status})${detail}`);
    }
    if (response.status === 204) return { data: undefined as T };
    return (await response.json()) as OpenCodeEnvelope<T>;
  }

  private async readServiceFile(): Promise<ServiceFile> {
    let parsed: ServiceFile;
    try {
      parsed = JSON.parse(await readFile(this.serviceFile, 'utf8')) as ServiceFile;
    } catch {
      throw new Error('OpenCode shared service is unavailable. Start OpenCode and try again.');
    }
    if (typeof parsed.url !== 'string' || typeof parsed.password !== 'string') {
      throw new Error('OpenCode shared service registration is incomplete');
    }
    return parsed;
  }
}

function requireData<T>(value: OpenCodeEnvelope<T>, message: string): T {
  if (value.data === undefined || value.data === null) throw new Error(message);
  return value.data;
}

function isConversationMessage(message: OpenCodeMessage): boolean {
  return (
    (message.type === 'user' || message.type === 'assistant') && typeof message.id === 'string'
  );
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return [];
      const value = part as { type?: unknown; text?: unknown };
      return value.type === 'text' && typeof value.text === 'string' ? [value.text] : [];
    })
    .join('');
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function samePath(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  return path.resolve(a).toLocaleLowerCase() === path.resolve(b).toLocaleLowerCase();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
