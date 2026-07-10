export class ConfigMutationCoordinator {
  private tail: Promise<void> = Promise.resolve();

  async run<Result>(mutation: () => Promise<Result>): Promise<Result> {
    const previous = this.tail;
    const next = createDeferred();
    this.tail = next.promise;

    await previous;

    try {
      return await mutation();
    } finally {
      next.resolve();
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
