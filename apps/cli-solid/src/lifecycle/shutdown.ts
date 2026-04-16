const FORCE_EXIT_TIMEOUT_MS = 3000;

let shuttingDown = false;
let shutdownPromise: Promise<void> | undefined;
let signalHandlersInstalled = false;

const cleanupHandlers: Array<() => void | Promise<void>> = [];
const trackedPids = new Set<number>();

export const registerCleanupHandler = (handler: () => void | Promise<void>): (() => void) => {
  cleanupHandlers.push(handler);

  return () => {
    const index = cleanupHandlers.indexOf(handler);
    if (index !== -1) {
      cleanupHandlers.splice(index, 1);
    }
  };
};

export const trackChildProcess = (pid: number): void => {
  trackedPids.add(pid);
};

export const untrackChildProcess = (pid: number): void => {
  trackedPids.delete(pid);
};

export const isShuttingDown = (): boolean => shuttingDown;

const killTrackedProcesses = (): void => {
  for (const pid of trackedPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  trackedPids.clear();
};

const runCleanupHandlers = async (): Promise<void> => {
  const reversed = [...cleanupHandlers].reverse();
  for (const handler of reversed) {
    try {
      await handler();
    } catch {}
  }
  cleanupHandlers.length = 0;
};

export const initiateShutdown = (): Promise<void> => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shuttingDown = true;

  shutdownPromise = (async () => {
    const forceExitTimer = setTimeout(() => {
      process.exit(1);
    }, FORCE_EXIT_TIMEOUT_MS);

    forceExitTimer.unref?.();

    killTrackedProcesses();
    await runCleanupHandlers();

    clearTimeout(forceExitTimer);
    process.exit(0);
  })();

  return shutdownPromise;
};

const onSignal = () => {
  void initiateShutdown();
};

export const installSignalHandlers = (): void => {
  if (signalHandlersInstalled) {
    return;
  }

  signalHandlersInstalled = true;
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
};

export const _resetForTesting = (): void => {
  shuttingDown = false;
  shutdownPromise = undefined;
  signalHandlersInstalled = false;
  cleanupHandlers.length = 0;
  trackedPids.clear();
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
};
