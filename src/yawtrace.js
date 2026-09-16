// Tracks recent angular-velocity samples and scores how consistently the
// player holds the ideal strafe turn rate. This is the actual skill for
// keyboardless strafing: there's no key press defining the wish direction,
// so it's entirely down to smoothly reversing the mouse's angular velocity
// rather than pausing or jerking through each direction change.
export class YawRateTrace {
  constructor({ windowMs = 4000 } = {}) {
    this.windowMs = windowMs;
    this.samples = []; // { t: performance.now() ms, rateDeg: signed deg/s }
  }

  push(tMs, rateDeg) {
    this.samples.push({ t: tMs, rateDeg });
    const cutoff = tMs - this.windowMs;
    let i = 0;
    while (i < this.samples.length && this.samples[i].t < cutoff) i++;
    if (i > 0) this.samples.splice(0, i);
  }
}

// stutterFraction: |rate| below this fraction of target counts as "not turning".
// minStutterMs: minimum continuous duration below that threshold to count as
// a real stutter event (filters out normal, brief zero-crossings).
export function computeConsistencyStats(samples, targetDeg, { stutterFraction = 0.3, minStutterMs = 60 } = {}) {
  if (samples.length < 2 || targetDeg <= 0) {
    return { scorePct: 0, stutterEvents: [], streakMs: 0 };
  }

  let errSum = 0;
  const stutterEvents = [];
  let stutterStart = null;

  for (const { t, rateDeg } of samples) {
    const absRate = Math.abs(rateDeg);
    errSum += Math.min(1, Math.abs(absRate - targetDeg) / targetDeg);

    if (absRate < targetDeg * stutterFraction) {
      if (stutterStart === null) stutterStart = t;
    } else {
      if (stutterStart !== null && t - stutterStart >= minStutterMs) {
        stutterEvents.push({ start: stutterStart, end: t });
      }
      stutterStart = null;
    }
  }

  const lastT = samples[samples.length - 1].t;
  if (stutterStart !== null && lastT - stutterStart >= minStutterMs) {
    stutterEvents.push({ start: stutterStart, end: lastT });
  }

  const scorePct = Math.max(0, 100 * (1 - errSum / samples.length));
  const lastStutterEnd = stutterEvents.length ? stutterEvents[stutterEvents.length - 1].end : samples[0].t;
  const streakMs = stutterStart !== null ? 0 : lastT - lastStutterEnd;

  return { scorePct, stutterEvents, streakMs };
}
