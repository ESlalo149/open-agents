import { Plugin } from '@opencode/plugin';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type ServerEntry = { port: number; token: string };

async function forwardToPixelAgents(event: Record<string, unknown>) {
  const registryDir = join(homedir(), '.pixel-agents', 'servers');
  let entries: string[];
  try {
    entries = await readdir(registryDir);
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) => {
        try {
          const server = JSON.parse(
            await readFile(join(registryDir, entry), 'utf8'),
          ) as ServerEntry;
          if (!Number.isInteger(server.port) || typeof server.token !== 'string') return;
          await fetch(`http://127.0.0.1:${server.port}/api/opencode/events`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${server.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ source: 'opencode', ...event }),
            signal: AbortSignal.timeout(1500),
          });
        } catch {
          // Server can stop between discovery and delivery; the next event retries.
        }
      }),
  );
}

/** OpenCode 2.2.6 plugin entry point. */
export default Plugin.define({
  id: 'pixel-agents',
  async setup(ctx) {
    const controller = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe()) {
        if (controller.signal.aborted) break;
        if (event.type.startsWith('session.') || event.type.startsWith('permission.')) {
          await forwardToPixelAgents({
            source: 'opencode',
            type: event.type,
            data: event.data,
            projectDirectory: ctx.location.directory,
          });
        }
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted)
        console.error('[pixel-agents] OpenCode event stream failed', error);
    });
    return () => controller.abort();
  },
});
