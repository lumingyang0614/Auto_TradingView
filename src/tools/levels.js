import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/levels.js';

export function registerLevelTools(server) {
  server.tool('draw_support_resistance', 'Auto-detect support/resistance levels from chart bars (swing pivots clustered by ATR) and draw them as labeled horizontal rays. Re-running replaces previous auto levels of the same timeframe; other timeframes\' levels stay.', {
    symbol: z.string().optional().describe('Switch to this symbol first, e.g. "BINANCE:DOGEUSDT"'),
    timeframe: z.string().optional().describe('Switch to this timeframe first, e.g. "60", "240", "D"'),
    bars: z.coerce.number().int().min(20).max(2000).optional().describe('Bars to analyze (default 500)'),
    pivot_left: z.coerce.number().int().min(1).optional().describe('Bars left of a swing pivot (default 5)'),
    pivot_right: z.coerce.number().int().min(1).optional().describe('Bars right of a swing pivot (default 5)'),
    tolerance_atr: z.coerce.number().positive().optional().describe('Cluster width as ATR multiple (default 0.5)'),
    min_touches: z.coerce.number().int().min(1).optional().describe('Minimum pivots per level (default 2)'),
    max_levels: z.coerce.number().int().min(1).max(10).optional().describe('Max levels per side (default 3)'),
    zones: z.boolean().optional().describe('Also draw a shaded zone around each level (default false)'),
  }, async (args) => {
    try { return jsonResult(await core.drawLevels(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_sr_clear', 'Remove auto support/resistance drawings (leaves manual drawings intact). Pass timeframe to remove only that timeframe\'s levels.', {
    timeframe: z.string().optional().describe('Only clear levels drawn on this timeframe, e.g. "240", "D". Omit to clear all.'),
  }, async ({ timeframe }) => {
    try { return jsonResult(await core.clearLevels({ timeframe })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
