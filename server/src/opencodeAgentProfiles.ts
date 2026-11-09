import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

export interface GlobalAgentProfile {
  id: string;
  description: string;
  mode: string;
  prompt: string;
  model: AgentModelSelection | null;
  editable: true;
}

export interface AgentModelSelection {
  providerID: string;
  modelID: string;
  variant?: string;
}

const MAX_PROMPT_LENGTH = 100_000;
const MAX_DESCRIPTION_LENGTH = 500;
const ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function globalAgentsDirectory(): string {
  const configDir =
    process.env['OPENCODE_CONFIG_DIR'] || path.join(homedir(), '.config', 'opencode');
  return path.join(configDir, 'agents');
}

/** CRUD for global Markdown agent files. Project-local agents are never touched. */
export class OpenCodeAgentProfiles {
  constructor(private readonly root = globalAgentsDirectory()) {}

  async list(): Promise<GlobalAgentProfile[]> {
    await this.ensureRoot();
    const profiles: GlobalAgentProfile[] = [];
    await this.readTree(this.root, '', profiles);
    return profiles.sort((a, b) => a.id.localeCompare(b.id));
  }

  async save(input: {
    id: string;
    prompt: string;
    description?: string;
    mode?: string;
    model?: AgentModelSelection | null;
  }): Promise<GlobalAgentProfile> {
    const id = validateAgentId(input.id);
    const prompt = validatePrompt(input.prompt);
    const description =
      input.description === undefined ? undefined : validateDescription(input.description);
    const mode = input.mode === undefined ? undefined : validateMode(input.mode);
    const model = input.model === undefined ? undefined : validateModelSelection(input.model);
    await this.ensureRoot();

    const filePath = this.filePath(id);
    await this.ensureSafeParent(id);
    const current = await this.readOptional(filePath);
    const contents =
      current === undefined
        ? createAgentMarkdown({
            description: description ?? '',
            mode: mode ?? 'subagent',
            model: model ?? null,
            prompt,
          })
        : updateAgentMarkdown(current, { description, mode, model, prompt });

    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    return { id, ...parseAgentMarkdown(contents), editable: true };
  }

