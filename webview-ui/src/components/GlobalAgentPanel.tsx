import { useCallback, useEffect, useState } from 'react';

import { serverToken } from '../transport/serverToken.js';
import { CharacterMugShot } from './CharacterMugShot.js';
import {
  clearLegacyGlobalAgentSessions,
  readGlobalAgentSession,
  removeGlobalAgentSession,
  saveGlobalAgentSession,
} from './globalAgentConversationStore.js';

export interface GlobalAgent {
  id: string;
  name: string;
  description?: string;
  mode?: string;
  profile: {
    prompt: string;
    description: string;
    mode: string;
    model: AgentModelSelection | null;
  } | null;
  available: boolean;
}

interface AgentModelSelection {
  providerID: string;
  modelID: string;
  variant?: string;
}

interface AvailableModel {
  id: string;
  providerID: string;
  name: string;
  enabled: boolean;
  status: string;
  variants: Array<{ id: string }>;
}

interface Project {
  id: string;
  directory: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

async function api<T>(route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(route, {
    ...init,
    headers: {
      authorization: `Bearer ${serverToken ?? ''}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      response.status === 404
        ? 'Pixel Agents API route is missing. Restart or update the Pixel Agents server.'
        : 'Pixel Agents returned a web page instead of API data. Check that you opened the current server URL.',
    );
  }
  const value = (await response.json()) as { error?: string } & T;
  if (!response.ok)
    throw new Error(
      value && 'error' in value ? value.error : `Request failed (${response.status})`,
    );
  return value as T;
}

interface GlobalAgentPanelProps {
  onAgentsChange?: (agents: GlobalAgent[]) => void;
  getAppearance?: (agentId: string) => { palette: number; hueShift: number };
}

export function GlobalAgentPanel({ onAgentsChange, getAppearance }: GlobalAgentPanelProps) {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<GlobalAgent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [agentId, setAgentId] = useState('');
  const [directory, setDirectory] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [draftId, setDraftId] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [modelChoice, setModelChoice] = useState('');
  const [variantChoice, setVariantChoice] = useState('');
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [agentsResult, projectsResult, modelsResult] = await Promise.allSettled([
        api<GlobalAgent[]>('/api/global-agents'),
        api<Project[]>('/api/global-agents/projects'),
        api<AvailableModel[]>('/api/global-agents/models'),
      ]);
      if (agentsResult.status === 'rejected') throw agentsResult.reason;
      const nextAgents = agentsResult.value;
      const nextProjects = projectsResult.status === 'fulfilled' ? projectsResult.value : [];
      const nextModels = modelsResult.status === 'fulfilled' ? modelsResult.value : [];
      setAgents(nextAgents);
      onAgentsChange?.(nextAgents);
      setProjects(nextProjects);
      setModels(nextModels);
      setAgentId((current) => current || nextAgents[0]?.id || '');
      setDirectory((current) => current || nextProjects[0]?.directory || '');
      const unavailable = [
        projectsResult.status === 'rejected' &&
          'OpenCode projects are unavailable. Start the managed OpenCode service to chat.',
        modelsResult.status === 'rejected' &&
          'OpenCode models are unavailable. Start the managed OpenCode service to configure agent models.',
      ].filter(Boolean);
      setError(unavailable.join(' '));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load OpenCode agents');
    }
  }, [onAgentsChange]);

  useEffect(() => {
    if (serverToken) void refresh();
  }, [refresh]);
  useEffect(() => {
    clearLegacyGlobalAgentSessions(window.localStorage);
  }, []);

  useEffect(() => {
    const selection = agents.find((agent) => agent.id === agentId)?.profile?.model;
    setModelChoice(selection ? `${selection.providerID}/${selection.modelID}` : '');
    setVariantChoice(selection?.variant ?? '');
    setModelSettingsOpen(false);
  }, [agentId, agents]);

  useEffect(() => {
    setError('');
    if (!agentId || !directory) {
      setSessionId('');
      setMessages([]);
      setRestoring(false);
      return;
    }

    let cancelled = false;
    const savedSessionId = readGlobalAgentSession(window.localStorage, agentId, directory);
    setSessionId(savedSessionId);
    setMessages([]);
    setRestoring(Boolean(savedSessionId));
    if (!savedSessionId)
      return () => {
        cancelled = true;
      };

    const query = new URLSearchParams({ sessionId: savedSessionId, agentId, directory });
    void api<Message[]>(`/api/global-agents/conversation?${query.toString()}`)
      .then((history) => {
        if (!cancelled) setMessages(history);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          if (cause instanceof Error && cause.message.includes('(404)')) {
            removeGlobalAgentSession(window.localStorage, agentId, directory);
            setSessionId('');
            setMessages([]);
          } else {
            setError(
              cause instanceof Error
                ? `Could not restore this conversation: ${cause.message}`
                : 'Could not restore this conversation',
            );
          }
        }
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, directory]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !agentId || !directory) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ sessionId: string; messages: Message[] }>(
        '/api/global-agents/chat',
        {
          method: 'POST',
          body: JSON.stringify({
            agentId,
            directory,
            sessionId: sessionId || undefined,
            text: prompt,
          }),
        },
      );
      setSessionId(result.sessionId);
      saveGlobalAgentSession(window.localStorage, agentId, directory, result.sessionId);
      setMessages(result.messages);
      setPrompt('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send message');
    } finally {
      setBusy(false);
    }
  }

  async function deleteConversation() {
    if (!sessionId || !agentId || !directory || busy || restoring) return;
    const name = agents.find((agent) => agent.id === agentId)?.name ?? agentId;
    if (!window.confirm(`Permanently delete the conversation with ${name} from this project?`))
      return;

    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams({ sessionId, agentId, directory });
      await api<void>(`/api/global-agents/conversation?${query.toString()}`, { method: 'DELETE' });
      removeGlobalAgentSession(window.localStorage, agentId, directory);
      setSessionId('');
      setMessages([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this conversation');
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!draftId.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/global-agents/${encodeURIComponent(draftId)}`, {
        method: 'PUT',
        body: JSON.stringify({ prompt: draftPrompt, mode: 'subagent' }),
      });
      setDraftId('');
      setDraftPrompt('');
      setCreateAgentOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save agent');
    } finally {
      setBusy(false);
    }
  }

  async function saveModelSettings(event: React.FormEvent) {
    event.preventDefault();
    const selectedAgent = agents.find((agent) => agent.id === agentId);
    if (!selectedAgent?.profile || busy) return;

    const model = models.find((item) => `${item.providerID}/${item.id}` === modelChoice);
    if (modelChoice && !model) {
      setError(
        'The selected model is not available. Choose another model or use the OpenCode default.',
      );
      return;
    }

    setBusy(true);
    setError('');
    try {
      await api(`/api/global-agents/${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          prompt: selectedAgent.profile.prompt,
          description: selectedAgent.profile.description,
          mode: selectedAgent.profile.mode,
          model: model
            ? {
                providerID: model.providerID,
                modelID: model.id,
                ...(variantChoice ? { variant: variantChoice } : {}),
              }
            : null,
        }),
      });
      await refresh();
      setModelSettingsOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save model settings');
    } finally {
      setBusy(false);
    }
  }

  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const selectedModel = models.find((model) => `${model.providerID}/${model.id}` === modelChoice);
  const providers = [...new Set(models.map((model) => model.providerID))];

  if (!serverToken) return null;

  return (
    <div className="team-harness">
      <button
        className="team-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="opencode-agent-menu"
      >
        <span className="team-trigger-icon material-symbols-sharp" aria-hidden="true">
          groups
        </span>
        <span className="team-trigger-copy">
          <span className="team-trigger-title">{open ? 'Close team' : 'Open team'}</span>
        </span>
        <span
          className={`team-trigger-chevron material-symbols-sharp ${open ? 'is-open' : ''}`}
          aria-hidden="true"
        >
          expand_more
        </span>
      </button>
      {open && (
        <section id="opencode-agent-menu" className="team-panel">
          <div className="team-panel-content">
            {error && (
              <p role="alert" className="team-error">
                {error}
              </p>
            )}
            <section className="team-roster" aria-label="Available agents">
              <div className="team-section-heading">
                <h3>Specialists</h3>
                <span>
                  {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
                </span>
              </div>
              <div className="team-agent-grid">
                {agents.map((agent) => {
                  const selected = agent.id === agentId;
                  return (
                    <button
                      key={agent.id}
                      disabled={busy}
                      onClick={() => setAgentId(agent.id)}
                      aria-pressed={selected}
                      className={`team-agent-card ${selected ? 'is-selected' : ''}`}
                    >
                      <span
                        className={`team-agent-avatar ${selected ? 'is-selected' : ''}`}
                        aria-hidden="true"
                      >
                        <CharacterMugShot
                          {...(getAppearance?.(agent.id) ?? { palette: 0, hueShift: 0 })}
                          size={40}
                        />
                      </span>
                      <span className="team-agent-copy">
                        <span className="team-agent-name">{agent.name || agent.id}</span>
                        <span className="team-agent-status">
                          <span
                            className={`team-status-dot ${agent.available ? 'is-ready' : 'is-pending'}`}
                          />
                          {agent.available ? 'Available' : 'Reload required'}
                        </span>
                      </span>
                      {selected && (
                        <span
                          className="material-symbols-sharp team-selected-check"
                          aria-hidden="true"
                        >
                          check
                        </span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`team-agent-card team-new-agent-card ${createAgentOpen ? 'is-selected' : ''}`}
                  aria-expanded={createAgentOpen}
                  onClick={() => setCreateAgentOpen((current) => !current)}
                >
                  <span className="team-agent-avatar team-new-agent-avatar" aria-hidden="true">
                    <span className="material-symbols-sharp">add</span>
                  </span>
                  <span className="team-agent-copy">
                    <span className="team-agent-name">NEW AGENT</span>
                    <span className="team-agent-status">Create a specialist</span>
                  </span>
                </button>
                {agents.length === 0 && <p className="team-empty">No global profiles yet.</p>}
              </div>
              {createAgentOpen && (
                <form className="team-create-agent-form" onSubmit={saveProfile}>
                  <label className="team-project-label">
                    Agent name or ID
                    <input
                      className="team-message-input"
                      value={draftId}
                      onChange={(event) => setDraftId(event.target.value)}
                      placeholder="e.g. researcher"
                      aria-label="Agent ID"
                    />
                  </label>
                  <label className="team-project-label">
                    Instructions
                    <textarea
                      className="team-message-input team-prompt-input"
                      value={draftPrompt}
                      onChange={(event) => setDraftPrompt(event.target.value)}
                      placeholder="What should this agent specialize in?"
                      aria-label="System instructions"
                    />
                  </label>
                  <button disabled={busy || !draftId.trim()} className="team-save-button">
                    Create agent
                  </button>
                </form>
              )}
            </section>

            <section className="team-conversation" aria-label="Conversation">
              <div className="team-conversation-heading">
                <span>{agents.find((agent) => agent.id === agentId)?.name ?? 'Conversation'}</span>
                <div className="team-conversation-actions">
                  <span>{sessionId ? 'Active session' : 'New conversation'}</span>
                  {sessionId && (
                    <button
                      type="button"
                      className="team-delete-conversation material-symbols-sharp"
                      onClick={() => void deleteConversation()}
                      disabled={busy || restoring}
                      aria-label="Delete conversation"
                      title="Delete conversation"
                    >
                      delete
                    </button>
                  )}
                </div>
              </div>
              <div className="team-message-list" aria-live="polite">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`team-message ${message.role === 'user' ? 'from-user' : 'from-agent'}`}
                  >
                    <strong>
                      {message.role === 'user'
                        ? 'You'
                        : (agents.find((agent) => agent.id === agentId)?.name ?? agentId)}
                    </strong>
                    <p className="whitespace-pre-wrap">{message.text}</p>
                  </div>
                ))}
                {restoring && <p className="team-chat-empty">Restoring conversation…</p>}
                {!restoring && messages.length === 0 && (
                  <p className="team-chat-empty">
                    Choose a project and write a message to start a conversation.
                  </p>
                )}
              </div>
              <form onSubmit={send} className="team-composer">
                <input
                  className="team-message-input"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Write a message…"
                  aria-label="Message for the agent"
                />
                <button
                  disabled={
                    busy ||
                    restoring ||
                    !directory ||
                    !agentId ||
                    !agents.find((agent) => agent.id === agentId)?.available
                  }
                  className="team-send-button"
                >
                  <span className="material-symbols-sharp" aria-hidden="true">
                    {busy || restoring ? 'progress_activity' : 'send'}
                  </span>
                  <span>{busy ? 'Sending' : restoring ? 'Loading' : 'Send'}</span>
                </button>
              </form>
            </section>

            <section className="team-agent-settings">
              <button
                type="button"
                className="team-model-settings-toggle"
                aria-expanded={modelSettingsOpen}
                onClick={() => setModelSettingsOpen((current) => !current)}
              >
                <span>
                  <strong>Agent settings</strong>
                  <small>
                    Project context and model · {selectedAgent?.name ?? 'Choose an agent'}
                  </small>
                </span>
                <span className="material-symbols-sharp" aria-hidden="true">
                  {modelSettingsOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              {modelSettingsOpen && (
                <div className="team-agent-settings-content">
                  <label className="team-project-label">
                    Project context
                    <select
                      className="team-project-select"
                      value={directory}
                      disabled={busy}
                      onChange={(event) => setDirectory(event.target.value)}
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.directory}>
                          {project.directory}
                        </option>
                      ))}
                    </select>
                  </label>
                  {agents.some((agent) => !agent.available) && (
                    <p className="team-notice">
                      Some profiles need OpenCode to reload its configuration before you can start a
                      chat.
                    </p>
                  )}
                  {selectedAgent?.profile && (
                    <form onSubmit={saveModelSettings}>
                      <label className="team-project-label">
                        Model
                        <select
                          className="team-project-select"
                          value={modelChoice}
                          disabled={busy}
                          onChange={(event) => {
                            setModelChoice(event.target.value);
                            setVariantChoice('');
                          }}
                        >
                          <option value="">Use OpenCode default</option>
                          {modelChoice && !selectedModel && (
                            <option value={modelChoice}>Unavailable: {modelChoice}</option>
                          )}
                          {providers.map((providerID) => (
                            <optgroup key={providerID} label={providerID}>
                              {models
                                .filter((model) => model.providerID === providerID)
                                .map((model) => (
                                  <option
                                    key={`${model.providerID}/${model.id}`}
                                    value={`${model.providerID}/${model.id}`}
                                  >
                                    {model.name}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <label className="team-project-label">
                        Variant
                        <select
                          className="team-project-select"
                          value={variantChoice}
                          disabled={!selectedModel || busy}
                          onChange={(event) => setVariantChoice(event.target.value)}
                        >
                          <option value="">Use model default</option>
                          {variantChoice &&
                            !selectedModel?.variants.some(
                              (variant) => variant.id === variantChoice,
                            ) && (
                              <option value={variantChoice}>Unavailable: {variantChoice}</option>
                            )}
                          {selectedModel?.variants.map((variant) => (
                            <option key={variant.id} value={variant.id}>
                              {variant.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="team-model-help">
                        If no model is selected, OpenCode uses its default or inherits the calling
                        agent’s model.
                      </p>
                      <button disabled={busy} className="team-save-button">
                        Save model settings
                      </button>
                    </form>
                  )}
                </div>
              )}
            </section>
          </div>
        </section>
      )}
    </div>
  );
}
