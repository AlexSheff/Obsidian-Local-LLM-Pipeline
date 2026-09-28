import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import {
  Send,
  FilePlus,
  FileEdit,
  CheckCircle2,
  Loader2,
  ArrowUpRight,
  Check
} from 'lucide-react';

interface MatchedNote {
  relativePath: string;
  filename: string;
  title: string;
  folder: string;
  tags: string[];
  snippet: string;
  score: number;
}

interface ExecutedAction {
  type: 'create_note' | 'edit_note' | 'append_note' | 'move_note';
  targetPath: string;
  title?: string;
  summary: string;
  snapshotId?: string;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  intent?: string;
  jevTelemetry?: {
    online: boolean;
    category?: string;
    confidence?: number;
    suggestedFolder?: string;
  };
  llmOnline?: boolean;
  matchedNotes?: MatchedNote[];
  executedActions?: ExecutedAction[];
}

interface KnowledgeChatPanelProps {
  activeNotePath: string | null;
  activeNoteTitle?: string;
  onSelectNote: (relativePath: string) => void;
  onNoteMutated: (targetPath?: string) => void;
}

export const KnowledgeChatPanel: React.FC<KnowledgeChatPanelProps> = ({
  activeNotePath,
  activeNoteTitle,
  onSelectNote,
  onNoteMutated
}) => {
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Local Knowledge Base AI Assistant is ready (**Jev Router + Primary LLM** tandem).\n\nYou can use this chat to:\n- **Find documents**: *"Find all notes about system prompts and AI assistants"*\n- **Plan projects**: *"Create a launch plan and action items based on the open note"*\n- **Create files**: *"Create a note in 01_Projects/Active with the system architecture"*\n- **Edit & move notes**: *"Append a summary and next steps section to the open note"*',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [autoExecute, setAutoExecute] = useState(true);
  const [tandemState, setTandemState] = useState<{
    checking: boolean;
    tested: boolean;
    jevOnline: boolean;
    llmOnline: boolean;
    jevModel?: string;
    llmModel?: string;
    message?: string;
  }>({
    checking: false,
    tested: false,
    jevOnline: false,
    llmOnline: false
  });
  const [actionToast, setActionToast] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkEngineStatusQuietly();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const showNotice = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 4000);
  };

  const checkEngineStatusQuietly = async () => {
    try {
      const res = await axios.get('/api/models/status');
      setTandemState(prev => ({
        ...prev,
        jevOnline: res.data?.jevServer?.status === 'running',
        llmOnline: res.data?.primaryServer?.status === 'running',
        jevModel: res.data?.jevServer?.modelFilename,
        llmModel: res.data?.primaryServer?.modelFilename
      }));
    } catch {}
  };

  const handleTestTandem = async () => {
    setTandemState(prev => ({ ...prev, checking: true }));
    try {
      const res = await axios.post('/api/models/test-tandem');
      const jevOk = Boolean(res.data?.jev?.online);
      const llmOk = Boolean(res.data?.primaryLlm?.online);
      setTandemState({
        checking: false,
        tested: true,
        jevOnline: jevOk,
        llmOnline: llmOk,
        jevModel: res.data?.jev?.model,
        llmModel: res.data?.primaryLlm?.model,
        message:
          jevOk && llmOk
            ? `Tandem Active: Jev (${res.data.jev.category || 'OK'}) + LLM (${res.data.primaryLlm.latencyMs || 0}ms)`
            : llmOk
            ? 'Primary LLM (8080) is online, Jev (1234) is offline — running Solo-LLM mode with semantic route guardrails'
            : 'Primary LLM (8080) is offline — instant local vault search is active'
      });
    } catch (err: any) {
      setTandemState(prev => ({
        ...prev,
        checking: false,
        tested: true,
        message: 'Verification error: ' + (err.response?.data?.error || err.message)
      }));
    }
  };

  const handleSend = async (presetPrompt?: string) => {
    const text = (presetPrompt ?? input).trim();
    if (!text || sending) return;

    if (!presetPrompt) setInput('');

    const userTurn: ChatTurn = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const historyPayload = messages
      .filter(m => m.id !== 'welcome')
      .slice(-6)
      .map(m => ({ role: m.role, content: m.content }));

    setMessages(prev => [...prev, userTurn]);
    setSending(true);

    try {
      const res = await axios.post('/api/chat/agent', {
        message: text,
        history: historyPayload,
        activeNotePath,
        autoExecuteActions: autoExecute
      });

      const data = res.data;
      const assistantTurn: ChatTurn = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        content: data.reply || 'Request completed.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        intent: data.intent,
        jevTelemetry: data.jevTelemetry,
        llmOnline: data.llmOnline,
        matchedNotes: data.matchedNotes || [],
        executedActions: data.executedActions || []
      };

      setMessages(prev => [...prev, assistantTurn]);
      setTandemState(prev => ({
        ...prev,
        jevOnline: Boolean(data.jevTelemetry?.online),
        llmOnline: Boolean(data.llmOnline)
      }));

      if (Array.isArray(data.executedActions) && data.executedActions.length > 0) {
        const lastAct = data.executedActions[data.executedActions.length - 1];
        onNoteMutated(lastAct.targetPath);
      }
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          content: `Request execution error: ${err.response?.data?.error || err.message}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleSaveReplyAsNote = async (turn: ChatTurn) => {
    const firstLine = turn.content
      .split('\n')
      .map(l => l.replace(/^#+\s*/, '').trim())
      .find(l => l.length >= 3);
    const derivedTitle = (firstLine || 'AI Note').slice(0, 55).replace(/[\\/:*?"<>|]/g, '').trim();
    const targetFolder = turn.jevTelemetry?.suggestedFolder || '01_Projects/Active';

    try {
      const res = await axios.post('/api/vault/note/create', {
        title: derivedTitle,
        folder: targetFolder,
        tags: ['ai-chat', 'plan'],
        body: turn.content
      });
      showNotice(`Created note: ${res.data.relativePath}`);
      onNoteMutated(res.data.relativePath);
    } catch (err: any) {
      showNotice('Failed to create note: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleAppendReplyToActiveNote = async (turn: ChatTurn) => {
    if (!activeNotePath) return;
    try {
      const noteRes = await axios.get('/api/vault/note', { params: { path: activeNotePath } });
      const existing = noteRes.data;
      const updatedBody = `${(existing.body || '').trim()}\n\n---\n\n${turn.content.trim()}\n`;
      await axios.post('/api/vault/note/save', {
        path: activeNotePath,
        frontmatter: existing.frontmatter || {},
        body: updatedBody
      });
      showNotice(`Appended reply to "${activeNotePath}"`);
      onNoteMutated(activeNotePath);
    } catch (err: any) {
      showNotice('Failed to update file: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 flex flex-col h-[760px] overflow-hidden">
      {/* Top Header: Jev + LLM Tandem Status */}
      <div className="p-3.5 px-4 border-b border-neutral-200 bg-neutral-50/60 flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-neutral-900">
              Local AI Chat & Vault Agent
            </h3>
            <span className="text-[11px] text-neutral-500 font-mono">
              {tandemState.llmOnline ? 'LLM: Online' : 'LLM: Search'} ·{' '}
              {tandemState.jevOnline ? 'Jev: Online' : 'Jev: Guard'}
            </span>
          </div>
          <p className="text-[11px] text-neutral-500 truncate mt-0.5">
            {activeNotePath
              ? `Active file: ${activeNoteTitle || activeNotePath}`
              : 'Context: Full Vault Semantic Search (RAG)'}
          </p>
        </div>

        <button
          onClick={handleTestTandem}
          disabled={tandemState.checking}
          className="px-2.5 py-1.5 text-[11px] font-medium bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
          title="Test Jev Decision (1234) + Primary LLM (8080) tandem"
        >
          {tandemState.checking ? (
            <Loader2 className="w-3 h-3 animate-spin text-neutral-500" />
          ) : (
            <CheckCircle2
              className={`w-3 h-3 ${
                tandemState.llmOnline ? 'text-emerald-600' : 'text-amber-500'
              }`}
            />
          )}
          <span>Verify Jev + LLM</span>
        </button>
      </div>

      {/* Tandem diagnostic banner if clicked */}
      {tandemState.tested && tandemState.message && (
        <div className="px-4 py-2 bg-neutral-100 border-b border-neutral-200 text-[11px] text-neutral-700 flex items-center justify-between gap-2">
          <span>{tandemState.message}</span>
          <button
            onClick={() => setTandemState(prev => ({ ...prev, tested: false }))}
            className="text-neutral-500 hover:text-neutral-900 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionToast && (
        <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 text-[11px] text-emerald-800 flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>{actionToast}</span>
        </div>
      )}

      {/* Quick Action Bar for 1-click workflows */}
      <div className="px-3.5 py-2 border-b border-neutral-100 flex items-center gap-1.5 overflow-x-auto bg-white">
        <button
          onClick={() => handleSend('Find all notes about projects, roadmaps, and specifications')}
          disabled={sending}
          className="px-2.5 py-1 text-[11px] font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-md whitespace-nowrap shrink-0 transition-colors"
        >
          Find Projects & Specs
        </button>
        {activeNotePath && (
          <>
            <button
              onClick={() =>
                handleSend(
                  `Create an action plan and next steps based on the open note "${activeNoteTitle || activeNotePath}"`
                )
              }
              disabled={sending}
              className="px-2.5 py-1 text-[11px] font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-md whitespace-nowrap shrink-0 transition-colors"
            >
              Plan from Open Note
            </button>
            <button
              onClick={() =>
                handleSend(
                  `Append an executive summary and key task checklist to the open note "${activeNoteTitle || activeNotePath}"`
                )
              }
              disabled={sending}
              className="px-2.5 py-1 text-[11px] font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-md whitespace-nowrap shrink-0 transition-colors"
            >
              Enrich Open Note
            </button>
          </>
        )}
        <button
          onClick={() =>
            setInput('Create a note in 01_Projects/Active with a roadmap for: ')
          }
          className="px-2.5 py-1 text-[11px] font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-md whitespace-nowrap shrink-0 transition-colors"
        >
          + Create Note
        </button>
      </div>

      {/* Chat Messages Viewport */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50/30">
        {messages.map(m => (
          <div
            key={m.id}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[92%] rounded-xl p-3.5 text-xs leading-relaxed ${
                m.role === 'user'
                  ? 'bg-neutral-900 text-white'
                  : 'bg-white border border-neutral-200 text-neutral-800'
              }`}
            >
              {/* Metadata line for assistant */}
              {m.role === 'assistant' && m.jevTelemetry?.category && (
                <div className="mb-2 pb-1.5 border-b border-neutral-100 text-[11px] text-neutral-500 font-mono flex items-center gap-1.5">
                  <span>Jev: {m.jevTelemetry.category}</span>
                  <span>·</span>
                  <span>{m.jevTelemetry.suggestedFolder}</span>
                  <span>·</span>
                  <span className="tabular-nums">
                    {Math.round((m.jevTelemetry.confidence || 0) * 100)}%
                  </span>
                </div>
              )}

              <div className="whitespace-pre-wrap">{m.content}</div>

              {/* Executed File Actions */}
              {m.executedActions && m.executedActions.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-neutral-100 space-y-1.5">
                  <div className="text-[11px] font-semibold text-emerald-700">
                    Executed Vault File Actions:
                  </div>
                  {m.executedActions.map((act, idx) => (
                    <button
                      key={idx}
                      onClick={() => onSelectNote(act.targetPath)}
                      className="w-full text-left p-2 rounded-lg bg-emerald-50/80 hover:bg-emerald-100/80 border border-emerald-200 text-[11px] text-emerald-900 flex items-center justify-between gap-2 transition-colors"
                    >
                      <span className="font-mono truncate">{act.summary}</span>
                      <span className="text-[10px] font-semibold underline shrink-0">
                        Open
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Matched Vault Notes (RAG Sources) */}
              {m.matchedNotes && m.matchedNotes.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-neutral-100 space-y-1.5">
                  <div className="text-[11px] font-semibold text-neutral-600">
                    Matched Vault Documents ({m.matchedNotes.length}):
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                    {m.matchedNotes.map((n, idx) => (
                      <button
                        key={idx}
                        onClick={() => onSelectNote(n.relativePath)}
                        className="w-full text-left p-2 rounded-lg bg-neutral-50 hover:bg-neutral-100 border border-neutral-200/80 transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold text-neutral-900 truncate">
                            {n.title}
                          </div>
                          <div className="text-[10px] text-neutral-500 font-mono truncate">
                            {n.relativePath}
                          </div>
                        </div>
                        <ArrowUpRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 1-Click Save / Apply Controls on Assistant Replies */}
              {m.role === 'assistant' && m.id !== 'welcome' && (
                <div className="mt-3 pt-2 border-t border-neutral-100 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleSaveReplyAsNote(m)}
                    className="px-2.5 py-1 text-[11px] font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-md flex items-center gap-1 transition-colors whitespace-nowrap"
                  >
                    <FilePlus className="w-3 h-3" />
                    <span>Save as New Note</span>
                  </button>
                  {activeNotePath && (
                    <button
                      onClick={() => handleAppendReplyToActiveNote(m)}
                      className="px-2.5 py-1 text-[11px] font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-md flex items-center gap-1 transition-colors whitespace-nowrap"
                    >
                      <FileEdit className="w-3 h-3" />
                      <span>Append to Open Note</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <span className="text-[10px] text-neutral-400 font-mono mt-1 px-1 tabular-nums">
              {m.timestamp}
            </span>
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-neutral-500 bg-white border border-neutral-200 rounded-xl p-3 w-fit">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-700" />
            <span>Searching vault and generating response with local model...</span>
          </div>
        )}
      </div>

      {/* Bottom Input Area */}
      <div className="p-3 border-t border-neutral-200 bg-white space-y-2">
        <div className="flex items-center justify-between text-[11px] text-neutral-500 px-1">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoExecute}
              onChange={e => setAutoExecute(e.target.checked)}
              className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
            />
            <span>Allow AI to create and edit vault files on command</span>
          </label>
          <button
            onClick={() =>
              setMessages([
                {
                  id: 'welcome',
                  role: 'assistant',
                  content: 'Chat history cleared. Ask a question about your vault or issue a file command.',
                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                }
              ])
            }
            className="text-neutral-400 hover:text-neutral-700"
          >
            Clear Chat
          </button>
        </div>

        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={2}
            placeholder="Search notes, draft a project plan, create or update a file..."
            className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-900 resize-none"
          />
          <button
            onClick={() => handleSend()}
            disabled={sending || !input.trim()}
            className="px-4 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center justify-center transition-colors shrink-0"
            title="Send (Enter)"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeChatPanel;
