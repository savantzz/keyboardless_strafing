// Regression test for the keyboardless-strafing input model
// (keyboardlessWishDir in physics.mjs): mouse angle is NOT the wish
// direction directly. Confirmed directly (see conversation/commit history):
// a strafer's view/crosshair tracks close to their direction of travel
// while strafing well, which is only consistent with the classic
// held-key mechanic (wishdir = view angle +/- 90 degrees, whichever key is
// held) -- a "keyboardless" setup automates which key is held based on
// which way the mouse is currently turning, it doesn't remove the offset.
// Before this fix, main.js fed the raw mouse-controlled view angle in as
// the wish direction with zero offset, silently training a different (and
// easier) skill -- aiming perpendicular to your velocity -- than real
// air-strafe muscle memory expects.
import assert from 'node:assert/strict';
import { applyAirAccelTick, accelCap, idealYawSpeedFor, keyboardlessWishDir, vecLength } from '../src/physics.mjs';

// No mouse movement this tick -> no key held -> no wish direction at all.
{
  const { active } = keyboardlessWishDir(0, 0);
  assert.equal(active, false, 'zero yawDelta must not produce an active wish direction');
}

// Turning direction picks the sign of the +/-90 degree offset.
{
  const view = 0.3;
  const right = keyboardlessWishDir(view, 0.01);
  const left = keyboardlessWishDir(view, -0.01);
  assert.equal(right.active, true);
  assert.equal(left.active, true);
  const approxEq = (a, b) => Math.abs(a - b) < 1e-12;
  assert.ok(approxEq(right.wishDirRad, view + Math.PI / 2), 'turning one way offsets wishdir by +90deg');
  assert.ok(approxEq(left.wishDirRad, view - Math.PI / 2), 'turning the other way offsets wishdir by -90deg');
}

// A player continuously turning at the theoretical ideal yaw rate (one
// direction, no reversal) must gain speed every tick and converge to the
// known uncapped-regime steady state: accel == airMaxSpeed, and the
// resulting wishdir-relative-to-velocity angle (result.A) converges to
// exactly 90 degrees -- the same target idealYawSpeedUncapped is built
// around.
{
  const params = { groundMaxSpeed: 320, airMaxSpeed: 30, tickRate: 100 * (2 / 3), airAccelerate: 150, penalty: 1 };
  const tickInterval = 1 / params.tickRate;
  const cap = accelCap(params);
  assert.ok(params.airMaxSpeed <= cap, 'test assumes the uncapped regime');

  let velocity = { x: 260, y: 0 };
  let worldViewAngle = 0;
  let prevSpeed = vecLength(velocity);
  for (let tick = 0; tick < 40; tick++) {
    const speed = vecLength(velocity);
    const yawDelta = idealYawSpeedFor(speed, params.airMaxSpeed, cap, params.tickRate) * tickInterval;
    worldViewAngle += yawDelta;
    const { wishDirRad } = keyboardlessWishDir(worldViewAngle, yawDelta);
    const result = applyAirAccelTick(velocity, wishDirRad, params);
    assert.ok(result.speed >= prevSpeed - 1e-9, `speed must not decrease at tick ${tick}`);
    velocity = result.velocity;
    prevSpeed = result.speed;
    if (tick === 39) {
      assert.ok(Math.abs(result.accel - params.airMaxSpeed) < 1e-6, 'accel converges to airMaxSpeed');
      assert.ok(Math.abs(result.A - Math.PI / 2) < 1e-6, 'wishdir-relative-to-velocity angle converges to 90deg');
    }
  }
  assert.ok(vecLength(velocity) > 260, 'net speed gain over the run');
}

// Realistic back-and-forth strafing (direction reverses periodically, as a
// real strafer alternates which key is held) must still net gain speed
// across many reversals, not just in the single-direction case above.
{
  const params = { groundMaxSpeed: 320, airMaxSpeed: 30, tickRate: 100 * (2 / 3), airAccelerate: 150, penalty: 1 };
  const tickInterval = 1 / params.tickRate;
  const cap = accelCap(params);

  let velocity = { x: 260, y: 0 };
  let worldViewAngle = 0;
  let dir = 1;
  const cycleTicks = 8;
  for (let tick = 0; tick < 80; tick++) {
    if (tick > 0 && tick % cycleTicks === 0) dir *= -1;
    const speed = vecLength(velocity);
    const yawDelta = dir * idealYawSpeedFor(speed, params.airMaxSpeed, cap, params.tickRate) * tickInterval;
    worldViewAngle += yawDelta;
    const { wishDirRad } = keyboardlessWishDir(worldViewAngle, yawDelta);
    velocity = applyAirAccelTick(velocity, wishDirRad, params).velocity;
  }
  assert.ok(vecLength(velocity) > 260, 'oscillating strafe nets a speed gain across reversals');
}

console.log('All keyboardless-model regression checks passed.');
