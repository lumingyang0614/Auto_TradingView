/**
 * Auto trend lines.
 *
 * computeTrendlines() is pure (bars in → lines out) so it can be unit-tested
 * without TradingView. drawTrendlines() reads bars from the live chart via CDP,
 * computes lines and draws them as right-extended trend lines.
 *
 * Algorithm:
 *   1. Find swing pivots (same fractals as the S/R levels).
 *   2. Uptrend candidates connect two rising pivot lows, downtrend candidates
 *      two falling pivot highs, at least `min_span` bars apart and rising/falling
 *      by at least `tolerance` between them (flatter lines are S/R levels).
 *   3. A candidate is valid only while price respects it: no close from the
 *      first anchor to the last bar may cross the line by more than `tolerance`
 *      (tolerance_atr × ATR) — broken lines are dropped.
 *   4. Touches are pivots of the same side within `tolerance` of the line;
 *      score = recency-weighted touches. Recency is weighted more steeply than
 *      for S/R levels (oldest bar 0.2, newest 1.0, quadratic) because a trend
 *      line is only useful while price is still interacting with it.
 *   5. Keep the `max_lines` strongest per direction, skipping near-duplicates
 *      (sharing an anchor, or within `tolerance` of a kept line at the last bar).
 *
 * Lines are measured in bar-index space, which matches how TradingView lays
 * out the time axis (sessions without bars take no space).
 */
import {
  MAX_BARS, validateOptions, atr, findPivots, fmt, tfLabel, isIntraday,
  loadChart, createShape, clearTagged,
} from './autodraw.js';

// Shapes are tagged "AutoTL <timeframe> " so 4H and 1D lines coexist.
export const TREND_TAG = 'AutoTL';
const KIND = 'trend';

export const DEFAULTS = {
  bars: 500,
  pivot_left: 5,
  pivot_right: 5,
  atr_period: 14,
  tolerance_atr: 0.5,
  min_touches: 2,
  min_span: 10,
  max_lines: 2,
  up_color: '#00bcd4',
  down_color: '#ff9800',
};

const INT_RANGES = {
  bars: [20, MAX_BARS],
  pivot_left: [1, 50],
  pivot_right: [1, 50],
  atr_period: [1, 500],
  min_touches: [2, 100],
  min_span: [1, MAX_BARS],
  max_lines: [1, 5],
};

/** Merge options over DEFAULTS and validate; throws before anything touches the chart. */
export const resolveOptions = (opts = {}) => validateOptions(opts, DEFAULTS, INT_RANGES);

export const recency = (index, n) => 0.2 + 0.8 * (index / (n - 1)) ** 2;

/**
 * All valid lines through two pivots of one side, at least `o.min_span` bars apart
 * with `o.min_touches` pivots on them.
 * dir = +1: line under price (through lows), no close may fall below it.
 * dir = -1: line over price (through highs), no close may rise above it.
 * `acceptRise(rise)` filters by the price change between the two anchors.
 */
export function lineCandidates(bars, pivots, dir, o, tolerance, acceptRise) {
  const n = bars.length;
  const out = [];
  for (let a = 0; a < pivots.length; a++) {
    for (let b = a + 1; b < pivots.length; b++) {
      const p1 = pivots[a];
      const p2 = pivots[b];
      if (p2.index - p1.index < o.min_span) continue;
      if (!acceptRise(p2.price - p1.price)) continue;
      const slope = (p2.price - p1.price) / (p2.index - p1.index);
      const at = k => p1.price + slope * (k - p1.index);

      let broken = false;
      for (let k = p1.index; k < n && !broken; k++) {
        broken = dir * (bars[k].close - at(k)) < -tolerance;
      }
      if (broken) continue;

      const touches = pivots.filter(p => p.index >= p1.index && Math.abs(p.price - at(p.index)) <= tolerance);
      if (touches.length < o.min_touches) continue;
      out.push({
        p1, p2, slope, touches,
        score: touches.reduce((s, p) => s + recency(p.index, n), 0),
        last_touch: Math.max(...touches.map(p => p.index)),
        current: at(n - 1),
      });
    }
  }
  return out;
}

