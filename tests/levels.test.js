/**
 * Support/resistance algorithm unit tests — no TradingView connection needed.
 *
 * Run: node --test tests/levels.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { atr, findPivots, computeLevels, resolveOptions, clearLevels, DEFAULTS, tfLabel } from '../src/core/levels.js';

const bar = (i, high, low, close = (high + low) / 2) => ({ time: 1700000000 + i * 3600, open: close, high, low, close, volume: 1 });

// Price oscillates between ~0.10 (support) and ~0.12 (resistance), ending mid-range.
function rangeBars(cycles = 6, half = 8) {
  const bars = [];
  let i = 0;
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k <= half; k++, i++) {
      const mid = 0.10 + (0.02 * k) / half;
      bars.push(bar(i, mid + 0.001, mid - 0.001));
    }
    for (let k = half - 1; k > 0; k--, i++) {
      const mid = 0.10 + (0.02 * k) / half;
      bars.push(bar(i, mid + 0.001, mid - 0.001));
    }
  }
  for (let k = 0; k <= half / 2; k++, i++) {
    const mid = 0.10 + (0.02 * k) / half;
    bars.push(bar(i, mid + 0.001, mid - 0.001));
  }
  return bars;
}

describe('atr', () => {
  it('averages true range over the last period', () => {
    const bars = [bar(0, 2, 1, 1.5), bar(1, 3, 2, 2.5), bar(2, 3, 2, 2.5)];
    // TRs: max(1, 1.5, 0.5)=1.5 ; max(1, 0.5, 0.5)=1
    assert.equal(atr(bars, 14), 1.25);
  });
});

describe('findPivots', () => {
  it('finds a single swing high and low', () => {
    const highs = [1, 2, 3, 2, 1, 2, 3];
    const bars = highs.map((h, i) => bar(i, h, h - 0.5));
    const pivots = findPivots(bars, 2, 2);
    assert.deepEqual(pivots.map(p => [p.index, p.kind]), [[2, 'high'], [4, 'low']]);
  });

  it('ignores equal highs (strict extreme)', () => {
    const bars = [1, 2, 3, 3, 2, 1].map((h, i) => bar(i, h, h - 0.5));
    assert.equal(findPivots(bars, 2, 2).filter(p => p.kind === 'high').length, 0);
  });
});

describe('computeLevels', () => {
  it('detects the range support and resistance', () => {
    const res = computeLevels(rangeBars(), { pivot_left: 3, pivot_right: 3 });
    assert.equal(res.supports.length, 1);
    assert.equal(res.resistances.length, 1);
    assert.ok(Math.abs(res.supports[0].price - 0.099) < 1e-9, `support ${res.supports[0].price}`);
    assert.ok(Math.abs(res.resistances[0].price - 0.121) < 1e-9, `resistance ${res.resistances[0].price}`);
    assert.ok(res.supports[0].touches >= 5);
    assert.ok(res.supports[0].price < res.last_close && res.resistances[0].price > res.last_close);
  });

  it('respects min_touches', () => {
    const res = computeLevels(rangeBars(), { pivot_left: 3, pivot_right: 3, min_touches: 100 });
    assert.equal(res.supports.length + res.resistances.length, 0);
  });

  it('keeps the strongest max_levels per side, ordered high to low', () => {
    const bars = stairBars();
    const all = computeLevels(bars, { pivot_left: 2, pivot_right: 2, max_levels: 10 });
    assert.ok(all.supports.length >= 3, `expected >=3 supports, got ${all.supports.length}`);
    const two = computeLevels(bars, { pivot_left: 2, pivot_right: 2, max_levels: 2 });
    assert.equal(two.supports.length, 2);
    const strongest = [...all.supports].sort((a, b) => b.score - a.score).slice(0, 2).map(l => l.price);
    assert.deepEqual([...two.supports.map(l => l.price)].sort(), [...strongest].sort());
    for (const side of [all.supports, all.resistances]) {
      for (let i = 1; i < side.length; i++) assert.ok(side[i - 1].price > side[i].price);
    }
  });

  it('caps cluster width at the tolerance (no chain drift)', () => {
    const res = computeLevels(stairBars(), { pivot_left: 2, pivot_right: 2, min_touches: 1, max_levels: 10 });
    for (const l of [...res.supports, ...res.resistances]) {
      assert.ok(l.zone_high - l.zone_low <= res.tolerance + 1e-12);
    }
  });

  it('classifies a level equal to the last close as resistance', () => {
    const bars = rangeBars();
    const support = computeLevels(bars, { pivot_left: 3, pivot_right: 3 }).supports[0].price;
    bars[bars.length - 1] = { ...bars[bars.length - 1], close: support };
    const res = computeLevels(bars, { pivot_left: 3, pivot_right: 3 });
    assert.ok(res.resistances.some(l => l.price === support));
    assert.ok(!res.supports.some(l => l.price === support));
  });

  it('throws on too few bars', () => {
    assert.throws(() => computeLevels([bar(0, 1, 0)]), /Need at least/);
  });
});

// Three troughs at different depths, each revisited, inside an uptrend that ends high.
function stairBars() {
  const lows = [0.090, 0.095, 0.090, 0.095, 0.100, 0.095, 0.100, 0.105, 0.100, 0.105, 0.110, 0.130];
  const bars = [];
  let i = 0;
  for (const low of lows) {
    for (const off of [0.004, 0.002, 0, 0.002, 0.004]) bars.push(bar(i++, low + off + 0.001, low + off));
  }
  return bars;
}

describe('resolveOptions', () => {
  it('ignores undefined values (CLI flags not given) and keeps defaults', () => {
    const o = resolveOptions({ bars: undefined, pivot_left: undefined, max_levels: undefined, zones: undefined });
    assert.equal(o.bars, DEFAULTS.bars);
    assert.equal(o.pivot_left, DEFAULTS.pivot_left);
    assert.equal(o.max_levels, DEFAULTS.max_levels);
    assert.equal(o.zones, false);
  });

  it('rejects invalid numbers before touching the chart', () => {
    assert.throws(() => resolveOptions({ bars: NaN }), /bars must be an integer/);
    assert.throws(() => resolveOptions({ pivot_left: 2.5 }), /pivot_left/);
    assert.throws(() => resolveOptions({ max_levels: -1 }), /max_levels/);
    assert.throws(() => resolveOptions({ tolerance_atr: 0 }), /tolerance_atr/);
    assert.throws(() => resolveOptions({ zones: 'false' }), /zones/);
    assert.throws(() => resolveOptions({ bars: 20, pivot_left: 50, pivot_right: 50 }), /at least pivot_left \+ pivot_right \+ 1/);
    assert.throws(() => resolveOptions({ days: 0 }), /days must be an integer/);
    assert.throws(() => resolveOptions({ days: 1.5 }), /days must be an integer/);
  });

  it('rejects an empty clear timeframe instead of clearing every timeframe', async () => {
    await assert.rejects(() => clearLevels({ timeframe: '' }), /non-empty string/);
    await assert.rejects(() => clearLevels({ timeframe: '  ' }), /non-empty string/);
  });

  it('records whether bars was given, so daily charts know to use the calendar lookback', () => {
    assert.equal(resolveOptions({}).bars_explicit, false);
    assert.equal(resolveOptions({ bars: undefined }).bars_explicit, false);
    assert.equal(resolveOptions({ bars: 300 }).bars_explicit, true);
    assert.equal(resolveOptions({ days: 365 }).days, 365);
  });
});

describe('tfLabel', () => {
  it('formats chart resolutions as drawing-tag labels', () => {
    assert.equal(tfLabel('240'), '4H');
    assert.equal(tfLabel('60'), '1H');
    assert.equal(tfLabel('15'), '15m');
    assert.equal(tfLabel('D'), '1D');
    assert.equal(tfLabel('1D'), '1D');
    assert.equal(tfLabel('w'), '1W');
  });
});
