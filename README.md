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

Click the canvas to lock the pointer, then move the mouse to strafe.

The trainer's core visual is a scrolling strip chart of your actual angular
velocity (deg/s) against the ideal target rate for your current speed. For
keyboardless strafing there's no key press defining a wish direction -- the
whole skill is smoothly reversing your mouse's turn rate instead of pausing
or jerking through each direction change. So rather than a static "aim
here" gauge, the chart shows that turn-rate signal directly: a clean trace
means consistent turning, a dip toward zero that lingers gets flagged as a
"stutter" (shaded red band) -- exactly the hesitation-at-the-reversal
problem that's hard to feel in the moment but easy to see on a graph.
Settings (tickrate, sv_airaccelerate, sensitivity, m_yaw, air-accel
penalties) are behind the gear icon, top right.

## How it works

- `src/physics.mjs` -- pure port of the Source engine's `AirAccelerate`
  formula and the sheet's derived quantities (ideal angle, ideal yaw speed,
  wallstrafe variants, multi-tick projections). No DOM dependencies, so it's
  directly testable with `node test/physics.test.mjs`.
- `src/input.js` -- Pointer Lock mouse capture. Tracks two things from the
  same raw mouse deltas: a tick-accumulated delta (drained once per physics
  tick, for the velocity simulation) and a never-reset continuous total
  (sampled every render frame, for smooth on-screen motion). Deltas are
  captured with `getCoalescedEvents()` so a high-polling-rate mouse can't
  lose movement to event coalescing.
- `src/sim.js` -- fixed-timestep accumulator loop: physics ticks run at a
  constant rate (default 66.67, i.e. CS:S 66-tick) independent of display
  refresh rate. Rendering hooks into a separate per-frame callback so the
  display updates at full refresh rate even though physics ticks less often
  -- mixing the two was the cause of visible stutter in an earlier version.
- `src/yawtrace.js` -- rolling history of angular-velocity samples plus the
  consistency scoring: mean error vs. the target rate, and detection of
  "stutter" events (turn rate dropping near zero for longer than a brief
  natural zero-crossing).
- `src/render.js` -- draws the strip chart and HUD.
- `src/main.js` -- wires the above together and reads the settings panel.

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
