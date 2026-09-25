import { useEffect, useMemo, useState } from 'react';
import type { LiveSummary } from '@localy/shared';
import { api } from './api';

/*
 * Live Google Maps details for saved prospects.
 *
 * Localy stores only place IDs. Business names and addresses shown in lists
 * are fetched on demand for the rows on screen, held in memory for this
 * browser tab only, and never written to storage.
 */
const cache = new Map<string, LiveSummary | null>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let disabled = false;

function notify() {
  listeners.forEach((l) => l());
}

async function flush() {
  timer = null;
  const ids = [...queue].slice(0, 50);
  const rest = [...queue].slice(50);
  queue = new Set(rest);
  if (rest.length) timer = setTimeout(flush, 30);
  if (!ids.length) return;
  const p = api
    .post<{ summaries: Record<string, LiveSummary | null> }>('/api/places/summaries', { placeIds: ids })
    .then((res) => {
      for (const id of ids) cache.set(id, res.summaries[id] ?? null);
    })
    .catch((err: { code?: string }) => {
      if (err?.code === 'NOT_CONFIGURED') disabled = true;
      for (const id of ids) cache.set(id, null);
    })
    .finally(() => {
      for (const id of ids) pending.delete(id);
      notify();
    });
  for (const id of ids) pending.set(id, p);
}

function request(ids: string[]) {
  if (disabled) return;
  let added = false;
  for (const id of ids) {
    if (!id || cache.has(id) || pending.has(id) || queue.has(id)) continue;
    queue.add(id);
    added = true;
  }
  if (added && !timer) timer = setTimeout(flush, 20);
}

export function clearPlaceCache() {
  cache.clear();
}

export function useLivePlaces(placeIds: (string | null | undefined)[]) {
  const ids = useMemo(() => [...new Set(placeIds.filter(Boolean) as string[])], [placeIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    request(ids);
    return () => {
      listeners.delete(l);
    };
  }, [ids]);
  return {
    get: (id: string | null | undefined) => (id ? cache.get(id) : undefined),
    loading: (id: string | null | undefined) => Boolean(id && !disabled && !cache.has(id)),
  };
}

/** Display name for a prospect: the user's own name, else the live Google name. */
export function useProspectName(placeId: string | null | undefined, name: string | null | undefined) {
  const live = useLivePlaces(name ? [] : [placeId]);
  if (name) return { name, loading: false, live: null as LiveSummary | null | undefined };
  const summary = live.get(placeId);
  return { name: summary?.name ?? (live.loading(placeId) ? null : placeId ? 'Business on Google Maps' : 'Unnamed business'), loading: live.loading(placeId), live: summary };
}
