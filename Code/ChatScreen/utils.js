import { getDatabase, ref, update, get, set, onDisconnect, onValue, query, orderByChild, equalTo, limitToLast } from '@react-native-firebase/database';
import { getAuth } from '@react-native-firebase/auth';
import { useState, useEffect, useCallback } from 'react';
import { Alert, AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { softDeleteMessagesBySender } from '../Supabase/chatBackend';
import { getServerTime } from '../Helper/serverTime';
import { getDeviceFingerprint } from '../Helper/deviceFingerprint';
import { encodeEmailKey, isMuteRecord, normalizeEmail } from '../Helper/banKeys';
import { getCurrentUserOwner } from '../Helper/ownerFlag';
import {
  callModSanction,
  logModAction,
  sanctionErrorText,
  nextStrikeCount,
  strikeBannedUntil,
  strikeDurationLabel,
  JMD_MAX_MUTE_MINUTES,
} from '../Helper/modSanction';

// Returns true if the caller is trying to ban/mute/unban their own account.
// All moderation actions go through utils.js, so guarding here closes every
// entry point (AdminDashboard, BottomDrawer, ReportPopUp, etc.) at once.
const isSelfTargeting = (targetEmail, targetUid = null) => {
  const me = getAuth()?.currentUser;
  if (!me) return false;
  if (targetUid && me.uid === targetUid) return true;
  if (!targetEmail || !me.email) return false;
  return normalizeEmail(me.email) === normalizeEmail(targetEmail);
};

// ─── Staff hierarchy ────────────────────────────────────────────────
// Strict ladder: a staffer can only act on someone STRICTLY below them.
// Owner (server-set owner flag) > Admin > Senior Mod > Mod > JMD > user.
// Mods can't ban Mods. Admins can't ban Admins or owners. Staff targets need
// a Senior Mod or higher (so Mods and JMDs only sanction regular users).
// Permanent bans need an Admin. Promote/demote rules: only Admins can manage Senior
// Mods; Admins and Senior Mods can manage Mods; Admins, Senior Mods and
// Mods can manage JMDs.
//
// The server (functions/banEnforcement.js readRank) is the source of truth;
// this copy only decides which buttons to show.
//
// Senior Mod (isSeniorMod) sits ONE step below Admin — it outranks every
// Mod/JMD, so canModerate lets a Senior Mod act on them and canManageMod
// lets a Senior Mod appoint or remove Mods and JMDs.
export const STAFF_RANK = { owner: 5, admin: 4, seniorMod: 3, moderator: 2, babyMod: 1, user: 0 };

// Owner rank comes from the server-written users/{uid}/owner flag
// (Helper/ownerFlag.js); the owner email list never ships in the app.
export const isCurrentUserOwner = () => getCurrentUserOwner(getAuth()?.currentUser?.uid);

export const getStaffRank = (roles) => {
  if (!roles) return STAFF_RANK.user;
  if (roles.isOwner || roles.owner === true) return STAFF_RANK.owner;
  if (roles.isAdmin || roles.admin) return STAFF_RANK.admin;
  if (roles.isSeniorMod) return STAFF_RANK.seniorMod;
  if (roles.isModerator) return STAFF_RANK.moderator;
  if (roles.isBabyMod) return STAFF_RANK.babyMod;
  return STAFF_RANK.user;
};

export const canModerate = (caller, target) =>
  getStaffRank(caller) > getStaffRank(target);

/** JMD and above. */
export const isStaffRoles = (roles) => getStaffRank(roles) >= STAFF_RANK.babyMod;

// Staff targets (JMD and up): only a Senior Mod or higher, on top of the
// strict-rank rule (functions/banEnforcement.js checkActorOverTarget).
export const canSanction = (caller, target) =>
  canModerate(caller, target) &&
  (!isStaffRoles(target) || getStaffRank(caller) >= STAFF_RANK.seniorMod);

/**
 * What the caller may do to the target — mirrors the server's checks so the UI
 * only offers actions it will accept (contract §2).
 *   JMD:   mute ≤ 1 day and unmute only.
 *   Mod+:  strike / ban / mute, unban, linked accounts. Below Admin a strike 3
 *          is a 30-day ban + a permanent-ban request (canPermaban false).
 * Lifting also needs rank ≥ the original banner's (admins always may), which
 * needs the record — see canLiftSanction.
 */
export const getModPermissions = (caller, target) => {
  const rank = getStaffRank(caller);
  const outranks = canModerate(caller, target);
  const sanction = canSanction(caller, target);
  const isJmd = rank === STAFF_RANK.babyMod;
  return {
    isStaff: rank >= STAFF_RANK.babyMod,
    isJmd,
    outranks,
    canMute: sanction,
    maxMuteMinutes: isJmd ? JMD_MAX_MUTE_MINUTES : null,
    canStrike: sanction && !isJmd,
    canPermaban: rank >= STAFF_RANK.admin,
    canUnmute: sanction,
    canUnban: sanction && !isJmd,
    canSeeLinked: sanction && rank >= STAFF_RANK.moderator,
  };
};

/**
 * Can the caller lift this record? `type` is 'ban' | 'mute', `bannerRoles`
 * the roles of whoever placed it (null when unknown — the server decides).
 */
export const canLiftSanction = (caller, target, type, bannerRoles = null) => {
  const perms = getModPermissions(caller, target);
  if (type === 'mute' ? !perms.canUnmute : !perms.canUnban) return false;
  const rank = getStaffRank(caller);
  if (rank >= STAFF_RANK.admin || !bannerRoles) return true;
  return rank >= getStaffRank(bannerRoles);
};

// Only Admins can appoint/remove Senior Mods.
export const canManageSeniorMod = (caller) => !!(caller?.isAdmin || caller?.isOwner);
// Admins AND Senior Mods can appoint/remove Mods.
export const canManageMod = (caller) => !!(caller?.isAdmin || caller?.isOwner || caller?.isSeniorMod);
// Admins, Senior Mods AND Mods can appoint/remove JMDs.
export const canManageBabyMod = (caller) =>
  !!(caller?.isAdmin || caller?.isOwner || caller?.isSeniorMod || caller?.isModerator);

// Look up target's role flags from RTDB so utility-level checks don't
// rely on every caller populating userInfo. Tolerant of the legacy
// `users/{uid}/admin` path AND the newer `isAdmin` path — both exist
// in the wild (see profileCache.js vs OnlineUsersList.jsx).
const fetchTargetRoles = async (userId) => {
  if (!userId) return null;
  try {
    const db = getDatabase();
    const [ownerSnap, adminLegacySnap, adminSnap, seniorSnap, modSnap, jmdSnap] = await Promise.all([
      get(ref(db, `users/${userId}/owner`)),
      get(ref(db, `users/${userId}/admin`)),
      get(ref(db, `users/${userId}/isAdmin`)),
      get(ref(db, `users/${userId}/isSeniorMod`)),
      get(ref(db, `users/${userId}/isModerator`)),
      get(ref(db, `users/${userId}/isBabyMod`)),
    ]);
    return {
      isOwner: ownerSnap?.exists() && ownerSnap.val() === true,
      isAdmin: !!(
        (adminLegacySnap?.exists() && adminLegacySnap.val()) ||
        (adminSnap?.exists() && adminSnap.val())
      ),
      isSeniorMod: !!(seniorSnap?.exists() && seniorSnap.val()),
      isModerator: !!(modSnap?.exists() && modSnap.val()),
      isBabyMod: !!(jmdSnap?.exists() && jmdSnap.val()),
    };
  } catch (_) {
    return null;
  }
};

/**
 * Fresh role flags for any user (RTDB), owner included. Resolves null when
 * nothing could be read.
 */
export const fetchUserRoles = async (userId) => fetchTargetRoles(userId);

// Resolve the most authoritative target-role view: prefer a fresh RTDB
// read (so a stale userInfo can't mask a recent promotion), fall back to
// whatever the caller passed.
const resolveTargetRoles = async (userId, fallback = {}) => {
  const fetched = await fetchTargetRoles(userId);
  if (fetched) return fetched;
  return {
    isOwner: !!(fallback?.isOwner || fallback?.owner === true),
    isAdmin: !!fallback?.isAdmin,
    isSeniorMod: !!fallback?.isSeniorMod,
    isModerator: !!fallback?.isModerator,
    isBabyMod: !!fallback?.isBabyMod,
  };
};

// Comparative hierarchy gate for role changes. The canManage* helpers above
// only answer "is the caller senior enough to touch this TIER of role" — they
// say nothing about who the target is. This closes that half: a staffer may
// only alter the roles of someone STRICTLY below them, mirroring canModerate
// (already used by ban/mute/strike). Without it, one Senior Mod could strip a
// peer Senior Mod's Mod flag, and a Mod could stamp/clear the JMD flag on an
// Admin. Reads the target's roles fresh from RTDB, so a stale userInfo can't
// be passed in to fake a low-ranked target.
const outranksTarget = async (userId, callerRoles, fallbackRoles = {}) => {
  const targetRoles = await resolveTargetRoles(userId, fallbackRoles);
  return canModerate(withOwnerFlag(callerRoles), targetRoles);
};

/** Fresh-RTDB version of canModerate for a target uid (message deletes etc.). */
export const outranksUser = (userId, callerRoles, fallbackRoles = {}) =>
  outranksTarget(userId, callerRoles, fallbackRoles);

// Callers pass their role flags from useGlobalState, which has no owner flag;
// add it from the auth session.
const withOwnerFlag = (roles = {}) => ({ ...roles, isOwner: !!roles?.isOwner || isCurrentUserOwner() });

// Pull caller role flags off a bannerInfo blob. Callers are expected to
// stamp these on bannerInfo from useGlobalState.
const callerRolesFromBanner = (bannerInfo) => withOwnerFlag({
  isAdmin: !!bannerInfo?.isAdmin,
  isSeniorMod: !!bannerInfo?.isSeniorMod,
  isModerator: !!bannerInfo?.isModerator,
  isBabyMod: !!bannerInfo?.isBabyMod,
});

const roleLabel = (roles) => {
  const rank = getStaffRank(roles);
  if (rank === STAFF_RANK.owner) return 'Owner';
  if (rank === STAFF_RANK.admin) return 'Admin';
  if (rank === STAFF_RANK.seniorMod) return 'Senior Mod';
  if (rank === STAFF_RANK.moderator) return 'Moderator';
  if (rank === STAFF_RANK.babyMod) return 'JMD';
  return 'Staff';
};

// The `bannedBy` object every email-keyed ban/mute record carries. The RTDB
// rules require bannedBy.uid === auth.uid, so it is always the signed-in
// user's own uid, never a value passed in.
const bannedByFor = (bannerInfo = {}) => ({
  uid: getAuth()?.currentUser?.uid || null,
  displayName: bannerInfo?.displayName || 'Staff',
  avatar: bannerInfo?.avatar || null,
  role: roleLabel(callerRolesFromBanner(bannerInfo)),
});

// Initialize the database reference
const database = getDatabase();
const usersRef = ref(database, 'users'); // Base reference to the "users" node

// Looks up the deviceId GlobelStats stamps on auth: users_private/{uid}
// (staff-readable) on current builds, users/{uid} on older ones until the
// server moves it. Returns null if the user has no deviceId yet. The server
// (functions/banEnforcement.js) also bans every device in its own index, so
// this client-side mirror is a fast path, not the only one.
const getUserDeviceId = async (userId) => {
  if (!userId) return null;
  try {
    const db = getDatabase();
    const [privSnap, legacySnap] = await Promise.all([
      get(ref(db, `users_private/${userId}/deviceId`)).catch(() => null),
      get(ref(db, `users/${userId}/deviceId`)).catch(() => null),
    ]);
    const v = privSnap?.val() || legacySnap?.val();
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch (_) {
    return null;
  }
};

// Mirrors a ban onto banned_devices/{deviceId} so the same device can't sign
// up with a fresh email and bypass the email-keyed ban. Writes BOTH the
// stamped device id (from users/{uid}/deviceId) AND the currently-active
// device's fingerprint when the ban is happening on the same device as the
// banned user. Without that second write, a self-ban whose stamp lost the
// race against the ban write left banned_devices empty — the user could
// then sign in to a different account on the same device with no gate.
//
// Caller already wrote the email-ban entry; we additionally tag that entry
// with `deviceId` so unbanUserWithEmail knows which device entry to clear.
const mirrorBanToDevice = async (email, userId, banPayload) => {
  const stampedDeviceId = await getUserDeviceId(userId);

  // Self-ban / same-device fallback: if the caller's session matches the
  // banned account, we know THIS device should be locked regardless of
  // what users/{uid}/deviceId says (it may be stale, missing, or the user
  // may have signed in pre-stamp).
  let currentDeviceId = null;
  const callerUid = getAuth()?.currentUser?.uid;
  if (userId && callerUid && userId === callerUid) {
    try {
      currentDeviceId = await getDeviceFingerprint();
    } catch (_) { /* fall through */ }
  }

  // Dedup so we don't write the same row twice.
  const targets = Array.from(
    new Set([stampedDeviceId, currentDeviceId].filter(Boolean))
  );

  if (targets.length === 0) {
    console.warn(
      'mirrorBanToDevice: no deviceId available for user',
      userId,
      '— device-side ban not written'
    );
    return null;
  }

  const payload = {
    bannedUntil: banPayload.bannedUntil,
    bannedAt: banPayload.bannedAt,
    bannedBy: banPayload.bannedBy,
    reason: banPayload.reason,
    strikeCount: banPayload.strikeCount,
    email,
    userId: userId || null,
  };

  try {
    const db = getDatabase();
    await Promise.all(
      targets.map((id) => set(ref(db, `banned_devices/${id}`), payload))
    );
    // Tag the email-ban entry with every device fp we wrote, so unban can
    // clear all of them. Keep the legacy `deviceId` field set to the primary
    // (stamped if available — more stable than current FP) for older clients.
    const primary = stampedDeviceId || currentDeviceId;
    await update(ref(db, `banned_users_by_email/${encodeEmailKey(email)}`), {
      deviceId: primary,
      deviceIds: targets,
    });
    return primary;
  } catch (e) {
    console.error('mirrorBanToDevice error:', e);
    return null;
  }
};


// Format Date Utility
export const formatDate = (dateString) => {
  const date = new Date(dateString);
  return isNaN(date)
    ? 'Invalid Date' // Handle invalid date cases gracefully
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

// Ban User
export const banUser = async (userId) => {
  try {
    await handleDeleteLast300Messages(userId)
    const database = getDatabase(); // Ensure database instance is created
    const userToUpdateRef = ref(database, `users/${userId}`); // Reference to the specific user in the "users" node
    await update(userToUpdateRef, { isBlock: true }); // Update the user's `isBlock` property
    // Alert.alert('Success', 'User has been banned.');
  } catch (error) {
    console.error('Error banning user:', error);
    Alert.alert('Error', 'Failed to ban the user.');
  }
};

// Unban User
export const unbanUser = async (userId) => {
  try {
    const database = getDatabase(); // Ensure the database instance is initialized
    const userToUpdateRef = ref(database, `users/${userId}`); // Reference to the specific user in the "users" node

    // Update the user's `isBlock` property to `false`
    await update(userToUpdateRef, { isBlock: false });

    Alert.alert('Success', 'User has been unbanned.');
  } catch (error) {
    console.error('Error unbanning user:', error);
    Alert.alert('Error', 'Failed to unban the user.');
  }
};

// Remove Admin
export const removeAdmin = async (userId) => {
  try {
    const userToUpdateRef = ref(database, `users/${userId}`); // Reference to the specific user
    await update(userToUpdateRef, { admin: false });
    Alert.alert('Success', 'Admin privileges removed from the user.');
  } catch (error) {
    console.error('Error removing admin:', error);
    Alert.alert('Error', 'Failed to remove admin privileges.');
  }
};
// Make Admin
export const makeAdmin = async (userId) => {
  try {
    // console.log(userId)
    const userToUpdateRef = ref(database, `users/${userId}`); // Reference to the specific user
    await update(userToUpdateRef, { admin: true });
    Alert.alert('Success', 'User has been made an admin.');
  } catch (error) {
    console.error('Error making admin:', error);
    Alert.alert('Error', 'Failed to make the user an admin.');
  }
};

// Make Owner
export const makeOwner = async (userId) => {
  try {
    const userToUpdateRef = ref(usersRef, userId); // Reference to the specific user
    await update(userToUpdateRef, { owner: true });
    Alert.alert('Success', 'User has been made an owner.');
  } catch (error) {
    console.error('Error making owner:', error);
    Alert.alert('Error', 'Failed to make the user an owner.');
  }
};
export const rulesen = [
  "Always communicate respectfully. Hate speech, discrimination, and harassment are strictly prohibited.",
  "Avoid sharing offensive, explicit, or inappropriate content, including text, images, or links.",
  "Do not share personal, sensitive, or confidential information such as phone numbers, addresses, or financial details.",
  "Spamming, repetitive messaging, or promoting products/services without permission is not allowed.",
  "If you encounter inappropriate behavior, use the report or block tools available in the app.",
  "Use appropriate language in the chat. Avoid abusive or overly aggressive tones.",
  "Discussions or activities promoting illegal or unethical behavior are prohibited.",
  "Users are responsible for the content they share and must adhere to community guidelines.",
  "Moderators reserve the right to monitor and take action on any violations, including warnings or bans.",
  "Content should be suitable for all approved age groups, adhering to app age requirements.",
  "Do not share links to harmful sites, malware, or malicious content.",
  "By using the chat feature, you agree to the app’s Terms of Service and Privacy Policy.https://bloxfruitscalc.com/privacy-policy/",
];

export const rulesde = [
  "Kommunizieren Sie immer respektvoll. Hassreden, Diskriminierung und Belästigung sind streng verboten.",
  "Vermeiden Sie das Teilen von anstößigen, expliziten oder unangemessenen Inhalten, einschließlich Text, Bildern oder Links.",
  "Geben Sie keine persönlichen, sensiblen oder vertraulichen Informationen wie Telefonnummern, Adressen oder Finanzdaten weiter.",
  "Spam, wiederholte Nachrichten oder das Bewerben von Produkten/Dienstleistungen ohne Erlaubnis sind nicht erlaubt.",
  "Wenn Sie unangemessenes Verhalten bemerken, nutzen Sie die Melde- oder Blockierfunktion der App.",
  "Verwenden Sie eine angemessene Sprache im Chat. Vermeiden Sie beleidigende oder aggressive Töne.",
  "Diskussionen oder Aktivitäten, die illegales oder unethisches Verhalten fördern, sind verboten.",
  "Benutzer sind für die Inhalte verantwortlich, die sie teilen, und müssen sich an die Community-Richtlinien halten.",
  "Moderatoren behalten sich das Recht vor, Verstöße zu überwachen und Maßnahmen zu ergreifen, einschließlich Verwarnungen oder Sperren.",
  "Inhalte sollten für alle genehmigten Altersgruppen geeignet sein und den Altersanforderungen der App entsprechen.",
  "Teilen Sie keine Links zu schädlichen Websites, Malware oder bösartigen Inhalten.",
  "Durch die Nutzung der Chat-Funktion stimmen Sie den Nutzungsbedingungen und der Datenschutzrichtlinie der App zu. https://bloxfruitscalc.com/privacy-policy/"
]


export const rulesvi = [
  "Luôn giao tiếp một cách tôn trọng. Phát ngôn thù địch, phân biệt đối xử và quấy rối đều bị nghiêm cấm.",
  "Tránh chia sẻ nội dung phản cảm, rõ ràng hoặc không phù hợp, bao gồm văn bản, hình ảnh hoặc liên kết.",
  "Không chia sẻ thông tin cá nhân, nhạy cảm hoặc bảo mật như số điện thoại, địa chỉ hoặc dữ liệu tài chính.",
  "Không spam, gửi tin nhắn lặp lại hoặc quảng bá sản phẩm/dịch vụ mà không được phép.",
  "Nếu bạn gặp hành vi không phù hợp, hãy sử dụng công cụ báo cáo hoặc chặn có trong ứng dụng.",
  "Sử dụng ngôn ngữ phù hợp trong cuộc trò chuyện. Tránh giọng điệu lăng mạ hoặc hung hăng.",
  "Các cuộc thảo luận hoặc hoạt động thúc đẩy hành vi bất hợp pháp hoặc phi đạo đức bị cấm.",
  "Người dùng chịu trách nhiệm về nội dung họ chia sẻ và phải tuân thủ nguyên tắc cộng đồng.",
  "Người điều hành có quyền giám sát và thực hiện hành động đối với bất kỳ vi phạm nào, bao gồm cảnh báo hoặc cấm.",
  "Nội dung phải phù hợp với tất cả các nhóm tuổi được phê duyệt, tuân theo yêu cầu về độ tuổi của ứng dụng.",
  "Không chia sẻ liên kết đến các trang web độc hại, phần mềm độc hại hoặc nội dung độc hại.",
  "Bằng cách sử dụng tính năng trò chuyện, bạn đồng ý với Điều khoản dịch vụ và Chính sách quyền riêng tư của ứng dụng. https://bloxfruitscalc.com/privacy-policy/"
]

export const rulesid = [
  "Selalu berkomunikasi dengan hormat. Ujaran kebencian, diskriminasi, dan pelecehan dilarang keras.",
  "Hindari berbagi konten yang menyinggung, eksplisit, atau tidak pantas, termasuk teks, gambar, atau tautan.",
  "Jangan bagikan informasi pribadi, sensitif, atau rahasia seperti nomor telepon, alamat, atau data keuangan.",
  "Spam, pengiriman pesan berulang, atau promosi produk/jasa tanpa izin tidak diperbolehkan.",
  "Jika Anda menemukan perilaku yang tidak pantas, gunakan alat laporan atau pemblokiran yang tersedia di aplikasi.",
  "Gunakan bahasa yang sesuai dalam obrolan. Hindari nada kasar atau agresif.",
  "Diskusi atau aktivitas yang mendorong perilaku ilegal atau tidak etis dilarang.",
  "Pengguna bertanggung jawab atas konten yang mereka bagikan dan harus mematuhi pedoman komunitas.",
  "Moderator berhak untuk memantau dan mengambil tindakan terhadap pelanggaran, termasuk peringatan atau larangan.",
  "Konten harus sesuai untuk semua kelompok umur yang disetujui, sesuai dengan persyaratan usia aplikasi.",
  "Jangan bagikan tautan ke situs berbahaya, malware, atau konten berbahaya.",
  "Dengan menggunakan fitur obrolan, Anda menyetujui Ketentuan Layanan dan Kebijakan Privasi aplikasi. https://bloxfruitscalc.com/privacy-policy/"
]

export const rulesfr = [
  "Communiquez toujours avec respect. Les discours de haine, la discrimination et le harcèlement sont strictement interdits.",
  "Évitez de partager du contenu offensant, explicite ou inapproprié, y compris du texte, des images ou des liens.",
  "Ne partagez pas d’informations personnelles, sensibles ou confidentielles telles que des numéros de téléphone, des adresses ou des données financières.",
  "Le spam, l’envoi répété de messages ou la promotion de produits/services sans autorisation ne sont pas autorisés.",
  "Si vous observez un comportement inapproprié, utilisez les outils de signalement ou de blocage disponibles dans l’application.",
  "Utilisez un langage approprié dans le chat. Évitez les tons insultants ou agressifs.",
  "Les discussions ou activités encourageant des comportements illégaux ou contraires à l’éthique sont interdites.",
  "Les utilisateurs sont responsables du contenu qu’ils partagent et doivent respecter les règles de la communauté.",
  "Les modérateurs se réservent le droit de surveiller et de prendre des mesures contre toute violation, y compris des avertissements ou des interdictions.",
  "Le contenu doit être adapté à tous les groupes d’âge approuvés, conformément aux exigences d’âge de l’application.",
  "Ne partagez pas de liens vers des sites nuisibles, des logiciels malveillants ou du contenu malveillant.",
  "En utilisant la fonction de chat, vous acceptez les Conditions d’utilisation et la Politique de confidentialité de l’application. https://bloxfruitscalc.com/privacy-policy/"
]

export const rulesfil = [
  "Laging makipag-usap nang may paggalang. Ang mapoot na pananalita, diskriminasyon, at pananakot ay mahigpit na ipinagbabawal.",
  "Iwasan ang pagbabahagi ng nakakasakit, malaswa, o hindi angkop na nilalaman, kabilang ang teksto, larawan, o mga link.",
  "Huwag ibahagi ang personal, sensitibo, o kumpidensyal na impormasyon tulad ng mga numero ng telepono, address, o data sa pananalapi.",
  "Ang spam, paulit-ulit na pagpapadala ng mensahe, o promosyon ng produkto/serbisyo nang walang pahintulot ay hindi pinapayagan.",
  "Kung makakita ka ng hindi naaangkop na pag-uugali, gamitin ang tool sa pag-uulat o pag-block sa app.",
  "Gumamit ng angkop na wika sa chat. Iwasan ang bastos o agresibong tono.",
  "Ipinagbabawal ang mga talakayan o aktibidad na nagtataguyod ng ilegal o hindi etikal na pag-uugali.",
  "Ang mga gumagamit ay may pananagutan sa nilalaman na kanilang ibinabahagi at dapat sumunod sa mga patakaran ng komunidad.",
  "Ang mga moderator ay may karapatang subaybayan at gumawa ng aksyon laban sa anumang paglabag, kabilang ang mga babala o pagbabawal.",
  "Ang nilalaman ay dapat na angkop para sa lahat ng pinapayagang pangkat ng edad, alinsunod sa mga kinakailangan sa edad ng app.",
  "Huwag magbahagi ng mga link sa nakakapinsalang mga site, malware, o mapanirang nilalaman.",
  "Sa paggamit ng tampok na chat, sumasang-ayon ka sa Mga Tuntunin ng Serbisyo at Patakaran sa Privacy ng app. https://bloxfruitscalc.com/privacy-policy/"
]

export const rulesru = [
  "Всегда общайтесь уважительно. Речи ненависти, дискриминация и преследование строго запрещены.",
  "Избегайте распространения оскорбительного, непристойного или неуместного контента, включая текст, изображения или ссылки.",
  "Не делитесь личной, конфиденциальной или чувствительной информацией, такой как номера телефонов, адреса или финансовые данные.",
  "Спам, повторяющиеся сообщения или реклама товаров/услуг без разрешения запрещены.",
  "Если вы заметили неподобающее поведение, используйте инструменты жалоб или блокировки в приложении.",
  "Используйте соответствующий язык в чате. Избегайте оскорбительного или агрессивного тона.",
  "Запрещены обсуждения или действия, продвигающие незаконное или неэтичное поведение.",
  "Пользователи несут ответственность за публикуемый контент и должны соблюдать правила сообщества.",
  "Модераторы имеют право контролировать и применять меры против нарушений, включая предупреждения или блокировки.",
  "Контент должен быть подходящим для всех одобренных возрастных групп, соответствуя требованиям приложения по возрасту.",
  "Не делитесь ссылками на вредоносные сайты, вредоносное ПО или вредоносный контент.",
  "Используя чат, вы соглашаетесь с Условиями использования и Политикой конфиденциальности приложения. https://bloxfruitscalc.com/privacy-policy/"
]
export const rulespt = [
  "Comunique-se sempre com respeito. Discursos de ódio, discriminação e assédio são estritamente proibidos.",
  "Evite compartilhar conteúdo ofensivo, explícito ou inapropriado, incluindo texto, imagens ou links.",
  "Não compartilhe informações pessoais, sensíveis ou confidenciais, como números de telefone, endereços ou dados financeiros.",
  "Spam, envio repetitivo de mensagens ou promoção de produtos/serviços sem permissão não são permitidos.",
  "Se encontrar um comportamento inadequado, utilize as ferramentas de denúncia ou bloqueio disponíveis no aplicativo.",
  "Use uma linguagem apropriada no chat. Evite tons ofensivos ou agressivos.",
  "Discussões ou atividades que promovam comportamentos ilegais ou antiéticos são proibidas.",
  "Os usuários são responsáveis pelo conteúdo que compartilham e devem seguir as diretrizes da comunidade.",
  "Os moderadores têm o direito de monitorar e tomar medidas contra qualquer violação, incluindo advertências ou banimentos.",
  "O conteúdo deve ser adequado para todas as faixas etárias aprovadas, de acordo com os requisitos de idade do aplicativo.",
  "Não compartilhe links para sites prejudiciais, malware ou conteúdos maliciosos.",
  "Ao usar o recurso de chat, você concorda com os Termos de Serviço e a Política de Privacidade do aplicativo. https://bloxfruitscalc.com/privacy-policy/"
]

// export const banUserInChat = async (currentUserId, selectedUser) => {
//   return new Promise((resolve, reject) => {
//     Alert.alert(
//       'Block User',
//       `Are you sure you want to block ${selectedUser.sender || 'this user'}? You will no longer receive messages from them.`,
//       [
//         { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, // User cancels the operation
//         {
//           text: 'Block',
//           style: 'destructive',
//           onPress: async () => {
//             try {
//               const database = getDatabase();
//               const bannedRef = ref(database, `bannedUsers/${currentUserId}/${selectedUser.senderId}`);

//               // Save the banned user's details in the database
//               await set(bannedRef, {
//                 displayName: selectedUser.sender || 'Anonymous',
//                 avatar: selectedUser.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
//               });

//               Alert.alert(
//                 'Success',
//                 `You have successfully blocked ${selectedUser.sender || 'this user'}.`
//               );
//               resolve(true); // Indicate success
//             } catch (error) {
//               console.error('Error blocking user:', error);
//               Alert.alert('Error', 'Could not block the user. Please try again.');
//               reject(error); // Indicate failure with the error
//             }
//           },
//         },
//       ]
//     );
//   });
// };

// export const unbanUserInChat = async (currentUserId, selectedUserId) => {
//   return new Promise((resolve, reject) => {
//     Alert.alert(
//       'Unblock User',
//       'Are you sure you want to unblock this user? You will start receiving messages from them again.',
//       [
//         { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, // User cancels the operation
//         {
//           text: 'Unblock',
//           style: 'destructive',
//           onPress: async () => {
//             try {
//               const database = getDatabase();
//               const bannedRef = ref(database, `bannedUsers/${currentUserId}/${selectedUserId}`);

//               // Remove the banned user's data from the database
//               await remove(bannedRef);

//               Alert.alert('Success', 'You have successfully unblocked this user.');
//               resolve(true); // Indicate success
//             } catch (error) {
//               console.error('Error unblocking user:', error);
//               Alert.alert('Error', 'Could not unblock the user. Please try again.');
//               reject(error); // Indicate failure with the error
//             }
//           },
//         },
//       ]
//     );
//   });
// };







// ✅ Simple cache for online status to reduce Firebase reads (cost optimization)
const onlineStatusCache = new Map(); // userId -> { status: boolean, timestamp: number }
const CACHE_TTL_MS = 10000; // Cache for 10 seconds (reduce redundant reads)

export const isUserOnline = async (userId) => {
  if (!userId) return false; // ✅ Return early if userId is invalid

  // ✅ Check cache first (cost optimization)
  const cached = onlineStatusCache.get(userId);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return cached.status; // ✅ Return cached value (no Firebase read)
  }

  try {
    // ✅ Check presence node (where online status is actually stored - see GlobelStats.js)
    const presenceRef = ref(getDatabase(), `presence/${userId}`);
    const snapshot = await get(presenceRef);

    const status = snapshot.val() ?? false;

    // ✅ Cache the result (cost optimization - reduces duplicate reads)
    onlineStatusCache.set(userId, { status, timestamp: now });

    return status;
  } catch (error) {
    console.error("🔥 Error checking user online status:", error);
    return false; // ✅ Always return a boolean
  }
};

/**
 * Real-time online status hook — uses onValue listener on presence/{userId}.
 * Unlike isUserOnline() which is a one-shot get(), this updates live
 * when the user goes online/offline.
 */
export const useOnlineStatus = (userId) => {
  const [isOnline, setIsOnline] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setIsOnline(false);
        return;
      }

      const presenceRef = ref(getDatabase(), `presence/${userId}`);
      const unsubscribe = onValue(presenceRef, (snapshot) => {
        setIsOnline(snapshot.val() === true);
      }, (error) => {
        console.error('useOnlineStatus listener error:', error);
        setIsOnline(false);
      });

      return () => {
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    }, [userId])
  );

  return isOnline;
};

