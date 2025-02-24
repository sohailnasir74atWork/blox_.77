import { getDatabase, ref, update, get, query, orderByChild, remove, set, orderByKey, onDisconnect } from '@react-native-firebase/database';
import { Alert } from 'react-native';
import { developmentMode } from '../Ads/ads';
import { useTranslation } from 'react-i18next';

// Initialize the database reference
const database = getDatabase();
const usersRef = ref(database, 'users'); // Base reference to the "users" node

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
    const database = getDatabase(); // Ensure database instance is created
    const userToUpdateRef = ref(database, `users/${userId}`); // Reference to the specific user in the "users" node
    await update(userToUpdateRef, { isBlock: true }); // Update the user's `isBlock` property
    Alert.alert('Success', 'User has been banned.');
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

export const rulesde  = [
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


  export const rulesvi  = [
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

  export const rulesid  = [
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

  export const rulesfr  = [
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

   export const rulesfil  = [
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

   export const rulesru  = [
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







// export const isUserOnline = async (userId) => {
//   if (!userId) {
//     return false; // If no user ID is provided, return false
//   }

//   const database = getDatabase();
//   const userRef = ref(database, `users/${userId}/online`);

//   try {
//     const snapshot = await get(userRef);
//     if (snapshot.exists()) {
//       const userStatus = snapshot.val();
//       return userStatus?.status === true; // Return true if status is true
//     }
//     return false; // If no data exists, the user is offline
//   } catch (error) {
//     console.error('Error checking user status:', error);
//     return false; // Return false in case of an error
//   }
// };
export const setActiveChat = async (userId, chatId) => {
  const database = getDatabase();
  const activeChatRef = ref(database, `/activeChats/${userId}`);
  const unreadRef = ref(database, `/private_chat_new/${chatId}/unread/${userId}`);

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
