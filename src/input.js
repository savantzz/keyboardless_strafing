// Pointer Lock mouse capture with tick-accumulated deltas.
//
// Real games (and this trainer) apply mouse movement once per simulation
// tick, not once per rendered frame. mousemove events fire independently of
// requestAnimationFrame -- a gaming mouse reports at 500-1000Hz, well above
// a ~66Hz game tick -- so summing movementX between two timestamps 15ms
// apart is accurate without needing sub-tick resolution. See sim.js for the
// fixed-timestep loop that drains this accumulator once per tick.
export class MouseInput {
  constructor({ sensitivity = 3, mYaw = 0.022 } = {}) {
    this.sensitivity = sensitivity; // in-game "sensitivity" cvar
    this.mYaw = mYaw; // in-game m_yaw cvar, degrees per mouse count (default 0.022)
    this.accumCounts = 0; // drained once per physics tick (resets)
    this.locked = false;
    this.onLockChange = null; // optional callback(locked: boolean)
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._onClick = this._onClick.bind(this);
  }

  attach(canvas) {
    this.canvas = canvas;
    document.addEventListener('pointerlockchange', this._onLockChange);
    canvas.addEventListener('click', this._onClick);
  }

  detach() {
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('mousemove', this._onMouseMove);
    if (this.canvas) this.canvas.removeEventListener('click', this._onClick);
  }

  _onClick() {
    if (this.locked) return;
    // unadjustedMovement asks the browser/OS to skip the pointer's
    // acceleration/sensitivity curve and hand back raw device deltas.
    // Without it, movementX is the OS's *processed* pointer-position delta:
    // non-linear except at exactly Windows' middle "pointer speed" setting,
    // and subject to a documented Chromium bug where an occasional event
    // reports a wildly-too-large delta (a cursor "teleport") even while the
    // physical motion is steady. That bad value is baked in before it ever
    // reaches this class, so no amount of accumulator/tick logic here can
    // catch it -- it has to be avoided at the source. Not universally
    // supported, so fall back to a plain lock if the browser rejects it.
    let result;
    try {
      result = this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      this.canvas.requestPointerLock();
      return;
    }
    if (result && typeof result.catch === 'function') {
      result.catch(() => this.canvas.requestPointerLock());
    }
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) {
      document.addEventListener('mousemove', this._onMouseMove);
    } else {
      document.removeEventListener('mousemove', this._onMouseMove);
    }
    if (this.onLockChange) this.onLockChange(this.locked);
  }

  _onMouseMove(e) {
    // getCoalescedEvents (Chrome/Edge) recovers every raw event the OS
    // delivered between animation frames, so a high-polling-rate mouse on a
    // busy tab can't silently lose movement to event coalescing.
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const source = events && events.length ? events : [e];
    for (const ev of source) {
      this.accumCounts += ev.movementX;
    }
  }

  // Returns the yaw turned (radians) since the last call and resets the
  // accumulator. Call exactly once per simulation tick.
  drainYawDelta() {
    const counts = this.accumCounts;
    this.accumCounts = 0;
    const degrees = counts * this.sensitivity * this.mYaw;
    return degrees * (Math.PI / 180);
  }
}

// Synthetic input source for automated testing / demo playback: same
// drainYawDelta() interface as MouseInput, driven by a supplied function of
// tick index instead of real mouse events.
export class ScriptedInput {
  constructor(yawDeltaFn) {
    this.yawDeltaFn = yawDeltaFn;
    this.tick = 0;
  }

  drainYawDelta() {
    const v = this.yawDeltaFn(this.tick);
    this.tick += 1;
    return v;
  }
}
