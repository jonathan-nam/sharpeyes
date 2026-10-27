import { useEffect, useMemo, useSyncExternalStore } from "react";

import { type NightResult, type NightSearch, searchNight } from "@/lib/night-search";

// Run Order's search in a worker, answered from a cache. The page asks for the live controls as soon
// as it has data and again whenever they move, so the button usually finds its night already done.
//
// One search at a time, two slots waiting: the button's, which goes first and stops a warm-up it does
// not match, and the latest warm-up, which replaces any older one still waiting.

type Job = { key: string; input: NightSearch };

// A handful, for flipping a control and back. A night's answer is tens of kilobytes.
const KEEP = 8;

const cache = new Map<string, NightResult>();
const listeners = new Set<() => void>();
let worker: Worker | null = null;
let workerFailed = false;
let running: Job | null = null;
let pressed: Job | null = null;
let warming: Job | null = null;

function remember(key: string, result: NightResult) {
  cache.delete(key);
  cache.set(key, result);
  if (cache.size > KEEP) cache.delete(cache.keys().next().value as string);
  listeners.forEach((listener) => listener());
}

function finish(job: Job, result: NightResult) {
  if (running === job) running = null;
  remember(job.key, result);
  pump();
}

function workerOrNull(): Worker | null {
  if (workerFailed || typeof Worker === "undefined") return null;
  if (worker === null) {
    worker = new Worker(new URL("./night-search.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<{ key: string; result: NightResult }>) => {
      if (running?.key === event.data.key) finish(running, event.data.result);
    };
    // A worker that cannot load is not a night that cannot be planned: the main thread still can.
    worker.onerror = () => {
      workerFailed = true;
      worker?.terminate();
      worker = null;
      const job = running;
      running = null;
      if (job) finish(job, searchNight(job.input));
    };
  }
  return worker;
}

function pump() {
  if (running !== null) return;
  const job = pressed ?? warming;
  if (job === null) return;
  if (job === pressed) pressed = null;
  else warming = null;
  if (cache.has(job.key)) {
    pump();
    return;
  }
  running = job;
  const target = workerOrNull();
  if (target) target.postMessage(job);
  // No worker (a test, or one that failed to load): the same search, after this render.
  else setTimeout(() => finish(job, searchNight(job.input)), 0);
}

function request(job: Job, press: boolean) {
  if (cache.has(job.key) || running?.key === job.key) return;
  if (!press) {
    warming = job;
  } else {
    pressed = job;
    // A warm-up for controls that have since moved would hold the press up for nothing.
    if (running !== null && worker !== null) {
      worker.terminate();
      worker = null;
      running = null;
    }
  }
  pump();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The search's answer for [input], once there is one, and null until then. A [press] goes ahead of
 * warm-ups; without one, the answer is only being got ready.
 */
export function useNightSearch(input: NightSearch | null, press: boolean): NightResult | null {
  const key = useMemo(() => (input === null ? null : JSON.stringify(input)), [input]);
  const result = useSyncExternalStore(
    subscribe,
    () => (key === null ? null : (cache.get(key) ?? null)),
    () => null,
  );
  useEffect(() => {
    if (input !== null && key !== null) request({ key, input }, press);
  }, [input, key, press]);
  return result;
}
