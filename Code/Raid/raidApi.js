/**
 * raidApi.js — Sea Beast Raid server calls (2026-10-31, Phase 1 step 3).
 *
 * Everything about a raid that pays (tickets, damage, bounty, chests, PRO
 * time, the boss crate) is decided by functions/raid (HTTPS + Firebase ID
 * token, like MM2's manorApi). Results go straight back to the game, which
 * words every case: { ...payload } or { error }.
 *
 * `isPro` (RevenueCat / purchase Pro) rides along on every call: a paying Pro
 * gets bounty instead of PRO time and 4 raids without the rewarded ad.
 */

import { getAuth, getIdToken } from '@react-native-firebase/auth';

const FUNCTIONS_URL = 'https://us-central1-fruiteblocks.cloudfunctions.net';
const KNOWN_ERRORS = new Set(['sign_in', 'bad_loadout', 'capped', 'no_round', 'too_fast', 'expired', 'generic']);
const TIMEOUT_MS = 12000;

async function call(name, body) {
  const user = getAuth().currentUser;
  if (!user) return { error: 'sign_in' };
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const token = await getIdToken(user);
    const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json) return json;
    const code = json && json.error;
    return { error: KNOWN_ERRORS.has(code) ? code : 'generic' };
  } catch (e) {
    return { error: 'generic' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Today's boss + this player → { state, crate } (crate = pending boss-crate loot, or null). */
export const getState = (isPro) => call('raidState', { isPro: !!isPro });
/** Opens a round → { ticket, raidsUsed } or { error: 'capped' | 'bad_loadout' | ... }. */
export const startRaid = (loadout, isPro) => call('raidStart', { loadout, isPro: !!isPro });
/** Closes the round → the game's result payload (dmg, bounty, chest, loot, state…) or { error }. */
export const finishRaid = (round, isPro) => call('raidFinish', Object.assign({}, round, { isPro: !!isPro }));
/** The rewarded ad finished → raids 2–4 today. */
export const rewarded = () => call('raidRewarded', {});
/** { tab, rows:[{name,value,rank,me}], me:{value,rank}|null } */
export const leaderboard = (tab) => call('raidLeaderboard', { tab: tab === 'all' ? 'all' : 'today' });

export const _internal = { call, FUNCTIONS_URL, KNOWN_ERRORS };
