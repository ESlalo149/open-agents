import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';

import type { AgentStateStore } from './agentStateStore.js';
import type { AssetCache, ReloadAssetsSideEffect } from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import { WS_CLOSE_FORBIDDEN_ORIGIN } from './constants.js';
import { buildGlobalAgentRoster } from './globalAgentRoster.js';
import type { AgentModelSelection } from './opencodeAgentProfiles.js';
import { OpenCodeAgentProfiles } from './opencodeAgentProfiles.js';
import { OpenCodeServiceClient } from './openCodeServiceClient.js';
import type { AgentState } from './types.js';
import {
  bearerTokenValid,
  isAllowedWebSocketOrigin,
  privilegedHostnames,
  redactTokenQuery,
  standaloneHandshakeVerdict,
} from './wsAuth.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for OpenCode events and privileged WebSocket access. */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Path to SPA dist directory for static serving. */
  staticDir?: string;
  /** Cached assets loaded at startup. */
  assetCache?: AssetCache;
  /** Callback for authenticated OpenCode plugin events */
  onOpenCodeEvent?: (event: Record<string, unknown>) => void;
  /** Invoked when an external asset directory is added/removed. Standalone reloads + re-broadcasts assets here. */
  onReloadAssets?: ReloadAssetsSideEffect;
  /** Extra Host names (beyond loopback and a specific bind address) a
   *  privileged standalone handshake may arrive under -- e.g. a reverse proxy's
   *  public name. See wsAuth.privilegedHostnames. */
  allowedHosts?: readonly string[];
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create the standalone Fastify server with OpenCode event, health, and WebSocket routes.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    // Standalone logs every request. The privilege token rides `/ws?token=`
    // and `/terminal/:id?token=` handshakes, so the url is redacted before it
    // is written -- otherwise every (re)connect would put the secret in stdout
    // and any log file (see wsAuth.redactTokenQuery).
    logger: { serializers: { req: serializeRequestForLog } },
    bodyLimit: 65_536,
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply
          .code(404)
          .send({ error: 'API route not found; restart or update the Pixel Agents server.' });
      }
      return reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  const host = options.host ?? '127.0.0.1';
  const allowedHostnames = privilegedHostnames(host, options.allowedHosts ?? []);

  registerHealthRoute(app);
  registerOpenCodeEventRoute(app, options);
  registerGlobalAgentRoutes(app, options);
  registerWebSocketRoute(app, options, allowedHostnames);

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host, port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

function registerGlobalAgentRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  const auth = { preHandler: bearerAuth(options.token) };
  const profiles = new OpenCodeAgentProfiles();
  const openCode = new OpenCodeServiceClient();

  app.get('/api/global-agents', auth, async (_request, reply) => {
    try {
      await ensureDefaultAgentProfiles(profiles);
      const profilesList = await profiles.list();
      let agents: Awaited<ReturnType<OpenCodeServiceClient['listAgents']>> = [];
      try {
        agents = await openCode.listAgents();
      } catch {
        // Keep global profiles visible when the managed OpenCode service is offline.
      }
      return reply.send(buildGlobalAgentRoster(profilesList, agents));
    } catch (error) {
      return sendOpenCodeError(reply, error);
    }
  });

  app.get('/api/global-agents/projects', auth, async (_request, reply) => {
    try {
      return reply.send(await openCode.listProjects());
    } catch (error) {
      return sendOpenCodeError(reply, error);
    }
  });

  app.get('/api/global-agents/models', auth, async (_request, reply) => {
    try {
      const models = await openCode.listModels();
      return reply.send(models.filter((model) => model.enabled && model.status !== 'deprecated'));
    } catch (error) {
      return sendOpenCodeError(reply, error);
    }
  });

  app.put<{
    Params: { id: string };
    Body: { prompt?: unknown; description?: unknown; mode?: unknown; model?: unknown };
  }>('/api/global-agents/:id', auth, async (request, reply) => {
    const { prompt, description, mode, model } = request.body ?? {};
    if (
      typeof prompt !== 'string' ||
      (description !== undefined && typeof description !== 'string') ||
      (mode !== undefined && typeof mode !== 'string') ||
      (model !== undefined && model !== null && !isAgentModelSelection(model))
    ) {
      return reply.code(400).send({ error: 'Invalid agent profile' });
    }
    try {
      if (model) {
        const [availableModel] = await openCode
          .listModels()
          .then((models) =>
            models.filter(
              (item) =>
                item.enabled &&
                item.status !== 'deprecated' &&
                item.providerID === model.providerID &&
                item.id === model.modelID,
            ),
          );
        if (!availableModel)
          return reply.code(400).send({ error: 'The selected model is not available in OpenCode' });
        if (
          model.variant &&
          !availableModel.variants.some((variant) => variant.id === model.variant)
        ) {
          return reply
            .code(400)
            .send({ error: 'The selected variant is not available for this model' });
        }
      }
      return reply.send(
        await profiles.save({
          id: request.params.id,
          prompt,
          description,
          mode,
          ...(model !== undefined ? { model: model as AgentModelSelection | null } : {}),
        }),
      );
    } catch (error) {
      return sendOpenCodeError(reply, error, 400);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/global-agents/:id', auth, async (request, reply) => {
    try {
      await profiles.remove(request.params.id);
      return reply.code(204).send();
    } catch (error) {
      return sendOpenCodeError(reply, error, 400);
    }
  });

  app.get<{ Querystring: { sessionId?: string; agentId?: string; directory?: string } }>(
    '/api/global-agents/conversation',
    auth,
    async (request, reply) => {
      const { sessionId, agentId, directory } = request.query;
      if (!sessionId || !agentId || !directory) {
        return reply.code(400).send({ error: 'sessionId, agentId, and directory are required' });
      }
      try {
        return reply.send(await openCode.conversation(sessionId, agentId, directory));
      } catch (error) {
        return sendOpenCodeError(reply, error, 400);
      }
    },
  );

  app.delete<{ Querystring: { sessionId?: string; agentId?: string; directory?: string } }>(
    '/api/global-agents/conversation',
    auth,
    async (request, reply) => {
      const { sessionId, agentId, directory } = request.query;
      if (!sessionId || !agentId || !directory) {
        return reply.code(400).send({ error: 'sessionId, agentId, and directory are required' });
      }
      try {
        await openCode.deleteConversation(sessionId, agentId, directory);
        return reply.code(204).send();
      } catch (error) {
        return sendOpenCodeError(reply, error, 400);
      }
    },
  );

  app.post<{
    Body: { agentId?: unknown; directory?: unknown; sessionId?: unknown; text?: unknown };
  }>('/api/global-agents/chat', auth, async (request, reply) => {
    const { agentId, directory, sessionId, text } = request.body ?? {};
    if (
      typeof agentId !== 'string' ||
      typeof directory !== 'string' ||
      typeof text !== 'string' ||
      (sessionId !== undefined && typeof sessionId !== 'string')
    ) {
      return reply.code(400).send({ error: 'Invalid chat request' });
    }
    try {
      return reply.send(await openCode.sendMessage({ agentId, directory, sessionId, text }));
    } catch (error) {
      return sendOpenCodeError(reply, error, 400);
    }
  });
}

function isAgentModelSelection(value: unknown): value is AgentModelSelection {
  if (!value || typeof value !== 'object') return false;
  const model = value as Record<string, unknown>;
  return (
    typeof model.providerID === 'string' &&
    typeof model.modelID === 'string' &&
    (model.variant === undefined || typeof model.variant === 'string')
  );
}

