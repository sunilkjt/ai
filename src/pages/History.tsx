import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { Card, Badge } from '../components/ui';

// Live signal performance (locally tracked) — kept strictly separate from backtests.
export default function History(): JSX.Element {
  const signals = useStore((s) => s.signals);
  const decided = useMemo(() => signals.filter((x) => ['TP1_HIT', 'TP2_HIT', 'SL_HIT'].includes(x.status)), [signals]);
  const wins = decided.filter((x) => x.status === 'TP1_HIT' || x.status === 'TP2_HIT').length;
  const losses = decided.filter((x) => x.status === 'SL_HIT').length;
  const avgRR = decided.length ? decided.reduce((a, x) => a + (x.riskReward ?? 0), 0) / decided.length : 0;

  const bySymbol = useMemo(() => {
    const m = new Map<string, { n: number; w: number }>();
    for (const x of decided) {
      const e = m.get(x.symbol) ?? { n: 0, w: 0 };
      e.n += 1;
      if (x.status !== 'SL_HIT') e.w += 1;
      m.set(x.symbol, e);
    }
    return [...m.entries()];
  }, [decided]);

  return (
    <div>
      <div className="topbar"><div><h1>History</h1><p>Live tracked signals (local). Backtest results live on the Backtest page — never mixed.</p></div></div>
      <div className="grid grid-4">
        <Card title="Decided signals"><div className="big">{decided.length}</div><div className="muted">of {signals.length} tracked</div></Card>
        <Card title="Wins"><div className="big positive">{wins}</div></Card>
        <Card title="Losses"><div className="big negative">{losses}</div></Card>
        <Card title="Avg R:R"><div className="big">{avgRR.toFixed(2)}</div><div className="muted">win rate {decided.length ? ((wins / decided.length) * 100).toFixed(1) : '—'}%</div></Card>
      </div>
      <div style={{ marginTop: 12 }} className="grid grid-2">
        <Card title="Performance by symbol">
          {bySymbol.length === 0 ? <div className="muted">No decided signals yet.</div> : (
            <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Decided</th><th>Wins</th><th>Win rate</th></tr></thead>
            <tbody>{bySymbol.map(([sym, v]) => <tr key={sym}><td><strong>{sym}</strong></td><td>{v.n}</td><td>{v.w}</td><td>{((v.w / v.n) * 100).toFixed(1)}%</td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Card title="All tracked signals">
          <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Dir</th><th>R:R</th><th>Status</th></tr></thead>
          <tbody>{[...signals].reverse().slice(0, 20).map((s) => (
            <tr key={s.id}><td>{s.symbol}</td><td><Badge value={s.direction} /></td><td>{s.riskReward?.toFixed(2) ?? '—'}</td><td>{s.status}</td></tr>
          ))}</tbody></table></div>
        </Card>
      </div>
    </div>
  );
}
