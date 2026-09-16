// Regression test for the fixed-timestep catch-up burst: after a frame
// hiccup forces several ticks to run in one animation frame, the mouse
// input accumulated during that hiccup must be split evenly across those
// ticks, not dumped entirely into the first one (which produced a single
// artificial spike in the "last tick turn" reading, reported by a user
// testing a real, smooth mouse sweep).
import assert from 'node:assert/strict';

global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

const { Simulation } = await import('../src/sim.js');

function makeFakeInput() {
  let pending = 0;
  return {
    set(v) {
      pending = v;
    },
    drainYawDelta() {
      const v = pending;
      pending = 0;
      return v;
    },
  };
}

// Normal frame: one tick's worth of time, mouse moved a bit -- should
// behave exactly as a single drain-and-apply.
{
  const input = makeFakeInput();
  const tickYaws = [];
  const sim = new Simulation({ tickRate: 66.667, input, onTick: (dt, y) => tickYaws.push(y), onFrame: () => {} });
  sim.lastTime = 0;
  sim.running = true;
  sim.accumulator = 0;

  input.set(0.02);
  sim._raf(15); // one tick interval (1000/66.667 ~= 15ms)

  assert.equal(tickYaws.length, 1, 'normal frame should run exactly one tick');
  assert.ok(Math.abs(tickYaws[0] - 0.02) < 1e-9, 'normal frame should apply the full accumulated yaw');
}

// Hiccup frame: ~150ms elapsed (10 ticks worth), mouse accumulated 0.2 rad
// total over that span -- must be split evenly, not spiked into tick 1.
{
  const input = makeFakeInput();
  const tickYaws = [];
  const sim = new Simulation({ tickRate: 66.667, input, onTick: (dt, y) => tickYaws.push(y), onFrame: () => {} });
  sim.lastTime = 0;
  sim.running = true;
  sim.accumulator = 0;

  input.set(0.2);
  sim._raf(150);

  assert.equal(tickYaws.length, 10, 'a 150ms hiccup at 66.667 tick should catch up 10 ticks');
  const allEqual = tickYaws.every((y) => Math.abs(y - tickYaws[0]) < 1e-9);
  assert.ok(allEqual, `catch-up ticks should be evenly distributed, got ${JSON.stringify(tickYaws)}`);
  const sum = tickYaws.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 0.2) < 1e-9, `total yaw across catch-up ticks should equal the input total, got ${sum}`);
}

console.log('All sim regression checks passed.');
