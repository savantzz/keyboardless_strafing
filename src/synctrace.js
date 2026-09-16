// Per-tick "strafe sync" tracking: for each physics tick, did you gain
// speed at all (accel > 0), and a speed-independent quality score for how
// close your aim was to ideal that tick (see main.js's onTick for how
// that score is computed and why).
//
// The raw per-tick signal is real but too sharp to read at a glance: real
// hand motion has brief micro-reversals (tremor) even during a sweep that
// feels perfectly consistent, and because "gained" flips at a hard
// threshold, a single-tick blip flips a bar from full-green to flat-red
// rather than just denting it. Verified empirically (see conversation/
// commit history) that a short window (3-5 ticks) barely helps -- it takes
// something like a 12-tick (~180ms) trailing window to actually flatten
// tremor-driven noise down to just the real underlying transitions, so
// each pushed sample also carries a smoothed value over that window for
// rendering. syncPercent()/averageEfficiencyPct() still use the raw values
// -- they're already aggregates over many ticks, so smoothing first
// wouldn't change them meaningfully, and raw is the more honest number.
export class SyncTrace {
  constructor({ maxTicks = 240, smoothingWindow = 12 } = {}) {
    this.maxTicks = maxTicks;
    this.smoothingWindow = smoothingWindow;
    this.ticks = []; // { efficiencyPct, gained, smoothedEfficiencyPct }
  }

  push(sample) {
    const entry = { ...sample };
    const start = Math.max(0, this.ticks.length - this.smoothingWindow + 1);
    const window = this.ticks.slice(start).concat(entry);
    entry.smoothedEfficiencyPct = window.reduce((sum, t) => sum + t.efficiencyPct, 0) / window.length;

    this.ticks.push(entry);
    if (this.ticks.length > this.maxTicks) this.ticks.shift();
  }

  clear() {
    this.ticks.length = 0;
  }

  // % of tracked ticks that gained any speed at all -- the headline "Sync" stat.
  syncPercent() {
    if (!this.ticks.length) return 0;
    const gained = this.ticks.reduce((n, t) => n + (t.gained ? 1 : 0), 0);
    return (gained / this.ticks.length) * 100;
  }

  averageEfficiencyPct() {
    if (!this.ticks.length) return 0;
    return this.ticks.reduce((sum, t) => sum + t.efficiencyPct, 0) / this.ticks.length;
  }
}
