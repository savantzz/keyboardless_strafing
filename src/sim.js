// Fixed-timestep accumulator loop: physics ticks run at a constant rate
// (matching the game's tickrate) regardless of display refresh rate, so
// simulation timing never drifts with monitor Hz or frame drops.
export class Simulation {
  constructor({ tickRate, onTick, onFrame, input }) {
    this.setTickRate(tickRate);
    this.onTick = onTick; // (tickIntervalSeconds, yawDeltaRadians) => void
    // Fires once per animation frame regardless of how many (or few) ticks
    // ran this frame -- use this for rendering, not onTick, so the display
    // updates at full refresh rate instead of being gated to the tick rate.
    this.onFrame = onFrame; // (nowMs) => void
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

    const ticksThisFrame = Math.floor(this.accumulator / this.tickInterval);
    if (ticksThisFrame > 0) {
      // Drain the mouse accumulator exactly once per frame, not once per
      // tick, and split it evenly across however many ticks are catching
      // up this frame. Draining per-tick meant that after any frame hiccup
      // (a GC pause, a busy tab -- JS is single-threaded, so no new
      // mousemove events can arrive mid-burst), the first catch-up tick
      // grabbed everything that piled up and every other tick in that same
      // burst got zero: one artificial spike followed by nothing, even
      // though the real hand motion was smooth the whole time.
      const totalYaw = this.input.drainYawDelta();
      const yawPerTick = totalYaw / ticksThisFrame;
      for (let i = 0; i < ticksThisFrame; i++) {
        this.onTick(this.tickInterval, yawPerTick);
        this.accumulator -= this.tickInterval;
      }
    }

    if (this.onFrame) this.onFrame(now);
    this._rafHandle = requestAnimationFrame(this._raf);
  }
}
