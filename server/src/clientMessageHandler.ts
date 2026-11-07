import type { StateAdapter } from '../../core/src/adapter.js';
import { resendAgentActivity } from './agentActivityResend.js';
import { buildAgentDiagnostics } from './agentDiagnostics.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { LoadedAssets, LoadedCharacterSprites, LoadedPetSprites } from './assetLoader.js';
import { readConfig, writeConfig } from './configPersistence.js';
import { HUE_SHIFT_MAX_DEG, PALETTE_COUNT } from './constants.js';
import {
  handleDirectoryClientMessage,
  type HostDirectoryEntry,
  listDirectories,
} from './directories.js';
import { collectDirectorySuggestions } from './directorySuggestions.js';
import { hostDirectory } from './hostDirectory.js';
import { readLayoutFromFile, writeLayoutToFile } from './layoutPersistence.js';

type WsSend = (message: Record<string, unknown>) => void;

/**
 * Reload server-side assets after an external-asset-directory change and
 * re-broadcast the updated sprites to the requesting client. Provided by cli.ts,
 * which owns the dist root needed to re-run the loaders.
 */
export type ReloadAssetsSideEffect = (send: WsSend) => Promise<void> | void;

/** Cached assets loaded at server startup. Sent to each WebSocket client on webviewReady. */
export interface AssetCache {
  characters: LoadedCharacterSprites | null;
  pets: LoadedPetSprites | null;
  floorTiles: string[][][] | null;
  wallTiles: string[][][][] | null;
  carpetTiles: string[][][][] | null;
  furniture: LoadedAssets | null;
  defaultLayout: Record<string, unknown> | null;
}

export interface ClientMessageContext {
  store: AgentStateStore;
  cache: AssetCache | null;
  /** Reload assets after an external-asset-directory change. Needs the dist root, known only to cli.ts. */
  onReloadAssets?: ReloadAssetsSideEffect;
  /**
   * Whether this client may change ANYTHING. An unprivileged client is
   * read-only: it may load and watch the office (`webviewReady`) and every
   * other message is refused at the top of handleClientMessage. Decided
   * per-connection by the transport (wsAuth.standaloneHandshakeVerdict, or the
   * embedded Bearer token); defaults to false so a caller that forgets to pass
   * it gets the safe answer.
   */
  privileged?: boolean;
}

// ── Setting keys ──
const KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
const KEY_LAST_SEEN_VERSION = 'pixel-agents.lastSeenVersion';
const KEY_ALWAYS_SHOW_LABELS = 'pixel-agents.alwaysShowLabels';
const KEY_GHOST_HEADLESS_AGENTS = 'pixel-agents.ghostHeadlessAgents';
const KEY_WATCH_ALL_SESSIONS = 'pixel-agents.watchAllSessions';
const KEY_SHOW_AREAS = 'pixel-agents.showAreas';
const KEY_BYPASS_PERMISSIONS = 'pixel-agents.bypassPermissions';
const KEY_SHOW_HOST_DIRECTORIES = 'pixel-agents.showHostDirectories';

function hostDirectoriesFor(): HostDirectoryEntry[] {
  return [hostDirectory()];
}

/**
 * The host Directories the drawer lists: all of them while the host's Show
 * setting is on, none while it is off (the default). Only the LIST is gated --
 * a launch still names its agent from hostDirectoriesFor, so an agent started
 * in the start directory keeps its name (and its Area mapping) either way, and
 * a hidden start directory becomes something the suggestions can offer.
 */
function shownHostDirectoriesFor(ctx: ClientMessageContext): HostDirectoryEntry[] {
  return ctx.store.getAdapter()?.getSetting(KEY_SHOW_HOST_DIRECTORIES, false)
    ? hostDirectoriesFor()
    : [];
}

/**
 * Handle incoming ClientMessage from a WebSocket client.
 *
 * In standalone mode, the server is the authority for all state: assets,
 * layout, settings, agents. Assets are loaded once at startup and cached
 * in memory. Each connecting client receives the full state on webviewReady.
 */
