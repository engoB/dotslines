/** Hand-drawn "pencil on paper" primitives. Noise is seeded so strokes never flicker. */
export class SketchRenderer {
  static seededNoise(seed: number): number {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  static drawPencilLine(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    progress = 1,
    seed = 1,
    isGhost = false,
    scale = 1
  ): void {
    if (progress <= 0) return;

    const targetX = x1 + (x2 - x1) * progress;
    const targetY = y1 + (y2 - y1) * progress;
    const steps = 8;
    const passes = isGhost ? 1 : 3;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;

    for (let p = 0; p < passes; p++) {
      ctx.beginPath();
      ctx.globalAlpha = isGhost ? 0.35 : p === 0 ? 0.85 : 0.4;
      ctx.lineWidth = (isGhost ? 4 : p === 0 ? 4.2 : 2.4) * scale;

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const bx = x1 + (targetX - x1) * t;
        const by = y1 + (targetY - y1) * t;

        const amp = (i === 0 || i === steps ? 0 : isGhost ? 1.0 : 2.1) * scale;
        const n1 = (this.seededNoise(seed + p * 31 + i * 7) - 0.5) * 2 * amp;
        const n2 = (this.seededNoise(seed + p * 53 + i * 13) - 0.5) * 2 * amp;

        if (i === 0) ctx.moveTo(bx + n1, by + n2);
        else ctx.lineTo(bx + n1, by + n2);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Soft marker underline used to point out the last line played. */
  static drawHighlight(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    width: number
  ): void {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  static drawSketchDot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, seed: number): void {
    ctx.save();
    ctx.fillStyle = '#3a2a20';
    for (let p = 0; p < 2; p++) {
      ctx.beginPath();
      const ox = (this.seededNoise(seed + p * 11) - 0.5) * 1.4;
      const oy = (this.seededNoise(seed + p * 23) - 0.5) * 1.4;
      ctx.arc(x + ox, y + oy, radius - p * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  static drawCapturedBox(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
    label: string,
    progress: number,
    seed: number
  ): void {
    if (progress <= 0) return;
    const pad = size * 0.14;
    const inner = size - pad * 2;

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.11 * progress;
    ctx.fillRect(x + pad, y + pad, inner, inner);

    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.32 * progress;
    ctx.lineWidth = Math.max(1.4, size * 0.022);
    ctx.lineCap = 'round';

    const hatchLines = 6;
    for (let i = 0; i < hatchLines; i++) {
      const ratio = (i + 1) / (hatchLines + 1);
      const jitter = (this.seededNoise(seed + i * 5) - 0.5) * inner * 0.05;
      const startX = x + pad + inner * ratio * 0.7 + jitter;
      const startY = y + pad + inner * 0.15;
      const endX = x + pad + inner * (0.2 + ratio * 0.65) + jitter;
      const endY = y + pad + inner * 0.85;

      // Lines are hatched one after another, like a real pencil.
      const local = Math.min(1, Math.max(0, progress * 1.6 - i * 0.1));
      if (local <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(startX + (endX - startX) * local, startY + (endY - startY) * local);
      ctx.stroke();
    }

    if (progress > 0.35) {
      const textScale = Math.min(1, (progress - 0.35) / 0.65);
      ctx.globalAlpha = 0.92 * textScale;
      ctx.fillStyle = color;
      ctx.font = `700 ${Math.floor(size * 0.44)}px 'Caveat', cursive`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.translate(x + size / 2, y + size / 2);
      ctx.rotate((this.seededNoise(seed) - 0.5) * 0.16);
      ctx.scale(textScale, textScale);
      ctx.fillText(label, 0, 2);
    }
    ctx.restore();
  }
}
