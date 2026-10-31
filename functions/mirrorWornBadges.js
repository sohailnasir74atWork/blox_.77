/**
 * Cloud Function: mirror RTDB /worn_badges/{uid} into Supabase user_roles
 * (badge_styles, custom_badges) — supabase/058_worn_badges.sql.
 *
 * worn_badges/{uid} is what a MOD granted on top of the role flags (badge
 * colours + custom badges; Code/Helper/customBadges.js). It lives outside
 * users/{uid} so the rules can give it a plain mod/admin write gate, which
 * means mirrorUsersToSupabase never sees it — this trigger does the same
 * job for the one node. Clients read the two columns with the role flags
 * (getRolesBatch), so a chat page costs no extra read for badges.
 *
 * Idempotent upsert: the row's other columns are left alone (upsert only
 * sets the columns given). Node removed → both columns null.
 *
 * Deployment:
 *   firebase deploy --only functions:mirrorWornBadges --project fruiteblocks
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const nonEmptyObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 ? v : null);

exports.mirrorWornBadges = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '128MB',
    timeoutSeconds: 30,
  })
  .database.ref('/worn_badges/{uid}')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    const after = change.after.exists() ? change.after.val() || {} : {};
    const row = {
      uid,
      badge_styles: nonEmptyObject(after.styles),
      custom_badges: nonEmptyObject(after.custom),
      updated_at: new Date().toISOString(),
    };
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('user_roles').upsert(row, { onConflict: 'uid' });
    if (error) console.error('[mirrorWornBadges]', uid, error.message);
    return null;
  });
