/** Clean, bright board drawing: straight lines, round pegs, solid tiles. */

export const BOARD_FONT = "'M PLUS Rounded 1c', 'Nunito', system-ui, sans-serif";

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** Slight overshoot, for the "pop" of captured tiles. */
export const easeOutBack = (t: number): number => {
  const c1 = 1.7;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class BoardRenderer {
  /** Empty cell: soft rounded slot. */
  static cell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    const pad = size * 0.1;
    ctx.save();
    ctx.fillStyle = '#f2f4f8';
    roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, size * 0.16);
    ctx.fill();
    ctx.restore();
  }

  /** A drawn line, growing from its start while `progress` goes 0 → 1. */
  static line(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    width: number,
    progress = 1
  ): void {
    if (progress <= 0) return;
    const t = easeOutCubic(Math.min(1, progress));
    const ex = x1 + (x2 - x1) * t;
    const ey = y1 + (y2 - y1) * t;
    ctx.save();
    ctx.lineCap = 'round';
    // Soft drop shadow for a little depth.
    ctx.strokeStyle = 'rgba(30, 40, 60, 0.16)';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1 + width * 0.28);
    ctx.lineTo(ex, ey + width * 0.28);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Glossy highlight along the line.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = width * 0.28;
    const ox = y1 === y2 ? 0 : -width * 0.18;
    const oy = y1 === y2 ? -width * 0.18 : 0;
    ctx.beginPath();
    ctx.moveTo(x1 + ox, y1 + oy);
    ctx.lineTo(ex + ox, ey + oy);
    ctx.stroke();
    ctx.restore();
  }

  /** Preview of the line under the finger / cursor. */
  static ghost(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  /** Wide glow under a line: marks the opponent's last move. */
  static halo(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    width: number,
    alpha: number
  ): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  static dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.save();
    ctx.fillStyle = '#2f3542';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.32, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Captured box: solid tile in the owner's colour with their initials. */
  static box(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
    label: string,
    progress: number
  ): void {
    if (progress <= 0) return;
    const s = Math.max(0, easeOutBack(Math.min(1, progress)));
    const pad = size * 0.1;
    const full = size - pad * 2;
    const w = full * s;
    const cx = x + size / 2;
    const cy = y + size / 2;
    ctx.save();
    ctx.fillStyle = color;
    roundRect(ctx, cx - w / 2, cy - w / 2, w, w, w * 0.2);
    ctx.fill();
    // Lighter top half for a glossy tile.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    roundRect(ctx, cx - w / 2, cy - w / 2, w, w * 0.5, w * 0.2);
    ctx.fill();
    if (s > 0.6) {
      ctx.globalAlpha = Math.min(1, (s - 0.6) / 0.4);
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.floor(full * 0.4)}px ${BOARD_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy + full * 0.03);
    }
    ctx.restore();
  }
}