  async remove(idInput: string): Promise<void> {
    const id = validateAgentId(idInput);
    await this.ensureRoot();
    const filePath = this.filePath(id);
    await this.ensureSafeParent(id);
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('Agent profile is not a regular file');
    }
    await unlink(filePath);
  }

  private async readTree(
    directory: string,
    prefix: string,
    into: GlobalAgentProfile[],
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.readTree(fullPath, relative, into);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const id = relative.slice(0, -3).split(path.sep).join('/');
      try {
        validateAgentId(id);
        const contents = await readFile(fullPath, 'utf8');
        const parsed = parseAgentMarkdown(contents);
        into.push({ id, ...parsed, editable: true });
      } catch {
        // A malformed or unsupported agent file should not make the whole team unavailable.
      }
    }
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Global OpenCode agents path must be a real directory');
    }
  }

  private filePath(id: string): string {
    const target = path.resolve(this.root, ...id.split('/')) + '.md';
    const root = path.resolve(this.root) + path.sep;
    if (!target.startsWith(root)) throw new Error('Invalid agent profile path');
    return target;
  }

  private async ensureSafeParent(id: string): Promise<void> {
    let current = this.root;
    for (const segment of id.split('/').slice(0, -1)) {
      current = path.join(current, segment);
      try {
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink()) {
          throw new Error('Agent profile path contains a non-directory component');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await mkdir(current);
      }
    }
    const filePath = this.filePath(id);
    try {
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error('Agent profile must be a regular file');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async readOptional(filePath: string): Promise<string | undefined> {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
}

function validateAgentId(id: string): string {
  const segments = id.split('/');
  if (!id || id.length > 160 || segments.some((part) => !ID_SEGMENT.test(part))) {
    throw new Error(
      'Agent ID may contain letters, numbers, hyphens, underscores, and nested / names',
    );
  }
  return id;
}

function validatePrompt(prompt: string): string {
  if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Agent prompt must be at most ${MAX_PROMPT_LENGTH} characters`);
  }
  return prompt;
}

function validateDescription(description: string): string {
  if (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Agent description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  return description;
}

function validateModelSelection(model: AgentModelSelection | null): AgentModelSelection | null {
  if (model === null) return null;
  if (!model || typeof model !== 'object')
    throw new Error('Agent model must be a valid model selection or null');
  const { providerID, modelID, variant } = model;
  if (
    typeof providerID !== 'string' ||
    !providerID ||
    /[\/#\s]/.test(providerID) ||
    typeof modelID !== 'string' ||
    !modelID ||
    modelID.includes('#') ||
    /\s/.test(modelID) ||
    (variant !== undefined && (typeof variant !== 'string' || !variant || /[#\s]/.test(variant)))
  ) {
    throw new Error(
      'Agent model selection must use a valid provider, model ID, and optional variant',
    );
  }
  return { providerID, modelID, ...(variant ? { variant } : {}) };
}

function validateMode(mode: string): string {
  if (!['primary', 'subagent', 'all'].includes(mode)) {
    throw new Error('Agent mode must be primary, subagent, or all');
  }
  return mode;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function parseAgentMarkdown(contents: string): Omit<GlobalAgentProfile, 'id' | 'editable'> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(contents);
  if (!match) return { description: '', mode: 'subagent', prompt: contents.trimEnd(), model: null };
  const frontmatter = match[1] ?? '';
  const descriptionMatch = /^description:\s*(.*)$/m.exec(frontmatter);
  const modeMatch = /^mode:\s*(primary|subagent|all)\s*$/m.exec(frontmatter);
  const modelMatch = /^model:\s*(.*)$/m.exec(frontmatter);
  const description = unquoteYamlScalar(descriptionMatch?.[1] ?? '');
  return {
    description: description.slice(0, MAX_DESCRIPTION_LENGTH),
    mode: modeMatch?.[1] ?? 'subagent',
    prompt: match[2] ?? '',
    model: parseModelReference(unquoteYamlScalar(modelMatch?.[1] ?? '')),
  };
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(trimmed);
      if (typeof decoded === 'string') return decoded;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function parseModelReference(value: string): AgentModelSelection | null {
  if (!value) return null;
  const slash = value.indexOf('/');
  if (slash <= 0) return null;
  const modelAndVariant = value.slice(slash + 1);
  const hash = modelAndVariant.indexOf('#');
  const modelID = hash === -1 ? modelAndVariant : modelAndVariant.slice(0, hash);
  const variant = hash === -1 ? undefined : modelAndVariant.slice(hash + 1);
  if (!modelID || (hash !== -1 && !variant)) return null;
  return { providerID: value.slice(0, slash), modelID, ...(variant ? { variant } : {}) };
}

function createAgentMarkdown(input: {
  description: string;
  mode: string;
  model: AgentModelSelection | null;
  prompt: string;
}): string {
  const fields = [
    `description: ${yamlString(input.description)}`,
    `mode: ${input.mode}`,
    ...(input.model ? [`model: ${yamlString(modelReference(input.model))}`] : []),
  ];
  return `---\n${fields.join('\n')}\n---\n${withTrailingNewline(input.prompt)}`;
}

function updateAgentMarkdown(
  contents: string,
  input: {
    description?: string;
    mode?: string;
    model?: AgentModelSelection | null;
    prompt: string;
  },
): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
  if (!match) {
    throw new Error(
      'Agent Markdown must start with a valid frontmatter block before editing its prompt',
    );
  }
  const lines = (match[1] ?? '').split(/\r?\n/);
  setFrontmatterValue(lines, 'description', input.description);
  setFrontmatterValue(lines, 'mode', input.mode);
  setFrontmatterValue(
    lines,
    'model',
    input.model === undefined
      ? undefined
      : input.model === null
        ? null
        : modelReference(input.model),
  );
  return `---\n${lines.join('\n')}\n---\n${withTrailingNewline(input.prompt)}`;
}

function setFrontmatterValue(lines: string[], key: string, value: string | null | undefined): void {
  if (value === undefined) return;
  const index = lines.findIndex((line) => new RegExp(`^${key}:\\s*`).test(line));
  if (value === null) {
    if (index !== -1) lines.splice(index, 1);
    return;
  }
  const line = `${key}: ${key === 'mode' ? value : yamlString(value)}`;
  if (index === -1) lines.push(line);
  else lines[index] = line;
}

function modelReference(model: AgentModelSelection): string {
  return `${model.providerID}/${model.modelID}${model.variant ? `#${model.variant}` : ''}`;
}

function withTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}