export const setActiveChat = async (userId, chatId) => {
  const database = getDatabase();
  const activeChatRef = ref(database, `/activeChats/${userId}`);
  const unreadRef = ref(database, `/private_messages/${chatId}/unread/${userId}`);

  try {
    await set(activeChatRef, chatId);
    await set(unreadRef, 0);
    await onDisconnect(activeChatRef).remove();
  } catch (error) {
    console.error(`❌ Failed to set active chat for user ${userId}:`, error);
  }
};





export const clearActiveChat = async (userId) => {
  const database = getDatabase();
  const activeChatRef = ref(database, `/activeChats/${userId}`);

  try {
    await set(activeChatRef, null);
  } catch (error) {
    console.error(`❌ Failed to clear active chat for user ${userId}:`, error);
  }
};

export const setActiveGroupChat = async (userId, groupId) => {
  if (!userId || !groupId) {
    console.error('❌ Invalid userId or groupId for setActiveGroupChat');
    return;
  }

  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    await set(activeGroupRef, true);
    await onDisconnect(activeGroupRef).remove();
  } catch (error) {
    console.error('❌ Failed to set active group chat:', error);
  }
};

export const clearActiveGroupChat = async (userId, groupId) => {
  if (!userId || !groupId) {
    console.error('❌ Invalid userId or groupId for clearActiveGroupChat');
    return;
  }

  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    await set(activeGroupRef, null);
  } catch (error) {
    console.error('❌ Failed to clear active group chat:', error);
  }
};


