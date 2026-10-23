import { register } from '../router.js';
import * as tri from '../../core/triangles.js';
import * as core from '../../core/structure.js';

const num = v => (v === undefined ? undefined : Number(v));
const list = v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined);

const chartOptions = {
  symbol: { type: 'string', short: 's', description: 'Symbol, e.g. BINANCE:DOGEUSDT' },
  timeframe: { type: 'string', short: 't', description: 'Timeframe, e.g. 15, 240, D' },
  bars: { type: 'string', short: 'n', description: 'Bars to analyze (default 500)' },
  days: { type: 'string', description: 'Calendar days to analyze instead of bars (daily default 730)' },
  'pivot-left': { type: 'string', description: 'Bars left of pivot' },
  'pivot-right': { type: 'string', description: 'Bars right of pivot' },
  tolerance: { type: 'string', description: 'Touch/break tolerance in ATR (default 0.5)' },
};

const chartArgs = opts => ({
  symbol: opts.symbol,
  timeframe: opts.timeframe,
  bars: num(opts.bars),
  days: num(opts.days),
  pivot_left: num(opts['pivot-left']),
  pivot_right: num(opts['pivot-right']),
  tolerance_atr: num(opts.tolerance),
});

register('triangle', {
  description: 'Auto triangles / wedges (draw, clear)',
  subcommands: new Map([
    ['draw', {
      description: 'Detect and draw converging patterns on the chart',
      options: {
        ...chartOptions,
        'min-span': { type: 'string', description: 'Min bars between a line\'s anchors (default 10)' },
        max: { type: 'string', short: 'm', description: 'Max patterns (default 1)' },
      },
      handler: (opts) => tri.drawTriangles({ ...chartArgs(opts), min_span: num(opts['min-span']), max_patterns: num(opts.max) }),
    }],
    ['clear', {
      description: 'Remove auto triangle drawings only',
      options: { timeframe: { type: 'string', short: 't', description: 'Only clear this timeframe (default: all)' } },
      handler: (opts) => tri.clearTriangles({ timeframe: opts.timeframe }),
    }],
  ]),
});

register('structure', {
  description: 'S/R + trend lines + triangles for one timeframe (draw)',
  subcommands: new Map([
    ['draw', {
      description: 'Draw levels, trend lines and triangles in one pass',
      options: chartOptions,
      handler: (opts) => core.drawStructure(chartArgs(opts)),
    }],
  ]),
});

register('micro', {
  description: 'Small-timeframe nearest S/R + range patterns (draw)',
  subcommands: new Map([
    ['draw', {
      description: 'Nearest support/resistance and trend lines/triangles inside that range (default 15m)',
      options: {
        ...chartOptions,
        recent: { type: 'string', description: 'Max bars to look back for the range (default 150)' },
      },
      handler: (opts) => core.drawMicro({ ...chartArgs(opts), recent_bars: num(opts.recent) }),
    }],
  ]),
});

// "none" → [] (skip), unset → undefined (default).
const tfList = v => (v === 'none' ? [] : list(v));

register('scan', {
  description: 'Draw structure for every watchlist symbol (1D/1W + 1H micro)',
  options: {
    symbols: { type: 'string', description: 'Comma-separated symbols instead of the watchlist' },
    timeframes: { type: 'string', description: 'Comma-separated full-structure timeframes (default D,W; "none" to skip)' },
    micro: { type: 'string', description: 'Comma-separated micro timeframes (default 60; "none" to skip)' },
    clear: { type: 'string', description: 'Comma-separated timeframes whose auto drawings to remove, e.g. 240' },
  },
  handler: (opts) => core.drawWatchlist({
    symbols: list(opts.symbols),
    timeframes: tfList(opts.timeframes),
    micro_timeframes: tfList(opts.micro),
    clear_timeframes: list(opts.clear),
  }),
});
