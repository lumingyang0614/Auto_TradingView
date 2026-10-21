/**
 * Shared plumbing for auto-drawn chart overlays (support/resistance levels,
 * trend lines): option validation, swing pivots, chart readiness, bar reading,
 * shape creation and tagged, per-timeframe cleanup.
 *
 * Every auto-drawn shape carries a text prefix "<tag> <timeframe> " (e.g.
 * "AutoSR 4H ", "AutoTL 1D ") and is recorded in the TradingView page as
 * { id, tf, kind }, so a re-run only replaces its own kind on its own timeframe.
 */
import { evaluate, evaluateAsync, getChartApi, KNOWN_PATHS } from '../connection.js';
import { setSymbol, setTimeframe } from './chart.js';

// IDs are per-session anyway, so the registry lives in the page itself. The
// registry also covers shape types that do not expose text via getProperties().
const PAGE_REGISTRY = 'window.__autoSRIds';
export const MAX_BARS = 2000;
const READY_TIMEOUT = 15000;

/**
 * Merge user options over `defaults` (ignoring undefined values) and validate.
 * Throws before anything touches the chart.
 */
export function validateOptions(opts, defaults, intRanges) {
  const o = { ...defaults };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== null) o[k] = v;

  for (const [k, [min, max]] of Object.entries(intRanges)) {
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
  for (const [k, v] of Object.entries(defaults)) {
    if (typeof v === 'boolean' && typeof o[k] !== 'boolean') throw new Error(`${k} must be a boolean, got ${opts[k]}`);
  }
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

/** Swing pivots (fractals): strict high/low extreme of `left` bars before and `right` bars after. */
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

/** Recency weight of a bar index: oldest bar 0.5, newest 1.0. */
export const recency = (index, n) => 0.5 + 0.5 * (index / (n - 1));

// Round price to a sensible number of decimals for labels (DOGE ~0.1 needs 5).
export function fmt(price) {
  const abs = Math.abs(price);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 8;
  return price.toFixed(decimals);
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

export const isIntraday = tf => /^\d+$/.test(normalizeTf(tf));

// The main series reports what is actually loaded. chart.symbol() switches to the
// requested symbol immediately, while the bars still belong to the previous one.
const MAIN_SERIES = `${KNOWN_PATHS.chartApi}._chartWidget.model().mainSeries()`;
const SERIES_STATE = `
  var ms = ${MAIN_SERIES};
  var si = ms.symbolInfo();
  var loaded = si ? (si.pro_name || si.full_name || si.name) : null;`;

async function chartInfo(apiPath) {
  return evaluate(`(function() {
    var c = ${apiPath};
    var bars = ${KNOWN_PATHS.mainSeriesBars};
    ${SERIES_STATE}
    return {
      symbol: loaded,
      requested: c.symbol(),
      resolution: String(ms.interval()),
      completed: !!ms.isCompleted() && !ms.isLoading(),
      bar_count: bars && typeof bars.size === 'function' ? bars.size() : 0,
    };
  })()`);
}

// "DOGEUSDT" matches any exchange; "BINANCE:DOGEUSDT" must match exactly.
function symbolMatches(actual, wanted) {
  if (!wanted) return true;
  const a = String(actual).toUpperCase();
  const w = String(wanted).toUpperCase();
  return w.includes(':') ? a === w : a.split(':').pop() === w;
}

const sameChart = (a, b) => !!a && !!b && a.symbol === b.symbol && a.requested === b.requested && a.resolution === b.resolution;

/**
 * Wait until the main series has finished loading the requested symbol and
 * timeframe — otherwise we would analyze (and draw over) stale data.
 */
async function waitForChart(apiPath, symbol, timeframe) {
  const start = Date.now();
  let info = null;
  const ready = i => i && i.completed && i.bar_count > 0
    && symbolMatches(i.symbol, symbol) && symbolMatches(i.requested, symbol)
    && (!timeframe || normalizeTf(i.resolution) === normalizeTf(timeframe));
  while (Date.now() - start < READY_TIMEOUT) {
    info = await chartInfo(apiPath);
    if (ready(info)) {
      // Let the series finish streaming in: still the same, completed chart with an unchanged bar count.
      await new Promise(r => setTimeout(r, 500));
      const again = await chartInfo(apiPath);
      if (ready(again) && sameChart(again, info) && again.bar_count === info.bar_count) return again;
      continue;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  // TradingView may serve another exchange's feed (e.g. NASDAQ:NVDA → BATS:NVDA without a data subscription).
  const hint = symbol && info?.symbol && symbolMatches(info.symbol, String(symbol).split(':').pop()) && !symbolMatches(info.symbol, symbol)
    ? ` (TradingView switched to ${info.symbol}; pass "${info.symbol}" or just the ticker)` : '';
  throw new Error(`Chart not ready for ${symbol || '(current symbol)'} ${timeframe || ''} — currently ${info?.symbol} ${info?.resolution} with ${info?.bar_count || 0} bars${hint}`);
}

async function readBars(apiPath, count) {
  const data = await evaluate(`
    (function() {
      var chart = ${apiPath};
      var bars = ${KNOWN_PATHS.mainSeriesBars};
      ${SERIES_STATE}
      if (!bars || typeof bars.lastIndex !== 'function') return null;
      var out = [];
      var end = bars.lastIndex();
      var start = Math.max(bars.firstIndex(), end - ${count} + 1);
      for (var i = start; i <= end; i++) {
        var v = bars.valueAt(i);
        if (v) out.push({ time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 });
      }
      return { symbol: loaded, requested: chart.symbol(), resolution: String(ms.interval()), completed: !!ms.isCompleted() && !ms.isLoading(), bars: out };
    })()
  `);
  if (!data?.bars?.length) throw new Error('Could not read chart bars. The chart may still be loading.');
  return data;
}

/**
 * Optionally switch symbol/timeframe, wait for the chart, and read `o.bars` bars,
 * verifying the chart did not change in between. Returns { apiPath, info, bars }.
 * `o.match_symbol` (e.g. just the ticker) overrides what the loaded chart must
 * match — used when TradingView may substitute another exchange's feed.
 */
export async function loadChart(o) {
  const apiPath = await getChartApi();
  if (o.symbol) await setSymbol({ symbol: o.symbol });
  if (o.timeframe) await setTimeframe({ timeframe: o.timeframe });
  const info = await waitForChart(apiPath, o.match_symbol || o.symbol, o.timeframe);
  const data = await readBars(apiPath, o.bars);
  if (!data.completed || !sameChart(data, info)) {
    throw new Error(`Chart changed while reading bars: expected ${info.symbol} ${info.resolution}, got ${data.symbol} ${data.resolution}`);
  }
  return { apiPath, info, bars: data.bars };
}

/** Create a shape and record it in the page registry under { tf, kind }. */
export async function createShape(apiPath, points, shape, overrides, text, { tf, kind }) {
  const opts = JSON.stringify({ shape, overrides, text, lock: false, disableUndo: false });
  const method = points.length > 1 ? 'createMultipointShape' : 'createShape';
  const arg = JSON.stringify(points.length > 1 ? points : points[0]);
  // Newer TradingView builds return a Promise<entityId>, older ones the id itself.
  const id = await evaluateAsync(`Promise.resolve(${apiPath}.${method}(${arg}, ${opts})).then(function(id) { return id || null; })`);
  if (!id) throw new Error(`TradingView did not create the ${shape} shape`);
  await evaluate(`(${PAGE_REGISTRY} = ${PAGE_REGISTRY} || []).push(${JSON.stringify({ id, tf, kind })})`);
  return id;
}

/**
 * Remove shapes of one `kind` (registered ID, or text starting with `tag`).
 * With a timeframe, only that timeframe's shapes are removed; without, all of that kind.
 * Registry entries from before `kind` existed (bare strings, or objects without kind)
 * were all S/R levels, so they count as kind "level".
 */
export async function clearTagged({ tag, kind, timeframe }) {
  const apiPath = await getChartApi();
  const scope = timeframe ? tfLabel(timeframe) : null;
  const prefix = scope ? `${tag} ${scope} ` : `${tag} `;
  const result = await evaluate(`
    (function() {
      var api = ${apiPath};
      var scope = ${JSON.stringify(scope)};
      var prefix = ${JSON.stringify(prefix)};
      var kind = ${JSON.stringify(kind)};
      var registry = (${PAGE_REGISTRY} || []).map(function(e) {
        if (typeof e === 'string') return { id: e, tf: null, kind: 'level' };
        return { id: e.id, tf: e.tf, kind: e.kind || 'level' };
      });
      var inScope = function(e) { return e.kind === kind && (!scope || e.tf === scope); };
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
      }).map(function(id) { return { id: id, tf: scope, kind: kind }; }));
      return { removed: targets.length - left.length, left: left.length };
    })()
  `);
  if (result?.left) throw new Error(`${result.left} ${tag} shapes could not be removed`);
  return { success: true, timeframe: scope || 'all', removed: result?.removed || 0 };
}