async function ensureDefaultAgentProfiles(profiles: OpenCodeAgentProfiles): Promise<void> {
  const existing = new Set((await profiles.list()).map((profile) => profile.id));
  const defaults = [
    {
      id: 'qa',
      description: 'Quality assurance specialist',
      prompt:
        'You are the QA specialist. Analyze requirements, identify risks and edge cases, design and run appropriate tests, and report findings with clear reproduction steps. Do not claim tests passed unless you ran them.',
    },
    {
      id: 'architect',
      description: 'Software architecture specialist',
      prompt:
        'You are the software architect. Understand the existing system before proposing changes. Focus on boundaries, compatibility, security, maintainability, and incremental delivery. Explain tradeoffs and avoid replacing established architecture without explicit approval.',
    },
    {
      id: 'developer',
      description: 'Implementation specialist',
      prompt:
        'You are the implementation specialist. Follow the repository conventions, make focused changes, preserve unrelated work, and run relevant checks. Explain assumptions and report exactly what changed and what remains unverified.',
    },
    {
      id: 'representante',
      description: 'Team representative and agent coordinator',
      prompt:
        'You are Representative, the team coordinator responsible for executing approved plans. The user plans with their primary assistant first and then gives you an approved plan. Treat that plan as the source of truth; do not rewrite it or expand its scope without authorization. Break the plan into concrete tasks. Delegate suitable work to QA, Architect, and Developer when available, integrate their findings, verify changes, and report progress, risks, and results clearly. If context is missing or a product decision is needed, ask before assuming. Respond in English by default. If the user explicitly asks you to respond in Spanish, do so.',
    },
  ];
  for (const agent of defaults) {
    if (!existing.has(agent.id)) await profiles.save({ ...agent, mode: 'subagent' });
  }
}

function sendOpenCodeError(reply: FastifyReply, error: unknown, status = 503) {
  const message = error instanceof Error ? error.message : 'OpenCode request failed';
  return reply.code(status).send({ error: message });
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

/** OpenCode's in-process plugin forwards typed server events to this authenticated route. */
function registerOpenCodeEventRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{ Body: Record<string, unknown> }>(
    '/api/opencode/events',
    { preHandler: bearerAuth(options.token), bodyLimit: 64 * 1024 },
    async (request, reply) => {
      const envelope = request.body;
      if (
        envelope.source === 'opencode' &&
        typeof envelope.type === 'string' &&
        envelope.data !== null &&
        typeof envelope.data === 'object'
      ) {
        options.onOpenCodeEvent?.(envelope);
      }
      reply.send({ status: 'ok' });
    },
  );
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(
  app: FastifyInstance,
  options: HttpServerOptions,
  allowedHostnames: ReadonlySet<string>,
): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
      socket.close(WS_CLOSE_FORBIDDEN_ORIGIN, 'forbidden origin');
      return;
    }

    const verdict = standaloneHandshakeVerdict(
      request.url,
      request.headers.host,
      options.token,
      allowedHostnames,
    );
    const privileged = verdict === 'privileged';
    if (verdict === 'untrusted-host') {
      // The operator has the right URL but reached us under a name they never
      // listed (typically a reverse proxy). Say how to fix it, or the session
      // silently stays watch-only.
      console.warn(
        `[Pixel Agents] Tokened connection via Host "${request.headers.host ?? ''}" is read-only: restart with --allowed-host <that name> to allow changes from it.`,
      );
    }

    const { store } = options;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, {
        type: 'agentCreated',
        id,
        directoryName: agent.directoryName,
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        palette: agent.palette,
        hueShift: agent.hueShift,
      });
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      safeSend(socket, message);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          cache: options.assetCache ?? null,
          onReloadAssets: options.onReloadAssets,
          privileged,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!bearerTokenValid(request.headers.authorization, expectedToken)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Logging ────────────────────────────────────────────────────

/** Fastify's default request serializer, minus the token query. Exported so a
 *  test can pin that the secret never reaches the log line. */
export function serializeRequestForLog(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: redactTokenQuery(request.url),
    hostname: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
