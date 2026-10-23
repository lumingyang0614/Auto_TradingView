/**
 * Auto triangle / wedge (converging pattern) detection, built on trend lines.
 *
 * computeTriangles() is pure (bars in → patterns out) so it can be unit-tested
 * without TradingView. drawTriangles() reads bars from the live chart via CDP
 * and draws each pattern as its two boundary lines up to the last bar.
 *
 * Algorithm:
 *   1. Boundary candidates are trend lines (see trendlines.js) of any slope:
 *      upper lines through swing highs that no close has risen above, lower
 *      lines through swing lows that no close has fallen below (± tolerance).
 *   2. Pair an upper and a lower line that start in the same stretch of bars
 *      (their first anchors no more than half the pattern length apart), with
 *      the pattern no longer than `max_pattern_bars` (a recent consolidation,
 *      not a macro channel) and at least `min_total_touches` touches in total.
 *   3. The pair must converge: the width at the last bar is at most
 *      `max_width_ratio` of the width where both lines exist, and the apex
 *      (where they meet) lies ahead, no further than `max_apex_ratio` × the
 *      pattern length.
 *   4. Both lines must still be in play: each was touched in the later half
 *      of the pattern.
 *   5. Classify by slope (a line moving less than `tolerance` over the pattern
 *      is flat): falling upper + rising lower = symmetrical, flat upper +
 *      rising lower = ascending, falling upper + flat lower = descending,
 *      both rising = rising wedge, both falling = falling wedge.
 *   6. Score = sum of both lines' recency-weighted touches; keep the
 *      `max_patterns` best that do not share an anchor.
 */
import {
  MAX_BARS, validateOptions, atr, findPivots, fmt, tfLabel, isIntraday,
  loadChart, createShape, clearTagged,
} from './autodraw.js';
import { lineCandidates } from './trendlines.js';

// Shapes are tagged "AutoTRI <timeframe> " so 4H and 1D patterns coexist.
export const TRIANGLE_TAG = 'AutoTRI';
const KIND = 'triangle';

export const DEFAULTS = {
  bars: 500,
  pivot_left: 5,
  pivot_right: 5,
  atr_period: 14,
  tolerance_atr: 0.5,
  min_touches: 2,
  min_span: 10,
  min_total_touches: 5,
  max_pattern_bars: 200,
  max_patterns: 1,
  max_width_ratio: 0.7,
  max_apex_ratio: 1.5,
  color: '#ab47bc',
};

const INT_RANGES = {
  bars: [20, MAX_BARS],
  pivot_left: [1, 50],
  pivot_right: [1, 50],
  atr_period: [1, 500],
  min_touches: [2, 100],
  min_span: [1, MAX_BARS],
  min_total_touches: [4, 100],
  max_pattern_bars: [10, MAX_BARS],
  max_patterns: [1, 5],
};

export const PATTERN_NAMES = {
  symmetrical: 'Sym Triangle',
  ascending: 'Asc Triangle',
  descending: 'Desc Triangle',
  rising_wedge: 'Rising Wedge',
  falling_wedge: 'Falling Wedge',
};

/** Merge options over DEFAULTS and validate; throws before anything touches the chart. */
export function resolveOptions(opts = {}) {
  const o = validateOptions(opts, DEFAULTS, INT_RANGES);
  for (const k of ['max_width_ratio', 'max_apex_ratio']) {
    if (!Number.isFinite(o[k]) || o[k] <= 0) throw new Error(`${k} must be a positive number, got ${opts[k]}`);
  }
  if (o.max_width_ratio >= 1) throw new Error(`max_width_ratio must be below 1, got ${opts.max_width_ratio}`);
  return o;
}

function classify(upperMove, lowerMove, tolerance) {
  const dirOf = move => (Math.abs(move) < tolerance ? 0 : Math.sign(move));
  const u = dirOf(upperMove);
  const l = dirOf(lowerMove);
  if (u < 0 && l > 0) return 'symmetrical';
  if (u === 0 && l > 0) return 'ascending';
  if (u < 0 && l === 0) return 'descending';
  if (u > 0 && l > 0) return 'rising_wedge';
  if (u < 0 && l < 0) return 'falling_wedge';
  return null; // flat/flat (rectangle) or diverging shapes
}

