import { useState } from 'react';
import { useStore } from '../store/useStore';
import { Card } from '../components/ui';
import { getAIProvider } from '../providers/ai/factory';
import { CHAT_SYSTEM_PROMPT } from '../agents/prompts';
import { TOOL_NAMES } from '../agents/tools';
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
          `If the user names an asset with no match here, say a matching Hyperliquid market was not found. ` +
          `Available read-only tools (reason over their outputs, never invent): ${TOOL_NAMES.join(', ')}.`;
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

  /**
   * Agent tool loop (local, deterministic): observe the question → decide which
   * read-only tool fits → call it → reason over the verified result.
   * Returns null when no tool matches (falls through to generic answers).
   */
  function answerWithTools(q: string): string | null {
    const st = useStore.getState();
    const s = q.toLowerCase();

    const findResult = (query: string) => {
      const toks = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
      return st.screenResults.find((r) =>
        toks.some((t) =>
          `${r.displaySymbol} ${r.assetName} ${r.marketId}`.toLowerCase().includes(t),
        ),
      );
    };

    // "Scan Hyperliquid for long/short setups" / "Find commodity opportunities"
    if (/scan|find.*(opportunit|setup|long|short)|commodity opportunit/.test(s)) {
      const wantLong = /long/.test(s) && !/short/.test(s);
      const wantShort = /short/.test(s) && !/long/.test(s);
      const wantCommodity = /commodity|commodities|gold|oil/.test(s);
      const pool = st.screenResults.filter((r) => {
        if (wantCommodity && r.category !== 'COMMODITY') return false;
        if (wantLong) return r.aiDirection === 'LONG';
        if (wantShort) return r.aiDirection === 'SHORT';
        return true;
      }).slice(0, 5);
      if (!pool.length) {
        return `Tool scanMarkets: no reviewed candidates match right now (last scan ${st.lastScanAt ? new Date(st.lastScanAt).toLocaleTimeString() : 'never ran'}). Run Scan Now on the Market Screener — I will not invent setups.`;
      }
      return `Tool scanMarkets → top candidates by setup quality:\n` +
        pool.map((r) => `• ${r.displaySymbol} (${r.category} · ${r.dexLabel}): ${r.aiDirection} · quality ${r.setupQuality ?? '—'} · conf ${r.confluence} · trap ${r.trapRisk ?? '—'} · status ${r.status}`).join('\n') +
        `\nOpen the Market Screener for the full WHY/AGAINST cards.`;
    }

    // "Why is GOLD ranked highly?" / "Why was TSLA rejected?"
    const whyMatch = s.match(/why (?:is|was) ([a-z0-9 /$]+?) (?:ranked|rejected|so high|low)/) ?? s.match(/why ([a-z0-9]+)\?/);
    if (/why|ranked|rejected/.test(s) && whyMatch) {
      const r = findResult(whyMatch[1] ?? '');
      if (!r) return `I have no screener record for that market. A matching Hyperliquid market was not found in the last scan.`;
      return `${r.displaySymbol} (${r.assetName} · ${r.dexLabel}): status ${r.status} — ${r.statusReason}.\n` +
        `WHY: ${(r.why.slice(0, 4).join('; ') || 'no strong supporting factors')}.\n` +
        `AGAINST: ${(r.against.slice(0, 4).join('; ') || 'no major opposing factors')}.\n` +
        `Quality ${r.setupQuality ?? '—'}/100, confluence ${r.confluence}/100, trap ${r.trapRisk ?? '—'}. Setup quality is not profit probability.`;
    }

    // "What changed since the last scan?"
    if (/what changed|changed since/.test(s)) {
      const deltas: string[] = [];
      for (const [sym, entries] of Object.entries(st.memory)) {
        const last = entries[entries.length - 1];
        const prev = entries[entries.length - 2];
        if (last && prev && (last.direction !== prev.direction || last.regime !== prev.regime)) {
          deltas.push(`• ${sym}: ${prev.direction}/${prev.regime} → ${last.direction}/${last.regime}`);
        }
      }
      if (!deltas.length) return `Tool getPreviousAnalysis: no direction/regime changes recorded across ${Object.keys(st.memory).length} tracked markets.`;
      return `Tool getPreviousAnalysis → recent changes:\n${deltas.slice(0, 8).join('\n')}`;
    }

    // "Show me markets with bullish 4H and bearish 15M structure"
    const tfMatch = s.match(/(bullish|bearish)\s+(1d|4h|1h|15m|5m|1m)\b.*?(bullish|bearish)\s+(1d|4h|1h|15m|5m|1m)\b/);
    if (tfMatch) {
      const [, d1, t1, d2, t2] = tfMatch;
      const want = (d: string) => (d === 'bullish' ? 'BULLISH' : 'BEARISH');
      const hits = Object.values(st.analyses).filter((x) => {
        const g = (tf: string) => x.timeframes.find((t) => t.timeframe.toLowerCase() === tf)?.bias;
        return g(t1) === want(d1) && g(t2) === want(d2);
      }).slice(0, 8);
      if (!hits.length) return `Tool getMultiTimeframeData: no analyzed market currently shows ${d1} ${t1.toUpperCase()} with ${d2} ${t2.toUpperCase()}.`;
      return `Tool getMultiTimeframeData → matches:\n` +
        hits.map((x) => `• ${x.symbol} (${x.category}): ${x.regime}, ${x.signal.direction}, conf ${x.signal.confluenceScore}`).join('\n');
    }

    // "Find markets with increasing OI and a liquidity sweep"
    if (/open interest|oi\b/.test(s) && /sweep/.test(s)) {
      const hits = Object.values(st.analyses).filter((x) => {
        const exec = x.timeframes[x.timeframes.length - 1];
        return exec?.smc.swept && x.openInterest != null && x.openInterest > 0;
      }).slice(0, 8);
      if (!hits.length) return `Tool getLiquidity+getDerivatives: no analyzed market currently combines a liquidity sweep with reported open interest.`;
      return `Tool getLiquidity+getDerivatives → matches:\n` +
        hits.map((x) => {
          const exec = x.timeframes[x.timeframes.length - 1];
          return `• ${x.symbol}: sweep ${exec?.smc.liquiditySweep}, OI ${x.openInterest?.toLocaleString()}, funding ${x.fundingRate != null ? (x.fundingRate * 100).toFixed(4) + '%' : 'N/A'} — context only, not a direction call.`;
        }).join('\n');
    }

    // "Explain the strongest current SHORT/strongest LONG candidates"
    if (/strongest.*(short|long)/.test(s)) {
      const side = /short/.test(s) ? 'SHORT' : 'LONG';
      const top = st.screenResults.filter((r) => r.aiDirection === side).slice(0, 3);
      if (!top.length) return `No ${side} candidates in the current screener results.`;
      return `Strongest current ${side} candidates (by setup quality):\n` +
        top.map((r) => `• ${r.displaySymbol}: quality ${r.setupQuality ?? '—'}, ${r.statusReason}. Main risk: ${(r.against[0] ?? 'see card')}.`).join('\n');
    }

    return null;
  }

  function answerLocally(q: string, facts: string): string {
    const tool = answerWithTools(q);
    if (tool) return tool;
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
              {log.length === 0 && <div className="muted">Try: "Scan Hyperliquid for long setups" · "Find commodity opportunities" · "Why is {selectedSymbol} ranked highly?" · "What changed since the last scan?" · "Show markets with bullish 4H and bearish 15M"</div>}
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
