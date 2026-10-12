/**
 * ownerFlag.js — the signed-in user's own users/{uid}/owner flag.
 *
 * Owner rank comes from that flag, which only the server writes
 * (functions/reconcileRolesMirror.js sets it for the verified owner accounts;
 * database.rules.json makes it read-only for every client). The owner email
 * list lives on the server only, never in the app.
 *
 * GlobelStats sets it when the profile loads and clears it on sign-out;
 * ChatScreen/utils reads it for the staff ladder (buttons only — the server
 * re-checks every action).
 */
let current = { uid: null, value: false };

export const setCurrentUserOwner = (uid, value) => {
  current = { uid: uid || null, value: !!(uid && value) };
};

/** True only for the uid the flag was loaded for. */
export const getCurrentUserOwner = (uid) => !!uid && current.uid === uid && current.value;
