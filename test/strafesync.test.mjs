// Regression test for StrafeSync (src/strafesync.js), a direct port of the
// reference's StrafeOffset key-vs-mouse timing pairing algorithm.
import assert from 'node:assert/strict';
import { StrafeSync } from '../src/strafesync.js';

const EPS = 0.01; // radians, arbitrary "counts as a turn" threshold for these tests

// Perfect sync: key switch and mouse turn switch land on the exact same tick.
{
  const sync = new StrafeSync();
  // Tick 0: turning right (mouse), key already right (no switch recorded at t=0
  // since lastKeyDir starts at 0 -> first nonzero key IS a switch too).
  sync.update(0, 1, 0.5, EPS); // key switches to +1 AND mouse turns +1, same tick -> perfect
  assert.equal(sync.history.length, 1, 'one paired event recorded');
  assert.equal(sync.history[0].offset, 0, 'same-tick key and mouse switch pairs at offset 0');
  assert.equal(sync.syncPercent(), 100, 'a single perfect event is 100% synced');
}

// Late key: mouse turns first, key follows a few ticks later.
{
  const sync = new StrafeSync();
  sync.update(0, 0, 0.5, EPS); // mouse turns right at tick 0, no key held yet
  sync.update(1, 0, 0, EPS);
  sync.update(2, 0, 0, EPS);
  sync.update(3, 1, 0, EPS); // key switches to right at tick 3 -- 3 ticks late
  assert.equal(sync.history.length, 1);
  assert.equal(sync.history[0].offset, 3, 'key 3 ticks after mouse -> +3 (late)');
  assert.equal(sync.syncPercent(), 0, 'a 3-tick-late event misses the default 1-tick perfect threshold');
}

// Early key: key switches first, mouse follows.
{
  const sync = new StrafeSync();
  sync.update(0, 1, 0, EPS); // key switches to right at tick 0
  sync.update(1, 1, 0, EPS);
  sync.update(2, 1, 0.5, EPS); // mouse turns right at tick 2 -- key was 2 ticks early
  assert.equal(sync.history.length, 1);
  assert.equal(sync.history[0].offset, -2, 'key 2 ticks before mouse -> -2 (early)');
}

// Switches outside the pairing window never pair -- each becomes its own
// pending event, and neither ever resolves into a history entry.
{
  const sync = new StrafeSync({ pairWindowTicks: 5 });
  sync.update(0, 1, 0, EPS); // key switch
  sync.update(30, 0, -0.5, EPS); // mouse turn switch 30 ticks later -- outside the 5-tick window
  assert.equal(sync.history.length, 0, 'switches outside the pairing window are never paired');
}

// A realistic oscillating strafe (key and mouse switch together every
// cycle, always within 1 tick) should read close to 100% synced across
// many cycles, not just a single event.
{
  const sync = new StrafeSync();
  let dir = 1;
  for (let tick = 0; tick < 100; tick += 10) {
    dir *= -1;
    sync.update(tick, dir, dir * 0.5, EPS);
  }
  assert.ok(sync.syncPercent() >= 90, `sustained same-tick switching should read near-perfect sync, got ${sync.syncPercent()}`);
}

// No keyswitches recorded yet -> null, distinct from 0%.
{
  const sync = new StrafeSync();
  assert.equal(sync.syncPercent(), null, 'no data yet is null, not 0%');
  assert.equal(sync.continuousSyncPercent(), null, 'continuous metric is also null before any turning tick');
}

// Continuous per-tick metric: updates every turning tick, not just at
// keyswitch events -- holding the matching key the whole time should
// read 100% even with zero recorded keyswitch-pairing events (key never
// switches, so history stays empty), proving it's a genuinely separate
// signal from syncPercent().
{
  const sync = new StrafeSync();
  for (let tick = 0; tick < 20; tick++) {
    sync.update(tick, 1, 0.5, EPS); // key held right the whole time, mouse turning right every tick
  }
  assert.equal(sync.history.length, 1, 'only the initial key switch is a pairing event');
  assert.equal(sync.continuousSyncPercent(), 100, 'held key matching the turn direction every tick is 100%');
}

// Holding the WRONG key the whole time should read close to 0%, and
// should update immediately (a "continuously moving" percentage), not
// wait for a keyswitch to resolve.
{
  const sync = new StrafeSync();
  for (let tick = 0; tick < 20; tick++) {
    sync.update(tick, -1, 0.5, EPS); // key held left, mouse turning right -- mismatched every tick
  }
  assert.equal(sync.continuousSyncPercent(), 0, 'held key opposite the turn direction every tick is 0%');
}

// The continuous window only keeps the trailing N turning ticks -- an
// early mismatched stretch should age out and stop dragging the percentage
// down once enough matched ticks have followed it.
{
  const sync = new StrafeSync({ continuousWindow: 10 });
  for (let tick = 0; tick < 10; tick++) sync.update(tick, -1, 0.5, EPS); // 10 mismatched
  assert.equal(sync.continuousSyncPercent(), 0);
  for (let tick = 10; tick < 20; tick++) sync.update(tick, 1, 0.5, EPS); // 10 matched, window is 10
  assert.equal(sync.continuousSyncPercent(), 100, 'old mismatched ticks should age out of the trailing window');
}

console.log('All strafe-sync regression checks passed.');
