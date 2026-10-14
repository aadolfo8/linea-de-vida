import { rename, rm, writeFile } from 'node:fs/promises';

export const WORKER_HEALTH_FILE = '/tmp/linea-de-vida-worker-health.json';
export const WORKER_HEALTH_INTERVAL_MS = 5_000;
export const WORKER_HEALTH_MAX_AGE_MS = 30_000;

type WorkerHeartbeat = { pid: number; heartbeatAt: number };
type WorkerHealthOptions = {
  filePath?: string;
  pid?: number;
  now?: () => number;
  write?: (path: string, contents: string) => Promise<unknown>;
  replace?: (temporaryPath: string, filePath: string) => Promise<unknown>;
};

export async function clearWorkerHeartbeat(filePath = WORKER_HEALTH_FILE) {
  await Promise.all([
    rm(filePath, { force: true }),
    rm(`${filePath}.${process.pid}.tmp`, { force: true }),
  ]);
}

/** A fresh heartbeat certifies both a responsive worker event loop and Redis access. */
export async function writeWorkerHeartbeat(
  ping: () => Promise<unknown>,
  options: WorkerHealthOptions = {},
) {
  const filePath = options.filePath ?? WORKER_HEALTH_FILE;
  const pid = options.pid ?? process.pid;
  await ping();
  const temporaryPath = `${filePath}.${pid}.tmp`;
  const contents = JSON.stringify({ pid, heartbeatAt: (options.now ?? Date.now)() });
  const write =
    options.write ??
    ((path: string, value: string) => writeFile(path, value, { encoding: 'utf8', mode: 0o600 }));
  const replace = options.replace ?? rename;
  await write(temporaryPath, contents);
  await replace(temporaryPath, filePath);
}

export function isWorkerHeartbeatHealthy(
  contents: string,
  now = Date.now(),
  expectedPid = process.pid,
) {
  try {
    const heartbeat = JSON.parse(contents) as Partial<WorkerHeartbeat>;
    if (
      heartbeat.pid !== expectedPid ||
      !Number.isSafeInteger(heartbeat.heartbeatAt) ||
      typeof heartbeat.heartbeatAt !== 'number'
    )
      return false;
    const age = now - heartbeat.heartbeatAt;
    return age >= 0 && age <= WORKER_HEALTH_MAX_AGE_MS;
  } catch {
    return false;
  }
}
