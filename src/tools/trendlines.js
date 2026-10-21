import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/trendlines.js';

export function registerTrendlineTools(server) {
  server.tool('draw_trendlines', 'Auto-detect trend lines from chart bars (uptrend through rising swing lows, downtrend through falling swing highs, unbroken by closes) and draw them extended to the right. Re-running replaces previous auto trend lines of the same timeframe; other timeframes\' lines stay.', {
    symbol: z.string().optional().describe('Switch to this symbol first, e.g. "BINANCE:DOGEUSDT"'),
    timeframe: z.string().optional().describe('Switch to this timeframe first, e.g. "60", "240", "D"'),
    bars: z.coerce.number().int().min(20).max(2000).optional().describe('Bars to analyze (default 500)'),
    pivot_left: z.coerce.number().int().min(1).optional().describe('Bars left of a swing pivot (default 5)'),
    pivot_right: z.coerce.number().int().min(1).optional().describe('Bars right of a swing pivot (default 5)'),
    tolerance_atr: z.coerce.number().positive().optional().describe('Touch/break tolerance as ATR multiple (default 0.5)'),
    min_touches: z.coerce.number().int().min(2).optional().describe('Minimum pivots on a line (default 2)'),
    min_span: z.coerce.number().int().min(1).optional().describe('Minimum bars between the two anchors (default 10)'),
    max_lines: z.coerce.number().int().min(1).max(5).optional().describe('Max lines per direction (default 2)'),
  }, async (args) => {
    try { return jsonResult(await core.drawTrendlines(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_tl_clear', 'Remove auto trend lines (leaves manual drawings and S/R levels intact). Pass timeframe to remove only that timeframe\'s lines.', {
    timeframe: z.string().optional().describe('Only clear lines drawn on this timeframe, e.g. "240", "D". Omit to clear all.'),
  }, async ({ timeframe }) => {
    try { return jsonResult(await core.clearTrendlines({ timeframe })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
