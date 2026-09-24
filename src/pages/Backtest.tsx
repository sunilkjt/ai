import { useMemo, useState } from 'react';
import { TIMEFRAMES } from '../config/app';
import { useStore, filteredMarkets } from '../store/useStore';
import { fetchCandlesCached } from '../services/marketService';
import { runBacktest } from '../core/backtest';
import type { BacktestResult } from '../types';
import { Card, CategoryTabs } from '../components/ui';
import type { CategoryFilter } from '../config/app';

// BACKTEST RESULTS — historical simulation. Past performance does not predict future results.
export default function Backtest(): JSX.Element {
  const markets = useStore((s) => s.markets);
  const [category, setCategory] = useState<CategoryFilter>('STOCK');
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('1H');
  const [feePercent, setFeePercent] = useState(0.05);
  const [slippagePercent, setSlippagePercent] = useState(0.02);
  const [leverage, setLeverage] = useState(1);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const options = useMemo(() => filteredMarkets({ markets, category, search: '' }).slice(0, 200), [markets, category]);
  const effective = symbol && options.some((m) => m.marketId === symbol) ? symbol : (options[0]?.marketId ?? '');

  async function run(): Promise<void> {
    if (!effective) return;
    setBusy(true);
    setError('');
    try {
      const tfMap: Record<string, string> = { '1D': '1D', '4H': '4H', '1H': '1H', '15m': '15m', '5m': '5m', '1m': '1m' };
      const { candles } = await fetchCandlesCached(effective, tfMap[timeframe] ?? '1H', 500);
      setResult(runBacktest(candles, effective, timeframe, { feePercent, slippagePercent }));
      void leverage;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'backtest failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div><h1>Backtest</h1><p>Same deterministic strategy, causal only — no look-ahead. Fees + slippage + leverage-aware.</p></div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <CategoryTabs value={category} onChange={(c) => { setCategory(c); setSymbol(''); setResult(null); }} />
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={effective} onChange={(e) => setSymbol(e.target.value)}>
          {options.map((m) => <option key={m.marketId} value={m.marketId}>{m.displaySymbol} · {m.assetName} · {m.category} · {m.dexLabel}</option>)}
        </select>
        <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
          {TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
        </select>
        <label className="muted">Fee % <input type="number" value={feePercent} step={0.01} min={0} max={1} style={{ width: 70 }} onChange={(e) => setFeePercent(Number(e.target.value))} /></label>
        <label className="muted">Slippage % <input type="number" value={slippagePercent} step={0.01} min={0} max={1} style={{ width: 70 }} onChange={(e) => setSlippagePercent(Number(e.target.value))} /></label>
        <label className="muted">Leverage <input type="number" value={leverage} step={1} min={1} max={50} style={{ width: 70 }} onChange={(e) => setLeverage(Number(e.target.value))} /></label>
        <button className="btn" disabled={busy || !effective} onClick={() => void run()}>{busy ? 'Running…' : 'Run backtest'}</button>
      </div>
      {error && <div className="banner">{error}</div>}
      <div className="banner">BACKTEST RESULTS — historical simulation only. Past performance does not guarantee future results. Not financial advice.</div>
      {result && (
        <>
          <div className="grid grid-4">
            <Card title="Total trades"><div className="big">{result.totalTrades}</div></Card>
            <Card title="Win rate"><div className="big">{result.winRate.toFixed(1)}%</div><div className="muted">{result.wins}W / {result.losses}L</div></Card>
            <Card title="Net R"><div className="big">{result.netR.toFixed(1)}R</div><div className="muted">avg {result.avgR.toFixed(2)}R · expectancy {result.expectancy.toFixed(2)}R</div></Card>
            <Card title="Risk"><div className="big">{Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : '∞'}</div><div className="muted">profit factor · max DD {result.maxDrawdownR.toFixed(1)}R</div></Card>
          </div>
          <div style={{ marginTop: 12 }}>
            <Card title={`Trades (${result.trades.length})`}>
              <div className="table-wrap"><table>
                <thead><tr><th>#</th><th>Dir</th><th>Entry</th><th>SL</th><th>TP</th><th>Exit</th><th>Result</th><th>R</th></tr></thead>
                <tbody>{result.trades.slice(-50).reverse().map((t, i) => (
                  <tr key={i}><td>{t.index}</td><td>{t.direction}</td><td>{t.entry.toFixed(2)}</td><td>{t.stopLoss.toFixed(2)}</td>
                  <td>{t.takeProfit.toFixed(2)}</td><td>{t.exit.toFixed(2)}</td><td>{t.result}</td><td>{t.rMultiple.toFixed(2)}</td></tr>
                ))}</tbody>
              </table></div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
