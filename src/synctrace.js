// Per-tick "strafe sync" tracking, matching the standard bhop/surf HUD
// metric: for each physics tick, did you gain speed (accel > 0) and how
// close was that gain to the theoretical max for your speed that tick.
// One tick = one bar. Since keyboardless strafing has no key press
// defining the wish direction, a dip in this signal at a direction
// reversal *is* the hesitation problem -- no separate smoothness heuristic
// needed on top of it.
export class SyncTrace {
  constructor({ maxTicks = 240 } = {}) {
    this.maxTicks = maxTicks;
    this.ticks = []; // { efficiencyPct: number, gained: boolean }
  }

  push(sample) {
    this.ticks.push(sample);
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
