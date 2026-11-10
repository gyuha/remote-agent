import { describe, expect, test } from 'vitest';
import { createLockManager } from '@remote-agent/server';

/** 프라미스가 ms 안에 풀리는지 확인한다(풀리면 값, 아니면 'PENDING'). */
async function within<T>(p: Promise<T>, ms = 50): Promise<T | 'PENDING'> {
  return Promise.race([p, new Promise<'PENDING'>((r) => setTimeout(() => r('PENDING'), ms))]);
}

describe('0010/0011 폴더 쓰기 잠금', () => {
  test('0010 같은 폴더의 다른 체인은 FIFO로 차례를 기다린다', async () => {
    const locks = createLockManager();
    const order: string[] = [];
    const relA = await locks.acquire('/f', 'A');
    order.push('A');
    const pB = locks.acquire('/f', 'B').then((r) => (order.push('B'), r));
    const pC = locks.acquire('/f', 'C').then((r) => (order.push('C'), r));
    const pD = locks.acquire('/f', 'D').then((r) => (order.push('D'), r));
    expect(await within(pB)).toBe('PENDING');
    expect(order).toEqual(['A']);

    relA();
    const relB = await pB;
    expect(await within(pC)).toBe('PENDING');
    expect(order).toEqual(['A', 'B']);
    relB();
    const relC = await pC;
    relC();
    const relD = await pD;
    relD();
    expect(order).toEqual(['A', 'B', 'C', 'D']);
  });

  test('0011 같은 체인은 재진입해 바로 획득한다(다른 체인이 줄 서 있어도)', async () => {
    const locks = createLockManager();
    const outer = await locks.acquire('/f', 'chain-1');
    const waiter = locks.acquire('/f', 'chain-2');
    const inner = await within(locks.acquire('/f', 'chain-1'));
    expect(inner).not.toBe('PENDING');
    expect(typeof inner).toBe('function');
    expect(await within(waiter)).toBe('PENDING');
    (inner as () => void)();
    outer();
    const rel2 = await within(waiter, 500);
    expect(rel2).not.toBe('PENDING');
    (rel2 as () => void)();
  });

  test('0011 재진입 해제는 참조 카운트로 처리한다(마지막 해제에서만 풀린다)', async () => {
    const locks = createLockManager();
    const r1 = await locks.acquire('/f', 'A');
    const r2 = await locks.acquire('/f', 'A');
    const r3 = await locks.acquire('/f', 'A');
    const pB = locks.acquire('/f', 'B');
    r3();
    expect(await within(pB)).toBe('PENDING');
    r2();
    expect(await within(pB)).toBe('PENDING');
    r1();
    const relB = await within(pB, 500);
    expect(relB).not.toBe('PENDING');
    (relB as () => void)();
  });

  test('0010 다른 폴더는 서로 막지 않는다', async () => {
    const locks = createLockManager();
    const r1 = await locks.acquire('/f1', 'A');
    const r2 = await within(locks.acquire('/f2', 'B'));
    expect(r2).not.toBe('PENDING');
    (r2 as () => void)();
    r1();
  });

  test('0010 해제 후 같은 폴더를 다시 획득할 수 있다', async () => {
    const locks = createLockManager();
    const r1 = await locks.acquire('/f', 'A');
    r1();
    const r2 = await within(locks.acquire('/f', 'B'));
    expect(r2).not.toBe('PENDING');
    (r2 as () => void)();
    const r3 = await within(locks.acquire('/f', 'A'));
    expect(r3).not.toBe('PENDING');
    (r3 as () => void)();
  });
});
