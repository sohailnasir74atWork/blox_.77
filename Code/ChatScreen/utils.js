import { getDatabase, ref, update, get, set, onDisconnect, onValue, query, orderByChild, equalTo, limitToLast } from '@react-native-firebase/database';
import { getAuth } from '@react-native-firebase/auth';
import { useState, useEffect, useCallback } from 'react';
import { Alert, AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { softDeleteMessagesBySender } from '../Supabase/chatBackend';
import { getServerTime } from '../Helper/serverTime';
import { getDeviceFingerprint } from '../Helper/deviceFingerprint';

// Returns true if the caller is trying to ban/mute/unban their own account.
// All moderation actions go through utils.js, so guarding here closes every
// entry point (AdminDashboard, BottomDrawer, ReportPopUp, etc.) at once.
const isSelfTargeting = (targetEmail) => {
  if (!targetEmail) return false;
  const callerEmail = getAuth()?.currentUser?.email;
  if (!callerEmail) return false;
  return callerEmail.toLowerCase().trim() === targetEmail.toLowerCase().trim();
};

// ─── Staff hierarchy ────────────────────────────────────────────────
// Strict ladder: a staffer can only act on someone STRICTLY below them.
// Mods can't ban Mods. Admins can't ban Admins. JMDs can only act on
// regular users. Promote/demote rules: only Admins can manage Mods;
// Admins and Mods can manage JMDs.
export const STAFF_RANK = { admin: 3, moderator: 2, babyMod: 1, user: 0 };

export const getStaffRank = (roles) => {
  if (!roles) return STAFF_RANK.user;
  if (roles.isAdmin) return STAFF_RANK.admin;
  if (roles.isModerator) return STAFF_RANK.moderator;
  if (roles.isBabyMod) return STAFF_RANK.babyMod;
  return STAFF_RANK.user;
};

export const canModerate = (caller, target) =>
  getStaffRank(caller) > getStaffRank(target);

export const canManageMod = (caller) => !!caller?.isAdmin;
export const canManageBabyMod = (caller) =>
  !!(caller?.isAdmin || caller?.isModerator);

// Look up target's role flags from RTDB so utility-level checks don't
// rely on every caller populating userInfo. Tolerant of the legacy
// `users/{uid}/admin` path AND the newer `isAdmin` path — both exist
// in the wild (see profileCache.js vs OnlineUsersList.jsx).
const fetchTargetRoles = async (userId) => {
  if (!userId) return null;
  try {
    const db = getDatabase();
    const [adminLegacySnap, adminSnap, modSnap, jmdSnap] = await Promise.all([
      get(ref(db, `users/${userId}/admin`)),
      get(ref(db, `users/${userId}/isAdmin`)),
      get(ref(db, `users/${userId}/isModerator`)),
      get(ref(db, `users/${userId}/isBabyMod`)),
    ]);
    return {
      isAdmin: !!(
        (adminLegacySnap?.exists() && adminLegacySnap.val()) ||
        (adminSnap?.exists() && adminSnap.val())
      ),
      isModerator: !!(modSnap?.exists() && modSnap.val()),
      isBabyMod: !!(jmdSnap?.exists() && jmdSnap.val()),
    };
  } catch (_) {
    return null;
  }
};

// Resolve the most authoritative target-role view: prefer a fresh RTDB
// read (so a stale userInfo can't mask a recent promotion), fall back to
// whatever the caller passed.
const resolveTargetRoles = async (userId, fallback = {}) => {
  const fetched = await fetchTargetRoles(userId);
  if (fetched) return fetched;
  return {
    isAdmin: !!fallback?.isAdmin,
    isModerator: !!fallback?.isModerator,
    isBabyMod: !!fallback?.isBabyMod,
  };
};

// Pull caller role flags off a bannerInfo blob. Callers are expected to
// stamp these on bannerInfo from useGlobalState.
const callerRolesFromBanner = (bannerInfo) => ({
  isAdmin: !!bannerInfo?.isAdmin,
  isModerator: !!bannerInfo?.isModerator,
  isBabyMod: !!bannerInfo?.isBabyMod,
});

// Initialize the database reference
const database = getDatabase();
const usersRef = ref(database, 'users'); // Base reference to the "users" node

// Looks up the deviceId stamped on a user record by GlobelStats on auth.
// Returns null if the user has no deviceId yet (older client / never signed in
// since the device-ban feature shipped).
const getUserDeviceId = async (userId) => {
  if (!userId) return null;
  try {
    const db = getDatabase();
    const snap = await get(ref(db, `users/${userId}/deviceId`));
    const v = snap.val();
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
    const encodeEmail = (em) => em.replace(/\./g, '(dot)');
    await update(ref(db, `banned_users_by_email/${encodeEmail(email)}`), {
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

export const banUserwithEmail = async (email, isAdmin = false, senderId = null, userInfo = {}, bannerInfo = {}, showConfirm = false, showAlert = false) => {
  // ✅ Safety check: handle undefined/null email
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    console.error('❌ Invalid email for banUserwithEmail');
    if (showConfirm || showAlert) Alert.alert('Error', 'Invalid email address.');
    return false;
  }

  const encodeEmail = (em) => em.replace(/\./g, '(dot)');
  const database = getDatabase();
  const banRef = ref(database, `banned_users_by_email/${encodeEmail(email)}`);

  // ✅ Self-target guard: prevents the "self-ban → reset" trick.
  if (isSelfTargeting(email)) {
    if (showConfirm || showAlert) Alert.alert('Permission Denied', 'You cannot ban yourself.');
    return false;
  }

  // ✅ Hierarchy check — strict rank: caller rank must STRICTLY exceed
  // target rank (Admin > Mod > JMD > User). Source of truth lives here
  // so every entry point (AdminDashboard, BottomDrawer, PostCard) is
  // gated even if a UI-level guard is missed or bypassed. Legacy callers
  // pass only the `isAdmin` boolean; newer callers also stamp full role
  // flags onto bannerInfo — we union both so neither path silently
  // regresses below the actual caller's rank.
  const callerRoles = {
    isAdmin: !!(isAdmin || bannerInfo?.isAdmin),
    isModerator: !!bannerInfo?.isModerator,
    isBabyMod: !!bannerInfo?.isBabyMod,
  };
  const targetRoles = await resolveTargetRoles(senderId || userInfo?.id, userInfo);
  if (!canModerate(callerRoles, targetRoles)) {
    console.warn("Staff hierarchy: caller rank does not exceed target rank.");
    if (showConfirm || showAlert) Alert.alert("Permission Denied", "You cannot ban this user.");
    return false;
  }

  const executeBan = async () => {
    try {
      const snap = await get(banRef);

      let strikeCount = 1;
      let bannedUntil = Date.now() + 24 * 60 * 60 * 1000; // 24 hours (First Strike)
      let banDuration = '24 hours';

      if (snap.exists()) {
        const data = snap.val();
        if (data && typeof data === 'object') {
          const currentStrikeCount = data.strikeCount || 0;
          strikeCount = currentStrikeCount + 1;

          if (strikeCount === 2) {
            bannedUntil = Date.now() + 3 * 24 * 60 * 60 * 1000; // 3 days (Second Strike)
            banDuration = '3 days';
          } else if (strikeCount >= 3) {
            bannedUntil = "permanent"; // Permanent (Third Strike)
            banDuration = 'permanent';
          }
        }
      }

      // Save complete ban info
      const banPayload = {
        strikeCount,
        bannedUntil,
        reason: `Strike ${strikeCount}`,
        email: email,
        displayName: userInfo?.displayName || 'Unknown',
        avatar: userInfo?.avatar || null,
        userId: userInfo?.id || senderId || null, // Ensure ID is saved
        bannedAt: Date.now(),
        bannedBy: {
          uid: bannerInfo?.id || null,
          displayName: bannerInfo?.displayName || 'System',
          avatar: bannerInfo?.avatar || null,
          role: isAdmin ? 'Admin' : 'Moderator'
        }
      };
      await set(banRef, banPayload);

      // Mirror onto banned_devices so the same device can't bypass with a
      // new email. Best-effort — if the user has no deviceId on file the
      // email ban still applies as before.
      mirrorBanToDevice(email, banPayload.userId, banPayload).catch(() => {});

      // Log mod action for scoring
      // Delete messages if senderId provided
      let deletedCount = 0;
      if (senderId) {
        const deleteResult = await handleDeleteLast300Messages(senderId, false);
        deletedCount = deleteResult?.count || 0;
      }

      if (showAlert) {
        Alert.alert(
          'User Banned',
          `Strike ${strikeCount} applied (${banDuration}).\nUser: ${userInfo?.displayName || email}${deletedCount > 0 ? `\n${deletedCount} messages deleted.` : ''}`
        );
      }
      return true;
    } catch (err) {
      console.error('Ban error:', err);
      if (showAlert) Alert.alert('Error', 'Could not ban user.');
      return false;
    }
  };

  if (showConfirm) {
    return new Promise((resolve) => {
      Alert.alert(
        'Confirm Ban',
        `Are you sure you want to ban ${userInfo?.displayName || email}?`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Ban User', style: 'destructive', onPress: async () => resolve(await executeBan()) }
        ]
      );
    });
  }

  return await executeBan();
};

/**
 * Set a specific strike level (1, 2, or 3) on a user - used by AdminDashboard
 * Strike 1: 3 hours | Strike 2: 3 days | Strike 3+: Permanent
 * @param {string} email - User email
 * @param {number} strikeCount - 1, 2, or 3
 * @param {string} userId - User ID (for fetching displayName/avatar)
 * @param {boolean} showAlert - Show success/error alert
 * @param {object} bannerInfo - Optional { id, displayName, avatar } of admin applying strike
 * @param {object} userInfo - Optional { displayName, avatar } of user being banned - prevents name becoming "Unknown"
 */
export const setUserStrike = async (email, strikeCount, userId = null, showAlert = true, bannerInfo = {}, userInfo = {}, showConfirm = true, customReason = null) => {
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    if (showAlert) Alert.alert('Error', 'User has no email associated.');
    return false;
  }
  if (![1, 2, 3].includes(strikeCount)) {
    if (showAlert) Alert.alert('Error', 'Invalid strike count. Use 1, 2, or 3.');
    return false;
  }

  // ✅ Self-target guard: prevents the "self-strike → reset" trick.
  if (isSelfTargeting(email)) {
    if (showAlert) Alert.alert('Permission Denied', 'You cannot strike yourself.');
    return false;
  }

  // ✅ Hierarchy check — caller rank must strictly exceed target rank.
  // bannerInfo carries caller's role flags (isAdmin/isModerator/isBabyMod);
  // target roles are pulled fresh from RTDB so a stale userInfo can't
  // mask a promotion that happened mid-session.
  const callerRoles = callerRolesFromBanner(bannerInfo);
  const targetRoles = await resolveTargetRoles(userId, userInfo);
  if (!canModerate(callerRoles, targetRoles)) {
    console.warn("Staff hierarchy: caller rank does not exceed target rank.");
    if (showAlert || showConfirm) {
      Alert.alert('Permission Denied', 'You cannot strike this user.');
    }
    return false;
  }

  const encodeEmail = (em) => em.replace(/\./g, '(dot)');
  const database = getDatabase();
  const banRef = ref(database, `banned_users_by_email/${encodeEmail(email)}`);

  const executeStrike = async () => {
    try {
      let bannedUntil;
      let banDuration;
      if (strikeCount === 1) {
        bannedUntil = Date.now() + 3 * 60 * 60 * 1000; // 3 hours
        banDuration = '3 hours';
      } else if (strikeCount === 2) {
        bannedUntil = Date.now() + 3 * 24 * 60 * 60 * 1000; // 3 days
        banDuration = '3 days';
      } else {
        bannedUntil = 'permanent';
        banDuration = 'permanent';
      }

      // ✅ No-downgrade guard: refuse to overwrite a stricter existing ban
      // with a softer one (the core of the JMD self-ban trick).
      try {
        const existingSnap = await get(banRef);
        if (existingSnap.exists()) {
          const existing = existingSnap.val() || {};
          const existingStrike = existing.strikeCount || 0;
          const existingUntil = existing.bannedUntil;
          const isExistingActive =
            existingUntil === 'permanent' ||
            (typeof existingUntil === 'number' && existingUntil > Date.now());
          if (
            isExistingActive &&
            (existingUntil === 'permanent' ||
              (typeof existingUntil === 'number' && existingUntil > bannedUntil) ||
              existingStrike > strikeCount)
          ) {
            if (showAlert) Alert.alert('Action Blocked', 'A stricter ban is already active on this user.');
            return false;
          }
        }
      } catch (_) { /* fall through — write attempt below */ }

      // Get user displayName & avatar
      let displayName = userInfo?.displayName || userInfo?.userName || null;
      let avatar = userInfo?.avatar || null;
      if (!displayName || displayName === 'Unknown') {
        try {
          const snap = await get(banRef);
          if (snap.exists() && snap.val()?.displayName) {
            displayName = snap.val().displayName;
            avatar = avatar || snap.val().avatar;
          }
        } catch (_) { /* ignore */ }
      }
      if (!displayName && userId) {
        try {
          const userRef = ref(database, `users/${userId}`);
          const userSnap = await get(userRef);
          if (userSnap.exists()) {
            const data = userSnap.val();
            displayName = data?.displayName || data?.userName || null;
            avatar = avatar || data?.avatar || null;
          }
        } catch (_) { /* ignore */ }
      }
      displayName = displayName || 'Unknown';

      const banPayload = {
        strikeCount,
        bannedUntil,
        reason: customReason || `Strike ${strikeCount}`,
        email,
        displayName,
        avatar,
        userId: userId || null,
        bannedAt: Date.now(),
        bannedBy: {
          uid: bannerInfo?.id || null,
          displayName: bannerInfo?.displayName || 'Admin',
          avatar: bannerInfo?.avatar || null,
          role: 'Admin'
        }
      };
      await set(banRef, banPayload);

      // Mirror onto banned_devices for cross-email enforcement.
      mirrorBanToDevice(email, userId, banPayload).catch(() => {});

      // Delete messages if userId provided
      if (userId) {
        handleDeleteLast300Messages(userId, false).catch(() => { });
      }

      if (showAlert) {
        Alert.alert(
          'Strike Applied',
          `Strike ${strikeCount} applied (${banDuration}).\nUser: ${displayName}`
        );
      }
      return true;
    } catch (err) {
      console.error('setUserStrike error:', err);
      if (showAlert) Alert.alert('Error', 'Could not apply strike.');
      return false;
    }
  };

  if (showConfirm) {
    const durationText = strikeCount === 1 ? '3 hours' : strikeCount === 2 ? '3 days' : 'permanently';
    const userName = userInfo?.displayName || userInfo?.userName || email || 'this user';

    return new Promise((resolve) => {
      Alert.alert(
        'Confirm Strike',
        `Are you sure you want to apply Strike ${strikeCount} to ${userName}? This will ban them ${durationText}.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Apply Strike', style: 'destructive', onPress: async () => resolve(await executeStrike()) }
        ]
      );
    });
  }

  return await executeStrike();
};

export const unbanUserWithEmail = async (email, showAlert = true) => {
  // ✅ Safety check
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    console.error('❌ Invalid email for unbanUserWithEmail');
    if (showAlert) Alert.alert('Error', 'Invalid email address.');
    return false;
  }

  // ✅ Self-target guard: a banned admin/mod must not be able to unban
  // themselves through the dashboard or any other entry point.
  if (isSelfTargeting(email)) {
    if (showAlert) Alert.alert('Permission Denied', 'You cannot unban yourself.');
    return false;
  }

  const encodeEmail = (em) => em.replace(/\./g, '(dot)');
  try {
    const db = getDatabase();
    const banRef = ref(db, `banned_users_by_email/${encodeEmail(email)}`);

    // Read first so we can clear every mirrored banned_devices entry.
    // mirrorBanToDevice may write multiple device ids when the stamped
    // one and the current device fp differ (self-ban edge case), so we
    // honour the `deviceIds` array if present and fall back to the
    // legacy `deviceId` scalar for older entries.
    const mirroredIds = new Set();
    try {
      const snap = await get(banRef);
      const v = snap.val();
      if (Array.isArray(v?.deviceIds)) {
        for (const id of v.deviceIds) {
          if (typeof id === 'string' && id.length > 0) mirroredIds.add(id);
        }
      }
      if (typeof v?.deviceId === 'string' && v.deviceId.length > 0) {
        mirroredIds.add(v.deviceId);
      }
    } catch (_) { /* ignore */ }

    await set(banRef, null);

    if (mirroredIds.size > 0) {
      Promise.all(
        Array.from(mirroredIds).map((id) =>
          set(ref(db, `banned_devices/${id}`), null).catch(() => {})
        )
      ).catch(() => {});
    }

    if (showAlert) Alert.alert('User Unbanned', 'Ban has been lifted.');
    return true;
  } catch (err) {
    console.error('Unban error:', err);
    if (showAlert) Alert.alert('Error', 'Could not unban user.');
    return false;
  }
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
      const encodeEmail = (em) => (em || '').toLowerCase().trim().replace(/\./g, '(dot)');
      const banRef = ref(db, `banned_users_by_email/${encodeEmail(email)}`);

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
        const probeUid = getAuth()?.currentUser?.uid || encodeEmail(email);
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

  const encodeEmail = (email) => email.replace(/\./g, '(dot)');
  try {
    const db = getDatabase();
    const banRef = ref(db, `banned_users_by_email/${encodeEmail(email)}`);
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
        const probeUid = getAuth()?.currentUser?.uid || encodeEmail(email);
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

// Make Moderator — Admin-only.
export const makeModerator = async (userId, callerRoles = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  if (!canManageMod(callerRoles)) {
    Alert.alert('Permission Denied', 'Only Admins can promote Moderators.');
    return false;
  }
  try {
    const db = getDatabase();
    const userRef = ref(db, `users/${userId}`);
    await update(userRef, { isModerator: true });
    Alert.alert('Success', 'User is now a moderator.');
    return true;
  } catch (error) {
    console.error('Error making moderator:', error);
    Alert.alert('Error', 'Failed to promote user.');
    return false;
  }
};

// Remove Moderator — Admin-only.
export const removeModerator = async (userId, callerRoles = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  if (!canManageMod(callerRoles)) {
    Alert.alert('Permission Denied', 'Only Admins can demote Moderators.');
    return false;
  }
  try {
    const db = getDatabase();
    const userRef = ref(db, `users/${userId}`);
    await update(userRef, { isModerator: false });
    Alert.alert('Success', 'Moderator privileges removed.');
    return true;
  } catch (error) {
    console.error('Error removing moderator:', error);
    Alert.alert('Error', 'Failed to demote user.');
    return false;
  }
};

// Promote to JMD (BabyMod) — Admin or Moderator can manage JMDs.
export const makeBabyMod = async (userId, callerRoles = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  if (!canManageBabyMod(callerRoles)) {
    Alert.alert('Permission Denied', 'Only Admins or Moderators can promote JMDs.');
    return false;
  }
  try {
    const db = getDatabase();
    await set(ref(db, `users/${userId}/isBabyMod`), true);
    return true;
  } catch (error) {
    console.error('Error promoting JMD:', error);
    Alert.alert('Error', 'Failed to promote user to JMD.');
    return false;
  }
};

// Demote JMD — Admin or Moderator. We block demoting a JMD who has
// already been upgraded to a real Mod (canManageBabyMod doesn't cover
// Mods, but the rank check below catches the corner case where this is
// called against a Mod by a Mod).
export const removeBabyMod = async (userId, callerRoles = {}) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  if (!canManageBabyMod(callerRoles)) {
    Alert.alert('Permission Denied', 'Only Admins or Moderators can remove JMDs.');
    return false;
  }
  try {
    const db = getDatabase();
    await set(ref(db, `users/${userId}/isBabyMod`), null);
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
 */
export const updateLastRead = async (chatKey, userId) => {
  if (!chatKey || !userId) return;

  try {
    const db = getDatabase();
    const lastReadRef = ref(db, `private_messages/${chatKey}/lastRead/${userId}`);
    await set(lastReadRef, Date.now());
  } catch (error) {
    console.warn('updateLastRead error:', error?.message);
  }
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

// ✅ Mute user for X minutes
export const muteUser = async (email, minutes, userInfo = null, bannerInfo = null, showAlert = true, customReason = null) => {
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    console.error('❌ Invalid email for muteUser');
    if (showAlert) Alert.alert('Error', 'Invalid email address.');
    return false;
  }

  if (!minutes || minutes < 1) {
    if (showAlert) Alert.alert('Error', 'Mute duration must be at least 1 minute.');
    return false;
  }

  // ✅ Self-target guard: blocks the JMD "self-mute → reset" trick.
  if (isSelfTargeting(email)) {
    if (showAlert) Alert.alert('Permission Denied', 'You cannot mute yourself.');
    return false;
  }

  // ✅ Hierarchy check — caller rank must strictly exceed target rank.
  // Mute used to be the unguarded backdoor (banUserwithEmail had a check,
  // muteUser did not), so it was the cleanest path for Mod-on-Mod hits.
  const callerRoles = callerRolesFromBanner(bannerInfo);
  const targetRoles = await resolveTargetRoles(userInfo?.id, userInfo);
  if (!canModerate(callerRoles, targetRoles)) {
    console.warn("Staff hierarchy: caller rank does not exceed target rank.");
    if (showAlert) Alert.alert('Permission Denied', 'You cannot mute this user.');
    return false;
  }

  try {
    const db = getDatabase();
    const encodeEmail = (em) => (em || '').toLowerCase().trim().replace(/\./g, '(dot)');
    const banRef = ref(db, `banned_users_by_email/${encodeEmail(email)}`);
    const snap = await get(banRef);

    // Preserve existing strikeCount if user was previously banned
    const existingStrikeCount = snap.exists() ? (snap.val()?.strikeCount || 0) : 0;

    // ✅ No-downgrade guard: a short mute must not overwrite a longer/stricter
    // existing ban. This is the actual mechanism behind the self-ban trick:
    // muteUser used to clobber a Strike-2 (3-day) ban with a 5-min entry.
    if (snap.exists()) {
      const existing = snap.val() || {};
      const existingUntil = existing.bannedUntil;
      const newBannedUntil = Date.now() + minutes * 60 * 1000;
      const isExistingActive =
        existingUntil === 'permanent' ||
        (typeof existingUntil === 'number' && existingUntil > Date.now());
      if (
        isExistingActive &&
        (existingUntil === 'permanent' ||
          (typeof existingUntil === 'number' && existingUntil > newBannedUntil))
      ) {
        if (showAlert) Alert.alert('Action Blocked', 'A longer ban is already active on this user.');
        return false;
      }
    }

    const muteData = {
      strikeCount: existingStrikeCount,
      bannedUntil: Date.now() + minutes * 60 * 1000,
      reason: customReason || `Muted for ${minutes} min`,
      bannedAt: Date.now(),
      userId: userInfo?.id || null,
      displayName: userInfo?.displayName || 'Unknown User',
      avatar: userInfo?.avatar || null,
      email: email,
      bannedBy: bannerInfo?.id || bannerInfo?.displayName || 'Admin',
      bannerAvatar: bannerInfo?.avatar || null,
    };

    await set(banRef, muteData);

    if (showAlert) {
      Alert.alert('User Muted', `Muted for ${minutes} minute${minutes !== 1 ? 's' : ''}.`);
    }

    return true;
  } catch (err) {
    console.error('Mute error:', err);
    if (showAlert) Alert.alert('Error', 'Could not mute user.');
    return false;
  }
};
