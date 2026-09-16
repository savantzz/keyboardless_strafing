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
    this.accumCounts = 0;
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
    if (!this.locked) this.canvas.requestPointerLock();
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
