import { Link } from 'react-router-dom';
import { useStore, filteredMarkets, availableDexes, isMarketStale } from '../store/useStore';
import { useMarketPolling } from '../hooks/useMarketData';
import { Card, Badge, RegimeBadge, CategoryTabs, CategoryBadge, DexTabs } from '../components/ui';
import { fmtPrice, fmtPct } from '../utils/format';
import { CATEGORY_LABELS } from '../types';
import { dexLabelFor } from '../hyperliquid/symbols';

export default function Markets(): JSX.Element {
  useMarketPolling(false);
  const markets = useStore((s) => s.markets);
  const marketsLoading = useStore((s) => s.marketsLoading);
  const marketsError = useStore((s) => s.marketsError);
  const category = useStore((s) => s.category);
  const setCategory = useStore((s) => s.setCategory);
  const dexFilter = useStore((s) => s.dexFilter);
  const setDexFilter = useStore((s) => s.setDexFilter);
  const newMarketIds = useStore((s) => s.newMarketIds);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const favorites = useStore((s) => s.favorites);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const analyses = useStore((s) => s.analyses);
  const selectSymbol = useStore((s) => s.selectSymbol);

  const dexes = availableDexes(markets);
  const rows = filteredMarkets({ markets, category, search, dexFilter });

  return (
    <div>
      <div className="topbar">
        <div><h1>Hyperliquid Markets</h1><p>Discovered live from Hyperliquid — asset · category · DEX · price · 24h · volume · OI · funding · trend · RSI · confluence · AI signal</p></div>
        <div className="row">
          <input
            placeholder="Search gold, oil, nasdaq, apple, tesla, eurusd, btc, hip…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
        </div>
      </div>

      <CategoryTabs value={category} onChange={setCategory} />
      <div style={{ marginTop: 8 }}>
        <DexTabs value={dexFilter} dexes={dexes} onChange={setDexFilter} />
      </div>

      {marketsLoading && markets.length === 0 && <div className="banner">Discovering Hyperliquid markets…</div>}
      {markets.length === 0 && !marketsLoading && <div className="banner">Hyperliquid connection unavailable — no markets discovered. Check your connection; no cached or placeholder data is shown.</div>}
      {marketsError && markets.length > 0 && <div className="banner">Discovery refresh failed ({marketsError}) — showing last discovered markets.</div>}

      <div style={{ marginTop: 12 }}>
        <Card title={`${rows.length} markets · ${CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category} · DEX ${dexFilter === 'ALL' ? 'ALL' : dexLabelFor(dexFilter)}`}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>★</th><th>Asset</th><th>Category</th><th>DEX</th><th>Price</th><th>24H %</th><th>Volume</th><th>OI</th><th>Funding</th><th>Trend</th><th>RSI</th><th>Conf</th><th>AI</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={13} className="muted">No markets match. Try ALL or another search.</td></tr>}
                {rows.slice(0, 150).map((m) => {
                  const a = analyses[m.marketId];
                  const exec = a?.timeframes.find((t) => t.role === 'CONFIRMATION') ?? a?.timeframes[a.timeframes.length - 1];
                  const fav = favorites.includes(m.marketId);
                  const isNew = newMarketIds.includes(m.marketId);
                  const stale = isMarketStale(m);
                  return (
                    <tr key={m.marketId}>
                      <td>
                        <button className="btn secondary" style={{ padding: '2px 8px' }} onClick={() => toggleFavorite(m.marketId)} title="Favorite">
                          {fav ? '★' : '☆'}
                        </button>
                      </td>
                      <td>
                        <Link to="/analyst" onClick={() => selectSymbol(m.marketId)}><strong>{m.displaySymbol}</strong></Link>{' '}
                        <span className="muted">{m.assetName !== m.displaySymbol ? m.assetName : ''}</span>{' '}
                        {isNew && <span className="badge">NEW</span>}{' '}
                        {stale && <span className="badge wait">STALE</span>}
                      </td>
                      <td><CategoryBadge value={m.category} /></td>
                      <td><span className="badge">{m.dexLabel}</span></td>
                      <td>{fmtPrice(a?.price ?? m.price)}</td>
                      <td className={(a?.change24h ?? m.priceChangePercent24h ?? 0) >= 0 ? 'positive' : 'negative'}>
                        {fmtPct(a?.change24h ?? m.priceChangePercent24h)}
                      </td>
                      <td>{a?.volume24h ? `$${Math.round(a.volume24h).toLocaleString()}` : m.ctx?.dayNtlVlm != null ? `$${Math.round(m.ctx.dayNtlVlm).toLocaleString()}` : 'N/A'}</td>
                      <td>{a?.openInterest != null ? a.openInterest.toLocaleString() : m.ctx?.openInterest ?? 'N/A'}</td>
                      <td>{a?.fundingRate != null ? `${(a.fundingRate * 100).toFixed(3)}%` : m.ctx?.funding != null ? `${(Number(m.ctx.funding) * 100).toFixed(3)}%` : 'N/A'}</td>
                      <td>{exec ? <Badge value={exec.bias} /> : <span className="muted">…</span>}</td>
                      <td>{exec?.indicators.rsi != null ? exec.indicators.rsi.toFixed(0) : 'N/A'}</td>
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