// Wires `setActiveChat` (+ optionally `setActiveGroupChat`) to both
// navigation focus AND AppState. Without the AppState half, backgrounding
// the app while on a chat screen leaves /activeChats set for the 10–60s
// window before RTDB tears down the socket — and during that window the
// notification CF reads "user is on this chat" and silently drops their
// pushes. With this hook, background → cleared immediately; foreground
// (while still focused) → re-set.
//
// Use:
//   • Private chat:  useActiveChatLifecycle({ userId, chatId: chatKey })
//   • Group chat:    useActiveChatLifecycle({ userId, chatId: groupId, groupId })
//
// onDisconnect is still armed by setActiveChat under the hood as a backstop
// for hard kills / network drops.
export function useActiveChatLifecycle({ userId, chatId, groupId = null }) {
  useFocusEffect(
    useCallback(() => {
      if (!userId || !chatId) return;

      const setAll = () => {
        setActiveChat(userId, chatId);
        if (groupId) setActiveGroupChat(userId, groupId);
      };
      const clearAll = () => {
        clearActiveChat(userId);
        if (groupId) clearActiveGroupChat(userId, groupId);
      };

      setAll();

      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active') setAll();
        else clearAll(); // background / inactive
      });

      return () => {
        sub.remove();
        clearAll();
      };
    }, [userId, chatId, groupId])
  );
}


