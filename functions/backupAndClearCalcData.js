const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

if (!admin.apps.length) admin.initializeApp();
exports.backupAndClearCalcData = functions.pubsub
  .schedule("1 */2 * * *") // Run every 2 hours starting from 1 AM
  .timeZone("Asia/Karachi") // Set to your time zone
  .onRun(async () => {
    const db = admin.database();

    try {
      const calcSnapshot = await db.ref("calcData").once("value");

      if (!calcSnapshot.exists()) {
        console.log("⚠️ No calcData to backup. Skipping...");
        return null;
      }

      const calcData = calcSnapshot.val();

      // Save to previousStock
      await db.ref("previousStock").set({
        mirageStock: calcData.mirage || null,
        normalStock: calcData.test || null,
        timestamp: Date.now(),
      });

      console.log("✅ calcData backed up to previousStock");

      // Clear calcData
      await db.ref("calcData").remove();

      console.log("🧹 calcData cleared after backup");
    } catch (error) {
      console.error("❌ Error during backup and clear:", error);
    }

    return null;
  });
