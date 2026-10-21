import { register } from '../router.js';
import * as core from '../../core/trendlines.js';

const num = v => (v === undefined ? undefined : Number(v));

register('trend', {
  description: 'Auto trend lines (draw, clear)',
  subcommands: new Map([
    ['draw', {
      description: 'Detect and draw trend lines on the chart',
      options: {
        symbol: { type: 'string', short: 's', description: 'Symbol, e.g. BINANCE:DOGEUSDT' },
        timeframe: { type: 'string', short: 't', description: 'Timeframe, e.g. 60, 240, D' },
        bars: { type: 'string', short: 'n', description: 'Bars to analyze (default 500)' },
        'pivot-left': { type: 'string', description: 'Bars left of pivot (default 5)' },
        'pivot-right': { type: 'string', description: 'Bars right of pivot (default 5)' },
        tolerance: { type: 'string', description: 'Touch/break tolerance in ATR (default 0.5)' },
        'min-touches': { type: 'string', description: 'Min pivots on a line (default 2)' },
        'min-span': { type: 'string', description: 'Min bars between anchors (default 10)' },
        max: { type: 'string', short: 'm', description: 'Max lines per direction (default 2)' },
      },
      handler: (opts) => core.drawTrendlines({
        symbol: opts.symbol,
        timeframe: opts.timeframe,
        bars: num(opts.bars),
        pivot_left: num(opts['pivot-left']),
        pivot_right: num(opts['pivot-right']),
        tolerance_atr: num(opts.tolerance),
        min_touches: num(opts['min-touches']),
        min_span: num(opts['min-span']),
        max_lines: num(opts.max),
      }),
    }],
    ['clear', {
      description: 'Remove auto trend lines only',
      options: {
        timeframe: { type: 'string', short: 't', description: 'Only clear this timeframe (default: all)' },
      },
      handler: (opts) => core.clearTrendlines({ timeframe: opts.timeframe }),
    }],
  ]),
});
