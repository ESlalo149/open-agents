import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CONFIG_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';

export interface AdapterSettings {
  soundEnabled: boolean;
  lastSeenVersion: string;
  alwaysShowLabels: boolean;
  ghostHeadlessAgents: boolean;
  watchAllSessions: boolean;
  showAreas: boolean;
  areaMappings: Record<string, string[]>;
  /** Retained as a preference for host-managed launch workflows. */
  bypassPermissions: boolean;
  /** Whether the host's start directory is listed in the session directory picker. */
  showHostDirectories: boolean;
}

/** All persisted per-host settings. */
export const ADAPTER_SETTING_KEYS = [
  'soundEnabled',
  'lastSeenVersion',
  'alwaysShowLabels',
  'ghostHeadlessAgents',
  'watchAllSessions',
  'showAreas',
  'areaMappings',
  'bypassPermissions',
  'showHostDirectories',
] as const;

export type AdapterSettingKey = (typeof ADAPTER_SETTING_KEYS)[number];

/** Current config namespace. */
export type ConfigNamespace = 'standalone';
/**
 * A user-defined Directory as persisted. Only what the user chose is stored:
 * `source` is always `user` for these (see directories.ts).
 */
export interface UserDirectory {
  name: string;
  path: string;
}

export interface PixelAgentsConfig {
  standalone: AdapterSettings;
  externalAssetDirectories: string[];
  /** User-defined Directories. */
  directories: UserDirectory[];
}

const DEFAULT_ADAPTER_SETTINGS: AdapterSettings = {
  soundEnabled: true,
  lastSeenVersion: '',
  alwaysShowLabels: false,
  ghostHeadlessAgents: false,
  watchAllSessions: false,
  showAreas: false,
  areaMappings: {},
  bypassPermissions: false,
  showHostDirectories: false,
};

function getConfigFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

/**
 * Coerce a loose object into `Record<string, string[]>`, dropping any entries
 * whose value is not an array of strings. Returns `{}` if the input isn't an
 * object. Used to defensively load Directory→area mappings from config.json,
 * which may have been hand-edited or written by an older build.
 */
export function parseAreaMappings(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [directory, labels] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof directory !== 'string') {
      continue;
    }
    if (!Array.isArray(labels)) {
      continue;
    }
    const filtered = labels.filter((l): l is string => typeof l === 'string');
    out[directory] = filtered;
  }
  return out;
}

/**
 * Coerce a loose value into `UserDirectory[]`, dropping anything that isn't an
 * object with a string name and a string path. Same defensive posture as
 * parseAreaMappings: config.json is hand-editable and may predate this field.
 */
export function parseUserDirectories(raw: unknown): UserDirectory[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: UserDirectory[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const { name, path: dirPath } = entry as { name?: unknown; path?: unknown };
    if (typeof name !== 'string' || typeof dirPath !== 'string' || dirPath.length === 0) {
      continue;
    }
    out.push({ name, path: dirPath });
  }
  return out;
}

/** Coerce a loose object into a valid AdapterSettings with defaults for missing/wrong-typed fields. */
function parseAdapterSettings(raw: unknown): AdapterSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdapterSettings>;
  return {
    soundEnabled:
      typeof obj.soundEnabled === 'boolean'
        ? obj.soundEnabled
        : DEFAULT_ADAPTER_SETTINGS.soundEnabled,
    lastSeenVersion:
      typeof obj.lastSeenVersion === 'string'
        ? obj.lastSeenVersion
        : DEFAULT_ADAPTER_SETTINGS.lastSeenVersion,
    alwaysShowLabels:
      typeof obj.alwaysShowLabels === 'boolean'
        ? obj.alwaysShowLabels
        : DEFAULT_ADAPTER_SETTINGS.alwaysShowLabels,
    ghostHeadlessAgents:
      typeof obj.ghostHeadlessAgents === 'boolean'
        ? obj.ghostHeadlessAgents
        : DEFAULT_ADAPTER_SETTINGS.ghostHeadlessAgents,
    watchAllSessions:
      typeof obj.watchAllSessions === 'boolean'
        ? obj.watchAllSessions
        : DEFAULT_ADAPTER_SETTINGS.watchAllSessions,
    showAreas:
      typeof obj.showAreas === 'boolean' ? obj.showAreas : DEFAULT_ADAPTER_SETTINGS.showAreas,
    areaMappings: parseAreaMappings(obj.areaMappings),
    bypassPermissions:
      typeof obj.bypassPermissions === 'boolean'
        ? obj.bypassPermissions
        : DEFAULT_ADAPTER_SETTINGS.bypassPermissions,
    showHostDirectories:
      typeof obj.showHostDirectories === 'boolean'
        ? obj.showHostDirectories
        : DEFAULT_ADAPTER_SETTINGS.showHostDirectories,
  };
}

function emptyConfig(): PixelAgentsConfig {
  return {
    standalone: { ...DEFAULT_ADAPTER_SETTINGS },
    externalAssetDirectories: [],
    directories: [],
  };
}

export function readConfig(): PixelAgentsConfig {
  const filePath = getConfigFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return emptyConfig();
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PixelAgentsConfig>;
    return {
      standalone: parseAdapterSettings(parsed.standalone),
      externalAssetDirectories: Array.isArray(parsed.externalAssetDirectories)
        ? parsed.externalAssetDirectories.filter((d): d is string => typeof d === 'string')
        : [],
      directories: parseUserDirectories(parsed.directories),
    };
  } catch (err) {
    console.error('[Pixel Agents] Failed to read config file:', err);
    return emptyConfig();
  }
}

/**
 * Atomically write the shared config. Never throws (most callers are
 * fire-and-forget settings writes that degrade to a console error); returns
 * whether the write landed, for callers whose success is reported to the user
 * — a Directory save must not be announced as saved when it never hit the disk.
 */
export function writeConfig(config: PixelAgentsConfig): boolean {
  const filePath = getConfigFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(config, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    console.error('[Pixel Agents] Failed to write config file:', err);
    return false;
  }
}
