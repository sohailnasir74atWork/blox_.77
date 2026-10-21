// Unread badges on the chat header's Inbox and Groups buttons.
//
// Kept outside React state on purpose. When these totals lived in ChatStack
// state, every chat_meta_data / group_meta_data realtime update re-rendered
// ChatStack and with it the screen on top plus the one under it (the public
// chat under the Inbox, the DM screen itself) — once per incoming message.
// Here a change re-renders only the components that read the badge.
//
// Per-chat counts come straight from the meta rows. A badge shows what came
// in since the player last tapped its button: tapping acknowledges the
// current counts, and a count that drops (the chat was read) lowers its
// acknowledgement with it. Before, the tap zeroed the badge in state only and
// the next realtime event brought the whole total back.
import { useSyncExternalStore } from 'react';

const makeCounter = () => ({ counts: new Map(), acked: new Map(), total: 0 });
const counters = { dm: makeCounter(), group: makeCounter() };
const listeners = new Set();
let snapshot = { dm: 0, group: 0 };

const shown = (count, acked) => Math.max(0, count - acked);

const publish = () => {
  const { dm, group } = counters;
  if (snapshot.dm === dm.total && snapshot.group === group.total) return;
  snapshot = { dm: dm.total, group: group.total };
  listeners.forEach((l) => l());
};

const setCount = (kind, id, value) => {
  if (!id) return;
  const c = counters[kind];
  const next = Math.max(0, Number(value) || 0);
  const prev = c.counts.get(id) || 0;
  const prevAck = c.acked.get(id) || 0;
  const nextAck = Math.min(prevAck, next);
  c.total += shown(next, nextAck) - shown(prev, prevAck);
  c.counts.set(id, next);
  if (nextAck !== prevAck) c.acked.set(id, nextAck);
  publish();
};

const removeCount = (kind, id) => {
  const c = counters[kind];
  if (!c.counts.has(id)) return;
  c.total -= shown(c.counts.get(id) || 0, c.acked.get(id) || 0);
  c.counts.delete(id);
  c.acked.delete(id);
  publish();
};

const clearCounts = (kind) => {
  counters[kind] = makeCounter();
  publish();
};

const acknowledge = (kind) => {
  const c = counters[kind];
  c.acked = new Map(c.counts);
  c.total = 0;
  publish();
};

export const setDmUnread = (partnerId, count) => setCount('dm', partnerId, count);
export const removeDmUnread = (partnerId) => removeCount('dm', partnerId);
export const clearDmUnread = () => clearCounts('dm');
export const acknowledgeDmBadge = () => acknowledge('dm');

export const setGroupUnread = (groupId, count) => setCount('group', groupId, count);
export const removeGroupUnread = (groupId) => removeCount('group', groupId);
export const clearGroupUnread = () => clearCounts('group');
export const acknowledgeGroupBadge = () => acknowledge('group');

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => snapshot;

// { dm, group } — re-renders the caller only when a badge number changes.
export const useChatBadges = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
