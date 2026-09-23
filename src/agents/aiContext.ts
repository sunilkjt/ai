// Structured AI context builder — generated programmatically from engine facts.
import type { AIContext, AICritiqueContext } from '../types';

function fmt(n: number | null | undefined, digits = 2): string {
  return n == null || Number.isNaN(n) ? 'n/a' : n.toFixed(digits);
}

export function buildAnalystUserMessage(ctx: AIContext): string {
  const tfLines = ctx.timeframes
    .map(
      (t) =>
        `${t.timeframe} [${t.role}]: bias=${t.bias}, EMA trend=${t.indicators.emaTrend} (20=${fmt(t.indicators.ema20)} 50=${fmt(t.indicators.ema50)}), RSI=${fmt(t.indicators.rsi, 1)} ${t.indicators.rsiState}, ATR=${fmt(t.indicators.atrPercent)}%, vol=${t.indicators.volumeState}, structure=${t.structure.trend}${t.structure.bos ? ` BOS-${t.structure.bos}` : ''}${t.structure.choch ? ` CHoCH-${t.structure.choch}` : ''}, SMC pts=${t.smc.points}${t.smc.liquiditySweep ? ` sweep-${t.smc.liquiditySweep}` : ''}, FVG=${t.smc.fvg.filter((f) => !f.mitigated).length}, OB=${t.smc.orderBlocks.filter((o) => !o.mitigated).length}, premium=${t.smc.premium} discount=${t.smc.discount}`,
    )
    .join('\n');
  const hl = ctx.hyperliquid
    ? `Underlying trend=${ctx.hyperliquid.underlyingTrend}, OI trend=${ctx.hyperliquid.openInterestTrend}, funding=${ctx.hyperliquid.fundingState}, premium=${ctx.hyperliquid.premiumState}, crowding=${ctx.hyperliquid.crowdingRisk}. ${ctx.hyperliquid.interpretation}`
    : 'Hyperliquid perp context unavailable';
  return `Symbol: ${ctx.symbol} (${ctx.category} perp on Hyperliquid)
Current price: ${ctx.price}
Execution timeframe: ${ctx.executionTimeframe}
Market regime: ${ctx.regime}

Timeframes:
${tfLines}

Confluence: ${ctx.confluence.total}/100 (${ctx.confluence.band}), direction=${ctx.confluence.direction}
Supporting: ${ctx.confluence.supportingReasons.join('; ') || 'none'}
Opposing: ${ctx.confluence.opposingReasons.join('; ') || 'none'}

Existing signal: direction=${ctx.signal.direction}, entry=${fmt(ctx.signal.entry)} SL=${fmt(ctx.signal.stopLoss)} TP1=${fmt(ctx.signal.takeProfit1)} TP2=${fmt(ctx.signal.takeProfit2)} RR=${fmt(ctx.signal.riskReward)} confluence=${ctx.signal.confluenceScore}

Derivatives: funding=${ctx.derivatives.fundingRate != null ? (ctx.derivatives.fundingRate * 100).toFixed(4) + '%' : 'Data unavailable'} OI=${ctx.derivatives.openInterest ?? 'Data unavailable'} mark=${fmt(ctx.derivatives.markPrice)} oracle=${fmt(ctx.derivatives.oraclePrice)} dayNotional=${ctx.derivatives.dayVolumeNotional != null ? Math.round(ctx.derivatives.dayVolumeNotional).toLocaleString() : 'n/a'} bias=${ctx.derivatives.bias}
Hyperliquid context: ${hl}
Asset insights (${ctx.category}): ${(ctx.assetInsights ?? []).join(' | ') || 'n/a'}

Risk: ${ctx.risk ? `entry=${fmt(ctx.risk.entry)} SL=${fmt(ctx.risk.stopLoss)} TP1=${fmt(ctx.risk.takeProfit1)} RR=${fmt(ctx.risk.riskReward)}` : 'n/a (WAIT or uncomputable)'}

Analyze according to the ${ctx.category} asset class. Return strict JSON only.`;
}

export function buildCriticUserMessage(ctx: AICritiqueContext): string {
  return `${buildAnalystUserMessage(ctx)}

Analyst summary: ${ctx.analystSummary}

Challenge this setup. Verdict LONG/SHORT/WAIT. Return strict JSON only.`;
}