// Soft-delete the last ~60 messages from a sender in a public-chat room.
// Backed by Supabase via softDeleteMessagesBySender — RTDB writes are no
// longer the source of truth for public chat. Realtime UPDATE events
// drop the rows from any open chat UI within ~1s.
//
// Called from two places:
//   1) Trader.jsx onDeleteAllMessage (per-channel bulk delete)
//   2) banUser flow in this file (ban-and-delete-history)
//
// Signature kept identical to minimize touch — `senderId`, `showAlert`,
// `chatPath` (which was the RTDB path and now also serves as the
// Supabase room_id; they're the same string, e.g. 'chat_new_upgrade').
export const handleDeleteLast300Messages = async (senderId, showAlert = false, chatPath = 'chat_new_upgrade') => {
  if (!senderId) {
    console.error('❌ Invalid senderId for handleDeleteLast300Messages');
    return { success: false, count: 0 };
  }

  try {
    const { count } = await softDeleteMessagesBySender(chatPath, senderId, { limit: 60 });
    if (showAlert && count > 0) {
      Alert.alert('Success', `${count} messages deleted.`);
    }
    return { success: true, count };
  } catch (error) {
    console.error('🔥 Failed to delete messages:', error);
    if (showAlert) {
      Alert.alert('Error', 'Failed to delete messages.');
    }
    return { success: false, count: 0 };
  }
};

