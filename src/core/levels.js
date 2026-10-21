/**
 * Auto support / resistance levels.
 *
 * computeLevels() is pure (bars in → levels out) so it can be unit-tested
 * without TradingView. drawLevels() reads bars from the live chart via CDP,
 * computes levels and draws them as horizontal rays (optionally zones).
 *
 * Algorithm:
 *   1. Find swing pivots (fractals): a bar whose high/low is the strict extreme
 *      of `pivot_left` bars before and `pivot_right` bars after it.
 *   2. Cluster pivot prices so that each cluster spans at most `tolerance`
 *      (tolerance_atr × ATR) — each cluster is a candidate level.
 *   3. Score each cluster: every pivot contributes a recency-weighted point
 *      (oldest bar 0.5, newest 1.0), so levels touched often and recently win.
 *   4. Levels strictly below the last close are supports, the rest (including
 *      a level equal to the close) are resistances. Keep the `max_levels`
 *      strongest of each side with at least `min_touches` pivots — or, with
 *      `nearest`, the ones closest to the last close.
 */
import {
  MAX_BARS, validateOptions, atr, findPivots, recency, fmt, tfLabel, isIntraday,
  loadChart, createShape, clearTagged,
} from './autodraw.js';

export { atr, findPivots, tfLabel };

// Shapes are tagged "AutoSR <timeframe> " so 4H and 1D levels coexist.
export const LEVEL_TAG = 'AutoSR';
const KIND = 'level';

export const DEFAULTS = {
  bars: 500,
  pivot_left: 5,
  pivot_right: 5,
  atr_period: 14,
  tolerance_atr: 0.5,
  min_touches: 2,
  max_levels: 3,
  zones: false,
  nearest: false,
  support_color: '#26a69a',
  resistance_color: '#ef5350',
};

const INT_RANGES = {
  bars: [20, MAX_BARS],
  pivot_left: [1, 50],
  pivot_right: [1, 50],
  atr_period: [1, 500],
  min_touches: [1, 1000],
  max_levels: [1, 10],
};

/** Merge options over DEFAULTS and validate; throws before anything touches the chart. */
export const resolveOptions = (opts = {}) => validateOptions(opts, DEFAULTS, INT_RANGES);

// Pivots are sorted ascending, so comparing against the cluster's lowest price
// caps every cluster's width (max - min) at `tolerance` — no chain drift.
function clusterPivots(pivots, tolerance) {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && p.price - last.pivots[0].price <= tolerance) last.pivots.push(p);
    else clusters.push({ pivots: [p] });
  }
  return clusters;
}

export function computeLevels(bars, opts = {}) {
  const o = resolveOptions(opts);
  if (!Array.isArray(bars) || bars.length < o.pivot_left + o.pivot_right + 1) {
    throw new Error(`Need at least ${o.pivot_left + o.pivot_right + 1} bars, got ${bars?.length || 0}`);
  }

  const lastClose = bars[bars.length - 1].close;
  const atrValue = atr(bars, o.atr_period);
  const tolerance = atrValue * o.tolerance_atr;
  const pivots = findPivots(bars, o.pivot_left, o.pivot_right);
  const n = bars.length;

  const levels = clusterPivots(pivots, tolerance)
    .filter(c => c.pivots.length >= o.min_touches)
    .map(c => {
      const prices = c.pivots.map(p => p.price);
      const price = prices.reduce((a, b) => a + b, 0) / prices.length;
      const indices = c.pivots.map(p => p.index);
      const first = c.pivots.find(p => p.index === Math.min(...indices));
      return {
        price,
        type: price < lastClose ? 'support' : 'resistance',
        touches: c.pivots.length,
        score: c.pivots.reduce((s, p) => s + recency(p.index, n), 0),
        last_index: Math.max(...indices),
        first_time: first.time,
        last_time: bars[Math.max(...indices)].time,
        zone_low: Math.min(...prices),
        zone_high: Math.max(...prices),
        distance_pct: Math.round(((price - lastClose) / lastClose) * 10000) / 100,
      };
    });

  // Rank on full-precision score (ties: more touches, then the more recent level),
  // or by distance to the last close when only the nearest levels are wanted.
  const rank = o.nearest
    ? (a, b) => Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose)
    : (a, b) => b.score - a.score || b.touches - a.touches || b.last_index - a.last_index;
  const pick = type => levels
    .filter(l => l.type === type)
    .sort(rank)
    .slice(0, o.max_levels)
    .sort((a, b) => b.price - a.price)
    .map(({ last_index, ...l }) => ({ ...l, score: Math.round(l.score * 100) / 100 }));

  return {
    last_close: lastClose,
    atr: atrValue,
    tolerance,
    pivot_count: pivots.length,
    resistances: pick('resistance'),
    supports: pick('support'),
  };
}

