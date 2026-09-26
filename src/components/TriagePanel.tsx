import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Zap,
  FolderInput,
  AlertTriangle,
  ArrowRight
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
  topFolder: string;
  distribution: Array<{ letter: string; option: string; probability: number }>;
  currentQuestionIndex?: number;
  questions?: TriageQuestion[];
  status?: 'pending' | 'resolved' | 'manual';
  timestamp: string;
}

interface TriagePanelProps {
  config: any;
  onSaveConfig: (updatedConfig: any) => Promise<void>;
  onNotify: () => void;
}

export const TriagePanel: React.FC<TriagePanelProps> = ({
  config,
  onNotify
}) => {
  const [triageQueue, setTriageQueue] = useState<TriageItem[]>([]);
  const [loadingTriage, setLoadingTriage] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');

  const threshold = config.decisionConfidenceThreshold ?? 0.8;

  useEffect(() => {
    fetchTriageQueue();
  }, []);

  const fetchTriageQueue = async () => {
    setLoadingTriage(true);
    try {
      const res = await axios.get('/api/decision/triage');
      if (Array.isArray(res.data?.items)) {
        setTriageQueue(res.data.items);
      }
    } catch (e) {
      console.error('Failed to load triage queue', e);
    } finally {
      setLoadingTriage(false);
    }
  };

  const handleAnswerQuestion = async (item: TriageItem, answer: 'yes' | 'no') => {
    setResolvingId(item.id);
    try {
      const qIndex = item.currentQuestionIndex ?? 0;
      const res = await axios.post('/api/decision/triage/answer', {
        id: item.id,
        questionIndex: qIndex,
        answer
      });
      if (res.data?.resolved) {
        setTriageQueue(prev => prev.filter(i => i.id !== item.id));
        onNotify();
      } else if (res.data?.status === 'manual') {
        fetchTriageQueue();
      } else {
        setTriageQueue(prev => prev.map(i => {
          if (i.id === item.id) {
            return { ...i, currentQuestionIndex: (i.currentQuestionIndex ?? 0) + 1 };
          }
          return i;
        }));
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to record triage answer');
    } finally {
      setResolvingId(null);
    }
  };

  const handleResolveTriage = async (item: TriageItem, targetFolder: string) => {
    setResolvingId(item.id);
    try {
      await axios.post('/api/decision/triage/resolve', {
        id: item.id,
        targetFolder,
        filePath: item.filePath
      });
      setTriageQueue(prev => prev.filter(i => i.id !== item.id));
      onNotify();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to move note');
    } finally {
      setResolvingId(null);
    }
  };

  const handleStartFastTriage = async () => {
    setBatchRunning(true);
    setBatchMessage('Scanning vault notes with Jev-Style decision model...');
    try {
      const res = await axios.post('/api/decision/batch-triage', {
        threshold
      });
      setBatchMessage(
        `Fast Triage Complete: Evaluated ${res.data.totalEvaluated} notes. Auto-routed: ${res.data.autoRouted}, Added to review: ${res.data.needsTriage}.`
      );
      fetchTriageQueue();
      onNotify();
    } catch (err: any) {
      setBatchMessage(`Error during batch triage: ${err.response?.data?.error || err.message}`);
    } finally {
      setBatchRunning(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 space-y-6 shadow-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-neutral-100">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-neutral-700" />
            <h3 className="text-base font-semibold text-neutral-900">
              Confidence-Gated Review Queue ({triageQueue.length})
            </h3>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Notes where classification confidence was under {Math.round(threshold * 100)}%. Confirm the correct destination with 1-click.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleStartFastTriage}
            disabled={batchRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
          >
            {batchRunning ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            Run Fast Jev Triage
          </button>

          <button
            onClick={fetchTriageQueue}
            disabled={loadingTriage}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingTriage ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {batchMessage && (
        <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-xs font-mono text-neutral-700">
          {batchMessage}
        </div>
      )}

      {triageQueue.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-neutral-400 gap-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-500/40" />
          <div className="text-center">
            <p className="text-sm font-semibold text-neutral-700">Review Queue is Clean</p>
            <p className="text-xs text-neutral-500 mt-1">
              All processed notes meet your {Math.round(threshold * 100)}% confidence threshold.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {triageQueue.map(item => {
            const activeQuestion = item.questions && item.questions[item.currentQuestionIndex ?? 0];
            return (
              <div
                key={item.id}
                className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 flex flex-col gap-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-neutral-900 font-mono">
                      {item.filename}
                    </span>
                    <span className="text-xs text-neutral-500">
                      Confidence: <strong className="text-amber-700 font-mono">{Math.round(item.confidence * 100)}%</strong>
                    </span>
                    <span className="text-xs text-neutral-400">·</span>
                    <span className="text-xs text-neutral-600">{item.contentType}</span>
                  </div>
                  {item.status === 'manual' && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-rose-100 text-rose-800 rounded">
                      Manual Review Needed
                    </span>
                  )}
                </div>

                <div className="text-xs text-neutral-500">
                  Current path: <span className="font-mono text-neutral-700">{item.relativePath || 'Root'}</span>
                </div>

                {/* Interactive Yes / No Question (C7.1) */}
                {activeQuestion && item.status !== 'manual' && (
                  <div className="bg-white border border-neutral-200/90 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-xs font-semibold text-neutral-900">
                        {activeQuestion.questionText}
                      </span>
                      <span className="text-[11px] text-neutral-500">
                        &rarr; {activeQuestion.targetFolder}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        disabled={resolvingId === item.id}
                        onClick={() => handleAnswerQuestion(item, 'yes')}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center gap-1 shadow-xs"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Да / Yes
                      </button>
                      <button
                        disabled={resolvingId === item.id}
                        onClick={() => handleAnswerQuestion(item, 'no')}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition-colors"
                      >
                        Нет / No
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-neutral-200/60">
                  <span className="text-xs text-neutral-400 mr-1">Direct destination:</span>
                  {item.distribution?.slice(0, 4).map((choice, cIdx) => (
                    <button
                      key={cIdx}
                      disabled={resolvingId === item.id}
                      onClick={() => handleResolveTriage(item, choice.option)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                        cIdx === 0
                          ? 'bg-neutral-800 text-white hover:bg-neutral-700 border-neutral-800'
                          : 'bg-white text-neutral-700 hover:bg-neutral-100 border-neutral-200'
                      }`}
                    >
                      <span>{choice.option}</span>
                      <span className="text-[10px] opacity-75 font-mono">
                        ({Math.round(choice.probability * 100)}%)
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TriagePanel;
