// Supabase client singleton, authenticated via Firebase ID token.
//
// - Auth: Firebase is configured as a Third-Party Auth provider in Supabase.
//   Every request grabs a fresh Firebase ID token and sends it in the
//   Authorization header; Supabase verifies it against Firebase's public
//   keys. RLS policies see the Firebase UID via the JWT `sub` claim
//   (extracted by the public.firebase_uid() SQL helper from 000_init.sql).
// - We disable Supabase's own auth persistence because we don't use it —
//   Firebase is the source of truth.
//
// See SUPABASE_MIGRATION.md for the full migration story.
import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { getAuth, getIdToken, onAuthStateChanged } from '@react-native-firebase/auth';
import config from '../Helper/Environment';

// Resolves the first time Firebase has determined auth state. On
// cold-start, RN Firebase fires onAuthStateChanged TWICE: once
// synchronously with null (before restoration), then again with the
// real user a few seconds later after keychain restore. We must wait
// for the non-null fire — otherwise accessToken returns null,
// supabase-js falls back to the publishable key (not a JWT under the
// sb_publishable_ format), and Realtime rejects the channel with
// `InvalidJWTToken: Fields role and exp are required`.
//
// 8s timeout covers the genuinely-anonymous case (user has never
// signed in) — after the timeout we proceed without a JWT, and
// Realtime can use the apikey path. This wait happens at most once
// per app launch, on the very first request.
let _authResolved = false;
let _authResolveFn;
const _authReady = new Promise((resolve) => { _authResolveFn = resolve; });
{
  const unsub = onAuthStateChanged(getAuth(), (u) => {
    if (u && !_authResolved) {
      _authResolved = true;
      unsub();
      _authResolveFn();
    }
  });
  setTimeout(() => {
    if (_authResolved) return;
    _authResolved = true;
    _authResolveFn();
  }, 8000);
}

// -------------------------------------------------------------------
// Role-claim self-heal
// -------------------------------------------------------------------
// Existing users predating the role-claim era have empty customClaims.
// Without `role: "authenticated"` on the JWT, every Supabase write is
// rejected by RLS and Realtime channels get `InvalidJWTToken`. The
// offline backfill (scripts/set-supabase-role-claim.js) is throttled
// at ~12 QPS to stay under Firebase Auth's setCustomUserClaims quota,
// so it takes hours to reach everyone. This on-launch check is the
// fast path: if the current user's ID token is missing the role claim,
// hit the ensureRoleClaim CF (which sets it server-side) and force a
// token refresh so the next Supabase request carries the new claim.
//
// One-shot per app launch — once a user has the claim, no further
// network calls.
const ENSURE_ROLE_CLAIM_URL =
  'https://us-central1-fruiteblocks.cloudfunctions.net/ensureRoleClaim';

let _roleClaimCheckedFor = null; // uid that's been checked this session

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // Hermes ships globalThis.atob; this falls through gracefully if not.
    const json = (typeof atob === 'function')
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function ensureRoleClaim() {
  const user = getAuth().currentUser;
  if (!user) return;
  if (_roleClaimCheckedFor === user.uid) return;
  try {
    const token = await getIdToken(user);
    const payload = decodeJwtPayload(token);
    if (payload?.role === 'authenticated') {
      _roleClaimCheckedFor = user.uid;
      return;
    }
    const res = await fetch(ENSURE_ROLE_CLAIM_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      console.warn('[supabase] ensureRoleClaim CF returned', res.status);
      return;
    }
    // Force refresh so the next getIdToken() call returns a token that
    // carries the new claim.
    await getIdToken(user, true);
    _roleClaimCheckedFor = user.uid;
  } catch (e) {
    console.warn('[supabase] ensureRoleClaim failed:', e?.message);
  }
}

// Run on cold-start (after auth resolves) AND on every subsequent sign-in,
// so a user who logs in mid-session also gets the claim self-heal.
_authReady.then(() => { ensureRoleClaim(); });
onAuthStateChanged(getAuth(), (u) => {
  if (u) ensureRoleClaim();
  else _roleClaimCheckedFor = null;
});

export const supabase = createClient(
  config.supabaseUrl,
  config.supabasePublishableKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    // Called before every REST request AND every realtime channel join.
    // RN Firebase caches and auto-refreshes the token internally, so this
    // stays cheap on the hot path. We wait once on _authReady to absorb
    // the cold-start window where currentUser is null but auth is still
    // restoring — otherwise realtime opens with no JWT, falls back to
    // the publishable key (which isn't a JWT under sb_publishable_), and
    // hits InvalidJWTToken.
    accessToken: async () => {
      if (!_authResolved) await _authReady;
      const user = getAuth().currentUser;
      if (!user) return null;
      try {
        return await getIdToken(user);
      } catch (e) {
        console.warn('[supabase] getIdToken failed:', e?.message);
        return null;
      }
    },
  },
);

// -------------------------------------------------------------------
// Foreground reconnect
// -------------------------------------------------------------------
// When the app returns from background the WebSocket may be silently
// dead (network switch, OS reclaim, device sleep). supabase-js doesn't
// always notice, so force a reconnect. Auth is handled by the top-level
// `accessToken` callback above — Realtime calls it on reconnect, so we
// don't touch realtime auth manually.
let lastAppState = AppState.currentState;
AppState.addEventListener('change', (next) => {
  const cameToForeground = lastAppState.match(/inactive|background/) && next === 'active';
  lastAppState = next;
  if (!cameToForeground) return;

  try {
    supabase.realtime.connect();
  } catch (e) {
    console.warn('[supabase] realtime reconnect failed:', e?.message);
  }
});
