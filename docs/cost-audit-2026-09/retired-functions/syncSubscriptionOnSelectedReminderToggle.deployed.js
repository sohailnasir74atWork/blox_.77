const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

if (admin.apps.length === 0) admin.initializeApp();

const rtdb = admin.database();
const fs = admin.firestore();

const SUBS_COL = "subscriptions";

// normalize fruit names into lowercase strings (matches rebuild script)
function normalizeFruitName(x) {
  const raw = typeof x === "string" ? x : (x?.name ?? x?.Name ?? x?.Normal ?? "");
  return String(raw)
    .split("-")[0]          // ✅ "Rocket-Rocket" -> "Rocket"
    .trim()
    .toLowerCase();
}

function normalizeSelectedFruits(selectedFruits) {
  if (!selectedFruits) return [];

  // can be array OR object map
  const arr = Array.isArray(selectedFruits)
    ? selectedFruits
    : Object.values(selectedFruits);

  const normalized = arr.map(normalizeFruitName).filter(Boolean);

  // ✅ de-dup
  return [...new Set(normalized)];
}

// small stable fingerprint so we can skip no-op writes
function fingerprint({ fcmToken, isReminderEnabled, isSelectedReminderEnabled, selectedFruits }) {
  return [
    fcmToken || "",
    isReminderEnabled ? "1" : "0",
    isSelectedReminderEnabled ? "1" : "0",
    (selectedFruits || []).slice().sort().join(","),
  ].join("|");
}

// reads minimal data from RTDB and writes to Firestore
async function upsertSubscription(userId) {
  const userRef = rtdb.ref(`users/${userId}`);

  const [tokenSnap, selSnap, selEnabledSnap, allEnabledSnap] = await Promise.all([
    userRef.child("fcmToken").once("value"),
    userRef.child("selectedFruits").once("value"),
    userRef.child("isSelectedReminderEnabled").once("value"),
    userRef.child("isReminderEnabled").once("value"),
  ]);

  const fcmToken = tokenSnap.val() || null;
  const selectedFruits = normalizeSelectedFruits(selSnap.val());
  const isReminderEnabled = !!allEnabledSnap.val();
  const rawSelectedEnabled = !!selEnabledSnap.val();

  // ✅ if selected reminder enabled but no fruits -> treat as disabled
  const isSelectedReminderEnabled = rawSelectedEnabled && selectedFruits.length > 0;

  // ✅ keep only if token exists AND (general enabled OR usable selected reminder)
  const keep =
    !!fcmToken && (isReminderEnabled || isSelectedReminderEnabled);

  const docRef = fs.collection(SUBS_COL).doc(userId);

  if (!keep) {
    await docRef.delete().catch(() => null);
    return null;
  }

  const doc = {
    fcmToken,
    isReminderEnabled,
    isSelectedReminderEnabled,
    selectedFruits: isSelectedReminderEnabled ? selectedFruits : [],
    fp: fingerprint({ fcmToken, isReminderEnabled, isSelectedReminderEnabled, selectedFruits }),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // ✅ optional no-op skip: if fp same, don't write
  const existing = await docRef.get();
  if (existing.exists && existing.data()?.fp === doc.fp) {
    return null;
  }

  await docRef.set(doc, { merge: true });
  return null;
}

/* =========================
   1) Trigger: FCM token change
========================= */
exports.syncSubscriptionOnTokenChange = functions.database
  .ref("users/{userId}/fcmToken")
  .onWrite(async (change, context) => {
    if (change.before.val() === change.after.val()) return null;
    return upsertSubscription(context.params.userId);
  });

/* =========================
   2) Trigger: reminder enabled change
========================= */
exports.syncSubscriptionOnReminderToggle = functions.database
  .ref("users/{userId}/isReminderEnabled")
  .onWrite(async (change, context) => {
    if (change.before.val() === change.after.val()) return null;
    return upsertSubscription(context.params.userId);
  });

/* =========================
   3) Trigger: selected reminder enabled change
========================= */
exports.syncSubscriptionOnSelectedReminderToggle = functions.database
  .ref("users/{userId}/isSelectedReminderEnabled")
  .onWrite(async (change, context) => {
    if (change.before.val() === change.after.val()) return null;
    return upsertSubscription(context.params.userId);
  });

/* =========================
   4) Trigger: selected fruits change
========================= */
exports.syncSubscriptionOnSelectedFruitsChange = functions.database
  .ref("users/{userId}/selectedFruits")
  .onWrite(async (change, context) => {
    const before = change.before.val() ?? null;
    const after = change.after.val() ?? null;

    if (JSON.stringify(before) === JSON.stringify(after)) return null;
    return upsertSubscription(context.params.userId);
  });
