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
export class StrafeSync {
  constructor({ historyLength = 15, perfectThreshold = 1, pairWindowTicks = 25 } = {}) {
    this.historyLength = historyLength;
    this.perfectThreshold = perfectThreshold;
    this.pairWindowTicks = pairWindowTicks;
    this.history = []; // { offset, side }
    this.lastKeyDir = 0;
    this.lastTurnDir = 0;
    this.pendingKey = null; // { tick, dir }
    this.pendingTurn = null; // { tick, dir }
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
  }

  latest() {
    return this.history.length ? this.history[this.history.length - 1] : null;
  }

  // % of tracked keyswitches within the "perfect" threshold. The
  // reference has no single headline percentage (it shows each event's
  // own Perfect/Late Nt/Early Nt text plus a scrolling offset-bar
  // history) -- this is this repo's own rollup of that into one number,
  // for the existing SYNC% HUD slot. null (not 0) when there's no data
  // yet, so callers can tell "no keyswitches recorded" apart from "0%
  // synced".
  syncPercent() {
    if (!this.history.length) return null;
    const perfect = this.history.reduce((n, s) => n + (Math.abs(s.offset) <= this.perfectThreshold ? 1 : 0), 0);
    return (perfect / this.history.length) * 100;
  }
}
