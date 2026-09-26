import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Share2,
  Cpu,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  Database
} from 'lucide-react';

interface TokenItem {
  key: string;
  kind: string;
  sourceNote: string;
  aliases: string[];
  deprecated?: boolean;
}

interface EdgeItem {
  id: string;
  triple: [string, string, string];
  weight: number;
  evidence: { type: string; note?: string };
  evidenceCount: number;
  status: string;
  tick: number;
}

interface OracleMetrics {
  totalProposed: number;
  totalConfirmed: number;
  totalRejected: number;
  confirmationRate: number;
  oraclePaused: boolean;
}

export const HypergraphWorkspace: React.FC<{ vaultPath: string; onNotify?: () => void }> = ({
  vaultPath,
  onNotify
}) => {
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [edges, setEdges] = useState<EdgeItem[]>([]);
  const [metrics, setMetrics] = useState<OracleMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [searchToken, setSearchToken] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'edges' | 'pending' | 'tokens' | 'report'>('edges');
  const [reportMarkdown, setReportMarkdown] = useState<string>('');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [vaultPath]);

  const fetchData = async () => {
    if (!vaultPath) return;
    setLoading(true);
    try {
      const [tokensRes, edgesRes, metricsRes] = await Promise.all([
        axios.get('/api/hypergraph/tokens'),
        axios.get('/api/hypergraph/edges'),
        axios.get('/api/hypergraph/metrics')
      ]);
      setTokens(tokensRes.data.tokens || []);
      setEdges(edgesRes.data.edges || []);
      setMetrics(metricsRes.data || null);
    } catch (err: any) {
      console.warn('Failed loading hypergraph data:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePredictOracle = async () => {
    setPredicting(true);
    setActionMsg(null);
    try {
      const res = await axios.post('/api/hypergraph/oracle/predict');
      setActionMsg(`Oracle cycle complete (Tick ${res.data.tick}): ${res.data.edgesPending?.length || 0} candidate hyperedges forecasted in ${res.data.wallClockMs}ms.`);
      await fetchData();
      if (onNotify) onNotify();
    } catch (err: any) {
      setActionMsg(`Oracle prediction failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setPredicting(false);
    }
  };

  const handleReviewEdge = async (edgeId: string, answer: 'yes' | 'no') => {
    try {
      await axios.post('/api/hypergraph/triage/review', { edgeId, answer });
      await fetchData();
      if (onNotify) onNotify();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Review failed');
    }
  };

  const handleFetchReport = async () => {
    try {
      const res = await axios.get('/api/hypergraph/report');
      setReportMarkdown(res.data.markdown || '');
    } catch (err: any) {
      setReportMarkdown(`Error loading report: ${err.message}`);
    }
  };

  const pendingEdges = edges.filter(e => e.status === 'pending');
  const activeEdges = edges.filter(e => e.status === 'active');

  const filteredTokens = tokens.filter(t =>
    t.key.toLowerCase().includes(searchToken.toLowerCase()) ||
    t.aliases.some(a => a.toLowerCase().includes(searchToken.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Top Banner / Metrics */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-neutral-100">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600 border border-purple-200/60">
                <Share2 className="w-4 h-4" />
              </div>
              <h2 className="text-base font-semibold text-neutral-900">
                Dynamic Semantic Hypergraph (DSH)
              </h2>
            </div>
            <p className="text-xs text-neutral-500">
              3-Uniform semantic knowledge hypergraph evaluated via local Decision Model primitives (Noul, Score, Choice).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handlePredictOracle}
              disabled={predicting}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 rounded-xl transition-all shadow-xs"
            >
              {predicting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-purple-400" />}
              Forecast H_(t+1) (Oracle)
            </button>

            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Quick KPI stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200/60">
            <span className="text-[11px] font-medium text-neutral-500">Active Tokens</span>
            <p className="text-lg font-bold text-neutral-900 mt-0.5">{tokens.length}</p>
          </div>

          <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200/60">
            <span className="text-[11px] font-medium text-neutral-500">Active Hyperedges</span>
            <p className="text-lg font-bold text-emerald-700 mt-0.5">{activeEdges.length}</p>
          </div>

          <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200/60">
            <span className="text-[11px] font-medium text-neutral-500">Pending Forecasts</span>
            <p className="text-lg font-bold text-purple-700 mt-0.5">{pendingEdges.length}</p>
          </div>

          <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200/60">
            <span className="text-[11px] font-medium text-neutral-500">Oracle Confirmation</span>
            <p className="text-lg font-bold text-neutral-900 mt-0.5">
              {metrics ? `${Math.round(metrics.confirmationRate * 100)}%` : '100%'}
            </p>
          </div>
        </div>

        {actionMsg && (
          <div className="mt-4 p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-xs font-mono text-neutral-700">
            {actionMsg}
          </div>
        )}
      </div>

      {/* Sub-Navigation */}
      <div className="flex items-center gap-1 bg-white border border-neutral-200 rounded-xl p-1 shadow-xs">
        <button
          onClick={() => setActiveSubTab('edges')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeSubTab === 'edges' ? 'bg-neutral-900 text-white font-semibold' : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Active Hyperedges ({activeEdges.length})
        </button>

        <button
          onClick={() => setActiveSubTab('pending')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
            activeSubTab === 'pending' ? 'bg-neutral-900 text-white font-semibold' : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          <span>Oracle Forecasts</span>
          {pendingEdges.length > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] font-bold bg-purple-100 text-purple-800 rounded">
              {pendingEdges.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('tokens')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeSubTab === 'tokens' ? 'bg-neutral-900 text-white font-semibold' : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Tokens Registry ({tokens.length})
        </button>

        <button
          onClick={() => {
            setActiveSubTab('report');
            handleFetchReport();
          }}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeSubTab === 'report' ? 'bg-neutral-900 text-white font-semibold' : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Status Report (_Report.md)
        </button>
      </div>

      {/* Active SubTab Panels */}
      {activeSubTab === 'edges' && (
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 space-y-4 shadow-xs">
          <h3 className="text-sm font-semibold text-neutral-900">Active 3-Uniform Hyperedges</h3>
          {activeEdges.length === 0 ? (
            <p className="text-xs text-neutral-400 py-8 text-center">
              No hyperedges formed yet. Run bootstrap script or process notes through the pipeline.
            </p>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {activeEdges.map(edge => (
                <div
                  key={edge.id}
                  className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-neutral-800 font-mono">
                      [{edge.triple.join(' — ')}]
                    </span>
                    <span className="text-neutral-400">·</span>
                    <span className="text-[11px] text-neutral-500">
                      Evidence: <strong className="text-neutral-700">{edge.evidence.type}</strong> ({edge.evidenceCount})
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-neutral-500 font-mono text-[11px]">
                      w = <strong className="text-emerald-700">{edge.weight}</strong>
                    </span>
                    <span className="px-2 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
                      active
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'pending' && (
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 space-y-4 shadow-xs">
          <h3 className="text-sm font-semibold text-neutral-900">
            Pending Oracle Forecasts Awaiting Human Confirmation (C7 Bridge)
          </h3>
          {pendingEdges.length === 0 ? (
            <p className="text-xs text-neutral-400 py-8 text-center">
              No pending Oracle forecasts. Click "Forecast H_(t+1) (Oracle)" to predict new emergent connections.
            </p>
          ) : (
            <div className="space-y-3">
              {pendingEdges.map(edge => (
                <div
                  key={edge.id}
                  className="p-4 bg-purple-50/50 border border-purple-200/70 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-semibold text-neutral-900 font-mono">
                      [{edge.triple.join(' — ')}]
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-1">
                      Forecasted by Decision Model Choice primitive with probability {Math.round(edge.weight * 100)}%.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleReviewEdge(edge.id, 'yes')}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold flex items-center gap-1 shadow-xs transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
                    </button>
                    <button
                      onClick={() => handleReviewEdge(edge.id, 'no')}
                      className="px-3 py-1.5 bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-lg font-medium transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'tokens' && (
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 space-y-4 shadow-xs">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-neutral-900">Tokens Registry (tokens.jsonl)</h3>
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-neutral-400" />
              <input
                type="text"
                value={searchToken}
                onChange={e => setSearchToken(e.target.value)}
                placeholder="Filter tokens..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[500px] overflow-y-auto">
            {filteredTokens.map(tok => (
              <div
                key={tok.key}
                className="p-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-xs space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-neutral-800 font-mono">{tok.key}</span>
                  <span className="px-1.5 py-0.2 text-[10px] bg-neutral-200 text-neutral-700 rounded font-medium">
                    {tok.kind}
                  </span>
                </div>
                {tok.aliases?.length > 0 && (
                  <p className="text-[10px] text-neutral-500 truncate">
                    Aliases: {tok.aliases.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeSubTab === 'report' && (
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-xs">
          <div className="prose prose-sm max-w-none font-mono text-xs text-neutral-800 whitespace-pre-wrap bg-neutral-50 p-4 rounded-xl border border-neutral-200">
            {reportMarkdown || 'Loading report...'}
          </div>
        </div>
      )}
    </div>
  );
};

export default HypergraphWorkspace;
