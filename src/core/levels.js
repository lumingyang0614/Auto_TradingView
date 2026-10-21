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
 *      strongest of each side with at least `min_touches` pivots.
 */
import { evaluate, evaluateAsync, getChartApi, KNOWN_PATHS } from '../connection.js';
import { setSymbol, setTimeframe } from './chart.js';

// Every auto-drawn shape carries the text prefix "AutoSR <timeframe> " so a re-run
// only replaces our own lines for that timeframe (e.g. 4H and 1D levels coexist).
export const LEVEL_TAG = 'AutoSR';
// Drawn shapes are also kept in the TradingView page as { id, tf }, in case a shape
// type does not expose its text through getProperties() (IDs are per-session anyway).
const PAGE_REGISTRY = 'window.__autoSRIds';
const MAX_BARS = 2000;
const READY_TIMEOUT = 15000;

export const DEFAULTS = {
  bars: 500,
  pivot_left: 5,
  pivot_right: 5,
  atr_period: 14,
  tolerance_atr: 0.5,
  min_touches: 2,
  max_levels: 3,
  zones: false,
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

/**
 * Merge user options over DEFAULTS (ignoring undefined values) and validate.
 * Throws before anything touches the chart.
 */
export function resolveOptions(opts = {}) {
  const o = { ...DEFAULTS };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== null) o[k] = v;

  for (const [k, [min, max]] of Object.entries(INT_RANGES)) {
    if (!Number.isInteger(o[k]) || o[k] < min || o[k] > max) {
      throw new Error(`${k} must be an integer between ${min} and ${max}, got ${opts[k]}`);
    }
  }
  if (!Number.isFinite(o.tolerance_atr) || o.tolerance_atr <= 0) {
    throw new Error(`tolerance_atr must be a positive number, got ${opts.tolerance_atr}`);
  }
  if (o.bars < o.pivot_left + o.pivot_right + 1) {
    throw new Error(`bars (${o.bars}) must be at least pivot_left + pivot_right + 1 (${o.pivot_left + o.pivot_right + 1})`);
  }
  if (typeof o.zones !== 'boolean') throw new Error(`zones must be a boolean, got ${opts.zones}`);
  for (const k of ['symbol', 'timeframe']) {
    if (o[k] !== undefined && (typeof o[k] !== 'string' || !o[k].trim())) throw new Error(`${k} must be a non-empty string`);
  }
  return o;
}

export function atr(bars, period = 14) {
  if (bars.length < 2) return bars.length ? bars[0].high - bars[0].low : 0;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const { high, low } = bars[i];
    const prevClose = bars[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

export function findPivots(bars, left = 5, right = 5) {
  const pivots = [];
  for (let i = left; i < bars.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low <= bars[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivots.push({ index: i, time: bars[i].time, price: bars[i].high, kind: 'high' });
    if (isLow) pivots.push({ index: i, time: bars[i].time, price: bars[i].low, kind: 'low' });
  }
  return pivots;
}

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
        score: c.pivots.reduce((s, p) => s + 0.5 + 0.5 * (p.index / (n - 1)), 0),
        last_index: Math.max(...indices),
        first_time: first.time,
        last_time: bars[Math.max(...indices)].time,
        zone_low: Math.min(...prices),
        zone_high: Math.max(...prices),
        distance_pct: Math.round(((price - lastClose) / lastClose) * 10000) / 100,
      };
    });

  // Rank on full-precision score; ties go to more touches, then the more recent level.
  const pick = type => levels
    .filter(l => l.type === type)
    .sort((a, b) => b.score - a.score || b.touches - a.touches || b.last_index - a.last_index)
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

// Round price to a sensible number of decimals for labels (DOGE ~0.1 needs 5).
function fmt(price) {
  const abs = Math.abs(price);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 8;
  return price.toFixed(decimals);
}

async function chartInfo(apiPath) {
  return evaluate(`(function() {
    var c = ${apiPath};
    var bars = ${KNOWN_PATHS.mainSeriesBars};
    return { symbol: c.symbol(), resolution: c.resolution(), bar_count: bars && typeof bars.size === 'function' ? bars.size() : 0 };
  })()`);
}

