// Fixed-timestep accumulator loop: physics ticks run at a constant rate
// (matching the game's tickrate) regardless of display refresh rate, so
// simulation timing never drifts with monitor Hz or frame drops.
export class Simulation {
  constructor({ tickRate, onTick, input }) {
    this.setTickRate(tickRate);
    this.onTick = onTick; // (tickIntervalSeconds, yawDeltaRadians) => void
    this.input = input; // anything with drainYawDelta()
    this.accumulator = 0;
    this.lastTime = null;
    this.running = false;
    this._raf = this._raf.bind(this);
    this._rafHandle = null;
  }

  setTickRate(tickRate) {
    this.tickRate = tickRate;
    this.tickInterval = 1 / tickRate;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this._rafHandle = requestAnimationFrame(this._raf);
  }

  stop() {
    this.running = false;
    if (this._rafHandle !== null) cancelAnimationFrame(this._rafHandle);
    this._rafHandle = null;
  }

  _raf(now) {
    if (!this.running) return;
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Clamp so a backgrounded/throttled tab doesn't fire a huge burst of
    // catch-up ticks on refocus (the "spiral of death" in fixed-step loops).
    if (frameTime > 0.25) frameTime = 0.25;
    this.accumulator += frameTime;
    while (this.accumulator >= this.tickInterval) {
      const yawDelta = this.input.drainYawDelta();
      this.onTick(this.tickInterval, yawDelta);
      this.accumulator -= this.tickInterval;
    }
    this._rafHandle = requestAnimationFrame(this._raf);
  }
}
