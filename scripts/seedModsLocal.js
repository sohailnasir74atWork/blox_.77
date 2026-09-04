/**
 * One-time local script to seed the mods node in RTDB.
 * Run on your PC: node seedModsLocal.js
 */

const admin = require('firebase-admin');
const fs = require('fs');

const SERVICE_ACCOUNT_PATH = './fruiteblocks-firebase-adminsdk-yfyra-203584e8a0.json';
const RTDB_URL = 'https://fruiteblocks-default-rtdb.firebaseio.com';

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.log('Service account file not found:', SERVICE_ACCOUNT_PATH);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  databaseURL: RTDB_URL,
});

const db = admin.database();

async function seedMods() {
  console.log('Scanning all users for isSeniorMod / isModerator / isBabyMod...\n');

  // Query senior mods (one rank below Admin — highest roster tier)
  const seniorSnap = await db.ref('users')
    .orderByChild('isSeniorMod')
    .equalTo(true)
    .once('value');

  // Query mods
  const modSnap = await db.ref('users')
    .orderByChild('isModerator')
    .equalTo(true)
    .once('value');

  // Query jmods
  const jmodSnap = await db.ref('users')
    .orderByChild('isBabyMod')
    .equalTo(true)
    .once('value');

  const updates = {};
  let count = 0;

  if (seniorSnap.exists()) {
    seniorSnap.forEach(child => {
      const data = child.val();
      updates[`mods/${child.key}`] = {
        displayName: data.displayName || 'Unknown',
        avatar: data.avatar || '',
        role: 'srmod',
        updatedAt: Date.now(),
      };
      console.log(`  SR MOD: ${data.displayName || 'Unknown'} (${child.key})`);
      count++;
    });
  }

  if (modSnap.exists()) {
    modSnap.forEach(child => {
      // Don't overwrite if already added as a senior mod (higher tier)
      if (!updates[`mods/${child.key}`]) {
        const data = child.val();
        updates[`mods/${child.key}`] = {
          displayName: data.displayName || 'Unknown',
          avatar: data.avatar || '',
          role: 'mod',
          updatedAt: Date.now(),
        };
        console.log(`  MOD: ${data.displayName || 'Unknown'} (${child.key})`);
        count++;
      }
    });
  }

  if (jmodSnap.exists()) {
    jmodSnap.forEach(child => {
      // Don't overwrite if already added as mod
      if (!updates[`mods/${child.key}`]) {
        const data = child.val();
        updates[`mods/${child.key}`] = {
          displayName: data.displayName || 'Unknown',
          avatar: data.avatar || '',
          role: 'jmod',
          updatedAt: Date.now(),
        };
        console.log(`  JMOD: ${data.displayName || 'Unknown'} (${child.key})`);
        count++;
      }
    });
  }

  if (count > 0) {
    await db.ref().update(updates);
    console.log(`\nSeeded ${count} mods/jmods into /mods node.`);
  } else {
    console.log('\nNo mods or jmods found.');
  }

  console.log('Cloud function syncModRoster will keep it updated from now on.');
  process.exit(0);
}

seedMods().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