// ─── Sanctions ─────────────────────────────────────────────────────────
// Every strike / mute / ban goes to the server by uid (Helper/modSanction.js),
// which writes the email record, the uid ban, device bans and Supabase, and
// enforces the hierarchy (staff immunity, JMD limits). The email-keyed write
// below is only for legacy rows that carry an email but no uid at all; it uses
// the record shape the rules require (contract §3) and the server's
// syncEmailBan carries it to everything else.

/**
 * The target's current strike count — ONE counter for every escalation:
 * banned_uids/{uid}.strikeCount, written by the server for every sanction.
 * The email record is only read for legacy records the server never saw.
 */
export const getCurrentStrikeCount = async (userId, email = null) => {
  const db = getDatabase();
  if (userId) {
    const v = (await get(ref(db, `banned_uids/${userId}/strikeCount`)).catch(() => null))?.val();
    if (typeof v === 'number') return v;
  }
  if (email) {
    const v = (await get(ref(db, `banned_users_by_email/${encodeEmailKey(email)}/strikeCount`)).catch(() => null))?.val();
    if (typeof v === 'number') return v;
  }
  return 0;
};

/**
 * Mute or ban, for every record shape in the wild. New records say `type`.
 * Older ones don't, and a custom mute reason defeats the "Muted for" prefix
 * test (isMuteRecord), so also: old app mutes wrote `bannedBy` as a plain
 * string (+ `bannerAvatar`) while strikes always wrote an object, and the
 * old server wrote mutes with strikeCount 0 (bans are always ≥ 1).
 */
export const isMuteRecordCompat = isMuteRecord; // one rule: Helper/banKeys.js

const isActiveUntil = (until, now = Date.now()) =>
  until === 'permanent' || (typeof until === 'number' && until > now);

const bannerUidOf = (by) => {
  if (by && typeof by === 'object') return by.uid || null;
  return typeof by === 'string' && /^[A-Za-z0-9]{10,128}$/.test(by) ? by : null;
};

/**
 * The target's current sanction, for the mod tools: the server's uid record
 * first, then the email record.
 * @returns {Promise<{active: boolean, type: 'ban'|'mute'|null, strikeCount: number,
 *   bannedUntil: any, reason: string|null, bannedByUid: string|null, bannedByName: string|null,
 *   pendingPermanent: boolean}>} pendingPermanent: a non-admin's strike 3 waiting for an Admin
 */
export const getSanctionStatus = async (userId, email = null) => {
  const db = getDatabase();
  const [uidRec, emailRec] = await Promise.all([
    userId ? get(ref(db, `banned_uids/${userId}`)).then((s) => s.val()).catch(() => null) : null,
    email ? get(ref(db, `banned_users_by_email/${encodeEmailKey(email)}`)).then((s) => s.val()).catch(() => null) : null,
  ]);
  const activeRec = [uidRec, emailRec].find((r) => r && isActiveUntil(r.bannedUntil)) || null;
  const anyRec = activeRec || uidRec || emailRec;
  // Same single counter as getCurrentStrikeCount.
  const strikeCount = typeof uidRec?.strikeCount === 'number' ? uidRec.strikeCount : (emailRec?.strikeCount || 0);
  if (!activeRec) {
    return { active: false, type: null, strikeCount, bannedUntil: null, reason: anyRec?.reason || null, bannedByUid: null, bannedByName: null };
  }
  const by = activeRec.bannedBy;
  return {
    active: true,
    type: isMuteRecordCompat(activeRec) ? 'mute' : 'ban',
    strikeCount,
    bannedUntil: activeRec.bannedUntil,
    reason: activeRec.reason || null,
    bannedByUid: activeRec.bannedByUid || bannerUidOf(by),
    bannedByName: (by && typeof by === 'object' ? by.displayName : null) || null,
    pendingPermanent: activeRec.pendingPermanent === true,
  };
};

// Legacy email-only write (no uid known). Same no-downgrade rule as the
// server; mutes keep the existing strikeCount.
const writeEmailSanction = async ({ action, email, strikeCount, minutes, reason, userInfo = {}, bannerInfo = {} }) => {
  const db = getDatabase();
  const banRef = ref(db, `banned_users_by_email/${encodeEmailKey(email)}`);
  const existing = (await get(banRef).catch(() => null))?.val() || null;
  const now = Date.now();
  const bannedUntil = action === 'mute' ? now + minutes * 60 * 1000 : strikeBannedUntil(strikeCount, now);
  if (existing && isActiveUntil(existing.bannedUntil)) {
    const cur = existing.bannedUntil;
    const stricter = cur === 'permanent' || (bannedUntil !== 'permanent' && typeof cur === 'number' && cur > bannedUntil);
    if (stricter) return { ok: false, error: 'stricter_ban_active' };
  }
  const payload = {
    type: action === 'mute' ? 'mute' : 'ban',
    strikeCount: action === 'mute' ? (existing?.strikeCount || 0) : strikeCount,
    bannedUntil,
    reason: reason || (action === 'mute' ? `Muted for ${minutes} min` : `Strike ${strikeCount}`),
    email: normalizeEmail(email),
    displayName: userInfo?.displayName || existing?.displayName || 'Unknown',
    avatar: userInfo?.avatar || existing?.avatar || null,
    userId: null,
    bannedAt: now,
    bannedBy: bannedByFor(bannerInfo),
  };
  try {
    await set(banRef, payload);
  } catch (e) {
    console.warn('[writeEmailSanction] failed:', e?.message);
    return { ok: false, error: 'internal' };
  }
  if (action !== 'mute') mirrorBanToDevice(payload.email, null, payload).catch(() => {});
  return { ok: true, strikeCount: payload.strikeCount, bannedUntil, viaEmail: true };
};