export function handleClientMessage(
  msg: Record<string, unknown>,
  send: WsSend,
  ctx: ClientMessageContext,
): void {
  const { store, cache } = ctx;
  const adapter = store.getAdapter();

  // Tokenless is read-only. Refused HERE, once, rather than per message, so a
  // message type added later is privileged by default instead of open until
  // someone remembers to gate it.
  if (!ctx.privileged && msg.type !== 'webviewReady') {
    refuseReadOnly(msg, send, ctx);
    return;
  }

  switch (msg.type) {
    case 'webviewReady':
      handleWebviewReady(send, ctx);
      break;

    case 'closeAgent': {
      // Closing the office character does not terminate the OpenCode session.
      const id = msg.id as number;
      const agent = store.get(id);
      if (agent) {
        store.delete(id);
        store.persist();
      }
      break;
    }

    case 'requestDiagnostics':
      // Point-to-point reply to the requesting socket (NOT a broadcast).
      send({ type: 'agentDiagnostics', agents: buildAgentDiagnostics(store) });
      break;

    case 'saveLayout':
      if (msg.layout) {
        writeLayoutToFile(msg.layout as Record<string, unknown>);
      }
      break;

    case 'saveAgentSeats':
      if (msg.seats) {
        const seats = msg.seats as Record<
          string,
          { palette?: number; hueShift?: number; seatId?: string }
        >;
        // Sync palette/hueShift back to AgentState so existingAgents stays
        // consistent across reconnects. Validate ranges to keep a remote
        // client (or a hand-edited payload) from corrupting the stored
        // values with out-of-range inputs that would render as a glitch.
        // Palette ceiling is dynamic: external asset directories can add
        // char_N.png beyond the bundled 6, so read the count from the asset
        // cache instead of hardcoding PALETTE_COUNT.
        const paletteCount = cache?.characters?.characters.length ?? PALETTE_COUNT;
        for (const [idStr, meta] of Object.entries(seats)) {
          const id = Number(idStr);
          const agent = store.get(id);
          if (agent) {
            if (
              meta.palette !== undefined &&
              Number.isInteger(meta.palette) &&
              meta.palette >= 0 &&
              meta.palette < paletteCount
            ) {
              agent.palette = meta.palette;
            }
            if (
              meta.hueShift !== undefined &&
              Number.isInteger(meta.hueShift) &&
              meta.hueShift >= 0 &&
              meta.hueShift <= HUE_SHIFT_MAX_DEG
            ) {
              agent.hueShift = meta.hueShift;
            }
          }
        }
        adapter?.saveSeats(seats);
      }
      break;

    case 'setSoundEnabled':
      adapter?.setSetting(KEY_SOUND_ENABLED, msg.enabled);
      break;

    case 'setLastSeenVersion':
      adapter?.setSetting(KEY_LAST_SEEN_VERSION, msg.version as string);
      break;

    case 'setAlwaysShowLabels':
      adapter?.setSetting(KEY_ALWAYS_SHOW_LABELS, msg.enabled);
      break;

    case 'setGhostHeadlessAgents':
      adapter?.setSetting(KEY_GHOST_HEADLESS_AGENTS, msg.enabled);
      break;

    case 'setWatchAllSessions': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_WATCH_ALL_SESSIONS, enabled);
      break;
    }

    case 'addExternalAssetDirectory': {
      const newPath = msg.path as string | undefined;
      if (!newPath) break;
      const cfg = readConfig();
      if (!cfg.externalAssetDirectories.includes(newPath)) {
        cfg.externalAssetDirectories.push(newPath);
        writeConfig(cfg);
      }
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      void ctx.onReloadAssets?.(send);
      break;
    }

    case 'removeExternalAssetDirectory': {
      const removePath = msg.path as string | undefined;
      if (!removePath) break;
      const cfg = readConfig();
      cfg.externalAssetDirectories = cfg.externalAssetDirectories.filter((d) => d !== removePath);
      writeConfig(cfg);
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      void ctx.onReloadAssets?.(send);
      break;
    }

    case 'saveAreaMappings': {
      const rawMappings = msg.mappings;
      if (!rawMappings || typeof rawMappings !== 'object') {
        break;
      }
      const cfg = readConfig();
      cfg.standalone.areaMappings = rawMappings as Record<string, string[]>;
      writeConfig(cfg);
      break;
    }

    case 'setShowAreas': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_SHOW_AREAS, enabled);
      break;
    }

    case 'setBypassPermissions': {
      if (typeof msg.enabled !== 'boolean' || !adapter) break;
      adapter.setSetting(KEY_BYPASS_PERMISSIONS, msg.enabled);
      // Every launch reads the persisted posture, so every office must show it:
      // a second tab still reading "off" would launch with the flag regardless.
      // Published as read back, so a failed write shows the truth, not the ask.
      store.broadcast({
        type: 'bypassPermissionsUpdated',
        enabled: adapter.getSetting(KEY_BYPASS_PERMISSIONS, false),
      });
      break;
    }

    case 'setShowHostDirectories': {
      if (typeof msg.enabled !== 'boolean' || !adapter) break;
      adapter.setSetting(KEY_SHOW_HOST_DIRECTORIES, msg.enabled);
      // The list is what changed, so every office gets it again -- the same
      // signal a Directory mutation sends.
      store.broadcast({
        type: 'directoriesLoaded',
        directories: listDirectories(shownHostDirectoriesFor(ctx)),
      });
      break;
    }

    case 'saveDirectory':
    case 'removeDirectory':
    case 'requestDirectorySuggestions':
      handleDirectoryClientMessage(msg, {
        hostDirectories: () => shownHostDirectoriesFor(ctx),
        broadcast: (message) => store.broadcast(message),
        reply: send,
        suggestions: () =>
          collectDirectorySuggestions(
            { sessionFilePattern: undefined },
            shownHostDirectoriesFor(ctx),
          ),
      });
      break;

    default:
      // focusAgent is handled entirely client-side in standalone (it focuses the
      // drawer tab, which the server has no say in). exportLayout / importLayout
      // still require IDE-specific handling.
      break;
  }
}

