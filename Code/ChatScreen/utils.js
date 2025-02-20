import { getDatabase, ref, update, get, query, orderByChild, remove, set, orderByKey, onDisconnect } from '@react-native-firebase/database';
import { Alert } from 'react-native';
import { developmentMode } from '../Ads/ads';

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
export const rules = [
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


export const banUserInChat = async (currentUserId, selectedUser) => {
  return new Promise((resolve, reject) => {
    Alert.alert(
      'Block User',
      `Are you sure you want to block ${selectedUser.sender || 'this user'}? You will no longer receive messages from them.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, // User cancels the operation
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              const database = getDatabase();
              const bannedRef = ref(database, `bannedUsers/${currentUserId}/${selectedUser.senderId}`);

              // Save the banned user's details in the database
              await set(bannedRef, {
                displayName: selectedUser.sender || 'Anonymous',
                avatar: selectedUser.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
              });

              Alert.alert(
                'Success',
                `You have successfully blocked ${selectedUser.sender || 'this user'}.`
              );
              resolve(true); // Indicate success
            } catch (error) {
              console.error('Error blocking user:', error);
              Alert.alert('Error', 'Could not block the user. Please try again.');
              reject(error); // Indicate failure with the error
            }
          },
        },
      ]
    );
  });
};

export const unbanUserInChat = async (currentUserId, selectedUserId) => {
  return new Promise((resolve, reject) => {
    Alert.alert(
      'Unblock User',
      'Are you sure you want to unblock this user? You will start receiving messages from them again.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, // User cancels the operation
        {
          text: 'Unblock',
          style: 'destructive',
          onPress: async () => {
            try {
              const database = getDatabase();
              const bannedRef = ref(database, `bannedUsers/${currentUserId}/${selectedUserId}`);

              // Remove the banned user's data from the database
              await remove(bannedRef);

              Alert.alert('Success', 'You have successfully unblocked this user.');
              resolve(true); // Indicate success
            } catch (error) {
              console.error('Error unblocking user:', error);
              Alert.alert('Error', 'Could not unblock the user. Please try again.');
              reject(error); // Indicate failure with the error
            }
          },
        },
      ]
    );
  });
};







export const isUserOnline = async (userId) => {
  if (!userId) {
    return false; // If no user ID is provided, return false
  }

  const database = getDatabase();
  const userRef = ref(database, `users/${userId}/online`);

  try {
    const snapshot = await get(userRef);
    if (snapshot.exists()) {
      const userStatus = snapshot.val();
      return userStatus?.status === true; // Return true if status is true
    }
    return false; // If no data exists, the user is offline
  } catch (error) {
    console.error('Error checking user status:', error);
    return false; // Return false in case of an error
  }
};


export const setActiveChat = async (userId, chatId) => {
  const database = getDatabase();
  const activeChatRef = ref(database, `/activeChats/${userId}`);
  const unreadRef = ref(database, `/private_chat/${chatId}/unread/${userId}`);
  const chatDataRef = ref(database, `/private_chat/${chatId}`);

  try {
    // 🔍 Fetch chat data before setting active chat
    const chatSnapshot = await get(chatDataRef);
    const chatData = chatSnapshot.exists() ? chatSnapshot.val() : {};

    // 🔹 Calculate the size of downloaded data in KB
    const chatDataSize = JSON.stringify(chatData).length / 1024;
    
    if (developmentMode) {
      console.log(`🚀 Downloaded chat data: ${chatDataSize.toFixed(2)} KB`);
    }

    // ✅ Set the active chat for the user
    await set(activeChatRef, chatId);
    console.log(`✅ Active chat set for user ${userId}: ${chatId}`);

    // ✅ Reset unread count for this user in the active chat
    await set(unreadRef, 0);
    console.log(`✅ Unread count reset to 0 for user ${userId} in chat ${chatId}`);

    // ✅ Ensure active chat is cleared on disconnect
    await onDisconnect(activeChatRef).remove();
    console.log(`ℹ️ Active chat for user ${userId} will be removed on disconnect.`);
  } catch (error) {
    console.error(`❌ Failed to set active chat for user ${userId}:`, error);
  }
};




export const clearActiveChat = async (userId) => {
  const database = getDatabase();
  const activeChatRef = ref(database, `/activeChats/${userId}`);

  try {
    // 🔍 Fetch current active chat before deleting
    const snapshot = await get(activeChatRef);
    const activeChatData = snapshot.exists() ? snapshot.val() : null;

    // 🔹 Calculate data size before deletion
    const dataSize = activeChatData ? JSON.stringify(activeChatData).length / 1024 : 0;

    if (developmentMode && activeChatData) {
      console.log(`🚀 Active chat data (${dataSize.toFixed(2)} KB) will be cleared for user ${userId}.`);
    }

    // ✅ Remove the active chat by setting it to null
    await set(activeChatRef, null);
    // console.log(`✅ Active chat cleared for user ${userId}.`);

  } catch (error) {
    // console.error(`❌ Failed to clear active chat for user ${userId}:`, error);
  }
};
