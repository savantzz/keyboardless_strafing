// Strafe Sync (a.k.a. "Strafe Offset" in the reference): measures how
// well-timed your real strafe-key switches are relative to your mouse's
// turn-direction switches, in whole ticks. Ported directly from the
// uploaded Momentum Mod panorama source's scripts/hud/strafe-sync.ts
// (StrafeOffset class) rather than approximated -- see README.
//
// Only meaningful with an actual, independent key signal (see
// keyboard-input.js and main.js's keyboard-mode toggle): a keyboardless
// setup infers its "held key" directly FROM the mouse's turn direction
// (keyboardlessWishDir in physics.mjs), so there's no independent second
// signal left to measure a timing offset between -- comparing the mouse
// to something derived from the mouse is measuring 0 by construction.
//
// Algorithm (unchanged from the reference): each time the held strafe key
// switches direction, pair it with the nearest still-open mouse
// turn-direction switch in the SAME direction within pairWindowTicks
// (or vice versa, whichever event arrives second). The offset is
// (key tick - mouse tick): positive means the key came late, negative
// means it came early. Unpaired switches wait as "pending" until a
// matching one arrives or a new switch of that same origin replaces them.
//
// Also tracks a second, simpler metric not present in the reference file:
// a continuous per-tick "is the held key's direction the one matching
// this tick's mouse turn" check, rolled into a percentage over a trailing
// window. Reported directly as the expected behavior for a headline
// SYNC% ("pretty sure it's a continuously moving %") -- the discrete
// event-pairing metric above only changes at keyswitch events, which
// reads as chunky/infrequent for a live headline number even though it's
// the right shape for the per-event "last keyswitch" diagnostic.
export class StrafeSync {
  constructor({ historyLength = 15, perfectThreshold = 1, pairWindowTicks = 25, continuousWindow = 60 } = {}) {
    this.historyLength = historyLength;
    this.perfectThreshold = perfectThreshold;
    this.pairWindowTicks = pairWindowTicks;
    this.continuousWindow = continuousWindow;
    this.history = []; // { offset, side }
    this.lastKeyDir = 0;
    this.lastTurnDir = 0;
    this.pendingKey = null; // { tick, dir }
    this.pendingTurn = null; // { tick, dir }
    this.continuousHistory = []; // booleans: held key matched the current turn direction this tick
  }

  // Call once per physics tick. tick is a whole tick index (just count
  // ticks -- the reference derives this from wall-clock time divided by
  // tick interval, but a running counter is equivalent and simpler here
  // since this sim already ticks at a fixed rate). keyDir is +1/-1/0 (see
  // keyWishDir in physics.mjs). yawDeltaRad is this tick's raw mouse yaw
  // change; turnEpsRad is the minimum |yawDelta| to count as an actual
  // turn rather than tremor/jitter (the reference's TURN_EPS, adapted
  // from a per-frame to a per-tick threshold since this sim's yawDelta is
  // already per-tick, not per-frame).
  update(tick, keyDir, yawDeltaRad, turnEpsRad) {
    if (keyDir !== 0 && keyDir !== this.lastKeyDir) {
      this._onKeySwitch(tick, keyDir);
      this.lastKeyDir = keyDir;
    }
    if (Math.abs(yawDeltaRad) > turnEpsRad) {
      const turnDir = Math.sign(yawDeltaRad);
      if (turnDir !== this.lastTurnDir) {
        this._onTurnSwitch(tick, turnDir);
        this.lastTurnDir = turnDir;
      }
      // Continuous per-tick check, separate from the event-pairing above:
      // is the currently-held key's direction the one that actually
      // matches this tick's mouse turn? Pushed every tick the mouse is
      // actually turning (not just at switches), so this rolls smoothly
      // tick by tick rather than jumping only when a keyswitch happens to
      // get paired -- reported directly as the expected behavior
      // ("pretty sure it's a continuously moving %"), and it's a
      // genuinely different, simpler question than the discrete timing
      // offset above (which the reference's own StrafeOffset answers, and
      // which this file's `latest()`/`syncPercent()` still expose for the
      // "last keyswitch" diagnostic -- both are real, they just answer
      // different questions).
      this.continuousHistory.push(keyDir === turnDir);
      if (this.continuousHistory.length > this.continuousWindow) this.continuousHistory.shift();
    }
  }

  _onKeySwitch(tick, dir) {
    if (this.pendingTurn && this.pendingTurn.dir === dir && Math.abs(tick - this.pendingTurn.tick) <= this.pairWindowTicks) {
      this._record(tick - this.pendingTurn.tick, dir); // key later than mouse -> +offset -> late
      this.pendingTurn = null;
      this.pendingKey = null;
    } else {
      this.pendingKey = { tick, dir };
    }
  }

  _onTurnSwitch(tick, dir) {
    if (this.pendingKey && this.pendingKey.dir === dir && Math.abs(tick - this.pendingKey.tick) <= this.pairWindowTicks) {
      this._record(this.pendingKey.tick - tick, dir); // key earlier than mouse -> -offset -> early
      this.pendingKey = null;
      this.pendingTurn = null;
    } else {
      this.pendingTurn = { tick, dir };
    }
  }

  _record(offsetTicks, side) {
    this.history.push({ offset: offsetTicks, side });
    if (this.history.length > this.historyLength) this.history.shift();
  }

  clear() {
    this.history.length = 0;
    this.lastKeyDir = 0;
    this.lastTurnDir = 0;
    this.pendingKey = null;
    this.pendingTurn = null;
    this.continuousHistory.length = 0;
  }

  latest() {
    return this.history.length ? this.history[this.history.length - 1] : null;
  }

  // % of tracked keyswitches within the "perfect" timing threshold -- the
  // discrete, event-based metric (only changes when a keyswitch actually
  // gets paired). The reference has no single headline percentage for
  // this either (it shows each event's own Perfect/Late Nt/Early Nt text
  // plus a scrolling offset-bar history); this is this repo's own rollup,
  // kept for the "last keyswitch" diagnostic rather than the headline
  // SYNC% (see continuousSyncPercent for that). null (not 0) when there's
  // no data yet, so callers can tell "no keyswitches recorded" apart from
  // "0% synced".
  syncPercent() {
    if (!this.history.length) return null;
    const perfect = this.history.reduce((n, s) => n + (Math.abs(s.offset) <= this.perfectThreshold ? 1 : 0), 0);
    return (perfect / this.history.length) * 100;
  }

  // % of the last continuousWindow turning ticks where the held key
  // matched the turn direction -- updates every tick the mouse is
  // turning, not just at keyswitch events. This is the headline SYNC%
  // in keyboard mode. null (not 0) before any turning tick has been seen.
  continuousSyncPercent() {
    if (!this.continuousHistory.length) return null;
    const matched = this.continuousHistory.reduce((n, b) => n + (b ? 1 : 0), 0);
    return (matched / this.continuousHistory.length) * 100;
  }
}