// "DOGEUSDT" matches any exchange; "BINANCE:DOGEUSDT" must match exactly.
function symbolMatches(actual, wanted) {
  if (!wanted) return true;
  const a = String(actual).toUpperCase();
  const w = String(wanted).toUpperCase();
  return w.includes(':') ? a === w : a.split(':').pop() === w;
}

// TradingView reports "D" as "1D", "W" as "1W", "M" as "1M".
const normalizeTf = tf => String(tf).toUpperCase().replace(/^([DWM])$/, '1$1');

/** Human timeframe label used in drawing text: "240" → "4H", "15" → "15m", "D" → "1D". */
export function tfLabel(tf) {
  const t = normalizeTf(tf);
  if (!/^\d+$/.test(t)) return t;
  const minutes = Number(t);
  return minutes % 60 === 0 ? `${minutes / 60}H` : `${minutes}m`;
}

const isIntraday = tf => /^\d+$/.test(normalizeTf(tf));

const sameChart = (a, b) => !!a && !!b && a.symbol === b.symbol && a.resolution === b.resolution;

/**
 * Wait until the chart actually shows the requested symbol/timeframe and has
 * bars loaded — otherwise we would analyze (and draw over) stale data.
 */
async function waitForChart(apiPath, symbol, timeframe) {
  const start = Date.now();
  let info = null;
  while (Date.now() - start < READY_TIMEOUT) {
    info = await chartInfo(apiPath);
    const tfOk = !timeframe || normalizeTf(info?.resolution) === normalizeTf(timeframe);
    if (info && symbolMatches(info.symbol, symbol) && tfOk && info.bar_count > 0) {
      // Let the series finish streaming in: the same chart with an unchanged bar count twice.
      await new Promise(r => setTimeout(r, 500));
      const again = await chartInfo(apiPath);
      if (sameChart(again, info) && again.bar_count === info.bar_count) return again;
      continue;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Chart not ready for ${symbol || '(current symbol)'} ${timeframe || ''} — currently ${info?.symbol} ${info?.resolution} with ${info?.bar_count || 0} bars`);
}

async function readBars(apiPath, count) {
  const data = await evaluate(`
    (function() {
      var chart = ${apiPath};
      var bars = ${KNOWN_PATHS.mainSeriesBars};
      if (!bars || typeof bars.lastIndex !== 'function') return null;
      var out = [];
      var end = bars.lastIndex();
      var start = Math.max(bars.firstIndex(), end - ${count} + 1);
      for (var i = start; i <= end; i++) {
        var v = bars.valueAt(i);
        if (v) out.push({ time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 });
      }
      return { symbol: chart.symbol(), resolution: chart.resolution(), bars: out };
    })()
  `);
  if (!data?.bars?.length) throw new Error('Could not read chart bars. The chart may still be loading.');
  return data;
}

async function createShape(apiPath, points, shape, overrides, text, tf) {
  const opts = JSON.stringify({ shape, overrides, text, lock: false, disableUndo: false });
  const method = points.length > 1 ? 'createMultipointShape' : 'createShape';
  const arg = JSON.stringify(points.length > 1 ? points : points[0]);
  // Newer TradingView builds return a Promise<entityId>, older ones the id itself.
  const id = await evaluateAsync(`Promise.resolve(${apiPath}.${method}(${arg}, ${opts})).then(function(id) { return id || null; })`);
  if (!id) throw new Error(`TradingView did not create the ${shape} shape`);
  await evaluate(`(${PAGE_REGISTRY} = ${PAGE_REGISTRY} || []).push(${JSON.stringify({ id, tf })})`);
  return id;
}

/**
 * Remove shapes this module drew (registered ID, or text starting with the tag).
 * With a timeframe, only that timeframe's levels are removed; without, all of them.
 */
export async function clearLevels({ timeframe } = {}) {
  const apiPath = await getChartApi();
  const scope = timeframe ? tfLabel(timeframe) : null;
  const prefix = scope ? `${LEVEL_TAG} ${scope} ` : LEVEL_TAG;
  const result = await evaluate(`
    (function() {
      var api = ${apiPath};
      var scope = ${JSON.stringify(scope)};
      var prefix = ${JSON.stringify(prefix)};
      // Older registries stored bare id strings (no timeframe) — only an unscoped clear takes them.
      var registry = (${PAGE_REGISTRY} || []).map(function(e) { return typeof e === 'string' ? { id: e, tf: null } : e; });
      var inScope = function(e) { return !scope || e.tf === scope; };
      var targets = api.getAllShapes().map(function(s) { return s.id; }).filter(function(id) {
        var entry = registry.filter(function(e) { return e.id === id; })[0];
        if (entry) return inScope(entry);
        try {
          var props = api.getShapeById(id).getProperties();
          return ((props && props.text) || '').indexOf(prefix) === 0;
        } catch (e) { return false; }
      });
      targets.forEach(function(id) { try { api.removeEntity(id); } catch (e) {} });
      var existing = api.getAllShapes().map(function(s) { return s.id; });
      // Keep tracking out-of-scope entries and anything that survived, so the next clear can retry it.
      var left = targets.filter(function(id) { return existing.indexOf(id) !== -1; });
      ${PAGE_REGISTRY} = registry.filter(function(e) {
        return existing.indexOf(e.id) !== -1 && (!inScope(e) || left.indexOf(e.id) !== -1);
      }).concat(left.filter(function(id) {
        return !registry.some(function(e) { return e.id === id; });
      }).map(function(id) { return { id: id, tf: scope }; }));
      return { removed: targets.length - left.length, left: left.length };
    })()
  `);
  if (result?.left) throw new Error(`${result.left} auto S/R shapes could not be removed`);
  return { success: true, timeframe: scope || 'all', removed: result?.removed || 0 };
}

export async function drawLevels(opts = {}) {
  const o = resolveOptions(opts);
  const apiPath = await getChartApi();
  if (o.symbol) await setSymbol({ symbol: o.symbol });
  if (o.timeframe) await setTimeframe({ timeframe: o.timeframe });
  const info = await waitForChart(apiPath, o.symbol, o.timeframe);

  // Compute before clearing, so a failure leaves the previous levels in place.
  const data = await readBars(apiPath, o.bars);
  if (!sameChart(data, info)) {
    throw new Error(`Chart changed while reading bars: expected ${info.symbol} ${info.resolution}, got ${data.symbol} ${data.resolution}`);
  }
  const bars = data.bars;
  const result = computeLevels(bars, o);
  const tf = tfLabel(info.resolution);
  const cleared = await clearLevels({ timeframe: info.resolution });

  const drawn = [];
  const all = [...result.resistances, ...result.supports];
  const maxScore = Math.max(1, ...all.map(l => l.score));
  for (const level of all) {
    const color = level.type === 'support' ? o.support_color : o.resistance_color;
    const label = `${LEVEL_TAG} ${tf} ${level.type === 'support' ? 'S' : 'R'} ${fmt(level.price)} (${level.touches}x)`;
    const entity_id = await createShape(apiPath, [{ time: level.first_time, price: level.price }], 'horizontal_ray', {
      linecolor: color,
      linewidth: 1 + Math.round((level.score / maxScore) * 2),
      // Intraday levels dashed, daily and higher solid, so timeframes are distinguishable.
      linestyle: isIntraday(info.resolution) ? 2 : 0,
      showLabel: true,
      textcolor: color,
      horzLabelsAlign: 'right',
      vertLabelsAlign: level.type === 'support' ? 'bottom' : 'top',
    }, label, tf);
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
      }, `${LEVEL_TAG} ${tf} zone`, tf);
    }
    drawn.push(entry);
  }

  return {
    success: true,
    symbol: info.symbol,
    timeframe: info.resolution,
    bars_used: bars.length,
    last_close: result.last_close,
    atr: result.atr,
    removed_previous: cleared.removed,
    resistances: drawn.filter(l => l.type === 'resistance'),
    supports: drawn.filter(l => l.type === 'support'),
  };
}
