// Regression test: reproduces the exact numeric example from the Desmos
// sheet (v=1600, A=90 [as fed to cos/sin directly, i.e. the sheet's own raw
// number -- see docs/desmos-sheet-notes.md for why this is 90 radians, not
// 90 degrees, in the source sheet] , T=100*2/3, sv_airaccelerate=150,
// penalty=1, groundMaxSpeed=260, airMaxSpeed=30) so any change to the
// physics engine that breaks the ported formulas fails loudly.
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS,
  accelCap,
  applyAirAccelTick,
  maxSpeedGainUncapped,
  idealYawSpeedUncapped,
  idealYawSpeedCapped,
  perfectLastStrafeYawSpeed,
  wallstrafeSpeed,
  maxWallstrafeGain,
  idealWallstrafeDeviation,
  maxSpeedAfterTicks,
  gainRange,
  idealAngle,
  idealWallAngle,
  capBoundaryAngle,
  maxTickRotationAtCapBoundary,
  stableOscillationYawSpeed,
} from '../src/physics.mjs';

const params = { ...DEFAULT_PARAMS }; // groundMaxSpeed 260, airMaxSpeed 30, tickRate 66.667, airAccelerate 150, penalty 1
const velocity = { x: 1600, y: 0 };
const wishDirRad = 90; // the sheet's raw "A = 90" fed straight into cos/sin

function approx(actual, expected, msg, tol = 1e-6) {
  const rel = Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
  assert.ok(rel < tol, `${msg}: expected ${expected}, got ${actual} (rel err ${rel})`);
}

const cap = accelCap(params);
approx(cap, 585, 'accelCap');

const result = applyAirAccelTick(velocity, wishDirRad, params);
approx(result.currentSpeed, -716.917785807, 'currentSpeed');
approx(result.addSpeed, 746.917785807, 'addSpeed');
approx(result.accel, 585, 'accel (clamped to cap)');
approx(result.speed, 1436.46482401, 'v_new');
approx(result.vAngle, 0.372644768967, 'v_angle');

approx(maxSpeedGainUncapped(1600, 30), 0.281225285106, 'maxSpeedGainUncapped');
approx(idealYawSpeedUncapped(1600, 30, params.tickRate), 1.25007325378, 'idealYawSpeedUncapped');
approx(idealYawSpeedCapped(1600, 30, cap, params.tickRate), 23.615811383, 'idealYawSpeedCapped');
approx(perfectLastStrafeYawSpeed(1600, 30, cap, params.tickRate), 24.86610446, 'perfectLastStrafeYawSpeed');
approx(wallstrafeSpeed(1600, result.accel, wishDirRad), 1337.87693456, 'wallstrafeSpeed');
approx(maxWallstrafeGain(1600, 30), 0.140625, 'maxWallstrafeGain');
approx(idealWallstrafeDeviation(1600, 30), 0.00937513733453, 'idealWallstrafeDeviation');
approx(maxSpeedAfterTicks(1600, 30, 0), 1600, 'maxSpeedAfterTicks(t=0)');
approx(gainRange(1600, 30), 0.0375021976133, 'gainRange');

// Analytically-derived optimal angles: since airMaxSpeed(30) <= accelCap(585),
// both should hit the uncapped branch.
approx(idealAngle(1600, 30, cap), Math.PI / 2, 'idealAngle (uncapped branch)');
approx(idealWallAngle(1600, 30, cap), 1.56142118946, 'idealWallAngle (uncapped branch, matches sheet A_maxwall)');

// Sanity check the capped branch too, with a low sv_airaccelerate that forces
// accelCap below airMaxSpeed (mirrors the sheet's own caveat: "some stuff
// here isn't accurate if sv_airaccelerate is low enough for accelcap to be
// less than maxspeed").
{
  const lowCapParams = { ...params, airAccelerate: 5 };
  const lowCap = accelCap(lowCapParams); // 260*1*5*0.015 = 19.5
  approx(lowCap, 19.5, 'accelCap (low sv_airaccelerate)');
  const A = idealAngle(1600, 30, lowCap);
  // At the true optimum, addSpeed(A) should land exactly on the cap boundary.
  const addSpeedAtOptimum = 30 - 1600 * Math.cos(A);
  approx(addSpeedAtOptimum, lowCap, 'addSpeed at capped-branch optimum equals accelCap');
}

// Literal confirmation against the sheet's own A_cap / A_caprange / A_v
// expressions (found in a later part of the sheet than the values above),
// evaluated at the sheet's default 585 accelCap even though that's not the
// branch that would actually be selected for it (M <= accelCap there) --
// the sheet defines A_cap as a standalone formula independent of the branch
// condition, so it's directly comparable.
approx(capBoundaryAngle(1600, 30, cap), 1.92503349754, 'capBoundaryAngle matches sheet A_cap literally');
approx(maxTickRotationAtCapBoundary(1600, 30, cap), 0.374225736221, 'maxTickRotationAtCapBoundary matches sheet A_caprange');
approx(stableOscillationYawSpeed(1600, 30, params.tickRate), 2.50014650755, 'stableOscillationYawSpeed matches sheet A_v');

console.log('All physics regression checks passed.');
