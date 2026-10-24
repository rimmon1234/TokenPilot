import React from 'react';
import { FlaskConical } from 'lucide-react';

export const BenchmarkLabPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-dark-800">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
          <FlaskConical className="w-6 h-6 text-brand-400" />
          Benchmark Lab & Evaluation
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Reproducible model benchmarking and ground-truth dataset evaluation (Milestone M4).
        </p>
      </div>

      <div className="dev-card p-10 text-center max-w-2xl mx-auto border-dashed border-dark-750">
        <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mx-auto mb-3">
          <FlaskConical className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-slate-100">Benchmark Lab Arriving in Milestone M4</h3>
        <p className="text-xs text-slate-400 mt-2 mb-6 leading-relaxed">
          TokenPilot models remain marked as <code>unbenchmarked</code> until verified against standardized task benchmarks.
          Milestone M4 will introduce reproducible evaluation runs across reasoning, coding, and comprehension subsets.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <div className="p-3.5 rounded-xl bg-dark-850 border border-dark-800">
            <span className="text-[10px] font-mono text-cyan-400 block mb-1">M4 Task</span>
            <strong className="text-xs text-slate-200 block">Coding Evaluation</strong>
            <p className="text-[10px] text-slate-400 mt-1">Unit test pass rate on HumanEval and MBPP programming tasks.</p>
          </div>

          <div className="p-3.5 rounded-xl bg-dark-850 border border-dark-800">
            <span className="text-[10px] font-mono text-cyan-400 block mb-1">M4 Task</span>
            <strong className="text-xs text-slate-200 block">Math & Reasoning</strong>
            <p className="text-[10px] text-slate-400 mt-1">Accuracy on GSM8K and multi-step logic prompts.</p>
          </div>

          <div className="p-3.5 rounded-xl bg-dark-850 border border-dark-800">
            <span className="text-[10px] font-mono text-cyan-400 block mb-1">M4 Task</span>
            <strong className="text-xs text-slate-200 block">Knowledge & Chat</strong>
            <p className="text-[10px] text-slate-400 mt-1">Standardized judge evaluation across broad domain questions.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
