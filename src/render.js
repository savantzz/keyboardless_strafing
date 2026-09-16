// Renders one tick's state as an angle gauge: 0 deg (straight up) is the
// current velocity direction, matching the reference Desmos sheet's own
// convention of drawing the velocity vector vertically. Angles are measured
// clockwise from up, so the gauge angle for a wish direction A (radians,
// relative to velocity) is drawn at screen angle A directly.
const TAU = Math.PI * 2;

function polar(angleRad, radius) {
  return { x: radius * Math.sin(angleRad), y: -radius * Math.cos(angleRad) };
}

function deg(rad) {
  return (rad * 180) / Math.PI;
}

export function render(ctx, view) {
  const { canvas } = ctx;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const originX = w / 2;
  const originY = h - 48;
  const radius = Math.min(w, h) * 0.42;

  ctx.save();
  ctx.translate(originX, originY);

  // Background gauge circle.
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.stroke();

  // Ideal-angle target zone (both signs, since a strafe cycle alternates
  // direction) with a small tolerance band.
  if (view.idealAngle != null) {
    const tol = view.toleranceRad ?? (Math.PI / 180) * 2;
    ctx.fillStyle = 'rgba(80,220,120,0.18)';
    for (const sign of [1, -1]) {
      const a = sign * view.idealAngle;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, a - tol - Math.PI / 2, a + tol - Math.PI / 2);
      ctx.closePath();
      ctx.fill();
    }
    for (const sign of [1, -1]) {
      const p = polar(sign * view.idealAngle, radius);
      ctx.strokeStyle = 'rgba(80,220,120,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Velocity direction reference (always straight up).
  ctx.strokeStyle = '#4da3ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -radius);
  ctx.stroke();

  // Current aim direction (live).
  if (view.aimAngle != null) {
    const onTarget = view.idealAngle != null &&
      Math.abs(Math.abs(view.aimAngle) - view.idealAngle) <= (view.toleranceRad ?? (Math.PI / 180) * 2);
    const p = polar(view.aimAngle, radius);
    ctx.strokeStyle = onTarget ? '#5be178' : '#ff5b5b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, TAU);
    ctx.fill();
  }

  ctx.restore();

  // HUD text.
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '13px monospace';
  ctx.textBaseline = 'top';
  const lines = [
    `speed: ${view.speed?.toFixed(1) ?? '-'} u/s`,
    `aim vs velocity (A): ${view.aimAngle != null ? deg(view.aimAngle).toFixed(2) + ' deg' : '-'}`,
    `ideal angle: ${view.idealAngle != null ? '+/-' + deg(view.idealAngle).toFixed(2) + ' deg' : '-'}`,
    `angular error: ${view.angleErrorDeg != null ? view.angleErrorDeg.toFixed(2) + ' deg' : '-'}`,
    `tick efficiency: ${view.efficiencyPct != null ? view.efficiencyPct.toFixed(1) + '%' : '-'}`,
    `avg efficiency: ${view.avgEfficiencyPct != null ? view.avgEfficiencyPct.toFixed(1) + '%' : '-'}`,
  ];
  lines.forEach((line, i) => ctx.fillText(line, 10, 10 + i * 18));
}
