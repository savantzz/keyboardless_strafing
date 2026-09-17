// Per-tick "strafe sync" tracking: for each physics tick, did you gain
// speed at all (accel > 0), and two separate speed-independent ratios (see
// main.js's onTick for how each is computed and why): efficiencyPct (a
// yaw-rate ratio, drives bar height) and gainRatioPct (a speedGain/
// idealGain ratio, drives bar color -- see render.js). Both are smoothed
// over the same trailing window independently, matching the reference
// Momentum Mod implementation's two separate buffers (gainRatioHistory,
// yawRatioHistory) averaged the same way.
//
// The raw per-tick signal is real but too sharp to read at a glance: real
// hand motion has brief micro-reversals (tremor) even during a sweep that
// feels perfectly consistent, and because "gained" flips at a hard
// threshold, a single-tick blip flips a bar from full-green to flat-red
// rather than just denting it. Verified empirically (see conversation/
// commit history) that a short window (3-5 ticks) barely helps -- it takes
// something like a 10-tick trailing window to actually flatten tremor-
// driven noise down to just the real underlying transitions, so each
// pushed sample also carries a smoothed value over that window for
// rendering. syncPercent()/averageEfficiencyPct() still use the raw values
// -- they're already aggregates over many ticks, so smoothing first
// wouldn't change them meaningfully, and raw is the more honest number.
//
// 10 (not an earlier empirically-chosen 12) to match the actual reference
// implementation exactly: confirmed directly from the uploaded Momentum
// Mod panorama source (scripts/hud/strafe-trainer.ts), which has this as
// a user-facing "Averaging Window" setting, DEFAULT_BUFFER_LENGTH = 10 --
// same mechanism (a true moving average over the last N ticks), just a
// ring buffer with pre-scaled samples (sampleWeight = 1/interpFrames)
// instead of a literal slice+reduce. Exposed here as an adjustable
// setting too, matching the reference.
export class SyncTrace {
  constructor({ maxTicks = 240, smoothingWindow = 10 } = {}) {
    this.maxTicks = maxTicks;
    this.smoothingWindow = smoothingWindow;
    this.ticks = []; // { efficiencyPct, gainRatioPct, gained, smoothedEfficiencyPct, smoothedGainRatioPct }
  }

  push(sample) {
    const entry = { ...sample };
    const start = Math.max(0, this.ticks.length - this.smoothingWindow + 1);
    const window = this.ticks.slice(start).concat(entry);
    entry.smoothedEfficiencyPct = window.reduce((sum, t) => sum + t.efficiencyPct, 0) / window.length;
    entry.smoothedGainRatioPct = window.reduce((sum, t) => sum + t.gainRatioPct, 0) / window.length;

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
