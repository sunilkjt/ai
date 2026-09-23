import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore, filteredMarkets } from '../store/useStore';
import { useMarketPolling } from '../hooks/useMarketData';
import { Card, Badge, RegimeBadge, CategoryBadge } from '../components/ui';
import { fmtPrice, fmtPct, timeAgo } from '../utils/format';
import { APP_CONFIG } from '../config/app';
import type { AssetCategory } from '../types';

const SECTIONS: AssetCategory[] = ['STOCK', 'COMMODITY', 'INDEX', 'FOREX', 'CRYPTO'];

export default function Dashboard(): JSX.Element {
  useMarketPolling(false);
  const markets = useStore((s) => s.markets);
  const marketsLoading = useStore((s) => s.marketsLoading);
  const analyses = useStore((s) => s.analyses);
  const signals = useStore((s) => s.signals);
  const selectSymbol = useStore((s) => s.selectSymbol);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of markets) c[m.category] = (c[m.category] ?? 0) + 1;
    return c;
  }, [markets]);

  const highConfluence = useMemo(
    () =>
      Object.values(analyses)
        .filter((a) => a.signal.direction !== 'WAIT')
        .sort((a, b) => b.signal.confluenceScore - a.signal.confluenceScore)
        .slice(0, 6),
    [analyses],
  );

  const activeSignals = signals.filter((s) => ['NEW', 'ACTIVE'].includes(s.status)).slice(-6).reverse();
  const analyzed = Object.keys(analyses).length;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Hyperliquid Market Overview</h1>
          <p>{APP_CONFIG.tagline} — live perp discovery, multi-timeframe engine, AI on demand.</p>
        </div>
        <div className="row">
          <Link className="btn" to="/markets">Browse markets</Link>
          <Link className="btn secondary" to="/analyst">Open AI Analyst</Link>
        </div>
      </div>

      {marketsLoading && markets.length === 0 && <div className="banner">Discovering Hyperliquid markets…</div>}

      <div className="grid grid-4">
        {SECTIONS.map((cat) => (
          <Card key={cat} title={cat === 'STOCK' ? 'Stocks' : cat === 'COMMODITY' ? 'Commodities' : cat === 'INDEX' ? 'Indices' : cat === 'FOREX' ? 'Forex' : 'Crypto'}>
            <div className="big">{counts[cat] ?? 0}<span className="muted" style={{ fontSize: 13 }}> markets</span></div>
            <div className="muted">{analyzed > 0 ? `${analyzed} analyzed this session` : 'Polling…'}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <Card title="High confluence setups (neutral label — not advice)" action={<Link to="/signals">All signals →</Link>}>
          {highConfluence.length === 0 && (
            <div className="muted">No high-confluence setups right now. The engine says WAIT more often than not — by design.</div>
          )}
          <ul className="tight">
            {highConfluence.map((a) => (
              <li key={a.internalSymbol}>
                <Badge value={a.signal.direction} /> <strong>{a.symbol}</strong>{' '}
                <CategoryBadge value={a.category} /> {a.signal.timeframe} · conf {a.signal.confluenceScore} ·{' '}
                <Link to="/analyst" onClick={() => selectSymbol(a.internalSymbol)}>Review →</Link>
              </li>
            ))}
          </ul>
          <div className="muted" style={{ marginTop: 8 }}>
            Labels used: High Confluence · AI Reviewed · Potential Setup · Awaiting Confirmation. Confluence is setup quality (0–100), not profit probability.
          </div>
        </Card>
        <Card title="Active signals" action={<Link to="/signals">All signals →</Link>}>
          {activeSignals.length === 0 && <div className="muted">No active signals tracked yet.</div>}
          <ul className="tight">
            {activeSignals.map((s) => (
              <li key={s.id}>
                <Badge value={s.direction} /> <strong>{s.symbol}</strong> {s.timeframe} · entry {fmtPrice(s.entry)} · SL {fmtPrice(s.stopLoss)} · TP {fmtPrice(s.takeProfit1)} · R:R {s.riskReward?.toFixed(2) ?? '—'}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Market snapshot by category">
          {SECTIONS.map((cat) => {
            const rows = filteredMarkets({ markets, category: cat, search: '' }).slice(0, 5);
            if (rows.length === 0) return null;
            return (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <strong>{cat}</strong>
                  <Link className="muted" to="/markets">view all →</Link>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Asset</th><th>Price</th><th>24H %</th><th>OI</th><th>Funding</th><th>Regime</th><th>AI Signal</th></tr></thead>
                    <tbody>
                      {rows.map((m) => {
                        const a = analyses[m.internalSymbol];
                        return (
                          <tr key={m.internalSymbol}>
                            <td><strong>{m.displaySymbol}</strong></td>
                            <td>{fmtPrice(a?.price ?? m.price)}</td>
                            <td className={(a?.change24h ?? m.priceChangePercent24h ?? 0) >= 0 ? 'positive' : 'negative'}>
                              {fmtPct(a?.change24h ?? m.priceChangePercent24h)}
                            </td>
                            <td>{a?.openInterest != null ? a.openInterest.toLocaleString() : m.ctx?.openInterest ?? '—'}</td>
                            <td>{a?.fundingRate != null ? `${(a.fundingRate * 100).toFixed(3)}%` : '—'}</td>
                            <td>{a ? <RegimeBadge value={a.regime} /> : <span className="muted">…</span>}</td>
                            <td>{a ? <Badge value={a.signal.direction} /> : <span className="muted">…</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {rows[0] && analyses[rows[0].internalSymbol] && (
                  <div className="muted">Updated {timeAgo(analyses[rows[0].internalSymbol].updatedAt)}</div>
                )}
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
