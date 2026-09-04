const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

if (admin.apps.length === 0) admin.initializeApp();

const rtdb = admin.database();
const messaging = admin.messaging();

/** ---------- Topic helpers ---------- **/
function fruitToSlug(name) {
  if (!name) return "";
  let s = String(name).trim().toLowerCase();
  s = s.replace(/^\+/, "");          // remove leading '+'
  s = s.replace(/[\s_]+/g, "-");     // spaces -> hyphen
  s = s.replace(/[^a-z0-9-]/g, "");  // remove non-safe chars (keeps hyphen)
  s = s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length > 120) s = s.slice(0, 120);
  return s;
}

function normalizeSelectedFruits(selectedFruits) {
  if (!selectedFruits) return [];
  const arr = Array.isArray(selectedFruits) ? selectedFruits : Object.values(selectedFruits);
  const slugs = arr
    .map((f) => (typeof f === "string" ? f : (f?.name ?? f?.Name ?? f?.Normal ?? "")))
    .map(fruitToSlug)
    .filter(Boolean);

  return [...new Set(slugs)];
}

function computeTopics({ isReminderEnabled, isSelectedReminderEnabled, selectedFruits }) {
  const topics = [];
  if (isReminderEnabled) topics.push("stock-all");

  const selected = normalizeSelectedFruits(selectedFruits);
  if (isSelectedReminderEnabled && selected.length > 0) {
    for (const slug of selected) topics.push(`fruit-${slug}`);
  }

  return topics;
}

async function subscribe(token, topics) {
  if (!token || topics.length === 0) return;
  for (const t of topics) {
    await messaging.subscribeToTopic([token], t);
  }
}

async function unsubscribe(token, topics) {
  if (!token || topics.length === 0) return;
  for (const t of topics) {
    await messaging.unsubscribeFromTopic([token], t);
  }
}

// reads the minimal data we need from RTDB
async function readUserPrefs(userId) {
  const userRef = rtdb.ref(`users/${userId}`);

  const [tokenSnap, selSnap, selEnabledSnap, allEnabledSnap] = await Promise.all([
    userRef.child("fcmToken").once("value"),
    userRef.child("selectedFruits").once("value"),
    userRef.child("isSelectedReminderEnabled").once("value"),
    userRef.child("isReminderEnabled").once("value"),
  ]);

  return {
    fcmToken: tokenSnap.val() || null,
    selectedFruits: selSnap.val() || [],
    isSelectedReminderEnabled: !!selEnabledSnap.val(),
    isReminderEnabled: !!allEnabledSnap.val(),
  };
}

/** ---------- 1) Token change ---------- **/
exports.syncTopicsOnTokenChange = functions.database
  .ref("users/{userId}/fcmToken")
  .onWrite(async (change, context) => {
    const { userId } = context.params;

    const beforeToken = change.before.val() || null;
    const afterToken = change.after.val() || null;

    if (beforeToken === afterToken) return null;

    // Read prefs once (after state)
    const prefs = await readUserPrefs(userId);
    const topics = computeTopics(prefs);

    // Unsubscribe old token from user’s topics (if any)
    if (beforeToken) {
      await unsubscribe(beforeToken, topics);
    }

    // Subscribe new token to user’s topics (if any)
    if (afterToken) {
      await subscribe(afterToken, topics);
    }

    return null;
  });

/** ---------- 2) General reminder toggle ---------- **/
exports.syncTopicsOnReminderToggle = functions.database
  .ref("users/{userId}/isReminderEnabled")
  .onWrite(async (change, context) => {
    const { userId } = context.params;

    const before = !!change.before.val();
    const after = !!change.after.val();
    if (before === after) return null;

    const { fcmToken } = await readUserPrefs(userId);
    if (!fcmToken) return null;

    const topic = ["stock-all"];
    if (after) await subscribe(fcmToken, topic);
    else await unsubscribe(fcmToken, topic);

    return null;
  });

/** ---------- 3) Selected reminder toggle ---------- **/
exports.syncTopicsOnSelectedReminderToggle = functions.database
  .ref("users/{userId}/isSelectedReminderEnabled")
  .onWrite(async (change, context) => {
    const { userId } = context.params;

    const before = !!change.before.val();
    const after = !!change.after.val();
    if (before === after) return null;

    const prefs = await readUserPrefs(userId);
    if (!prefs.fcmToken) return null;

    // IMPORTANT RULE you wanted:
    // if selected reminder enabled but no fruits -> subscribe to nothing (and unsubscribe if disabling)
    const selectedSlugs = normalizeSelectedFruits(prefs.selectedFruits);
    const fruitTopics = selectedSlugs.map((s) => `fruit-${s}`);

    if (after && fruitTopics.length > 0) {
      await subscribe(prefs.fcmToken, fruitTopics);
    } else {
      // disabling OR enabling with empty selection => unsubscribe from current fruit list
      // (keeps things clean)
      await unsubscribe(prefs.fcmToken, fruitTopics);
    }

    return null;
  });

/** ---------- 4) Selected fruits change ---------- **/
exports.syncTopicsOnSelectedFruitsChange = functions.database
  .ref("users/{userId}/selectedFruits")
  .onWrite(async (change, context) => {
    const { userId } = context.params;

    const beforeRaw = change.before.val() || [];
    const afterRaw = change.after.val() || [];

    // strict no-op check
    if (JSON.stringify(beforeRaw) === JSON.stringify(afterRaw)) return null;

    const prefs = await readUserPrefs(userId);
    if (!prefs.fcmToken) return null;

    // If selected reminder isn't enabled -> DO NOTHING (your requirement)
    if (!prefs.isSelectedReminderEnabled) return null;

    const beforeSlugs = normalizeSelectedFruits(beforeRaw);
    const afterSlugs = normalizeSelectedFruits(afterRaw);

    const beforeSet = new Set(beforeSlugs);
    const afterSet = new Set(afterSlugs);

    const toUnsub = [];
    const toSub = [];

    for (const s of beforeSet) if (!afterSet.has(s)) toUnsub.push(`fruit-${s}`);
    for (const s of afterSet) if (!beforeSet.has(s)) toSub.push(`fruit-${s}`);

    // if user ends up with 0 fruits, unsubscribe all that were before
    await unsubscribe(prefs.fcmToken, toUnsub);
    await subscribe(prefs.fcmToken, toSub);

    return null;
  });
