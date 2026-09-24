import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useMarketPolling } from '../hooks/useMarketData';
import { Card, Badge, RegimeBadge, CategoryBadge } from '../components/ui';
import { fmtPrice, fmtPct } from '../utils/format';

export default function Watchlist(): JSX.Element {
  useMarketPolling(false);
  const markets = useStore((s) => s.markets);
  const favorites = useStore((s) => s.favorites);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const analyses = useStore((s) => s.analyses);
  const selectSymbol = useStore((s) => s.selectSymbol);

  const rows = favorites
    .map((f) => markets.find((m) => m.marketId === f || m.internalSymbol === f))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  return (
    <div>
      <div className="topbar">
        <div><h1>Watchlist</h1><p>Your favorited Hyperliquid markets — persisted locally. ⭐ from Markets to add.</p></div>
        <Link className="btn secondary" to="/markets">Find markets</Link>
      </div>
      <Card>
        {rows.length === 0 && <div className="muted">No favorites yet. Example: ⭐ GOLD, ⭐ NASDAQ, ⭐ AAPL, ⭐ TSLA, ⭐ EUR/USD, ⭐ BTC — if listed on Hyperliquid.</div>}
        {rows.length > 0 && (
          <div className="table-wrap"><table>
            <thead><tr><th>★</th><th>Asset</th><th>Category</th><th>DEX</th><th>Price</th><th>24H %</th><th>OI</th><th>Funding</th><th>Regime</th><th>AI</th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const a = analyses[m.marketId];
                return (
                  <tr key={m.marketId}>
                    <td><button className="btn secondary" style={{ padding: '2px 8px' }} onClick={() => toggleFavorite(m.marketId)}>★</button></td>
                    <td><Link to="/analyst" onClick={() => selectSymbol(m.marketId)}><strong>{m.displaySymbol}</strong></Link> <span className="muted">{m.assetName !== m.displaySymbol ? m.assetName : ''}</span></td>
                    <td><CategoryBadge value={m.category} /></td>
                    <td><span className="badge">{m.dexLabel}</span></td>
                    <td>{fmtPrice(a?.price ?? m.price)}</td>
                    <td className={(a?.change24h ?? m.priceChangePercent24h ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtPct(a?.change24h ?? m.priceChangePercent24h)}</td>
                    <td>{a?.openInterest != null ? a.openInterest.toLocaleString() : m.ctx?.openInterest ?? '—'}</td>
                    <td>{a?.fundingRate != null ? `${(a.fundingRate * 100).toFixed(3)}%` : '—'}</td>
                    <td>{a ? <RegimeBadge value={a.regime} /> : <span className="muted">…</span>}</td>
                    <td>{a ? <Badge value={a.signal.direction} /> : <span className="muted">…</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
