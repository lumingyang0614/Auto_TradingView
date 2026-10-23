/**
 * Composite chart structure: everything for one timeframe from a single bar load.
 *
 * drawStructure()  — S/R levels + trend lines + triangles (meant for 1D / 1W).
 * computeMicro()   — small-timeframe view (default 15m): only the nearest support
 *                    and resistance, then trend lines / triangles found in the
 *                    recent bars that have stayed between those two levels.
 * drawWatchlist()  — run both over every watchlist symbol.
 */
import { MAX_BARS, validateOptions, loadChart, focusChart } from './autodraw.js';
import * as levels from './levels.js';
import * as trend from './trendlines.js';
import * as tri from './triangles.js';
import * as chart from './chart.js';
import * as watchlist from './watchlist.js';

// `chart` ({ symbol, resolution? }) makes every clear verify the chart has not changed.
const clearAll = async (timeframe, chart) => {
  const results = [
    await levels.clearLevels({ timeframe, chart }),
    await trend.clearTrendlines({ timeframe, chart }),
    await tri.clearTriangles({ timeframe, chart }),
  ];
  return results.reduce((s, r) => s + r.removed, 0);
};

/** S/R levels, trend lines and triangles for one timeframe (one bar load, one redraw). */
export async function drawStructure(opts = {}) {
  // Each module validates the shared options plus its own (max_levels, max_lines, ...).
  const lo = levels.resolveOptions(opts);
  const to = trend.resolveOptions(opts);
  const xo = tri.resolveOptions(opts);
  const { apiPath, info, chart: target, bars, bars_note } = await loadChart(lo);

  // Compute everything before clearing, so a failure leaves the previous drawings in place.
  const lv = levels.computeLevels(bars, lo);
  const tl = trend.computeTrendlines(bars, to);
  const tr = tri.computeTriangles(bars, xo);
  const removed = await clearAll(info.resolution, target);
  const ctx = { apiPath, resolution: info.resolution, chart: target, bars };

  return {
    success: true,
    symbol: info.symbol,
    timeframe: info.resolution,
    bars_used: bars.length,
    ...(bars_note ? { bars_note } : {}),
    last_close: lv.last_close,
    removed_previous: removed,
    ...(await levels.renderLevels(lv, { ...ctx, o: lo })),
    ...(await trend.renderTrendlines(tl, { ...ctx, o: to })),
    ...(await tri.renderTriangles(tr, { ...ctx, o: xo })),
  };
}

export const MICRO_DEFAULTS = {
  timeframe: '15',
  bars: 500,
  pivot_left: 3,
  pivot_right: 3,
  atr_period: 14,
  tolerance_atr: 0.5,
  min_touches: 2,
  min_span: 6,
  recent_bars: 150,
  min_range_bars: 30,
};

const MICRO_RANGES = {
  bars: [20, MAX_BARS],
  pivot_left: [1, 50],
  pivot_right: [1, 50],
  atr_period: [1, 500],
  min_touches: [2, 100],
  min_span: [1, MAX_BARS],
  recent_bars: [10, MAX_BARS],
  min_range_bars: [10, MAX_BARS],
};

export const resolveMicroOptions = (opts = {}) => validateOptions(opts, MICRO_DEFAULTS, MICRO_RANGES);

/** Highest high (resistance) or lowest low (support) of `bars` as a one-touch level, if it is beyond the last close. */
function extremeLevel(bars, type) {
  const high = type === 'resistance';
  let idx = 0;
  bars.forEach((b, i) => { if (high ? b.high > bars[idx].high : b.low < bars[idx].low) idx = i; });
  const price = high ? bars[idx].high : bars[idx].low;
  const lastClose = bars[bars.length - 1].close;
  if (high ? price <= lastClose : price >= lastClose) return [];
  return [{
    price, type, touches: 1, score: 0, fallback: high ? 'recent_high' : 'recent_low',
    first_time: bars[idx].time, last_time: bars[idx].time, zone_low: price, zone_high: price,
    distance_pct: Math.round(((price - lastClose) / lastClose) * 10000) / 100,
  }];
}

