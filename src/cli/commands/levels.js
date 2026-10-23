import { register } from '../router.js';
import * as core from '../../core/levels.js';

const num = v => (v === undefined ? undefined : Number(v));

register('levels', {
  description: 'Auto support/resistance levels (draw, clear)',
  subcommands: new Map([
    ['draw', {
      description: 'Detect and draw support/resistance on the chart',
      options: {
        symbol: { type: 'string', short: 's', description: 'Symbol, e.g. BINANCE:DOGEUSDT' },
        timeframe: { type: 'string', short: 't', description: 'Timeframe, e.g. 60, 240, D' },
        bars: { type: 'string', short: 'n', description: 'Bars to analyze (default 500)' },
        days: { type: 'string', description: 'Calendar days to analyze instead of bars (daily default 730)' },
        'pivot-left': { type: 'string', description: 'Bars left of pivot (default 5)' },
        'pivot-right': { type: 'string', description: 'Bars right of pivot (default 5)' },
        tolerance: { type: 'string', description: 'Cluster width in ATR (default 0.5)' },
        'min-touches': { type: 'string', description: 'Min pivots per level (default 2)' },
        max: { type: 'string', short: 'm', description: 'Max levels per side (default 3)' },
        zones: { type: 'boolean', description: 'Also draw shaded zones' },
      },
      handler: (opts) => core.drawLevels({
        symbol: opts.symbol,
        timeframe: opts.timeframe,
        bars: num(opts.bars),
        days: num(opts.days),
        pivot_left: num(opts['pivot-left']),
        pivot_right: num(opts['pivot-right']),
        tolerance_atr: num(opts.tolerance),
        min_touches: num(opts['min-touches']),
        max_levels: num(opts.max),
        zones: opts.zones,
      }),
    }],
    ['clear', {
      description: 'Remove auto support/resistance drawings only',
      options: {
        timeframe: { type: 'string', short: 't', description: 'Only clear this timeframe (default: all)' },
      },
      handler: (opts) => core.clearLevels({ timeframe: opts.timeframe }),
    }],
  ]),
});
