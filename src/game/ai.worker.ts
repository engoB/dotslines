import { getGeometry } from './board';
import { chooseMove, type AILevel } from './ai';

export interface AIRequest {
  id: number;
  size: number;
  drawn: Uint8Array;
  level: AILevel;
}

self.onmessage = (ev: MessageEvent<AIRequest>) => {
  const { id, size, drawn, level } = ev.data;
  const move = chooseMove(getGeometry(size), drawn, level);
  self.postMessage({ id, move });
};
