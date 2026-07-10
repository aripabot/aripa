export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<Result>(key: string, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = createDeferred();
    this.tails.set(key, next.promise);
    await previous;

    try {
      return await operation();
    } finally {
      next.resolve();
      if (this.tails.get(key) === next.promise) {
        this.tails.delete(key);
      }
    }
  }
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
