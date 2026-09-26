import React, { useState } from 'react';
import {
  FolderSearch,
  Copy,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import DirectoryRevisor from './DirectoryRevisor';
import DuplicateCleaner from './DuplicateCleaner';
import { TriagePanel } from './TriagePanel';
import { HypergraphWorkspace } from './HypergraphWorkspace';
import { Share2 } from 'lucide-react';

interface VaultWorkspaceProps {
  vaultPath: string;
  config: any;
  triageCount: number;
  onNotify: () => void;
  onSaveConfig: (updatedConfig: any) => Promise<void>;
}

export const VaultWorkspace: React.FC<VaultWorkspaceProps> = ({
  vaultPath,
  config,
  triageCount,
  onNotify,
  onSaveConfig
}) => {
  const [subView, setSubView] = useState<'revisor' | 'duplicates' | 'triage' | 'hypergraph'>('revisor');

  return (
    <div className="space-y-6">
      {/* Workspace Sub-Navigation / Segmented Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-neutral-200/80 rounded-2xl p-3 px-4 shadow-xs">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            Vault Organization & Maintenance Workspace
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Audit project clusters, purge ghost notes, deduplicate files, and triage low-confidence notes
          </p>
        </div>

        {/* Clean Segmented Controls (Anti-Slop, No Pills) */}
        <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl shrink-0">
          <button
            onClick={() => setSubView('revisor')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              subView === 'revisor'
                ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <FolderSearch className="w-3.5 h-3.5 text-amber-500" />
            <span>Project & Folder Audit</span>
          </button>

          <button
            onClick={() => setSubView('duplicates')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              subView === 'duplicates'
                ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Copy className="w-3.5 h-3.5 text-blue-500" />
            <span>Duplicate Notes</span>
          </button>

          <button
            onClick={() => setSubView('triage')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              subView === 'triage'
                ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-purple-500" />
            <span>Review & Triage</span>
            {triageCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-amber-100 text-amber-800 font-bold text-[10px] rounded border border-amber-300">
                {triageCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setSubView('hypergraph')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              subView === 'hypergraph'
                ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Share2 className="w-3.5 h-3.5 text-indigo-500" />
            <span>Hypergraph (DSH)</span>
          </button>
        </div>
      </div>

      {/* Workspace Content Panels */}
      {subView === 'revisor' && (
        <DirectoryRevisor
          vaultPath={vaultPath}
          onNotify={onNotify}
        />
      )}

      {subView === 'duplicates' && (
        <DuplicateCleaner onNotify={onNotify} />
      )}

      {subView === 'triage' && (
        <TriagePanel
          config={config}
          onSaveConfig={onSaveConfig}
          onNotify={onNotify}
        />
      )}

      {subView === 'hypergraph' && (
        <HypergraphWorkspace
          vaultPath={vaultPath}
          onNotify={onNotify}
        />
      )}
    </div>
  );
};

export default VaultWorkspace;
