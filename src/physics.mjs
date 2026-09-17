// Port of the Source engine (CS:S) air-acceleration / strafe-jump physics,
// matching the "strafing" Desmos sheet formulas exactly (variable names below
// mirror the sheet's subscripted names, e.g. v_elocity -> velocity).
//
// Units: speed in game units/second, angles in radians unless noted, time in
// seconds. Positions/velocities are 2D horizontal vectors {x, y}.

export const DEFAULT_PARAMS = {
  groundMaxSpeed: 260, // sv_maxspeed
  airMaxSpeed: 30, // hardcoded air wishspeed cap used by AirAccelerate
  tickRate: 100 * (2 / 3), // 66.6666... (CS:S 66 tick)
  airAccelerate: 150, // sv_airaccelerate
  penalty: 1, // combined air-accel penalty multiplier, 1 = none
};

export function tickInterval(tickRate) {
  return 1 / tickRate;
}

// accelcap: the max speed the engine is allowed to add to your velocity this tick.
export function accelCap({ groundMaxSpeed, penalty, airAccelerate, tickRate }) {
  return groundMaxSpeed * penalty * airAccelerate * tickInterval(tickRate);
}

export function vecLength(v) {
  return Math.hypot(v.x, v.y);
}

export function unitVec(angleRad) {
  return { x: Math.cos(angleRad), y: Math.sin(angleRad) };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function wrapAngle(a) {
  // wrap to (-PI, PI]
  a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a;
}

// Angle of `wishDirRad` relative to the current velocity direction, wrapped
// to (-PI, PI]. This is `A` in the sheet.
export function relativeWishAngle(velocity, wishDirRad) {
  const velAngle = Math.atan2(velocity.y, velocity.x);
  return wrapAngle(wishDirRad - velAngle);
}

// One tick of AirAccelerate. wishDirRad is in world space (same frame as velocity).
// Returns the new velocity vector plus the scalars the sheet exposes for display.
export function applyAirAccelTick(velocity, wishDirRad, params = DEFAULT_PARAMS) {
  const speed = vecLength(velocity);
  const wishUnit = unitVec(wishDirRad);
  const currentSpeed = dot(velocity, wishUnit); // c_urrentspeed
  const addSpeed = params.airMaxSpeed - currentSpeed; // a_ddspeed (uncapped)
  const cap = accelCap(params); // a_ccelcap
  const accel = clamp(addSpeed, 0, cap); // a_ccel
  const newVelocity = {
    x: velocity.x + accel * wishUnit.x,
    y: velocity.y + accel * wishUnit.y,
  };
  const A = relativeWishAngle(velocity, wishDirRad);
  const newSpeed = vecLength(newVelocity);
  // v_angle: how much the velocity vector itself rotated this tick (<= turn you aimed)
  const vAngle = newSpeed > 0 ? Math.asin(clamp((accel * Math.sin(A)) / newSpeed, -1, 1)) : 0;
  return {
    velocity: newVelocity,
    speed: newSpeed,
    currentSpeed,
    addSpeed,
    accelCap: cap,
    accel,
    A,
    vAngle,
    // Angle you'd need to re-aim to next tick to hold the same relative angle A again.
    nextWishAngleOffset: A - vAngle,
  };
}

// --- Single-tick theoretical-max helpers (assume optimal angle, no cap) ---

// Max possible speed gain in one tick if unconstrained by accelcap.
export function maxSpeedGainUncapped(speed, airMaxSpeed) {
  return Math.sqrt(speed * speed + airMaxSpeed * airMaxSpeed) - speed;
}

// Ideal yaw speed (rad/s) to continuously hold the optimal angle when NOT accelcap-limited.
export function idealYawSpeedUncapped(speed, airMaxSpeed, tickRate) {
  return Math.asin(clamp(airMaxSpeed / speed, -1, 1)) * tickRate;
}

// Ideal yaw speed (rad/s) to hit the accelcap exactly, assuming view dir == velocity dir.
export function idealYawSpeedCapped(speed, airMaxSpeed, cap, tickRate) {
  return Math.asin(clamp((cap - airMaxSpeed) / speed, -1, 1)) * tickRate;
}

// Picks the correct one-directional ideal yaw speed (rad/s) for the current
// regime, using the same branch condition as idealAngle.
export function idealYawSpeedFor(speed, airMaxSpeed, cap, tickRate) {
  return airMaxSpeed <= cap
    ? idealYawSpeedUncapped(speed, airMaxSpeed, tickRate)
    : idealYawSpeedCapped(speed, airMaxSpeed, cap, tickRate);
}

// Combined "perfect last strafe" yaw speed: catch up to the cap, then finish at max-speed angle.
export function perfectLastStrafeYawSpeed(speed, airMaxSpeed, cap, tickRate) {
  const capped = Math.asin(clamp((cap - airMaxSpeed) / speed, -1, 1)) * tickRate;
  const uncapped = Math.asin(clamp(airMaxSpeed / Math.sqrt(speed * speed - airMaxSpeed * airMaxSpeed), -1, 1)) * tickRate;
  return capped + uncapped;
}

// --- Wallstrafe (no turning: direction fixed by the wall) ---

export function wallstrafeSpeed(speed, accel, A) {
  return Math.abs(speed + accel * Math.cos(A));
}

export function maxWallstrafeGain(speed, airMaxSpeed) {
  return (airMaxSpeed * airMaxSpeed) / (4 * speed);
}

// Small deviation-from-90-degrees angle for wallstrafing (matches the sheet's
// row-38 "ideal wallstrafe angle"; NOT relative to velocity direction).
export function idealWallstrafeDeviation(speed, airMaxSpeed) {
  return Math.asin(clamp(airMaxSpeed / (2 * speed), -1, 1));
}

// --- Multi-tick projections ---

export function maxSpeedAfterTicks(speed, airMaxSpeed, ticks) {
  return Math.sqrt(speed * speed + ticks * airMaxSpeed * airMaxSpeed);
}

// Midpoint-rule approximation of distance covered over `ticks` ticks.
export function maxDistanceAfterTicks(speed, airMaxSpeed, ticks, tickIntervalSeconds) {
  let sum = 0;
  for (let n = 1; n <= ticks; n++) {
    sum += Math.sqrt(speed * speed + (n - 0.5) * airMaxSpeed * airMaxSpeed);
  }
  return sum * tickIntervalSeconds;
}

// Angular half-width of the window (around velocity dir) where a strafe still gains speed.
export function gainRange(speed, airMaxSpeed) {
  return 2 * Math.asin(clamp(airMaxSpeed / speed, -1, 1));
}

// --- Optimal-angle selection (feedback target for the trainer) ---
//
// Both branches below are derived analytically by maximizing v_new(A) under
// the accel clamp (accel = clamp(airMaxSpeed - speed*cos(A), 0, accelCap)):
//
//   v_new(A)^2 = speed^2 + 2*speed*accel*cos(A) + accel^2
//
// Uncapped sub-range (accel = addSpeed): substituting addSpeed collapses this
// to v_new^2 = speed^2*sin^2(A) + airMaxSpeed^2, maximized at A = pi/2 exactly
// (sin(A) = 1 is always reachable there since cos(pi/2) = 0 <= airMaxSpeed/speed
// always holds) -- provided that angle doesn't demand more accel than the cap
// allows, i.e. provided airMaxSpeed <= accelCap.
//
// Capped sub-range (accel = accelCap, constant): v_new^2 = speed^2 +
// 2*speed*accelCap*cos(A) + accelCap^2 increases monotonically as cos(A)
// increases, so the best reachable point is the smallest A for which the cap
// still binds -- exactly the boundary with the uncapped region, where
// addSpeed(A) == accelCap, i.e. cos(A) = (airMaxSpeed - accelCap) / speed.
//
// This matches the sheet's own branch condition (airMaxSpeed vs accelCap)
// and every numeric example in it.
// The accel-clamp boundary angle itself (the sheet's own `A_cap`, confirmed
// letter-for-letter against the sheet: cos^-1((airMaxSpeed - accelCap) / speed)).
// Exposed standalone since it's also the correct capped-branch optimum for
// both the free-strafe and wallstrafe objectives (see idealWallAngle).
export function capBoundaryAngle(speed, airMaxSpeed, cap) {
  return Math.acos(clamp((airMaxSpeed - cap) / speed, -1, 1));
}

export function idealAngle(speed, airMaxSpeed, cap) {
  if (airMaxSpeed <= cap) {
    return Math.PI / 2;
  }
  return capBoundaryAngle(speed, airMaxSpeed, cap);
}

// The velocity vector's own max rotation this tick (v_angle) when aimed at
// the capped-regime optimum. Matches the sheet's `A_caprange`: at A_cap,
// addSpeed(A_cap) == cap by construction, so accel == cap exactly.
export function maxTickRotationAtCapBoundary(speed, airMaxSpeed, cap) {
  const A = capBoundaryAngle(speed, airMaxSpeed, cap);
  const vNew = Math.sqrt((speed + cap * Math.cos(A)) ** 2 + (cap * Math.sin(A)) ** 2);
  return Math.asin(clamp((cap * Math.sin(A)) / vNew, -1, 1));
}

// Total yaw rate (rad/s) needed to hold a stable oscillating strafe once at
// the speed where further strafing at the ideal angle no longer nets a
// speed gain -- i.e. turning the full +idealAngle to -idealAngle sweep each
// half-cycle. Matches the sheet's `A_v` (2 * the one-directional ideal yaw
// speed).
export function stableOscillationYawSpeed(speed, airMaxSpeed, tickRate) {
  return 2 * idealYawSpeedUncapped(speed, airMaxSpeed, tickRate);
}

// Same derivation restricted to the wallstrafe objective (maximize speed +
// accel*cos(A) instead of the full vector magnitude): the uncapped optimum
// is cos(A) = airMaxSpeed / (2*speed) (threshold airMaxSpeed/2 vs accelCap),
// while the capped optimum reduces to the *same* boundary angle as the
// non-wallstrafe case above (the accel-clamp boundary doesn't depend on the
// objective being maximized past it).
export function idealWallAngle(speed, airMaxSpeed, cap) {
  if (airMaxSpeed / 2 <= cap) {
    return Math.acos(clamp(airMaxSpeed / (2 * speed), -1, 1));
  }
  return capBoundaryAngle(speed, airMaxSpeed, cap);
}

// --- Keyboardless-strafing input model ---
//
// Classic air-strafing holds a directional key (A/D); that key's state is
// what actually supplies the wish direction as view-angle +/- 90 degrees
// -- your view/crosshair itself tracks close to your direction of travel
// while strafing well, it is NOT the wish direction. "Keyboardless"
// automates the key press (e.g. a script that holds whichever key matches
// the direction you're currently turning) rather than eliminating that
// offset, so a mouse-only trainer has to reproduce the same offset: wish
// direction is view angle +/- 90 degrees, sign following whichever way
// you're turning this tick, not the view angle directly. No turning this
// tick (yawDelta === 0) means no key is being held, i.e. no wish
// direction at all, matching the real engine (wishspeed 0 fails
// AirAccelerate's addspeed check and it returns without touching
// velocity) -- callers should apply no acceleration for that tick rather
// than calling applyAirAccelTick with an arbitrary direction.
export function keyboardlessWishDir(worldViewAngle, yawDelta) {
  const sign = Math.sign(yawDelta);
  return { active: sign !== 0, wishDirRad: worldViewAngle + sign * (Math.PI / 2) };
}

// --- Real-keyboard strafing input model ---
//
// Same view-angle +/- 90-degree offset as keyboardlessWishDir, but the
// sign comes from an actually-held key instead of being inferred from
// this tick's mouse motion. keyDir is +1 (right/D) or -1 (left/A) held,
// or 0 for neither/both (matches the reference StrafeOffset's own
// keyDir: "both or neither -> 0, transient"). Unlike the keyboardless
// model, a held key stays active even on a tick where the mouse doesn't
// move at all -- that's the whole point of measuring real key-vs-mouse
// timing (strafesync.js), which needs the key's own independent signal,
// not one re-derived from the mouse it's meant to be compared against.
export function keyWishDir(worldViewAngle, keyDir) {
  return { active: keyDir !== 0, wishDirRad: worldViewAngle + keyDir * (Math.PI / 2) };
}