/**
 * Strike or mute one user. Never throws, never alerts — callers own the UI.
 * With a uid it always goes through the server (which also handles accounts
 * with no email); `email` alone only for legacy rows.
 *
 * @param {{action: 'strike'|'mute', targetUid?: string|null, email?: string|null,
 *   strikeCount?: number, minutes?: number, reason?: string, evidence?: string[],
 *   includeLinked?: boolean, linkedUids?: string[], userInfo?: object,
 *   bannerInfo?: object, deleteMessages?: boolean}} p
 * @returns {Promise<{ok: boolean, error?: string, [k: string]: any}>}
 */
export const applySanction = async ({
  action, targetUid = null, email = null, strikeCount, minutes, reason, evidence,
  includeLinked = false, linkedUids, userInfo = {}, bannerInfo = {}, deleteMessages = true,
}) => {
  if (action !== 'strike' && action !== 'mute') return { ok: false, error: 'bad_action' };
  if (isSelfTargeting(email, targetUid)) return { ok: false, error: 'self_target' };
  if (action === 'strike' && ![1, 2, 3].includes(strikeCount)) return { ok: false, error: 'bad_strike' };
  if (action === 'mute' && !(Number(minutes) >= 1)) return { ok: false, error: 'bad_minutes' };
  const finalReason = (reason || '').trim() ||
    (action === 'mute' ? `Muted for ${minutes} min` : `Strike ${strikeCount}`);

  let r;
  if (targetUid) {
    const opts = { reason: finalReason };
    if (Array.isArray(evidence) && evidence.length) opts.evidence = evidence;
    if (action === 'strike') {
      opts.strikeCount = strikeCount;
      if (includeLinked) {
        opts.includeLinked = true;
        if (Array.isArray(linkedUids)) opts.linkedUids = linkedUids;
      }
    } else {
      opts.minutes = Math.floor(Number(minutes));
    }
    r = await callModSanction(action, targetUid, opts);
  } else if (email) {
    // No uid, so no role flags to read here. syncEmailBan works out the
    // target's rank from the email (owners included) and reverts a write the
    // caller is outranked for; this only applies the caller-side limits.
    const targetRoles = {};
    if (!canSanction(callerRolesFromBanner(bannerInfo), targetRoles)) return { ok: false, error: 'outranked' };
    if (getStaffRank(callerRolesFromBanner(bannerInfo)) === STAFF_RANK.babyMod &&
      (action !== 'mute' || minutes > JMD_MAX_MUTE_MINUTES)) {
      return { ok: false, error: 'rank_limit' };
    }
    r = await writeEmailSanction({ action, email, strikeCount, minutes: Math.floor(Number(minutes)), reason: finalReason, userInfo, bannerInfo });
  } else {
    return { ok: false, error: 'bad_target' };
  }

  // A strike also clears the user's recent public-chat messages.
  if (r.ok && action === 'strike' && deleteMessages && targetUid) {
    handleDeleteLast300Messages(targetUid, false).catch(() => {});
  }
  return r;
};

/**
 * Lift a ban ('unban') or a mute ('unmute') — server only. The server
 * removes the email record, the uid ban, device bans and the Supabase row,
 * and checks the original banner's rank. No direct-write fallback: when the
 * function refuses, the caller shows sanctionErrorText(r.error).
 */
export const liftSanction = async ({ action = 'unban', targetUid, reason }) => {
  if (!targetUid) return { ok: false, error: 'bad_target' };
  if (isSelfTargeting(null, targetUid)) return { ok: false, error: 'self_target' };
  const r = await callModSanction(action === 'unmute' ? 'unmute' : 'unban', targetUid, { reason });
  // Older deployed functions only know 'unban', which lifts a mute too.
  if (!r.ok && action === 'unmute' && r.error === 'bad_action') {
    return callModSanction('unban', targetUid, { reason });
  }
  return r;
};

const confirmAsync = (title, message, okText) => new Promise((resolve) => {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: okText, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) });
});

/**
 * "Ban" = the next strike on the ladder (server counter). Kept for older call
 * sites (PostCard); new UI uses applySanction with a reason prompt.
 * @param {object} [extra] { reason, evidence }
 */
export const banUserwithEmail = async (email, isAdmin = false, senderId = null, userInfo = {}, bannerInfo = {}, showConfirm = false, showAlert = false, extra = {}) => {
  const targetUid = senderId || userInfo?.id || null;
  if (!targetUid && (!email || typeof email !== 'string' || !email.trim())) {
    if (showConfirm || showAlert) Alert.alert('Error', 'This user has no ID or email.');
    return false;
  }
  if (isSelfTargeting(email, targetUid)) {
    if (showConfirm || showAlert) Alert.alert('Permission Denied', 'You cannot ban yourself.');
    return false;
  }

  // UX pre-check only (the server re-checks everything): strict rank plus
  // staff immunity. Legacy callers pass only the `isAdmin` boolean; newer
  // ones stamp full role flags on bannerInfo — union both.
  const callerRoles = callerRolesFromBanner({ ...bannerInfo, isAdmin: !!(isAdmin || bannerInfo?.isAdmin) });
  const targetRoles = await resolveTargetRoles(targetUid, userInfo);
  if (!canSanction(callerRoles, targetRoles) || getStaffRank(callerRoles) === STAFF_RANK.babyMod) {
    if (showConfirm || showAlert) Alert.alert('Permission Denied', 'You cannot ban this user.');
    return false;
  }

  const strikeCount = nextStrikeCount(await getCurrentStrikeCount(targetUid, email));
  const name = userInfo?.displayName || email || 'this user';
  const ladder = { permanentAllowed: getStaffRank(callerRoles) >= STAFF_RANK.admin };
  if (showConfirm) {
    const ok = await confirmAsync('Confirm Ban', `Apply Strike ${strikeCount} (${strikeDurationLabel(strikeCount, ladder)}) to ${name}?`, 'Ban User');
    if (!ok) return false;
  }
  const r = await applySanction({
    action: 'strike', targetUid, email, strikeCount,
    reason: extra?.reason, evidence: extra?.evidence,
    userInfo, bannerInfo: { ...bannerInfo, isAdmin: !!(isAdmin || bannerInfo?.isAdmin) },
  });
  if (!r.ok) {
    if (showConfirm || showAlert) Alert.alert('Error', sanctionErrorText(r.error));
    return false;
  }
  if (showAlert) Alert.alert('User Banned', `Strike ${strikeCount} applied (${strikeDurationLabel(strikeCount, ladder)}).\nUser: ${name}`);
  return true;
};

/**
 * Set a specific strike level (1, 2, or 3) on a user.
 * Strike 1: 3 hours | Strike 2: 3 days | Strike 3: permanent (STRIKE_LADDER;
 * below Admin: 30 days + a permanent-ban request, decided by the server).
 * @param {string} email - User email (only needed when there is no userId)
 * @param {number} strikeCount - 1, 2, or 3
 * @param {string} userId - target uid (preferred: goes through the server)
 * @param {boolean} showAlert - Show success/error alert
 * @param {object} bannerInfo - caller { displayName, avatar, isAdmin, isSeniorMod, isModerator, isBabyMod }
 * @param {object} userInfo - target { displayName, avatar, role flags }
 * @param {boolean} showConfirm
 * @param {string} customReason
 * @param {object} [extra] { evidence }
 */
export const setUserStrike = async (email, strikeCount, userId = null, showAlert = true, bannerInfo = {}, userInfo = {}, showConfirm = true, customReason = null, extra = {}) => {
  if (!userId && (!email || typeof email !== 'string' || !email.trim())) {
    if (showAlert) Alert.alert('Error', 'This user has no ID or email.');
    return false;
  }
  if (![1, 2, 3].includes(strikeCount)) {
    if (showAlert) Alert.alert('Error', 'Invalid strike count. Use 1, 2, or 3.');
    return false;
  }
  if (isSelfTargeting(email, userId)) {
    if (showAlert) Alert.alert('Permission Denied', 'You cannot strike yourself.');
    return false;
  }
  const callerRoles = callerRolesFromBanner(bannerInfo);
  const targetRoles = await resolveTargetRoles(userId, userInfo);
  if (!canSanction(callerRoles, targetRoles) || getStaffRank(callerRoles) === STAFF_RANK.babyMod) {
    if (showAlert || showConfirm) Alert.alert('Permission Denied', 'You cannot strike this user.');
    return false;
  }
  const userName = userInfo?.displayName || userInfo?.userName || email || 'this user';
  const ladder = { permanentAllowed: getStaffRank(callerRoles) >= STAFF_RANK.admin };
  if (showConfirm) {
    const ok = await confirmAsync('Confirm Strike', `Apply Strike ${strikeCount} to ${userName}? This bans them for ${strikeDurationLabel(strikeCount, ladder)}.`, 'Apply Strike');
    if (!ok) return false;
  }
  const r = await applySanction({
    action: 'strike', targetUid: userId, email, strikeCount,
    reason: customReason, evidence: extra?.evidence, userInfo, bannerInfo,
  });
  if (!r.ok) {
    if (showAlert) Alert.alert('Error', sanctionErrorText(r.error));
    return false;
  }
  if (showAlert) Alert.alert('Strike Applied', `Strike ${strikeCount} applied (${strikeDurationLabel(strikeCount, ladder)}).\nUser: ${userName}`);
  return true;
};

