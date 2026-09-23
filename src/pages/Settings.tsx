import { useMemo } from 'react';
import { TIMEFRAMES } from '../config/app';
import { useStore, availableDexes, isMarketStale } from '../store/useStore';
import { Card, CategoryBadge } from '../components/ui';
import { clearAnalysisCache } from '../agents/orchestrator';
import { fmtPrice, timeAgo } from '../utils/format';

export default function Settings(): JSX.Element {
  const executionTimeframe = useStore((s) => s.executionTimeframe);
  const setExecutionTimeframe = useStore((s) => s.setExecutionTimeframe);
  const aiEnabled = useStore((s) => s.aiEnabled);
  const riskPercent = useStore((s) => s.riskPercent);
  const leverage = useStore((s) => s.leverage);
  const accountBalance = useStore((s) => s.accountBalance);
  const setRisk = useStore((s) => s.setRisk);
  const category = useStore((s) => s.category);
  const setCategory = useStore((s) => s.setCategory);
  const markets = useStore((s) => s.markets);
  const marketsUpdatedAt = useStore((s) => s.marketsUpdatedAt);
  const newMarketIds = useStore((s) => s.newMarketIds);

  const discovery = useMemo(() => {
    const byCat: Record<string, number> = {};
    const bySrc: Record<string, number> = {};
    let stale = 0;
    for (const m of markets) {
      byCat[m.category] = (byCat[m.category] ?? 0) + 1;
      bySrc[m.classificationSource] = (bySrc[m.classificationSource] ?? 0) + 1;
      if (isMarketStale(m)) stale += 1;
    }
    return { byCat, bySrc, stale, dexes: availableDexes(markets) };
  }, [markets]);

  const aiKeyConfigured =
    (typeof window !== 'undefined' && Boolean(window.__SUNIL_AI__?.apiKey)) ||
    Boolean(import.meta.env.VITE_AI_API_KEY);

  return (
    <div>
      <div className="topbar">
        <div><h1>Settings</h1><p>Defaults, risk, AI usage. No auto-trading in v1 — this terminal never places orders.</p></div>
      </div>
      <div className="grid grid-2">
        <Card title="Defaults">
          <dl className="kv">
            <dt>Default category</dt>
            <dd>
              <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                {(['ALL', 'STOCK', 'COMMODITY', 'INDEX', 'FOREX', 'CRYPTO'] as const).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </dd>
            <dt>Execution TF</dt>
            <dd>
              <select value={executionTimeframe} onChange={(e) => setExecutionTimeframe(e.target.value)}>
                {TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.id} — {t.label}</option>)}
              </select>
            </dd>
          </dl>
          <div className="muted">Suggested: 1D macro · 4H structure · 1H setup · 15M confirmation · 5M entry. Remap freely — the engine follows your mapping.</div>
        </Card>
        <Card title="Risk">
          <dl className="kv">
            <dt>Risk %</dt><dd><input type="number" value={riskPercent} min={0.1} max={5} step={0.1} onChange={(e) => setRisk({ riskPercent: Number(e.target.value) })} style={{ width: 90 }} /></dd>
            <dt>Leverage</dt><dd><input type="number" value={leverage} min={1} max={50} step={1} onChange={(e) => setRisk({ leverage: Number(e.target.value) })} style={{ width: 90 }} /></dd>
            <dt>Balance $</dt><dd><input type="number" value={accountBalance} min={100} step={100} onChange={(e) => setRisk({ accountBalance: Number(e.target.value) })} style={{ width: 130 }} /></dd>
          </dl>
          <div className="muted">Risk math is deterministic. The AI reviews the numbers — it never invents them.</div>
        </Card>
        <Card title="AI usage & cost control">
          <div className="row">
            <label><input type="checkbox" checked={aiEnabled} onChange={(e) => setRisk({ aiEnabled: e.target.checked })} /> AI enabled</label>
          </div>
          <ul className="tight">
            <li>AI key: {aiKeyConfigured ? 'configured (live reasoning)' : 'not configured (local fallback analyst)'}</li>
            <li>AI is called only on: user request · new signal · structure change · volatility event · refresh interval.</li>
            <li>Results cached 5 minutes per structure hash.</li>
          </ul>
          <button className="btn secondary" onClick={() => clearAnalysisCache()}>Clear AI cache</button>
        </Card>
        <Card title="Security">
          <ul className="tight">
            <li>No API keys in the frontend bundle — see .env.example.</li>
            <li>Hyperliquid market data is public (no key). AI keys stay in local .env or a backend proxy.</li>
            <li>v1 never places orders, changes leverage, or moves funds.</li>
          </ul>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card
          title="Hyperliquid Discovery (debug)"
          action={<span className="muted">{marketsUpdatedAt ? `updated ${timeAgo(marketsUpdatedAt)}` : 'no discovery yet'}</span>}
        >
          <div className="grid grid-4">
            <div><div className="big">{discovery.dexes.length}</div><div className="muted">DEXes ({discovery.dexes.map((d) => (d === '' ? 'MAIN' : d.toUpperCase())).join(', ') || '—'})</div></div>
            <div><div className="big">{markets.length}</div><div className="muted">markets discovered</div></div>
            <div><div className="big">{newMarketIds.length}</div><div className="muted">new since last visit</div></div>
            <div><div className="big">{discovery.stale}</div><div className="muted">stale (&gt;5 min)</div></div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {['STOCK', 'COMMODITY', 'INDEX', 'FOREX', 'CRYPTO', 'OTHER', 'UNKNOWN'].map((c) => (
              <span key={c}><CategoryBadge value={c} /> {discovery.byCat[c] ?? 0}</span>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="muted">Classification source:</span>
            {['METADATA', 'DEX', 'PATTERN', 'MAPPING', 'UNKNOWN'].map((s) => (
              <span key={s} className="badge">{s} {discovery.bySrc[s] ?? 0}</span>
            ))}
          </div>
          <div className="table-wrap" style={{ marginTop: 8, maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>DEX</th><th>Internal</th><th>Display</th><th>Underlying</th><th>Category</th><th>Source</th><th>Price</th><th>Status</th></tr></thead>
              <tbody>
                {markets.length === 0 && <tr><td colSpan={8} className="muted">No discovery yet.</td></tr>}
                {markets.map((m) => (
                  <tr key={m.marketId}>
                    <td><span className="badge">{m.dexLabel}</span></td>
                    <td className="muted">{m.internalSymbol}</td>
                    <td><strong>{m.displaySymbol}</strong> <span className="muted">{m.assetName}</span></td>
                    <td>{m.underlying}</td>
                    <td><CategoryBadge value={m.category} /></td>
                    <td><span className="badge" title={m.classificationReason}>{m.classificationSource}</span></td>
                    <td>{m.price != null ? fmtPrice(m.price) : 'N/A'}</td>
                    <td>
                      {newMarketIds.includes(m.marketId) ? <span className="badge">NEW</span> : null}{' '}
                      {isMarketStale(m) ? <span className="badge wait">STALE</span> : <span className="muted">ok</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