/**
 * The support/resistance pair framing the current range, plus trend lines and
 * triangles inside that range.
 *
 * The range is the run of most recent bars (at most `recent_bars`) whose closes
 * stayed within [support − tol, resistance + tol]. Start from the levels nearest
 * the price; while fewer than `min_range_bars` bars fit, widen the side the
 * range was broken through to its next level — so tiny swings right next to the
 * price give way to the levels that actually bound recent trading. When price
 * is beyond every pivot level, the extreme of the loaded bars is the last level.
 */
export function computeMicro(bars, opts = {}) {
  const o = resolveMicroOptions(opts);
  const shared = {
    pivot_left: o.pivot_left, pivot_right: o.pivot_right, atr_period: o.atr_period,
    tolerance_atr: o.tolerance_atr, min_touches: o.min_touches,
  };
  const lv = levels.computeLevels(bars, { ...shared, nearest: true, max_levels: 10 });
  // Candidates ordered nearest first, ending with the loaded bars' extreme.
  const sups = [...lv.supports, ...extremeLevel(bars, 'support')];
  const ress = [...lv.resistances].reverse().concat(extremeLevel(bars, 'resistance'));

  const n = bars.length;
  const tol = lv.tolerance;
  // The inner trend/triangle searches need at least one full pivot window.
  const minRange = Math.max(o.min_range_bars, o.pivot_left + o.pivot_right + 1);
  let si = 0;
  let ri = 0;
  let start;
  for (;;) {
    const support = sups[si]?.price ?? -Infinity;
    const resistance = ress[ri]?.price ?? Infinity;
    start = n - 1;
    while (start > 0 && n - start < o.recent_bars) {
      const close = bars[start - 1].close;
      if (close < support - tol || close > resistance + tol) break;
      start--;
    }
    if (n - start >= minRange || start === 0 || n - start >= o.recent_bars) break;
    const exit = bars[start - 1].close;
    if (exit > resistance + tol && ri < ress.length) ri++;
    else if (exit < support - tol && si < sups.length) si++;
    else break;
  }
  lv.supports = sups[si] ? [sups[si]] : [];
  lv.resistances = ress[ri] ? [ress[ri]] : [];
  const support = lv.supports[0]?.price ?? -Infinity;
  const resistance = lv.resistances[0]?.price ?? Infinity;
  const range = bars.slice(start);
  const result = {
    levels: lv,
    range: {
      support: Number.isFinite(support) ? support : null,
      resistance: Number.isFinite(resistance) ? resistance : null,
      start_time: range[0].time,
      bars: range.length,
    },
    trendlines: { uptrends: [], downtrends: [] },
    triangles: { patterns: [] },
  };
  if (range.length < minRange) {
    result.range.note = `Only ${range.length} bars inside the range (need ${minRange}) — no trend/triangle check`;
    return result;
  }
  const inner = { ...shared, min_span: o.min_span };
  result.trendlines = trend.computeTrendlines(range, { ...inner, max_lines: 1 });
  result.triangles = tri.computeTriangles(range, { ...inner, max_patterns: 1 });
  return result;
}

/** Draw the small-timeframe structure (default 15m) on the chart. */
export async function drawMicro(opts = {}) {
  const o = resolveMicroOptions(opts);
  const { apiPath, info, chart: target, bars, bars_note } = await loadChart(o);
  const m = computeMicro(bars, o);
  const removed = await clearAll(info.resolution, target);
  const ctx = { apiPath, resolution: info.resolution, chart: target, bars };

  return {
    success: true,
    symbol: info.symbol,
    timeframe: info.resolution,
    bars_used: bars.length,
    ...(bars_note ? { bars_note } : {}),
    last_close: m.levels.last_close,
    removed_previous: removed,
    range: m.range,
    ...(await levels.renderLevels(m.levels, { ...ctx, o: levels.DEFAULTS })),
    ...(await trend.renderTrendlines(m.trendlines, { ...ctx, o: trend.DEFAULTS })),
    ...(await tri.renderTriangles(m.triangles, { ...ctx, o: tri.DEFAULTS })),
  };
}

