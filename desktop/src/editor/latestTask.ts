/** Runs one expensive task at a time, skipping pending work that was replaced. */
export class LatestTask {
  private active: Promise<void> = Promise.resolve();
  private revision = 0;

  run<T>(work: () => Promise<T>): Promise<T | undefined> {
    const revision = ++this.revision;
    const result = this.active.then(() => revision === this.revision ? work() : undefined);
    // A failed estimate must not prevent later settings from being estimated.
    this.active = result.then(() => {}, () => {});
    return result;
  }

  cancel() {
    this.revision++;
  }
}
