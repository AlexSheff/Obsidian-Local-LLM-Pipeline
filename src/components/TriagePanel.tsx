import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  HelpCircle,
  CheckCircle2,
  XCircle,
  FolderOutput,
  RefreshCw,
  AlertTriangle,
  Sparkles,
  Wand2
} from 'lucide-react';

interface TriageQuestion {
  index: number;
  targetOption: string;
  targetFolder: string;
  questionText: string;
  answered?: 'yes' | 'no';
}

interface TriageItem {
  id: string;
  filePath: string;
  relativePath: string;
  filename: string;
  contentType: string;
  confidence: number;
  currentQuestionIndex: number;
  questions: TriageQuestion[];
  status: 'pending' | 'resolved' | 'manual';
  resolvedFolder?: string;
}

interface TriagePanelProps {
  config?: any;
  onSaveConfig?: (updatedConfig: any) => Promise<void>;
  onNotify?: () => void;
  onResolved?: () => void;
}

export const TriagePanel: React.FC<TriagePanelProps> = ({ onNotify, onResolved }) => {
  const [items, setItems] = useState<TriageItem[]>([]);
  const [vaultFolders, setVaultFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [autoResolvingAll, setAutoResolvingAll] = useState(false);
  const [customFolders, setCustomFolders] = useState<Record<string, string>>({});
  const [rethoughtNotice, setRethoughtNotice] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchTriage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/decision/triage');
      if (res.data && Array.isArray(res.data.items)) {
        setItems(res.data.items);
      }
      if (res.data && Array.isArray(res.data.vaultFolders)) {
        setVaultFolders(res.data.vaultFolders);
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTriage();
  }, [fetchTriage]);

  const handleAnswer = async (id: string, questionIndex: number, answer: 'yes' | 'no') => {
    setAnsweringId(id);
    setErrorMsg(null);
    try {
      const res = await axios.post('/api/decision/triage/answer', {
        id,
        questionIndex,
        answer
      });
      if (res.data?.rethought && res.data?.nextQuestion) {
        setRethoughtNotice(prev => ({
          ...prev,
          [id]: `AI re-evaluated and proposed: ${res.data.nextQuestion.targetFolder}`
        }));
      }
      await fetchTriage();
      if (onResolved) onResolved();
      if (onNotify) onNotify();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setAnsweringId(null);
    }
  };

  const handleAutoResolveItem = async (id: string) => {
    setAnsweringId(id);
    setErrorMsg(null);
    try {
      await axios.post('/api/decision/triage/auto-resolve', { id });
      await fetchTriage();
      if (onResolved) onResolved();
      if (onNotify) onNotify();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setAnsweringId(null);
    }
  };

  const handleAutoResolveAll = async () => {
    setAutoResolvingAll(true);
    setErrorMsg(null);
    try {
      await axios.post('/api/decision/triage/auto-resolve', {});
      await fetchTriage();
      if (onResolved) onResolved();
      if (onNotify) onNotify();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setAutoResolvingAll(false);
    }
  };

  const handleManualResolve = async (item: TriageItem, folder: string) => {
    if (!folder || !folder.trim()) return;
    setAnsweringId(item.id);
    setErrorMsg(null);
    try {
      await axios.post('/api/decision/triage/resolve', {
        filePath: item.filePath,
        targetFolder: folder.trim()
      });
      await fetchTriage();
      if (onResolved) onResolved();
      if (onNotify) onNotify();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setAnsweringId(null);
    }
  };

  const activeItems = items.filter(i => i.status === 'pending' || i.status === 'manual');
  const resolvedItems = items.filter(i => i.status === 'resolved');

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-neutral-100">
        <div className="flex items-center gap-2.5">
          <HelpCircle className="w-5 h-5 text-amber-600" />
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              Smart Triage & Automatic Alternative Resolver
            </h3>
            <p className="text-xs text-neutral-500">
              Click <span className="text-neutral-900 font-semibold">No</span> to make the model rethink and propose an alternative from your Vault, or click <span className="text-neutral-900 font-semibold">Auto-Resolve All</span> for 100% automatic placement.
            </p>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-medium">
            {activeItems.length} pending
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeItems.length > 0 && (
            <button
              onClick={handleAutoResolveAll}
              disabled={autoResolvingAll}
              className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Wand2 className={`w-3.5 h-3.5 text-emerald-400 ${autoResolvingAll ? 'animate-spin' : ''}`} />
              {autoResolvingAll ? 'Auto-Resolving...' : `Auto-Resolve All (${activeItems.length})`}
            </button>
          )}
          <button
            onClick={fetchTriage}
            disabled={loading}
            className="p-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition-colors"
            title="Refresh Triage Queue"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {activeItems.length === 0 ? (
        <div className="text-center py-8 text-neutral-500 text-xs">
          No notes waiting for review. All documents have been automatically classified and placed.
        </div>
      ) : (
        <div className="space-y-3">
          {activeItems.map(item => {
            const currentQ = item.questions[item.currentQuestionIndex];
            const isBusy = answeringId === item.id || autoResolvingAll;
            const rejectedHistory = item.questions.filter(q => q.answered === 'no');

            return (
              <div
                key={item.id}
                className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-neutral-900">{item.filename}</div>
                    <div className="text-xs text-neutral-500 font-mono">
                      Current path: {item.relativePath || 'Vault Root'} • Confidence:{' '}
                      {Math.round(item.confidence * 100)}%
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAutoResolveItem(item.id)}
                      disabled={isBusy}
                      className="text-xs px-2.5 py-1 rounded-lg bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200 flex items-center gap-1 transition-colors font-medium"
                      title="Let AI rethink and automatically move to the best matching folder"
                    >
                      <Sparkles className="w-3 h-3 text-emerald-600" />
                      Auto-Decide
                    </button>
                    <span className="text-xs px-2 py-0.5 rounded bg-neutral-200 text-neutral-700 font-mono">
                      {item.status === 'manual'
                        ? 'Choose Folder'
                        : `Proposal #${item.currentQuestionIndex + 1}`}
                    </span>
                  </div>
                </div>

                {rejectedHistory.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                    <span>Rejected:</span>
                    {rejectedHistory.map((rq, idx) => (
                      <span
                        key={idx}
                        className="px-1.5 py-0.5 rounded bg-white border border-neutral-200 text-neutral-400 line-through font-mono"
                      >
                        {rq.targetFolder}
                      </span>
                    ))}
                  </div>
                )}

                {rethoughtNotice[item.id] && (
                  <div className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span>{rethoughtNotice[item.id]}</span>
                  </div>
                )}

                {item.status === 'pending' && currentQ ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-neutral-200/70">
                    <div className="text-xs text-neutral-800 font-medium">
                      {currentQ.questionText}{' '}
                      <span className="text-neutral-500 font-normal">
                        (→ <code className="text-emerald-700 font-semibold font-mono">{currentQ.targetFolder}</code>)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={isBusy}
                        onClick={() => handleAnswer(item.id, currentQ.index, 'yes')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Yes, Move Here
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => handleAnswer(item.id, currentQ.index, 'no')}
                        className="px-3 py-1.5 rounded-lg bg-white hover:bg-neutral-100 disabled:opacity-50 text-neutral-800 border border-neutral-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5 text-rose-500" />
                        No, Propose Alternative
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-neutral-200/70 space-y-2.5">
                    <div className="text-xs text-neutral-500">
                      Select any discovered folder from your Vault or enter a new destination path:
                    </div>
                    {vaultFolders.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1">
                        {vaultFolders.map(folder => (
                          <button
                            key={folder}
                            disabled={isBusy}
                            onClick={() => handleManualResolve(item, folder)}
                            className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 hover:border-emerald-300 border border-neutral-200 text-xs text-neutral-800 font-mono flex items-center gap-1 transition-colors"
                          >
                            <FolderOutput className="w-3 h-3 text-emerald-600" />
                            {folder}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={customFolders[item.id] || ''}
                        onChange={e =>
                          setCustomFolders(prev => ({ ...prev, [item.id]: e.target.value }))
                        }
                        placeholder="Or type custom folder path (e.g. 01_Projects/MyProject)..."
                        className="flex-1 bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-800 font-mono focus:outline-none focus:ring-1 focus:ring-neutral-900"
                      />
                      <button
                        disabled={isBusy || !customFolders[item.id]?.trim()}
                        onClick={() => handleManualResolve(item, customFolders[item.id])}
                        className="px-3.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white text-xs font-semibold"
                      >
                        Move
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {resolvedItems.length > 0 && (
        <div className="pt-2 border-t border-neutral-100 text-xs text-neutral-500 flex items-center justify-between">
          <span>Resolved in this session: {resolvedItems.length}</span>
          <span className="text-emerald-700 font-mono font-medium">
            Last moved to: {resolvedItems[0].resolvedFolder}
          </span>
        </div>
      )}
    </div>
  );
};
