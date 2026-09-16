# Keyboardless Strafing Trainer

A browser-based trainer for CS:S/CS:GO-style air-strafing (bhop/surf speed
gain), built on the exact air-acceleration physics used by the Source
engine. The model is ported from a reference Desmos sheet and verified in
`test/physics.test.mjs` against that sheet's own numeric example.

## Run it

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Click the gauge to lock the pointer, then move the mouse to strafe. The
gauge shows your current aim angle relative to your velocity (red/green
line), the analytically-optimal target angle (green dashed zone, both
directions), and live/average strafe efficiency versus the theoretical max
speed gain for your current speed.

## How it works

- `src/physics.mjs` -- pure port of the Source engine's `AirAccelerate`
  formula and the sheet's derived quantities (ideal angle, ideal yaw speed,
  wallstrafe variants, multi-tick projections). No DOM dependencies, so it's
  directly testable with `node test/physics.test.mjs`.
- `src/input.js` -- Pointer Lock mouse capture. Mouse deltas are
  accumulated with `getCoalescedEvents()` and drained once per simulation
  tick, not once per rendered frame, matching how the game itself samples
  input.
- `src/sim.js` -- fixed-timestep accumulator loop: physics ticks run at a
  constant rate (default 66.67, i.e. CS:S 66-tick) independent of display
  refresh rate.
- `src/render.js` -- canvas gauge + HUD.
- `src/main.js` -- wires the above together and reads the control panel.

## Notes on the physics

- `airMaxSpeed` (30 u/s) is the hardcoded air-wishspeed cap used only during
  air acceleration -- distinct from `sv_maxspeed` (ground speed, default
  260), which is what actually determines `accelcap` each tick.
- The optimal strafe angle (`idealAngle` in `physics.mjs`) is derived
  analytically, not guessed: maximizing resultant speed under the engine's
  accel clamp gives exactly 90 degrees relative to your velocity when
  `airMaxSpeed <= accelcap`, and `acos((airMaxSpeed - accelcap) / speed)`
  when accel-capped. Both are cross-checked against the reference sheet's
  branch conditions and numeric outputs in the test suite.
- Air-accel penalties (crouch, +speed/walk, a z-velocity window, +moveup)
  are exposed as toggles using the reference sheet's documented minimum
  multipliers; real CS:S doesn't expose an exact formula for these, so
  they're adjustable estimates rather than derived constants.
