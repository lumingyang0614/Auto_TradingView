import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as tri from '../core/triangles.js';
import * as core from '../core/structure.js';

const common = {
  symbol: z.string().optional().describe('Switch to this symbol first, e.g. "BINANCE:DOGEUSDT"'),
  timeframe: z.string().optional().describe('Switch to this timeframe first, e.g. "15", "240", "D"'),
  bars: z.coerce.number().int().min(20).max(2000).optional().describe('Bars to analyze (default 500)'),
  pivot_left: z.coerce.number().int().min(1).optional().describe('Bars left of a swing pivot'),
  pivot_right: z.coerce.number().int().min(1).optional().describe('Bars right of a swing pivot'),
  tolerance_atr: z.coerce.number().positive().optional().describe('Touch/break tolerance as ATR multiple (default 0.5)'),
};

const run = fn => async (args) => {
  try { return jsonResult(await fn(args)); }
  catch (err) { return jsonResult({ success: false, error: err.message }, true); }
};

export function registerStructureTools(server) {
  server.tool('draw_triangles', 'Auto-detect converging patterns (symmetrical/ascending/descending triangles, rising/falling wedges) from trend lines through swing highs and lows, and draw their two boundary lines. Re-running replaces previous patterns of the same timeframe.', {
    ...common,
    min_span: z.coerce.number().int().min(1).optional().describe('Minimum bars between a line\'s two anchors (default 10)'),
    max_patterns: z.coerce.number().int().min(1).max(5).optional().describe('Max patterns to draw (default 1)'),
  }, run(args => tri.drawTriangles(args)));

  server.tool('draw_tri_clear', 'Remove auto triangle/wedge drawings. Pass timeframe to remove only that timeframe\'s.', {
    timeframe: z.string().optional().describe('Only clear this timeframe, e.g. "240", "D". Omit to clear all.'),
  }, run(({ timeframe }) => tri.clearTriangles({ timeframe })));

  server.tool('draw_structure', 'Draw support/resistance levels, trend lines and triangles for one timeframe in one pass (meant for 1D / 1W). Replaces previous auto drawings of that timeframe.', {
    ...common,
  }, run(args => core.drawStructure(args)));

  server.tool('draw_micro_structure', 'Small-timeframe view (default 15m): draw only the nearest support and resistance to the current price, plus any trend line / triangle in the recent bars that stayed between them.', {
    ...common,
    recent_bars: z.coerce.number().int().min(10).optional().describe('Look back at most this many bars for the range (default 150)'),
    min_range_bars: z.coerce.number().int().min(10).optional().describe('Minimum bars inside the range to look for patterns (default 30)'),
  }, run(args => core.drawMicro(args)));

  server.tool('draw_watchlist_structure', 'For every watchlist symbol (or the given symbols): draw full structure (S/R, trend lines, triangles) on 1D and 1W plus the micro view on 15m and 1H. Slow — several seconds per symbol. Restores the original chart afterwards.', {
    symbols: z.array(z.string()).optional().describe('Symbols to process instead of the watchlist'),
    timeframes: z.array(z.string()).optional().describe('Full-structure timeframes (default ["D", "W"]; [] to skip)'),
    micro_timeframes: z.array(z.string()).optional().describe('Micro view timeframes (default ["15", "60"]; [] to skip)'),
    clear_timeframes: z.array(z.string()).optional().describe('Remove auto drawings of these timeframes, e.g. ["240"]'),
  }, run(args => core.drawWatchlist(args)));
}