/** Remove auto S/R shapes — only the given timeframe's, or all of them. */
export const clearLevels = ({ timeframe } = {}) => clearTagged({ tag: LEVEL_TAG, kind: KIND, timeframe });

/**
 * Draw computed levels on the chart (caller clears the timeframe first).
 * ctx: { apiPath, resolution, bars, o } — o supplies colors and `zones`.
 */
export async function renderLevels(result, { apiPath, resolution, bars, o }) {
  const tf = tfLabel(resolution);
  const drawn = [];
  const all = [...result.resistances, ...result.supports];
  const maxScore = Math.max(1, ...all.map(l => l.score));
  for (const level of all) {
    const color = level.type === 'support' ? o.support_color : o.resistance_color;
    const touches = level.fallback ? (level.type === 'support' ? 'lo' : 'hi') : `${level.touches}x`;
    const label = `${LEVEL_TAG} ${tf} ${level.type === 'support' ? 'S' : 'R'} ${fmt(level.price)} (${touches})`;
    const entity_id = await createShape(apiPath, [{ time: level.first_time, price: level.price }], 'horizontal_ray', {
      linecolor: color,
      linewidth: 1 + Math.round((level.score / maxScore) * 2),
      // Intraday levels dashed, daily and higher solid, so timeframes are distinguishable.
      linestyle: isIntraday(resolution) ? 2 : 0,
      showLabel: true,
      textcolor: color,
      horzLabelsAlign: 'right',
      vertLabelsAlign: level.type === 'support' ? 'bottom' : 'top',
    }, label, { tf, kind: KIND });
    const entry = { ...level, price: Number(fmt(level.price)), entity_id };

    if (o.zones) {
      // Zone covers every clustered pivot, padded to at least ±tolerance/2 so a
      // single-price level still gets a visible band.
      const half = result.tolerance / 2;
      entry.zone_entity_id = await createShape(apiPath, [
        { time: level.first_time, price: Math.max(level.zone_high, level.price + half) },
        { time: bars[bars.length - 1].time, price: Math.min(level.zone_low, level.price - half) },
      ], 'rectangle', {
        color, backgroundColor: color, fillBackground: true, transparency: 85, linewidth: 0,
      }, `${LEVEL_TAG} ${tf} zone`, { tf, kind: KIND });
    }
    drawn.push(entry);
  }
  return {
    resistances: drawn.filter(l => l.type === 'resistance'),
    supports: drawn.filter(l => l.type === 'support'),
  };
}

export async function drawLevels(opts = {}) {
  const o = resolveOptions(opts);
  const { apiPath, info, bars } = await loadChart(o);

  // Compute before clearing, so a failure leaves the previous levels in place.
  const result = computeLevels(bars, o);
  const cleared = await clearLevels({ timeframe: info.resolution });
  const drawn = await renderLevels(result, { apiPath, resolution: info.resolution, bars, o });

  return {
    success: true,
    symbol: info.symbol,
    timeframe: info.resolution,
    bars_used: bars.length,
    last_close: result.last_close,
    atr: result.atr,
    removed_previous: cleared.removed,
    ...drawn,
  };
}