/**
 * Lift a ban by email (older call sites). Goes through the server by uid —
 * `extra.uid`, or the userId on the email record. No direct delete.
 * @param {object} [extra] { uid, reason, action: 'unban'|'unmute' }
 */
export const unbanUserWithEmail = async (email, showAlert = true, extra = {}) => {
  let uid = extra?.uid || null;
  if (!uid && email) {
    const v = (await get(ref(getDatabase(), `banned_users_by_email/${encodeEmailKey(email)}/userId`)).catch(() => null))?.val();
    uid = typeof v === 'string' && v ? v : null;
  }
  if (!uid) {
    if (showAlert) Alert.alert('Error', 'This ban record has no user ID, so the server cannot lift it.');
    return false;
  }
  if (isSelfTargeting(email, uid)) {
    if (showAlert) Alert.alert('Permission Denied', 'You cannot unban yourself.');
    return false;
  }
  const r = await liftSanction({ action: extra?.action || 'unban', targetUid: uid, reason: extra?.reason });
  if (!r.ok) {
    if (showAlert) Alert.alert('Error', sanctionErrorText(r.error));
    return false;
  }
  if (showAlert) Alert.alert('User Unbanned', 'Ban has been lifted.');
  return true;
};

/**
 * Hook to check if a user is banned based on their email.
 * Listens to `banned_users_by_email` in real-time.
 *
 * Server-time-validated so a user with a tampered device clock can't be
 * shown as un-banned. See GlobelStats.js for the same pattern on the
 * current-user listener.
 */
export const useBanStatus = (email) => {
  const [isBanned, setIsBanned] = useState(false);
  const [banDetails, setBanDetails] = useState(null);

  useFocusEffect(
    useCallback(() => {
      if (!email) {
        setIsBanned(false);
        setBanDetails(null);
        return;
      }

      const db = getDatabase();
      const banRef = ref(db, `banned_users_by_email/${encodeEmailKey(email)}`);

      let currentBan = null;
      let expiryTimer = null;
      let cancelled = false;

      const evaluate = async () => {
        if (cancelled) return;
        if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }

        const data = currentBan;
        if (!data) {
          setIsBanned(false);
          setBanDetails(null);
          return;
        }
        if (data.bannedUntil === 'permanent') {
          setIsBanned(true);
          setBanDetails(data);
          return;
        }
        if (typeof data.bannedUntil !== 'number') {
          setIsBanned(false);
          setBanDetails(null);
          return;
        }
        const probeUid = getAuth()?.currentUser?.uid || encodeEmailKey(email);
        const serverNow = (await getServerTime(db, probeUid)).getTime();
        if (cancelled) return;
        const remaining = data.bannedUntil - serverNow;
        if (remaining <= 0) {
          setIsBanned(false);
          setBanDetails(null);
          return;
        }
        setIsBanned(true);
        setBanDetails(data);
        expiryTimer = setTimeout(evaluate, Math.min(remaining, 24 * 60 * 60 * 1000));
      };

      const unsubscribe = onValue(banRef, (snapshot) => {
        currentBan = snapshot.exists() ? snapshot.val() : null;
        evaluate();
      });

      return () => {
        cancelled = true;
        if (expiryTimer) clearTimeout(expiryTimer);
        unsubscribe();
      };
    }, [email])
  );

  return { isBanned, banDetails };
};

export const checkBanStatus = async (email) => {
  if (!email) return { isBanned: false };

  try {
    const db = getDatabase();
    const banRef = ref(db, `banned_users_by_email/${encodeEmailKey(email)}`);
    const snap = await get(banRef);

    if (snap.exists()) {
      const data = snap.val();
      const { bannedUntil, strikeCount } = data;

      if (bannedUntil === 'permanent') {
        return { isBanned: true, message: 'You are permanently banned from performing this action.' };
      }

      if (typeof bannedUntil === 'number') {
        // Compare against authoritative server time, not Date.now() — a
        // tampered device clock would otherwise let a banned user slip past.
        const probeUid = getAuth()?.currentUser?.uid || encodeEmailKey(email);
        const serverNow = (await getServerTime(db, probeUid)).getTime();
        if (serverNow < bannedUntil) {
          // Display countdown in device-clock terms (cosmetic). The gate
          // decision above is what enforces the ban.
          const totalMinutes = Math.ceil((bannedUntil - Date.now()) / 60000);
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          const timeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
          return { isBanned: true, message: `You are temporarily banned (Strike ${strikeCount}). Time remaining: ${timeText}.` };
        }
      }
    }
    return { isBanned: false };
  } catch (error) {
    console.error('Error checking ban status:', error);
    return { isBanned: false }; // Fail safe
  }
};

// Make Senior Mod — Admin-only. Senior Mod is one rank below Admin and
// can itself appoint/remove Mods and JMDs (see canManageMod above).
export const makeSeniorMod = async (userId, callerRoles = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  if (!canManageSeniorMod(callerRoles)) {
    Alert.alert('Permission Denied', 'Only Admins can promote Senior Mods.');
    return false;
  }
  if (!(await outranksTarget(userId, callerRoles))) {
    Alert.alert('Permission Denied', 'You cannot change the roles of someone at or above your rank.');
    return false;
  }
  try {
    const db = getDatabase();
    const userRef = ref(db, `users/${userId}`);
    await update(userRef, { isSeniorMod: true, rolesUpdatedAt: Date.now() });
    logModAction('role_change', userId, { role: 'isSeniorMod', value: true });
    Alert.alert('Success', 'User is now a Senior Mod.');
    return true;
  } catch (error) {
    console.error('Error making senior mod:', error);
    Alert.alert('Error', 'Failed to promote user.');
    return false;
  }
};

// Remove Senior Mod — Admin-only.
export const removeSeniorMod = async (userId, callerRoles = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  if (!canManageSeniorMod(callerRoles)) {
    Alert.alert('Permission Denied', 'Only Admins can demote Senior Mods.');
    return false;
  }
  if (!(await outranksTarget(userId, callerRoles))) {
    Alert.alert('Permission Denied', 'You cannot change the roles of someone at or above your rank.');
    return false;
  }
  try {
    const db = getDatabase();
    const userRef = ref(db, `users/${userId}`);
    await update(userRef, { isSeniorMod: false, rolesUpdatedAt: Date.now() });
    logModAction('role_change', userId, { role: 'isSeniorMod', value: false });
    Alert.alert('Success', 'Senior Mod privileges removed.');
    return true;
  } catch (error) {
    console.error('Error removing senior mod:', error);
    Alert.alert('Error', 'Failed to demote user.');
    return false;
  }
};

// Make Moderator — Admin or Senior Mod.
export const makeModerator = async (userId, callerRoles = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  if (!canManageMod(callerRoles)) {
    Alert.alert('Permission Denied', 'Only Admins or Senior Mods can promote Moderators.');
    return false;
  }
  if (!(await outranksTarget(userId, callerRoles))) {
    Alert.alert('Permission Denied', 'You cannot change the roles of someone at or above your rank.');
    return false;
  }
  try {
    const db = getDatabase();
    const userRef = ref(db, `users/${userId}`);
    // rolesUpdatedAt forces the Supabase mirror to run even if the flag value
    // is unchanged (see functions/mirrorUsersToSupabase.js ROLES_KEYS).
    await update(userRef, { isModerator: true, rolesUpdatedAt: Date.now() });
    logModAction('role_change', userId, { role: 'isModerator', value: true });
    Alert.alert('Success', 'User is now a moderator.');
    return true;
  } catch (error) {
    console.error('Error making moderator:', error);
    Alert.alert('Error', 'Failed to promote user.');
    return false;
  }
};

