import AIWorker from './ai.worker?worker&inline';
import { getGeometry } from './board';
import { chooseMove, type AILevel } from './ai';
import type { AIRequest } from './ai.worker';

/**
 * Runs the AI in a Web Worker so the expert search never freezes the drawing
 * animations. Falls back to the main thread if workers are unavailable.
 */
export class AIClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { req: AIRequest; resolve: (move: number) => void }>();

  constructor() {
    try {
      this.worker = new AIWorker();
      this.worker.onmessage = (ev: MessageEvent<{ id: number; move: number }>) => {
        const job = this.pending.get(ev.data.id);
        if (!job) return;
        this.pending.delete(ev.data.id);
        job.resolve(ev.data.move);
      };
      this.worker.onerror = () => this.fallBackToMainThread();
    } catch {
      this.worker = null;
    }
  }

  private fallBackToMainThread(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [id, job] of this.pending) {
      this.pending.delete(id);
      job.resolve(this.computeSync(job.req));
    }
  }

  private computeSync(req: AIRequest): number {
    return chooseMove(getGeometry(req.size), req.drawn, req.level);
  }

  public request(size: number, drawn: Uint8Array, level: AILevel): Promise<number> {
    const req: AIRequest = { id: this.nextId++, size, drawn, level };
    if (!this.worker) return Promise.resolve(this.computeSync(req));
    return new Promise((resolve) => {
      this.pending.set(req.id, { req, resolve });
      this.worker!.postMessage(req);
    });
  }
}
