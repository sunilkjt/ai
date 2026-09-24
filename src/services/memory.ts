// Signal memory: persistent per-marketId structured summaries + meaningful-change detection.
// Only meaningful change is remembered (first entry always kept). Raw history is never stored.
import type { AnalysisMemoryEntry } from '../types';

const TRAP_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

export interface MemoryDelta {
  remember: boolean;
  reasons: string[];
}

/**
 * Compare two memory entries and describe what meaningfully changed.
 * Example: LONG 78 → WAIT 52 because 4H structure weakened, trap risk increased.
 */
export function detectMeaningfulChange(
  prev: AnalysisMemoryEntry | undefined,
  next: AnalysisMemoryEntry,
): MemoryDelta {
  if (!prev) return { remember: true, reasons: ['first analysis recorded'] };
  const reasons: string[] = [];

  if (prev.direction !== next.direction) {
    reasons.push(`direction ${prev.direction} → ${next.direction}`);
  }
  if (prev.regime !== next.regime) {
    reasons.push(`regime ${prev.regime} → ${next.regime}`);
  }
  if (prev.confidence != null && next.confidence != null && Math.abs(next.confidence - prev.confidence) >= 15) {
    const dir = next.confidence < prev.confidence ? 'weakened' : 'strengthened';
    reasons.push(`confidence ${dir} ${prev.confidence} → ${next.confidence}`);
  }
  if (Math.abs(next.confluence - prev.confluence) >= 10) {
    const dir = next.confluence < prev.confluence ? 'weakened' : 'strengthened';
    reasons.push(`confluence ${dir} ${prev.confluence} → ${next.confluence}`);
  }
  if (prev.structure !== next.structure) {
    reasons.push(`structure ${prev.structure} → ${next.structure}`);
  }
  if (prev.trapRisk && next.trapRisk && TRAP_RANK[next.trapRisk] > TRAP_RANK[prev.trapRisk]) {
    reasons.push(`trap risk increased ${prev.trapRisk} → ${next.trapRisk}`);
  }
  if (prev.riskReward != null && next.riskReward != null && next.riskReward < prev.riskReward - 0.3) {
    reasons.push(`R:R deteriorated ${prev.riskReward.toFixed(2)} → ${next.riskReward.toFixed(2)}`);
  }
  // OI divergence proxy: entry invalidated levels shifting against the trade
  if (prev.direction !== 'WAIT' && next.direction !== 'WAIT' && prev.entry != null && next.entry != null) {
    if (prev.direction === 'LONG' && next.stopLoss != null && prev.stopLoss != null && next.stopLoss > prev.stopLoss && next.entry < prev.entry) {
      reasons.push('long entry deteriorated (lower entry, wider stop)');
    }
    if (prev.direction === 'SHORT' && next.stopLoss != null && prev.stopLoss != null && next.stopLoss < prev.stopLoss && next.entry > prev.entry) {
      reasons.push('short entry deteriorated (higher entry, wider stop)');
    }
  }

  return { remember: reasons.length > 0, reasons };
}

export function summarizeMemoryEntry(e: AnalysisMemoryEntry): string {
  const conf = e.confidence != null ? ` ${e.confidence}` : '';
  return `${e.direction}${conf} · ${e.regime} · conf ${e.confluence} · trap ${e.trapRisk ?? '—'}`;
}
