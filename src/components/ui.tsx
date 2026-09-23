import type { ReactNode } from 'react';
import { CATEGORY_FILTERS } from '../config/app';
import type { CategoryFilter } from '../config/app';
import { CATEGORY_LABELS } from '../types';
import { dexLabelFor } from '../hyperliquid/symbols';

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="card">
      {(title || action) && (
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          {title ? <h3 style={{ margin: 0 }}>{title}</h3> : <span />}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Badge({ value }: { value: string }): JSX.Element {
  const v = value.toUpperCase();
  const cls = v === 'LONG' || v === 'BULLISH' || v.includes('BULL') || v.includes('BREAKOUT') ? 'long'
    : v === 'SHORT' || v === 'BEARISH' || v.includes('BEAR') || v.includes('BREAKDOWN') ? 'short'
    : v === 'WAIT' || v === 'NEUTRAL' || v === 'RANGE' || v === 'UNCLEAR' || v === 'NO_TRADE' ? 'wait' : '';
  return <span className={`badge ${cls}`}>{value}</span>;
}

export function RegimeBadge({ value }: { value: string }): JSX.Element {
  return <Badge value={value.replace(/_/g, ' ')} />;
}

export function CategoryTabs({ value, onChange, counts }: {
  value: CategoryFilter;
  onChange: (c: CategoryFilter) => void;
  counts?: Partial<Record<CategoryFilter, number>>;
}): JSX.Element {
  return (
    <div className="row" role="tablist" aria-label="Asset category">
      {CATEGORY_FILTERS.map((c) => (
        <button
          key={c}
          role="tab"
          aria-selected={value === c}
          className={`btn${value === c ? '' : ' secondary'}`}
          onClick={() => onChange(c)}
        >
          {c === 'ALL' ? 'ALL' : (CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] ?? c).toUpperCase()}
          {counts?.[c] != null ? ` (${counts[c]})` : ''}
        </button>
      ))}
    </div>
  );
}

export function CategoryBadge({ value }: { value: string }): JSX.Element {
  return <span className="badge">{value}</span>;
}

export function DexTabs({ value, dexes, onChange }: {
  value: string;
  /** Actual dex identifiers discovered live ('' = MAIN). Never hard-coded. */
  dexes: string[];
  onChange: (d: string) => void;
}): JSX.Element {
  return (
    <div className="row" role="tablist" aria-label="DEX">
      <span className="muted">DEX</span>
      <button role="tab" aria-selected={value === 'ALL'} className={`btn${value === 'ALL' ? '' : ' secondary'}`} onClick={() => onChange('ALL')}>
        ALL
      </button>
      {dexes.map((d) => (
        <button
          key={d === '' ? 'main' : d}
          role="tab"
          aria-selected={value === d}
          className={`btn${value === d ? '' : ' secondary'}`}
          onClick={() => onChange(d)}
        >
          {dexLabelFor(d)}
        </button>
      ))}
    </div>
  );
}
