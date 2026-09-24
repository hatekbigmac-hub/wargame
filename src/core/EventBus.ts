// Minimal typed event bus used to decouple the simulation from views/UI/audio.
import type { GameEvents } from './types';

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        // A broken listener must never take down the simulation.
        console.error(`[EventBus] handler for "${String(type)}" failed`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
