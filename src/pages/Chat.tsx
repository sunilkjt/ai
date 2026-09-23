import { useState } from 'react';
import { useStore } from '../store/useStore';
import { Card } from '../components/ui';
import { getAIProvider } from '../providers/ai/factory';
import { CHAT_SYSTEM_PROMPT } from '../agents/prompts';
import { fmtPrice } from '../utils/format';

interface Msg { role: 'user' | 'ai'; text: string; }

export default function Chat(): JSX.Element {
  const analyses = useStore((s) => s.analyses);
  const markets = useStore((s) => s.markets);
  const selectedSymbol = useStore((s) => s.selectedSymbol);
  const selectSymbol = useStore((s) => s.selectSymbol);
  const [input, setInput] = useState('');
  const [log, setLog] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  const a = analyses[selectedSymbol];

  function structuredFacts(): string {
    if (!a) return 'No market data loaded yet.';
    const id = a.identity;
    const identity = `Market ${a.symbol} (${a.assetName}) — ${id.dexLabel} DEX, ${a.category} perpetual on Hyperliquid. ` +
      `Last ${fmtPrice(a.price)} · mark ${fmtPrice(a.derivatives.markPrice)} · oracle ${fmtPrice(a.derivatives.oraclePrice)}. ` +
      (a.stale ? 'Data is STALE — not live. ' : '');
    return identity +
      `Regime ${a.regime} signal ${a.signal.direction} confluence ${a.signal.confluenceScore}/100. ` +
      a.timeframes.map((t) => `${t.timeframe}: bias ${t.bias}, EMA ${t.indicators.emaTrend}, RSI ${t.indicators.rsi?.toFixed(1) ?? 'n/a'}, struct ${t.structure.trend}${t.structure.bos ? ' BOS-' + t.structure.bos : ''}${t.structure.choch ? ' CHoCH-' + t.structure.choch : ''}, sweep ${t.smc.liquiditySweep ?? 'none'}`).join(' | ') +
      ` Invalidation: ${a.signal.invalidation ?? 'n/a'}.`;
  }

  /**
   * "Analyze Apple" must never invent a market: resolve the requested asset
   * against the Hyperliquid registry first. Returns the match, or null when
   * the query names no discoverable market (caller answers "not found").
   */
  function resolveRequestedMarket(q: string): { matched: boolean; requested: boolean } {
    const lower = q.toLowerCase();
    const wantsAnalysis = /(analy|what about|how is|how's|look at|check|price of|view|show me|thoughts on)/.test(lower);
    if (!wantsAnalysis) return { matched: true, requested: false };
    const tokens = lower.split(/[^a-z0-9/$]+/).filter((t) => t.length >= 2);
    if (!tokens.length) return { matched: true, requested: false };
    const hit = markets.some((m) => {
      const hay = `${m.internalSymbol} ${m.displaySymbol} ${m.assetName} ${m.underlying} ${m.dex} ${m.marketId}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    });
    return { matched: hit, requested: true };
  }

  async function send(): Promise<void> {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setLog((l) => [...l, { role: 'user', text: q }]);
    const req = resolveRequestedMarket(q);
    if (req.requested && !req.matched) {
      setLog((l) => [...l, { role: 'ai', text: 'A matching Hyperliquid market was not found. I only analyze markets currently discovered on Hyperliquid — I will not substitute external data.' }]);
      return;
    }
    setBusy(true);
    try {
      const provider = getAIProvider();
      const facts = structuredFacts();
      let answer: string;
      if (provider.name === 'local-fallback') {
        answer = answerLocally(q, facts);
      } else if ('chatText' in provider && typeof (provider as { chatText: unknown }).chatText === 'function') {
        const registry = `Hyperliquid registry: ${markets.length} discovered markets (${[...new Set(markets.map((m) => m.dexLabel))].join(', ')}). ` +
          `Known symbols include: ${markets.slice(0, 60).map((m) => m.displaySymbol).join(', ')}${markets.length > 60 ? '…' : ''}. ` +
          `If the user names an asset with no match here, say a matching Hyperliquid market was not found.`;
        answer = await (provider as { chatText: (s: string, u: string) => Promise<string> }).chatText(
          CHAT_SYSTEM_PROMPT, `Market facts: ${facts}\n${registry}\n\nUser question: ${q}`,
        );
      } else {
        answer = answerLocally(q, facts);
      }
      setLog((l) => [...l, { role: 'ai', text: answer }]);
    } catch {
      setLog((l) => [...l, { role: 'ai', text: 'AI chat unavailable — deterministic analysis on the Analyst page is still available.' }]);
    } finally {
      setBusy(false);
    }
  }

  function answerLocally(q: string, facts: string): string {
    const s = q.toLowerCase();
    if (s.includes('why') && (s.includes('wait') || a?.signal.direction === 'WAIT')) {
      return `The engine is at WAIT because confluence is ${a?.signal.confluenceScore ?? '?'}/100 (needs ≥55 with cross-block agreement).\nOpposing: ${(a?.signal.opposingReasons ?? []).join('; ') || 'none listed'}.\n\nFacts: ${facts}`;
    }
    if (s.includes('invalidat')) {
      return `Invalidation for this setup: ${a?.signal.invalidation ?? 'no active setup — nothing to invalidate'}.\n\nFacts: ${facts}`;
    }
    if (s.includes('structure')) {
      return `Multi-timeframe structure:\n${(a?.timeframes ?? []).map((t) => `${t.timeframe}: ${t.structure.trend}${t.structure.bos ? ' BOS-' + t.structure.bos : ''}${t.structure.choch ? ' CHoCH-' + t.structure.choch : ''}`).join('\n')}\n\nAI analysis is informational and does not guarantee trading results.`;
    }
    return `Based on current structured data:\n${facts}\n\nAsk "why WAIT?", "what would invalidate this setup?", or "explain the current market structure". AI analysis is informational and does not guarantee trading results.`;
  }

  return (
    <div>
      <div className="topbar">
        <div><h1>AI Chat</h1><p>Answers only from the app's structured market data. Never fabricates live prices.</p></div>
        <select value={selectedSymbol} onChange={(e) => selectSymbol(e.target.value)}>
          {Object.keys(analyses).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Card title={`Context: ${selectedSymbol}`}>
        <div className="muted">{structuredFacts()}</div>
      </Card>
      <div style={{ marginTop: 12 }}>
        <Card title="Conversation">
          <div className="chat-box">
            <div className="chat-log">
              {log.length === 0 && <div className="muted">Try: "Why is {selectedSymbol} showing WAIT?" · "What would invalidate this setup?" · "Explain the current market structure."</div>}
              {log.map((m, i) => <div key={i} className={`msg ${m.role === 'user' ? 'user' : ''}`}>{m.text}</div>)}
              {busy && <div className="msg">Thinking…</div>}
            </div>
            <div className="row">
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} placeholder="Ask about the current setup…" style={{ flex: 1 }} />
              <button className="btn" disabled={busy || !input.trim()} onClick={() => void send()}>Send</button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
