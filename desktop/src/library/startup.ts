// Startup work and its presentation run together. A timeout or unmount must
// never let an old attempt advance the screen or start another backend request.

export type StartupStage = "settings" | "workspace" | "ready";

export const STARTUP_INTRO_MS = 3500;

export class StartupTimeoutError extends Error {
  constructor() {
    super("Startup timed out");
    this.name = "StartupTimeoutError";
  }
}

type StartupOptions = {
  loadSettings: () => Promise<unknown>;
  loadLibrary: () => Promise<unknown>;
  shouldLoadLibrary: () => boolean;
  onStage: (stage: StartupStage) => void;
  signal: AbortSignal;
  minimumMs?: number;
  timeoutMs?: number;
};

export async function prepareStartup({
  loadSettings,
  loadLibrary,
  shouldLoadLibrary,
  onStage,
  signal,
  minimumMs = STARTUP_INTRO_MS,
  timeoutMs = 15000,
}: StartupOptions): Promise<void> {
  if (signal.aborted) throw new DOMException("Startup cancelled", "AbortError");

  let active = true;
  let introTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};

  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException("Startup cancelled", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    timeoutTimer = setTimeout(() => reject(new StartupTimeoutError()), timeoutMs);
  });

  const introduction = new Promise<void>((resolve) => {
    introTimer = setTimeout(resolve, minimumMs);
  });

  const work = async () => {
    onStage("settings");
    await loadSettings();
    if (!active || signal.aborted) return;
    onStage("workspace");
    if (shouldLoadLibrary()) await loadLibrary();
  };

  try {
    await Promise.race([Promise.all([work(), introduction]), interrupted]);
  } finally {
    active = false;
    clearTimeout(introTimer);
    clearTimeout(timeoutTimer);
    signal.removeEventListener("abort", onAbort);
  }
}