// Remove Moderator — Admin or Senior Mod.
export const removeModerator = async (userId, callerRoles = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  if (!canManageMod(callerRoles)) {
    Alert.alert('Permission Denied', 'Only Admins or Senior Mods can demote Moderators.');
    return false;
  }
  if (!(await outranksTarget(userId, callerRoles))) {
    Alert.alert('Permission Denied', 'You cannot change the roles of someone at or above your rank.');
    return false;
  }
  try {
    const db = getDatabase();
    const userRef = ref(db, `users/${userId}`);
    // The stamp makes a repeat removal a real write so a stale Supabase copy
    // of the role gets re-mirrored instead of living forever.
    await update(userRef, { isModerator: false, rolesUpdatedAt: Date.now() });
    logModAction('role_change', userId, { role: 'isModerator', value: false });
    Alert.alert('Success', 'Moderator privileges removed.');
    return true;
  } catch (error) {
    console.error('Error removing moderator:', error);
    Alert.alert('Error', 'Failed to demote user.');
    return false;
  }
};

// Promote to JMD (BabyMod) — Admin, Senior Mod or Moderator can manage JMDs.
export const makeBabyMod = async (userId, callerRoles = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  if (!canManageBabyMod(callerRoles)) {
    Alert.alert('Permission Denied', 'Only Admins, Senior Mods or Moderators can promote JMDs.');
    return false;
  }
  if (!(await outranksTarget(userId, callerRoles))) {
    Alert.alert('Permission Denied', 'You cannot change the roles of someone at or above your rank.');
    return false;
  }
  try {
    const db = getDatabase();
    await update(ref(db, `users/${userId}`), { isBabyMod: true, rolesUpdatedAt: Date.now() });
    logModAction('role_change', userId, { role: 'isBabyMod', value: true });
    return true;
  } catch (error) {
    console.error('Error promoting JMD:', error);
    Alert.alert('Error', 'Failed to promote user to JMD.');
    return false;
  }
};

// Demote JMD — Admin, Senior Mod or Moderator. The outranksTarget check
// blocks demoting a JMD who has already been upgraded to a real Mod
// (canManageBabyMod doesn't cover Mods, so without it a Mod could clear a
// peer Mod's — or an Admin's — JMD flag).
export const removeBabyMod = async (userId, callerRoles = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  if (!canManageBabyMod(callerRoles)) {
    Alert.alert('Permission Denied', 'Only Admins, Senior Mods or Moderators can remove JMDs.');
    return false;
  }
  if (!(await outranksTarget(userId, callerRoles))) {
    Alert.alert('Permission Denied', 'You cannot change the roles of someone at or above your rank.');
    return false;
  }
  try {
    const db = getDatabase();
    await update(ref(db, `users/${userId}`), { isBabyMod: null, rolesUpdatedAt: Date.now() });
    logModAction('role_change', userId, { role: 'isBabyMod', value: false });
    return true;
  } catch (error) {
    console.error('Error removing JMD:', error);
    Alert.alert('Error', 'Failed to remove JMD status.');
    return false;
  }
};

// ========== Read Receipts (lastRead) ==========

/**
 * Update lastRead timestamp for the current user in a private chat.
 * Called when user enters or is actively viewing the chat.
 *
 * Cost note: this fires once per incoming partner message while the chat
 * is open, and each call used to be an unthrottled RTDB set(). We COALESCE
 * (pattern from adoptme-jan7): write immediately on the leading edge (the
 * blue tick still feels instant), suppress repeats within a short window,
 * and write once more on the trailing edge if any were suppressed — rapid
 * bursts collapse from N writes to 2. Keyed per-chat so two conversations
 * don't share a window. Storage stays on the same RTDB path existing
 * builds read/listen on — only the write FREQUENCY changes, so this is
 * fully backward compatible.
 */
const LAST_READ_DEBOUNCE_MS = 4000;
const _lastReadTimers = new Map();   // chatKey -> timeout id (window open)
const _lastReadPending = new Map();  // chatKey -> bool (calls suppressed in window)

const _fireLastRead = async (chatKey, userId) => {
  try {
    const db = getDatabase();
    const lastReadRef = ref(db, `private_messages/${chatKey}/lastRead/${userId}`);
    await set(lastReadRef, Date.now());
  } catch (error) {
    console.warn('updateLastRead error:', error?.message);
  }
};

export const updateLastRead = (chatKey, userId) => {
  if (!chatKey || !userId) return;
  if (!_lastReadTimers.has(chatKey)) {
    // Leading edge: write now, open a coalescing window.
    _fireLastRead(chatKey, userId);
    _lastReadPending.set(chatKey, false);
    _lastReadTimers.set(chatKey, setTimeout(() => {
      _lastReadTimers.delete(chatKey);
      const hadPending = _lastReadPending.get(chatKey);
      _lastReadPending.delete(chatKey);
      if (hadPending) _fireLastRead(chatKey, userId); // trailing edge
    }, LAST_READ_DEBOUNCE_MS));
  } else {
    // Within the window — mark that a trailing write is owed.
    _lastReadPending.set(chatKey, true);
  }
};

/**
 * Flush any owed lastRead write immediately and close the window. Call on
 * chat blur/unmount so the final read receipt lands promptly instead of
 * waiting out the debounce. No-op if nothing is pending.
 */
export const flushLastRead = (chatKey, userId) => {
  if (!chatKey || !userId) return;
  const timer = _lastReadTimers.get(chatKey);
  if (timer) {
    clearTimeout(timer);
    _lastReadTimers.delete(chatKey);
  }
  const hadPending = _lastReadPending.get(chatKey);
  _lastReadPending.delete(chatKey);
  if (hadPending) _fireLastRead(chatKey, userId);
};

/**
 * Hook: listen to the OTHER user's lastRead timestamp.
 * Returns a timestamp (number) or 0 if not yet read.
 */
export const useOtherLastRead = (chatKey, otherUserId) => {
  const [lastRead, setLastRead] = useState(0);

  useEffect(() => {
    if (!chatKey || !otherUserId) {
      setLastRead(0);
      return;
    }

    const db = getDatabase();
    const lastReadRef = ref(db, `private_messages/${chatKey}/lastRead/${otherUserId}`);

    const unsubscribe = onValue(lastReadRef, (snapshot) => {
      setLastRead(snapshot.exists() ? (Number(snapshot.val()) || 0) : 0);
    }, (error) => {
      console.warn('useOtherLastRead listener error:', error?.message);
      setLastRead(0);
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [chatKey, otherUserId]);

  return lastRead;
};

// ✅ Mute user for X minutes (chat only; keeps the strike count). Kept for
// older call sites; goes through the server by uid like applySanction.
// @param {object} [extra] { evidence }
export const muteUser = async (email, minutes, userInfo = null, bannerInfo = null, showAlert = true, customReason = null, extra = {}) => {
  const targetUid = userInfo?.id || null;
  if (!targetUid && (!email || typeof email !== 'string' || !email.trim())) {
    if (showAlert) Alert.alert('Error', 'This user has no ID or email.');
    return false;
  }
  if (!minutes || minutes < 1) {
    if (showAlert) Alert.alert('Error', 'Mute duration must be at least 1 minute.');
    return false;
  }
  // ✅ Self-target guard: blocks the JMD "self-mute → reset" trick.
  if (isSelfTargeting(email, targetUid)) {
    if (showAlert) Alert.alert('Permission Denied', 'You cannot mute yourself.');
    return false;
  }
  // UX pre-check (the server re-checks): strict rank, staff targets, JMD ≤ 1 day.
  const callerRoles = callerRolesFromBanner(bannerInfo);
  const targetRoles = await resolveTargetRoles(targetUid, userInfo || {});
  const perms = getModPermissions(callerRoles, targetRoles);
  if (!perms.canMute) {
    if (showAlert) Alert.alert('Permission Denied', 'You cannot mute this user.');
    return false;
  }
  if (perms.maxMuteMinutes && minutes > perms.maxMuteMinutes) {
    if (showAlert) Alert.alert('Permission Denied', sanctionErrorText('rank_limit'));
    return false;
  }
  const r = await applySanction({
    action: 'mute', targetUid, email, minutes,
    reason: customReason, evidence: extra?.evidence,
    userInfo: userInfo || {}, bannerInfo: bannerInfo || {},
  });
  if (!r.ok) {
    if (showAlert) Alert.alert('Error', sanctionErrorText(r.error));
    return false;
  }
  if (showAlert) {
    Alert.alert('User Muted', `Muted for ${minutes} minute${minutes !== 1 ? 's' : ''}.`);
  }
  return true;
};
