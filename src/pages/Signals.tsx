import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useMarketPolling } from '../hooks/useMarketData';
import { Card, Badge, RegimeBadge, CategoryTabs } from '../components/ui';
import { fmtPrice, fmtTime } from '../utils/format';
import type { CategoryFilter } from '../config/app';

export default function Signals(): JSX.Element {
  useMarketPolling(false);
  const signals = useStore((s) => s.signals);
  const selectSignal = useStore((s) => s.selectSignal);
  const markets = useStore((s) => s.markets);
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [status, setStatus] = useState<string>('ALL');

  const catOf = (symbol: string): string => {
    const m = markets.find((x) => x.displaySymbol === symbol || x.internalSymbol === symbol);
    return m?.category ?? 'UNKNOWN';
  };

  const rows = [...signals].reverse().filter((s) => {
    if (category !== 'ALL' && catOf(s.symbol) !== category) return false;
    if (status !== 'ALL' && s.status !== status) return false;
    return true;
  });

  return (
    <div>
      <div className="topbar">
        <div><h1>Signals</h1><p>Deterministic signals with lifecycle: NEW · ACTIVE · TP1 HIT · TP2 HIT · SL HIT · INVALIDATED · EXPIRED.</p></div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <CategoryTabs value={category} onChange={setCategory} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {['ALL', 'NEW', 'ACTIVE', 'TP1_HIT', 'TP2_HIT', 'SL_HIT', 'INVALIDATED', 'EXPIRED'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      <Card>
        <div className="table-wrap"><table>
          <thead><tr><th>Symbol</th><th>Cat</th><th>Dir</th><th>Entry</th><th>SL</th><th>TP1</th><th>TP2</th><th>R:R</th><th>Conf</th><th>Regime</th><th>TF</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={13} className="muted">No signals yet. WAIT is a valid state — signals appear when confluence ≥ 55 with cross-block agreement.</td></tr>}
            {rows.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => selectSignal(s.id)}>
                <td><Link to={`/signals/${s.id}`} onClick={() => selectSignal(s.id)}><strong>{s.symbol}</strong></Link></td>
                <td className="muted">{catOf(s.symbol)}</td>
                <td><Badge value={s.direction} /></td>
                <td>{fmtPrice(s.entry)}</td>
                <td>{fmtPrice(s.stopLoss)}</td>
                <td>{fmtPrice(s.takeProfit1)}</td>
                <td>{fmtPrice(s.takeProfit2)}</td>
                <td>{s.riskReward?.toFixed(2) ?? '—'}</td>
                <td>{s.confluenceScore}</td>
                <td><RegimeBadge value={s.marketRegime} /></td>
                <td>{s.timeframe}</td>
                <td><span className="badge">{s.status.replace(/_/g, ' ')}</span></td>
                <td className="muted">{fmtTime(s.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