export function computeTriangles(bars, opts = {}) {
  const o = resolveOptions(opts);
  if (!Array.isArray(bars) || bars.length < o.pivot_left + o.pivot_right + 1) {
    throw new Error(`Need at least ${o.pivot_left + o.pivot_right + 1} bars, got ${bars?.length || 0}`);
  }

  const n = bars.length;
  const last = n - 1;
  const lastClose = bars[last].close;
  const atrValue = atr(bars, o.atr_period);
  const tolerance = atrValue * o.tolerance_atr;
  const pivots = findPivots(bars, o.pivot_left, o.pivot_right);
  const any = () => true;
  const uppers = lineCandidates(bars, pivots.filter(p => p.kind === 'high'), -1, o, tolerance, any);
  const lowers = lineCandidates(bars, pivots.filter(p => p.kind === 'low'), 1, o, tolerance, any);

  const at = (line, k) => line.p1.price + line.slope * (k - line.p1.index);
  const found = [];
  for (const U of uppers) {
    for (const L of lowers) {
      const start = Math.min(U.p1.index, L.p1.index);
      const both = Math.max(U.p1.index, L.p1.index);
      const length = last - start;
      if (length > o.max_pattern_bars || both - start > length / 2) continue;
      if (U.touches.length + L.touches.length < o.min_total_touches) continue;

      const widthStart = at(U, both) - at(L, both);
      const widthNow = at(U, last) - at(L, last);
      if (widthNow <= 0 || widthStart <= 0 || widthNow > widthStart * o.max_width_ratio) continue;
      const apexAhead = widthNow / (L.slope - U.slope); // bars from the last bar to the apex
      if (!(apexAhead > 0) || apexAhead > length * o.max_apex_ratio) continue;

      const half = start + length / 2;
      if (U.last_touch < half || L.last_touch < half) continue;

      const type = classify(at(U, last) - at(U, both), at(L, last) - at(L, both), tolerance);
      if (!type) continue;
      found.push({ U, L, type, start, apexAhead, widthNow, score: U.score + L.score });
    }
  }

  const kept = [];
  const anchors = f => [f.U.p1.index, f.U.p2.index, f.L.p1.index, f.L.p2.index];
  for (const f of found.sort((a, b) => b.score - a.score || a.widthNow - b.widthNow)) {
    if (kept.length >= o.max_patterns) break;
    if (kept.some(k => anchors(k).some(i => anchors(f).includes(i)))) continue;
    kept.push(f);
  }

  const boundary = line => ({
    touches: line.touches.length,
    start: { time: line.p1.time, price: line.p1.price },
    end: { time: bars[last].time, price: at(line, last) },
    slope_per_bar: line.slope,
  });

  return {
    last_close: lastClose,
    atr: atrValue,
    tolerance,
    pivot_count: pivots.length,
    patterns: kept.map(f => ({
      type: f.type,
      name: PATTERN_NAMES[f.type],
      score: Math.round(f.score * 100) / 100,
      start_time: bars[f.start].time,
      bars_in_pattern: last - f.start,
      apex_bars_ahead: Math.round(f.apexAhead * 10) / 10,
      upper: boundary(f.U),
      lower: boundary(f.L),
      // Breakout triggers: a close above the upper / below the lower line.
      breakout_above: at(f.U, last),
      breakdown_below: at(f.L, last),
      width_pct: Math.round((f.widthNow / lastClose) * 10000) / 100,
    })),
  };
}

/** Remove auto triangle drawings — only the given timeframe's, or all of them. */
export const clearTriangles = ({ timeframe, chart } = {}) => clearTagged({ tag: TRIANGLE_TAG, kind: KIND, timeframe, chart });

/**
 * Draw computed patterns on the chart (caller clears the timeframe first).
 * Each boundary runs from its first anchor to the last bar, where the lines
 * are closest — the apex itself lies in the future.
 */
export async function renderTriangles(result, { apiPath, resolution, chart, o }) {
  const tf = tfLabel(resolution);
  const drawn = [];
  for (const pat of result.patterns) {
    const ids = {};
    for (const side of ['upper', 'lower']) {
      const line = pat[side];
      const label = side === 'upper'
        ? `${TRIANGLE_TAG} ${tf} ${pat.name} (${pat.upper.touches}/${pat.lower.touches}) apex +${Math.round(pat.apex_bars_ahead)} bars`
        : `${TRIANGLE_TAG} ${tf} ${pat.name} low`;
      ids[side] = await createShape(apiPath, [line.start, line.end], 'trend_line', {
        linecolor: o.color,
        linewidth: 2,
        linestyle: isIntraday(resolution) ? 2 : 0,
        extendLeft: false,
        extendRight: false,
        showLabel: side === 'upper',
        textcolor: o.color,
        horzLabelsAlign: 'right',
        vertLabelsAlign: 'top',
      }, label, { tf, kind: KIND, chart });
    }
    drawn.push({
      ...pat,
      breakout_above: Number(fmt(pat.breakout_above)),
      breakdown_below: Number(fmt(pat.breakdown_below)),
      upper_entity_id: ids.upper,
      lower_entity_id: ids.lower,
    });
  }
  return { patterns: drawn };
}

export async function drawTriangles(opts = {}) {
  const o = resolveOptions(opts);
  const { apiPath, info, chart, bars, bars_note } = await loadChart(o);

  // Compute before clearing, so a failure leaves the previous patterns in place.
  const result = computeTriangles(bars, o);
  const cleared = await clearTriangles({ timeframe: info.resolution, chart });
  const drawn = await renderTriangles(result, { apiPath, resolution: info.resolution, chart, o });

  return {
    success: true,
    symbol: info.symbol,
    timeframe: info.resolution,
    bars_used: bars.length,
    ...(bars_note ? { bars_note } : {}),
    last_close: result.last_close,
    atr: result.atr,
    removed_previous: cleared.removed,
    ...drawn,
  };
}
