/**
 * Trend line algorithm unit tests — no TradingView connection needed.
 *
 * Run: node --test tests/trendlines.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeTrendlines, resolveOptions, DEFAULTS } from '../src/core/trendlines.js';

const bar = (i, high, low, close = (high + low) / 2) => ({ time: 1700000000 + i * 3600, open: close, high, low, close, volume: 1 });

// Zig-zag (period 2*half) riding on a linear baseline: troughs (dir=+1) or
// peaks (dir=-1) all sit exactly on the baseline, so they form one trend line.
function trendBars({ start = 0.10, slope = 0.0002, amp = 0.01, half = 8, cycles = 6, dir = 1 } = {}) {
  const bars = [];
  const n = cycles * 2 * half + half / 2;
  for (let i = 0; i < n; i++) {
    const phase = i % (2 * half);
    const tri = (phase <= half ? phase : 2 * half - phase) / half; // 0 at troughs, 1 at peaks
    const mid = start + slope * i + dir * amp * tri;
    bars.push(bar(i, mid + 0.001, mid - 0.001, mid));
  }
  return bars;
}

describe('computeTrendlines', () => {
  it('finds the rising line through higher lows', () => {
    const bars = trendBars({ dir: 1, slope: 0.0002 });
    const res = computeTrendlines(bars, { pivot_left: 3, pivot_right: 3 });
    assert.ok(res.uptrends.length >= 1);
    const best = res.uptrends[0];
    assert.ok(best.touches >= 5, `touches ${best.touches}`);
    assert.ok(Math.abs(best.slope_per_bar - 0.0002) < 1e-9, `slope ${best.slope_per_bar}`);
    assert.ok(best.end.time > best.start.time);
    assert.equal(res.downtrends.length, 0);
  });

  it('finds the falling line through lower highs', () => {
    const bars = trendBars({ dir: -1, slope: -0.0002, start: 0.2 });
    const res = computeTrendlines(bars, { pivot_left: 3, pivot_right: 3 });
    assert.ok(res.downtrends.length >= 1);
    assert.ok(res.downtrends[0].touches >= 5);
    assert.ok(Math.abs(res.downtrends[0].slope_per_bar + 0.0002) < 1e-9);
    assert.equal(res.uptrends.length, 0);
  });

  it('drops a line once a close breaks through it', () => {
    const bars = trendBars({ dir: 1, slope: 0.0002 });
    const last = bars.length - 1;
    bars[last] = bar(last, 0.06, 0.05, 0.05); // crash far below every rising line
    const res = computeTrendlines(bars, { pivot_left: 3, pivot_right: 3 });
    assert.equal(res.uptrends.length, 0);
  });

  it('respects min_touches and max_lines', () => {
    const bars = trendBars({ dir: 1, slope: 0.0002 });
    assert.equal(computeTrendlines(bars, { pivot_left: 3, pivot_right: 3, min_touches: 50 }).uptrends.length, 0);
    assert.ok(computeTrendlines(bars, { pivot_left: 3, pivot_right: 3, min_touches: 2, max_lines: 1 }).uptrends.length <= 1);
  });

  it('does not return near-duplicate lines', () => {
    const res = computeTrendlines(trendBars({ dir: 1 }), { pivot_left: 3, pivot_right: 3, max_lines: 5 });
    for (let a = 0; a < res.uptrends.length; a++) {
      for (let b = a + 1; b < res.uptrends.length; b++) {
        const anchors = l => [l.start.time, l.end.time];
        assert.ok(!anchors(res.uptrends[a]).some(t => anchors(res.uptrends[b]).includes(t)));
        assert.ok(Math.abs(res.uptrends[a].current_price - res.uptrends[b].current_price) > res.tolerance);
      }
    }
  });

  it('ignores near-flat lines (those are S/R levels)', () => {
    const res = computeTrendlines(trendBars({ dir: 1, slope: 0.0000001 }), { pivot_left: 3, pivot_right: 3 });
    assert.equal(res.uptrends.length, 0);
  });

  it('throws on too few bars', () => {
    assert.throws(() => computeTrendlines([bar(0, 1, 0)]), /Need at least/);
  });
});

describe('trendline resolveOptions', () => {
  it('keeps defaults for undefined CLI flags', () => {
    const o = resolveOptions({ max_lines: undefined, min_span: undefined });
    assert.equal(o.max_lines, DEFAULTS.max_lines);
    assert.equal(o.min_span, DEFAULTS.min_span);
  });

  it('rejects invalid values', () => {
    assert.throws(() => resolveOptions({ min_touches: 1 }), /min_touches/);
    assert.throws(() => resolveOptions({ max_lines: 0 }), /max_lines/);
    assert.throws(() => resolveOptions({ min_span: 1.5 }), /min_span/);
  });
});