function handleWebviewReady(send: WsSend, ctx: ClientMessageContext): void {
  const { store, cache } = ctx;
  const adapter = store.getAdapter();

  // 0. Access, first: a read-only office hides every control that would send
  // a change (all refused by refuseReadOnly), so it must know before it draws
  // them.
  send({ type: 'officeAccess', readOnly: ctx.privileged !== true });

  // 2. Assets (from server cache, loaded at startup via pngjs)
  if (cache) {
    if (cache.characters) {
      send({ type: 'characterSpritesLoaded', characters: cache.characters.characters });
    }
    if (cache.pets) {
      send({
        type: 'petSpritesLoaded',
        pets: cache.pets.pets,
        petNames: cache.pets.manifests.map((m) => m.name),
      });
    }
    if (cache.floorTiles) {
      send({ type: 'floorTilesLoaded', sprites: cache.floorTiles });
    }
    if (cache.wallTiles) {
      send({ type: 'wallTilesLoaded', sets: cache.wallTiles });
    }
    if (cache.carpetTiles) {
      send({ type: 'carpetTilesLoaded', sets: cache.carpetTiles });
    }
    if (cache.furniture) {
      send({
        type: 'furnitureAssetsLoaded',
        catalog: cache.furniture.catalog,
        sprites: Object.fromEntries(cache.furniture.sprites),
      });
    }
  }

  // 3. Layout is sent AFTER existingAgents — see step 7 below. The webview
  // buffers agents from existingAgents and only materializes them on the next
  // layoutLoaded (useExtensionMessages.ts: "Buffer agents — they'll be added
  // in layoutLoaded"), so layout-first would leave a client that connects
  // after agent creation with no characters.

  // 4. Settings (from adapter, with sensible defaults when adapter is absent)
  const cfg = readConfig();
  const settings = settingsSnapshot(adapter);
  send(settings);

  // 4b. Directory→Area mappings (must arrive before existingAgents so the
  // webview seat-preference logic has the dict when characters are created).
  send({
    type: 'areaMappingsLoaded',
    mappings: cfg.standalone.areaMappings ?? {},
  });

  // 4c. Directories include the standalone server's start directory.
  send({ type: 'directoriesLoaded', directories: listDirectories(shownHostDirectoriesFor(ctx)) });

  // 5. Restore persisted OpenCode agents.

  // 6. Existing agents.
  const agentIds: number[] = [];
  const directoryNames: Record<number, string> = {};
  const externalAgents: Record<number, boolean> = {};
  const persistedSeats = adapter?.loadSeats() ?? {};
  const agentMeta: Record<number, { palette?: number; hueShift?: number; seatId?: string }> = {};
  for (const [id, agent] of store) {
    agentIds.push(id);
    if (agent.directoryName) {
      directoryNames[id] = agent.directoryName;
    }
    if (agent.isExternal) {
      externalAgents[id] = true;
    }
    const persisted = persistedSeats[String(id)];
    agentMeta[id] = {
      palette: agent.palette,
      hueShift: agent.hueShift,
      seatId: persisted?.seatId,
    };
  }
  send({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta,
    directoryNames,
    externalAgents,
  });

  // 7. Layout last (see step 3): flushes the webview's buffered existingAgents
  // into characters once seats are rebuilt.
  const savedLayout = readLayoutFromFile();
  send({ type: 'layoutLoaded', layout: savedLayout ?? cache?.defaultLayout ?? null });

  // 8. Agent state, AFTER layoutLoaded -- the characters they target only
  // exist once the layout flush creates them. Without this a reconnecting
  // client shows bare characters until each agent takes another turn.
  resendAgentActivity(send, store);
}