function pickLines(cands, o, tolerance) {
  // Full-precision score first; ties go to more touches, then the more recent touch.
  const sorted = cands.sort((a, b) => b.score - a.score || b.touches.length - a.touches.length || b.last_touch - a.last_touch);
  const kept = [];
  for (const c of sorted) {
    if (kept.length >= o.max_lines) break;
    const sharesAnchor = k => [k.p1.index, k.p2.index].some(i => i === c.p1.index || i === c.p2.index);
    const dup = kept.some(k => sharesAnchor(k) || Math.abs(k.current - c.current) <= tolerance);
    if (!dup) kept.push(c);
  }
  return kept;
}

export function computeTrendlines(bars, opts = {}) {
  const o = resolveOptions(opts);
  if (!Array.isArray(bars) || bars.length < o.pivot_left + o.pivot_right + 1) {
    throw new Error(`Need at least ${o.pivot_left + o.pivot_right + 1} bars, got ${bars?.length || 0}`);
  }

  const lastClose = bars[bars.length - 1].close;
  const atrValue = atr(bars, o.atr_period);
  const tolerance = atrValue * o.tolerance_atr;
  const pivots = findPivots(bars, o.pivot_left, o.pivot_right);
  const lows = pivots.filter(p => p.kind === 'low');
  const highs = pivots.filter(p => p.kind === 'high');

  const describe = (c, type) => ({
    type,
    touches: c.touches.length,
    score: Math.round(c.score * 100) / 100,
    start: { time: c.p1.time, price: c.p1.price },
    end: { time: c.p2.time, price: c.p2.price },
    current_price: c.current,
    distance_pct: Math.round(((c.current - lastClose) / lastClose) * 10000) / 100,
    slope_per_bar: c.slope,
  });

  return {
    last_close: lastClose,
    atr: atrValue,
    tolerance,
    pivot_count: pivots.length,
    // Trend lines must actually rise/fall by `tolerance`; flatter ones are S/R levels.
    uptrends: pickLines(lineCandidates(bars, lows, 1, o, tolerance, rise => rise >= tolerance), o, tolerance).map(c => describe(c, 'uptrend')),
    downtrends: pickLines(lineCandidates(bars, highs, -1, o, tolerance, rise => -rise >= tolerance), o, tolerance).map(c => describe(c, 'downtrend')),
  };
}

/** Remove auto trend lines — only the given timeframe's, or all of them. */
export const clearTrendlines = ({ timeframe } = {}) => clearTagged({ tag: TREND_TAG, kind: KIND, timeframe });

/**
 * Draw computed trend lines on the chart (caller clears the timeframe first).
 * ctx: { apiPath, resolution, o } — o supplies colors.
 */
export async function renderTrendlines(result, { apiPath, resolution, o }) {
  const tf = tfLabel(resolution);
  const drawn = [];
  const all = [...result.downtrends, ...result.uptrends];
  const maxScore = Math.max(1, ...all.map(l => l.score));
  for (const line of all) {
    const up = line.type === 'uptrend';
    const color = up ? o.up_color : o.down_color;
    const label = `${TREND_TAG} ${tf} ${up ? 'Up' : 'Down'} (${line.touches}x)`;
    const entity_id = await createShape(apiPath, [line.start, line.end], 'trend_line', {
      linecolor: color,
      linewidth: 1 + Math.round((line.score / maxScore) * 2),
      // Intraday lines dashed, daily and higher solid, matching the S/R levels.
      linestyle: isIntraday(resolution) ? 2 : 0,
      extendLeft: false,
      extendRight: true,
      showLabel: true,
      textcolor: color,
      horzLabelsAlign: 'right',
      vertLabelsAlign: up ? 'bottom' : 'top',
    }, label, { tf, kind: KIND });
    drawn.push({ ...line, current_price: Number(fmt(line.current_price)), entity_id });
  }
  return {
    downtrends: drawn.filter(l => l.type === 'downtrend'),
    uptrends: drawn.filter(l => l.type === 'uptrend'),
  };
}

export async function drawTrendlines(opts = {}) {
  const o = resolveOptions(opts);
  const { apiPath, info, bars } = await loadChart(o);

  // Compute before clearing, so a failure leaves the previous lines in place.
  const result = computeTrendlines(bars, o);
  const cleared = await clearTrendlines({ timeframe: info.resolution });
  const drawn = await renderTrendlines(result, { apiPath, resolution: info.resolution, o });

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
