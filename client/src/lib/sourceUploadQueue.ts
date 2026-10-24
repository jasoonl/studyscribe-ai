/**
 * A small queue that runs at most `concurrency` uploads at once. Each task gets an AbortSignal;
 * aborting a waiting task removes it, aborting a running one cancels it through its signal.
 * Tasks report their own outcome (the hook keeps the row state), so a rejected task never
 * stops the queue.
 */
export type QueueTask = (signal: AbortSignal) => Promise<void>;

export type UploadQueue = {
  add(id: string, task: QueueTask): void;
  abort(id: string): void;
  abortAll(): void;
  has(id: string): boolean;
  /** Ids running now and ids waiting, in order. */
  snapshot(): { running: string[]; waiting: string[] };
};

export function createUploadQueue(options: { concurrency: number; onChange?: () => void }): UploadQueue {
  const concurrency = Math.max(1, options.concurrency);
  const waiting: { id: string; task: QueueTask }[] = [];
  const running = new Map<string, AbortController>();

  const changed = () => options.onChange?.();

  const pump = () => {
    while (running.size < concurrency && waiting.length > 0) {
      const next = waiting.shift()!;
      const controller = new AbortController();
      running.set(next.id, controller);
      void next
        .task(controller.signal)
        .catch(() => undefined)
        .finally(() => {
          running.delete(next.id);
          changed();
          pump();
        });
    }
    changed();
  };

  return {
    add(id, task) {
      if (running.has(id) || waiting.some(item => item.id === id)) return;
      waiting.push({ id, task });
      pump();
    },
    abort(id) {
      const index = waiting.findIndex(item => item.id === id);
      if (index >= 0) {
        waiting.splice(index, 1);
        changed();
        return;
      }
      running.get(id)?.abort();
    },
    abortAll() {
      waiting.length = 0;
      running.forEach(controller => controller.abort());
      changed();
    },
    has: id => running.has(id) || waiting.some(item => item.id === id),
    snapshot: () => ({ running: Array.from(running.keys()), waiting: waiting.map(item => item.id) }),
  };
}