/**
 * The settingsLoaded snapshot: sent on connect, and re-sent to a read-only
 * client whose setting change was refused (refuseReadOnly), so its optimistic
 * toggle snaps back to the truth.
 */
function settingsSnapshot(adapter: StateAdapter | undefined) {
  return {
    type: 'settingsLoaded',
    soundEnabled: adapter?.getSetting(KEY_SOUND_ENABLED, true) ?? true,
    lastSeenVersion: adapter?.getSetting(KEY_LAST_SEEN_VERSION, '') ?? '',
    extensionVersion: process.env.PIXEL_AGENTS_VERSION ?? '',
    watchAllSessions: adapter?.getSetting(KEY_WATCH_ALL_SESSIONS, false) ?? false,
    alwaysShowLabels: adapter?.getSetting(KEY_ALWAYS_SHOW_LABELS, false) ?? false,
    ghostHeadlessAgents: adapter?.getSetting(KEY_GHOST_HEADLESS_AGENTS, false) ?? false,
    // A single boolean carrying the CLAUDE provider's preference until the
    // Settings UI grows a per-provider list -- its sole webview reader is the
    // hooks tooltip gate.
    externalAssetDirectories: readConfig().externalAssetDirectories,
    showAreas: adapter?.getSetting(KEY_SHOW_AREAS, false) ?? false,
    bypassPermissions: adapter?.getSetting(KEY_BYPASS_PERMISSIONS, false) ?? false,
    showHostDirectories: adapter?.getSetting(KEY_SHOW_HOST_DIRECTORIES, false) ?? false,
  } as const;
}

/** Message types already reported as refused, so a read-only client that keeps
 *  sending (seat saves, layout saves) logs once per type, not per message. */
const reportedRefusals = new Set<string>();

/**
 * Drop a message from a read-only (unprivileged) client. Where the UI changes
 * optimistically before the server answers, the refused client is re-sent the
 * real state so the control snaps back instead of showing a change that was
 * never made -- the same "answer with the truth" rule as a failed hooks install.
 */
function refuseReadOnly(
  msg: Record<string, unknown>,
  send: WsSend,
  ctx: ClientMessageContext,
): void {
  const type = String(msg.type);
  if (!reportedRefusals.has(type)) {
    reportedRefusals.add(type);
    console.warn(
      `[Pixel Agents] Ignoring ${type} from a read-only client. Changes need the tokened URL the CLI printed (at localhost or an --allowed-host name).`,
    );
  }
  switch (msg.type) {
    case 'setSoundEnabled':
    case 'setAlwaysShowLabels':
    case 'setGhostHeadlessAgents':
    case 'setWatchAllSessions':
    case 'setShowAreas':
    case 'setBypassPermissions':
    case 'setShowHostDirectories':
      send(settingsSnapshot(ctx.store.getAdapter()));
      return;
    case 'addExternalAssetDirectory':
    case 'removeExternalAssetDirectory':
      send({
        type: 'externalAssetDirectoriesUpdated',
        dirs: readConfig().externalAssetDirectories,
      });
      return;
    case 'saveAreaMappings':
      send({ type: 'areaMappingsLoaded', mappings: readConfig().standalone.areaMappings ?? {} });
      return;
  }
}
