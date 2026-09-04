const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

if (admin.apps.length === 0) admin.initializeApp();

const rtdb = admin.database();
const firestore = admin.firestore();

/* ===== CONFIG ===== */
const USERS_RTD_PATH = "/users";
const SUBS_GENERAL = "subscriptions_general";
const SUBS_BY_FRUIT = "subscriptions_byFruit";
const STATE_DOC = firestore.doc("system/rtdbBackfillState");

/* ===== HELPERS ===== */
function normalizeFruitName(x) {
  if (!x) return null;
  return String(x).split("-")[0].trim().toLowerCase();
}

function extractSelectedFruitNames(selectedFruits) {
  if (!selectedFruits) return [];
  const arr = Array.isArray(selectedFruits) ? selectedFruits : Object.values(selectedFruits);
  return arr
    .map((fruit) => {
      const n = fruit?.name ?? fruit?.Name ?? fruit?.Normal ?? fruit;
      return normalizeFruitName(n);
    })
    .filter(Boolean);
}

async function commitWriteOpsInChunks(writeOps, chunkSize = 450) {
  let committed = 0;
  for (let i = 0; i < writeOps.length; i += chunkSize) {
    const batch = firestore.batch();
    const slice = writeOps.slice(i, i + chunkSize);
    slice.forEach((fn) => fn(batch));
    await batch.commit();
    committed += slice.length;
  }
  return committed;
}

/**
 * Call:
 *   /rebuildSubscriptionsFromRTDB?key=SECRET&reset=1&limit=200
 * then:
 *   /rebuildSubscriptionsFromRTDB?key=SECRET&limit=200
 */
exports.rebuildSubscriptionsFromRTDB = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    try {
      // Simple protection
      const key = String(req.query.key || "");
      const expected = String(functions.config()?.backfill?.key || "");
      if (!expected || key !== expected) {
        return res.status(403).json({ ok: false, error: "Forbidden (bad key)" });
      }

      const reset = String(req.query.reset || "") === "1";
      const limit = Math.min(Number(req.query.limit || 200), 1000);

      if (reset) {
        await STATE_DOC.set({
          lastKey: null,
          done: false,
          resetAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      const stateSnap = await STATE_DOC.get();
      const state = stateSnap.exists ? stateSnap.data() : {};
      const lastKey = state?.lastKey || null;

      // RTDB page query
      let q = rtdb.ref(USERS_RTD_PATH).orderByKey().limitToFirst(limit + 1);
      if (lastKey) q = rtdb.ref(USERS_RTD_PATH).orderByKey().startAt(lastKey).limitToFirst(limit + 1);

      const snap = await q.once("value");
      const usersObj = snap.val();

      if (!usersObj) {
        await STATE_DOC.set(
          { done: true, lastKey: null, finishedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        return res.json({ ok: true, done: true, processed: 0 });
      }

      let keys = Object.keys(usersObj);

      // startAt includes lastKey again => remove duplicate first item
      if (lastKey) keys = keys.filter((k) => k !== lastKey);

      if (keys.length === 0) {
        await STATE_DOC.set(
          { done: true, lastKey: null, finishedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        return res.json({ ok: true, done: true, processed: 0 });
      }

      // compute newLastKey cursor
      const newLastKey = keys[keys.length - 1];

      const writeOps = [];
      let processed = 0;
      let generalCount = 0;
      let fruitLinks = 0;
      let skippedNoToken = 0;

      for (const uid of keys) {
        processed++;
        const u = usersObj[uid] || {};

        const token = u.fcmToken || null;
        if (!token) {
          skippedNoToken++;
          continue;
        }

        const isReminderEnabled = !!u.isReminderEnabled;
        const isSelectedReminderEnabled = !!u.isSelectedReminderEnabled;
        const fruits = extractSelectedFruitNames(u.selectedFruits);

        // general subscription
        const genRef = firestore.collection(SUBS_GENERAL).doc(uid);
        if (isReminderEnabled) {
          writeOps.push((batch) =>
            batch.set(
              genRef,
              { token, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
              { merge: true }
            )
          );
          generalCount++;
        } else {
          writeOps.push((batch) => batch.delete(genRef));
        }

        // fruit subscriptions
        if (isSelectedReminderEnabled && fruits.length > 0) {
          for (const fruit of fruits) {
            const fruitRef = firestore
              .collection(SUBS_BY_FRUIT)
              .doc(fruit)
              .collection("users")
              .doc(uid);

            writeOps.push((batch) =>
              batch.set(
                fruitRef,
                { token, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                { merge: true }
              )
            );
            fruitLinks++;
          }
        }
      }

      const committedOps = await commitWriteOpsInChunks(writeOps);

      await STATE_DOC.set(
        {
          lastKey: newLastKey,
          done: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          stats: { processed, generalCount, fruitLinks, skippedNoToken, committedOps },
        },
        { merge: true }
      );

      return res.json({
        ok: true,
        done: false,
        nextCursor: newLastKey,
        stats: { processed, generalCount, fruitLinks, skippedNoToken, committedOps },
      });
    } catch (e) {
      console.error("Backfill failed:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });
