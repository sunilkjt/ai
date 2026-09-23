import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Card, Badge } from '../components/ui';
import { timeAgo } from '../utils/format';
import type { AgentName } from '../types';

const AGENTS: { name: AgentName; label: string }[] = [
  { name: 'discovery', label: 'Market Discovery' },
  { name: 'market-data', label: 'Market Data' },
  { name: 'mtf', label: 'Multi-Timeframe' },
  { name: 'technical', label: 'Technical' },
  { name: 'structure', label: 'Structure' },
  { name: 'smc', label: 'SMC' },
  { name: 'ict', label: 'ICT' },
  { name: 'derivatives', label: 'Derivatives' },
  { name: 'asset-class', label: 'Asset Class' },
  { name: 'confluence', label: 'Confluence' },
  { name: 'long', label: 'Long Agent' },
  { name: 'short', label: 'Short Agent' },
  { name: 'contrarian', label: 'Contrarian' },
  { name: 'trap', label: 'Trap Detector' },
  { name: 'critic', label: 'Critic' },
  { name: 'risk', label: 'Risk Agent' },
  { name: 'final', label: 'Final Signal' },
];

export default function AgentMonitor(): JSX.Element {
  const lastAgentLedger = useStore((s) => s.lastAgentLedger);
  const screenStats = useStore((s) => s.screenStats);
  const scanning = useStore((s) => s.scanning);
  const lastScanAt = useStore((s) => s.lastScanAt);
  const screenResults = useStore((s) => s.screenResults);

  const byAgent = useMemo(() => {
    const m = new Map<AgentName, { ok: number; skipped: number; failed: number; last: string }>();
    for (const e of lastAgentLedger) {
      const cur = m.get(e.agent) ?? { ok: 0, skipped: 0, failed: 0, last: '' };
      cur[e.status] += 1;
      cur.last = e.summary;
      m.set(e.agent, cur);
    }
    return m;
  }, [lastAgentLedger]);

  const aiCalls = lastAgentLedger.filter((e) => e.agent === 'mtf' || e.agent === 'critic').length;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>AI Agent Monitor</h1>
          <p>Transparent view of what the agent system did in the last scan. <Link to="/screener">Open Market Screener →</Link></p>
        </div>
      </div>

      <div className="grid grid-4">
        <Card title="Markets scanned"><div className="big">{screenStats?.scanned ?? '—'}</div><div className="muted">{lastScanAt ? `last scan ${timeAgo(lastScanAt)}` : 'no scan yet'}</div></Card>
        <Card title="Fast candidates"><div className="big">{screenStats?.fastCandidates ?? '—'}</div><div className="muted">deterministic stage</div></Card>
        <Card title="AI analyses"><div className="big">{screenStats?.aiReviewed ?? '—'}</div><div className="muted">{aiCalls} agent calls in ledger</div></Card>
        <Card title="Generated / rejected">
          <div className="big">{(screenStats?.longCount ?? 0) + (screenStats?.shortCount ?? 0)}<span className="muted"> / {screenStats?.rejected ?? '—'}</span></div>
          <div className="muted">{scanning ? 'scan in progress…' : `scan took ${screenStats ? (screenStats.durationMs / 1000).toFixed(1) : '—'}s`}</div>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Agent checklist (last scan)">
          {lastAgentLedger.length === 0 && <div className="muted">No scan yet — run Scan Now on the Market Screener.</div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Agent</th><th>Status</th><th>Runs ok</th><th>Skipped</th><th>Failed</th><th>Last summary</th></tr></thead>
              <tbody>
                {AGENTS.map((a) => {
                  const s = byAgent.get(a.name);
                  const state = !s ? '—' : s.failed > 0 ? 'failed' : s.ok > 0 ? 'ok' : 'skipped';
                  return (
                    <tr key={a.name}>
                      <td><strong>{a.label}</strong></td>
                      <td>{state === '—' ? <span className="muted">—</span> : state === 'ok' ? <span className="badge">✓ {state}</span> : <span className="badge wait">{state}</span>}</td>
                      <td>{s?.ok ?? 0}</td>
                      <td>{s?.skipped ?? 0}</td>
                      <td>{s?.failed ?? 0}</td>
                      <td className="muted">{s?.last ?? 'not run'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Scan ledger (latest entries)">
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Agent</th><th>Status</th><th>Summary</th><th>ms</th></tr></thead>
              <tbody>
                {[...lastAgentLedger].slice(-60).reverse().map((e, i) => (
                  <tr key={i}><td>{e.agent}</td><td><Badge value={e.status.toUpperCase()} /></td><td>{e.summary}</td><td className="muted">{e.durationMs}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>{screenResults.length} candidates retained from the last scan. Signals tracked: see Signals + History.</div>
        </Card>
      </div>
    </div>
  );
}
