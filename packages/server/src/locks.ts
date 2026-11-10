import path from 'node:path';

export type Release = () => void;

export interface LockManager {
  /** Resolves with a release function once `chainId` holds the folder's write lock. */
  acquire(folder: string, chainId: string): Promise<Release>;
}

interface Waiter {
  chainId: string;
  resolve: (release: Release) => void;
}

interface FolderLock {
  chainId: string;
  /** Number of unreleased acquisitions by the holding chain (re-entrancy). */
  count: number;
  queue: Waiter[];
}

/** Per-folder write lock: FIFO across call chains, re-entrant within one chain (ADR 0010/0011). */
export function createLockManager(): LockManager {
  const locks = new Map<string, FolderLock>();

  function releaser(key: string): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const lock = locks.get(key)!;
      if (--lock.count > 0) return;
      const next = lock.queue.shift();
      if (!next) {
        locks.delete(key);
        return;
      }
      // Hand off to the next chain, along with any other queued acquisitions from that same chain.
      lock.chainId = next.chainId;
      const granted = [next, ...lock.queue.filter((w) => w.chainId === next.chainId)];
      lock.queue = lock.queue.filter((w) => w.chainId !== next.chainId);
      lock.count = granted.length;
      for (const w of granted) w.resolve(releaser(key));
    };
  }

  return {
    acquire(folder, chainId) {
      const key = path.resolve(folder);
      const lock = locks.get(key);
      if (!lock) {
        locks.set(key, { chainId, count: 1, queue: [] });
        return Promise.resolve(releaser(key));
      }
      if (lock.chainId === chainId) {
        lock.count++;
        return Promise.resolve(releaser(key));
      }
      return new Promise((resolve) => lock.queue.push({ chainId, resolve }));
    },
  };
}