const r2 = v => (v == null ? v : Number(Number(v).toPrecision(6)));

// Compact per-timeframe summary for batch output.
function summarize(res) {
  return {
    bars: res.bars_used,
    ...(res.bars_note ? { bars_note: res.bars_note } : {}),
    supports: (res.supports || []).map(l => r2(l.price)),
    resistances: (res.resistances || []).map(l => r2(l.price)),
    uptrends: (res.uptrends || []).map(l => r2(l.current_price)),
    downtrends: (res.downtrends || []).map(l => r2(l.current_price)),
    patterns: (res.patterns || []).map(p => `${p.name} ${r2(p.breakdown_below)}–${r2(p.breakout_above)}`),
    ...(res.range ? { range_bars: res.range.bars, ...(res.range.note ? { note: res.range.note } : {}) } : {}),
  };
}

/**
 * Draw structure for every watchlist symbol (or `symbols`): full structure on
 * `timeframes` (default 1D and 1W) plus the micro view on each of `micro_timeframes`
 * (default 1H). Auto drawings of `clear_timeframes` are removed (e.g.
 * a timeframe no longer scanned), also when nothing is drawn. Failures are
 * recorded per symbol and do not stop the run. The chart is returned to its
 * original symbol and timeframe; `restored` reports whether that worked.
 */
export async function drawWatchlist({ symbols, timeframes = ['D', 'W'], micro_timeframes = ['60'], clear_timeframes = [] } = {}) {
  const list = symbols?.length ? symbols : (await watchlist.get()).symbols.map(s => s.symbol);
  if (!list.length) throw new Error('Watchlist is empty or the watchlist panel is closed');
  const original = await chart.getState();

  const results = [];
  for (const symbol of list) {
    // TradingView may serve another exchange's feed (NASDAQ:NVDA → BATS:NVDA), so match on the ticker.
    const match_symbol = symbol.split(':').pop();
    const entry = { symbol };
    let switched = false;
    const run = async (key, fn, timeframe) => {
      try {
        const res = await fn({ ...(switched ? {} : { symbol }), match_symbol, timeframe });
        switched = true;
        entry.chart_symbol = res.symbol;
        entry.last_close = res.last_close;
        entry[key] = summarize(res);
      } catch (err) {
        entry[key] = { error: err.message };
      }
    };
    for (const tf of timeframes) await run(levels.tfLabel(tf), drawStructure, tf);
    for (const tf of micro_timeframes) await run(`${levels.tfLabel(tf)}_micro`, drawMicro, tf);
    // Drawings belong to the symbol, so clear only on it — and verify that on every clear.
    if (clear_timeframes.length) {
      try {
        if (!switched) entry.chart_symbol = (await focusChart({ symbol, match_symbol })).info.symbol;
        let removed = 0;
        for (const tf of clear_timeframes) removed += await clearAll(tf, { symbol: entry.chart_symbol });
        entry.cleared = removed;
      } catch (err) {
        entry.cleared = { error: err.message };
      }
    }
    results.push(entry);
  }

  // Same readiness check as a draw: the main series must actually show the original chart.
  let restore_error = null;
  try {
    await focusChart({ symbol: original.symbol, match_symbol: original.symbol.split(':').pop(), timeframe: original.resolution });
  } catch (err) {
    restore_error = err.message;
  }

  const failed = results.filter(r => Object.values(r).some(v => v && v.error)).length;
  return {
    success: true,
    symbols: results.length,
    with_errors: failed,
    restored: !restore_error,
    ...(restore_error ? { restore_error } : {}),
    results,
  };
}
