/**
 * Triangle / wedge and micro-structure unit tests — no TradingView connection needed.
 *
 * Run: node --test tests/triangles.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeTriangles, resolveOptions } from '../src/core/triangles.js';
import { computeMicro } from '../src/core/structure.js';
import { computeLevels } from '../src/core/levels.js';

const bar = (i, high, low, close = (high + low) / 2) => ({ time: 1700000000 + i * 3600, open: close, high, low, close, volume: 1 });

// Zig-zag bouncing between two boundary lines: peaks sit exactly on upper(i),
// troughs exactly on lower(i), so the swing pivots define both boundaries.
function patternBars(upper, lower, { half = 8, cycles = 6 } = {}) {
  const bars = [];
  const n = cycles * 2 * half + half / 2;
  for (let i = 0; i < n; i++) {
    const phase = i % (2 * half);
    const w = (phase <= half ? phase : 2 * half - phase) / half; // 0 trough → 1 peak
    const p = lower(i) + (upper(i) - lower(i)) * w;
    bars.push(bar(i, p + 0.0005, p - 0.0005, p));
  }
  return bars;
}

const opts = { pivot_left: 3, pivot_right: 3 };

describe('computeTriangles', () => {
  it('detects a symmetrical triangle', () => {
    const res = computeTriangles(patternBars(i => 1.2 - 0.001 * i, i => 0.8 + 0.001 * i), opts);
    assert.equal(res.patterns.length, 1);
    const p = res.patterns[0];
    assert.equal(p.type, 'symmetrical');
    assert.ok(p.upper.slope_per_bar < 0 && p.lower.slope_per_bar > 0);
    assert.ok(p.apex_bars_ahead > 0);
    assert.ok(p.breakout_above > p.breakdown_below);
    assert.ok(p.upper.touches >= 2 && p.lower.touches >= 2);
  });

  it('detects an ascending triangle (flat top, rising lows)', () => {
    const res = computeTriangles(patternBars(() => 1.2, i => 0.8 + 0.002 * i), opts);
    assert.equal(res.patterns[0]?.type, 'ascending');
  });

  it('detects a descending triangle (falling highs, flat bottom)', () => {
    const res = computeTriangles(patternBars(i => 1.2 - 0.002 * i, () => 0.8), opts);
    assert.equal(res.patterns[0]?.type, 'descending');
  });

  it('detects a rising wedge', () => {
    const res = computeTriangles(patternBars(i => 1.2 + 0.001 * i, i => 0.8 + 0.003 * i), opts);
    assert.equal(res.patterns[0]?.type, 'rising_wedge');
  });

  it('ignores a parallel channel (no convergence)', () => {
    const res = computeTriangles(patternBars(i => 1.2 + 0.001 * i, i => 0.8 + 0.001 * i), opts);
    assert.equal(res.patterns.length, 0);
  });

  it('ignores a pattern once price closed through a boundary', () => {
    const bars = patternBars(i => 1.2 - 0.001 * i, i => 0.8 + 0.001 * i);
    const last = bars.length - 1;
    bars[last] = bar(last, 1.6, 1.5, 1.55); // breakout far above every upper line
    const res = computeTriangles(bars, opts);
    assert.ok(res.patterns.every(p => p.breakout_above >= 1.55 - res.tolerance));
  });

  it('rejects invalid ratio options', () => {
    assert.throws(() => resolveOptions({ max_width_ratio: 1 }), /max_width_ratio/);
    assert.throws(() => resolveOptions({ max_apex_ratio: 0 }), /max_apex_ratio/);
  });
});

describe('computeLevels nearest', () => {
  it('picks the levels closest to the last close instead of the strongest', () => {
    // Strong range 0.10–0.12 earlier, then a weaker range 0.13–0.14 where price sits now.
    const bars = [
      ...patternBars(() => 0.12, () => 0.10, { cycles: 6 }),
      ...patternBars(() => 0.14, () => 0.13, { cycles: 2 }),
    ].map((b, i) => ({ ...b, time: 1700000000 + i * 3600 }));
    const res = computeLevels(bars, { ...opts, nearest: true, max_levels: 1 });
    const last = bars[bars.length - 1].close;
    const supports = computeLevels(bars, { ...opts, min_touches: 2, max_levels: 10 }).supports;
    const closest = supports.reduce((a, b) => (Math.abs(b.price - last) < Math.abs(a.price - last) ? b : a));
    assert.equal(res.supports[0].price, closest.price);
  });
});

describe('computeMicro', () => {
  it('finds a triangle inside the range between the nearest levels', () => {
    // Wide range first (sets the levels), then a tightening triangle inside it.
    const wide = patternBars(() => 1.3, () => 0.7, { cycles: 3 });
    const tight = patternBars(i => 1.2 - 0.001 * i, i => 0.8 + 0.001 * i, { cycles: 6 });
    const bars = [...wide, ...tight].map((b, i) => ({ ...b, time: 1700000000 + i * 900 }));
    const m = computeMicro(bars, { recent_bars: 200, min_range_bars: 30 });
    assert.ok(m.range.bars >= 30);
    assert.ok(m.levels.supports.length <= 1 && m.levels.resistances.length <= 1);
    assert.equal(m.triangles.patterns[0]?.type, 'symmetrical');
  });

  it('stops the range where closes left the support/resistance band', () => {
    const outside = Array.from({ length: 40 }, (_, i) => bar(i, 5.01, 4.99, 5));
    const inside = patternBars(() => 1.2, () => 0.8, { cycles: 5 });
    const bars = [...outside, ...inside].map((b, i) => ({ ...b, time: 1700000000 + i * 900 }));
    const m = computeMicro(bars, { recent_bars: 500 });
    assert.ok(m.range.bars <= inside.length, `range ${m.range.bars} > ${inside.length}`);
  });

  it('widens past tiny swings next to the price to the levels bounding the recent range', () => {
    const broad = patternBars(() => 1.2, () => 0.8, { cycles: 5 });
    const tiny = patternBars(() => 1.01, () => 0.99, { half: 4, cycles: 3 }); // 26 bars hugging 1.0
    const bars = [...broad, ...tiny].map((b, i) => ({ ...b, time: 1700000000 + i * 900 }));
    const m = computeMicro(bars, { recent_bars: 300, min_range_bars: 40 });
    assert.ok(Math.abs(m.range.support - 0.7995) < 1e-6, `support ${m.range.support}`);
    assert.ok(Math.abs(m.range.resistance - 1.2005) < 1e-6, `resistance ${m.range.resistance}`);
    assert.ok(m.range.bars >= 40);
  });

  it('falls back to the recent high when price is above every pivot resistance', () => {
    const range = patternBars(() => 1.2, () => 0.8, { cycles: 4 });
    const n = range.length;
    // Spike to a fresh high, then pull back slightly: the spike is too recent to be a pivot.
    const tail = [bar(n, 1.5, 1.3, 1.45), bar(n + 1, 1.42, 1.35, 1.4)];
    const m = computeMicro([...range, ...tail], { min_range_bars: 10 });
    assert.equal(m.levels.resistances[0]?.fallback, 'recent_high');
    assert.equal(m.levels.resistances[0].price, 1.5);
    assert.ok(m.levels.supports.length === 1);
  });

  it('skips pattern search when too few bars are inside the range', () => {
    const bars = patternBars(() => 1.2, () => 0.8, { cycles: 3 });
    const m = computeMicro(bars, { recent_bars: 20, min_range_bars: 30 });
    assert.match(m.range.note, /no trend\/triangle check/);
    assert.equal(m.triangles.patterns.length, 0);
  });

  it('skips pattern search when the range is shorter than one pivot window', () => {
    const bars = Array.from({ length: 100 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 }));
    const m = computeMicro(bars, { pivot_left: 20, pivot_right: 20, recent_bars: 30, min_range_bars: 30 });
    assert.equal(m.range.bars, 30);
    assert.match(m.range.note, /need 41/);
  });
});
