import { Link } from 'react-router-dom';
import { useStore, filteredMarkets } from '../store/useStore';
import { useMarketPolling } from '../hooks/useMarketData';
import { Card, Badge, RegimeBadge, CategoryTabs, CategoryBadge } from '../components/ui';
import { fmtPrice, fmtPct } from '../utils/format';
import { CATEGORY_LABELS } from '../types';

export default function Markets(): JSX.Element {
  useMarketPolling(false);
  const markets = useStore((s) => s.markets);
  const marketsLoading = useStore((s) => s.marketsLoading);
  const marketsError = useStore((s) => s.marketsError);
  const category = useStore((s) => s.category);
  const setCategory = useStore((s) => s.setCategory);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const favorites = useStore((s) => s.favorites);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const analyses = useStore((s) => s.analyses);
  const selectSymbol = useStore((s) => s.selectSymbol);

  const rows = filteredMarkets({ markets, category, search });

  return (
    <div>
      <div className="topbar">
        <div><h1>Hyperliquid Markets</h1><p>Discovered live from Hyperliquid — asset · category · price · 24h · volume · OI · funding · trend · RSI · confluence · AI signal</p></div>
        <div className="row">
          <input
            placeholder="Search gold, oil, nasdaq, apple, tesla, eurusd, btc…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
        </div>
      </div>

      <CategoryTabs value={category} onChange={setCategory} />

      {marketsLoading && markets.length === 0 && <div className="banner">Discovering Hyperliquid markets…</div>}
      {marketsError && <div className="banner">Discovery error: {marketsError}</div>}

      <div style={{ marginTop: 12 }}>
        <Card title={`${rows.length} markets · ${CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category}`}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>★</th><th>Asset</th><th>Category</th><th>Price</th><th>24H %</th><th>Volume</th><th>OI</th><th>Funding</th><th>Trend</th><th>RSI</th><th>Conf</th><th>AI</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={12} className="muted">No markets match. Try ALL or another search.</td></tr>}
                {rows.slice(0, 150).map((m) => {
                  const a = analyses[m.internalSymbol];
                  const exec = a?.timeframes.find((t) => t.role === 'CONFIRMATION') ?? a?.timeframes[a.timeframes.length - 1];
                  const fav = favorites.includes(m.internalSymbol);
                  return (
                    <tr key={m.internalSymbol}>
                      <td>
                        <button className="btn secondary" style={{ padding: '2px 8px' }} onClick={() => toggleFavorite(m.internalSymbol)} title="Favorite">
                          {fav ? '★' : '☆'}
                        </button>
                      </td>
                      <td><Link to="/analyst" onClick={() => selectSymbol(m.internalSymbol)}><strong>{m.displaySymbol}</strong></Link></td>
                      <td><CategoryBadge value={m.category} /></td>
                      <td>{fmtPrice(a?.price ?? m.price)}</td>
                      <td className={(a?.change24h ?? m.priceChangePercent24h ?? 0) >= 0 ? 'positive' : 'negative'}>
                        {fmtPct(a?.change24h ?? m.priceChangePercent24h)}
                      </td>
                      <td>{a?.volume24h ? `$${Math.round(a.volume24h).toLocaleString()}` : m.ctx?.dayNtlVlm != null ? `$${Math.round(m.ctx.dayNtlVlm).toLocaleString()}` : '—'}</td>
                      <td>{a?.openInterest != null ? a.openInterest.toLocaleString() : m.ctx?.openInterest ?? '—'}</td>
                      <td>{a?.fundingRate != null ? `${(a.fundingRate * 100).toFixed(3)}%` : m.ctx?.funding != null ? `${(Number(m.ctx.funding) * 100).toFixed(3)}%` : '—'}</td>
                      <td>{exec ? <Badge value={exec.bias} /> : <span className="muted">…</span>}</td>
                      <td>{exec?.indicators.rsi != null ? exec.indicators.rsi.toFixed(0) : '—'}</td>
                      <td>{a ? `${a.signal.confluenceScore}` : '…'}</td>
                      <td>{a ? <><RegimeBadge value={a.regime} /> <Badge value={a.signal.direction} /></> : <span className="muted">…</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 150 && <div className="muted">Showing first 150 of {rows.length} — refine search or category.</div>}
        </Card>
      </div>
    </div>
  );
}
