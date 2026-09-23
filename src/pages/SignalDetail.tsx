import { useParams, Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Card, Badge, RegimeBadge } from '../components/ui';
import { fmtPrice, fmtTime } from '../utils/format';

export default function SignalDetail(): JSX.Element {
  const { id } = useParams();
  const signals = useStore((s) => s.signals);
  const analyses = useStore((s) => s.analyses);
  const fullAnalyses = useStore((s) => s.fullAnalyses);
  const sig = signals.find((x) => x.id === id);
  const liveList = Object.values(analyses);
  const live = liveList.find((x) => x.symbol === sig?.symbol || x.internalSymbol === sig?.symbol);
  const full = sig ? fullAnalyses[sig.symbol] ?? fullAnalyses[live?.internalSymbol ?? ''] : undefined;

  if (!sig) {
    return <div><h1>Signal not found</h1><p><Link to="/signals">Back to signals</Link></p></div>;
  }

  return (
    <div>
      <div className="topbar">
        <div><h1><Badge value={sig.direction} /> {sig.symbol} <span className="muted">{sig.timeframe} · {sig.status}</span></h1>
        <p>Entry {fmtPrice(sig.entry)} · SL {fmtPrice(sig.stopLoss)} · TP1 {fmtPrice(sig.takeProfit1)} · TP2 {fmtPrice(sig.takeProfit2)} · R:R {sig.riskReward?.toFixed(2) ?? '—'} · {fmtTime(sig.timestamp)}</p></div>
        <Link to="/signals" className="btn secondary">← All signals</Link>
      </div>

      <div className="grid grid-3">
        <Card title="Signal"><dl className="kv">
          <dt>Direction</dt><dd><Badge value={sig.direction} /></dd>
          <dt>Market</dt><dd>{sig.marketId ?? sig.symbol} · {sig.dex === '' ? 'MAIN' : (sig.dex ?? '—')} · {sig.category ?? '—'}</dd>
          <dt>Confluence</dt><dd>{sig.confluenceScore}/100</dd>
          <dt>Setup quality</dt><dd>{sig.setupQuality != null ? `${sig.setupQuality}/100 (setup quality, not profit odds)` : '—'}</dd>
          <dt>Trap risk</dt><dd>{sig.trapRisk ?? '—'}</dd>
          <dt>AI confidence</dt><dd>{sig.aiConfidence != null ? `${sig.aiConfidence}/100` : '—'}</dd>
          <dt>Regime</dt><dd><RegimeBadge value={sig.marketRegime} /></dd>
          <dt>Status</dt><dd>{sig.status}</dd>
          <dt>Invalidation</dt><dd>{sig.invalidation ?? '—'}</dd>
        </dl></Card>
        <Card title="Supporting"><ul className="tight">{sig.supportingReasons.map((r, i) => <li key={i}>✓ {r}</li>)}</ul></Card>
        <Card title="Opposing"><ul className="tight">{sig.opposingReasons.map((r, i) => <li key={i}>⚠ {r}</li>)}</ul></Card>
      </div>

      {live && (
        <div style={{ marginTop: 12 }} className="grid grid-2">
          <Card title="Multi-timeframe (live)">
            <div className="table-wrap"><table>
              <thead><tr><th>TF</th><th>Bias</th><th>EMA</th><th>RSI</th><th>Structure</th><th>SMC</th></tr></thead>
              <tbody>{live.timeframes.map((t) => (
                <tr key={t.timeframe}><td><strong>{t.timeframe}</strong></td><td><Badge value={t.bias} /></td>
                <td>{t.indicators.emaTrend}</td><td>{t.indicators.rsi?.toFixed(0) ?? '—'}</td>
                <td>{t.structure.bos ? `BOS ${t.structure.bos}` : t.structure.choch ? `CHoCH ${t.structure.choch}` : t.structure.trend}</td>
                <td>{t.smc.notes[0] ?? '—'}</td></tr>
              ))}</tbody>
            </table></div>
          </Card>
          <Card title="AI reasoning + critic">
            {full?.ai ? (
              <div>
                <div>Decision <Badge value={full.finalDecision} /> · confidence {full.ai.confidence}/100 (AI assessment, not profit odds)</div>
                <p>{full.ai.explanation}</p>
                {full.critique && <div className="critic" style={{ marginTop: 8 }}><strong>Why this might fail ({full.critique.verdict})</strong><ul className="tight">{full.critique.risks.map((r, i) => <li key={i}>{r}</li>)}</ul><div>{full.critique.critique}</div></div>}
              </div>
            ) : <div className="muted">No AI analysis for this symbol yet. Open AI Analyst and run analysis — deterministic data above is always available.</div>}
          </Card>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Card title="Signal lifecycle (recorded transitions)">
          {(sig.history?.length ?? 0) === 0 && <div className="muted">No transitions recorded.</div>}
          <ul className="tight">
            {(sig.history ?? []).map((h, i) => (
              <li key={i}>{new Date(h.at).toLocaleString()}: {h.from} → <strong>{h.to}</strong> — {h.reason}</li>
            ))}
          </ul>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Why you should WAIT / ACT">
          {sig.direction === 'WAIT'
            ? <div>The engine found no edge: confluence {sig.confluenceScore}/100. Waiting preserves capital — most of trading is waiting.</div>
            : <div>Act only if: price holds the entry zone, invalidation ({sig.invalidation ?? 'structure break'}) stays intact, and position risk is ≤1–2%. Otherwise WAIT — no setup survives poor execution.</div>}
        </Card>
      </div>
    </div>
  );
}
