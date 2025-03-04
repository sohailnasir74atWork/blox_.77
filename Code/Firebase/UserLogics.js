import auth from '@react-native-firebase/auth';
import { resetUserState } from '../Globelhelper';
import { storage_user_data } from '../GlobelStats';


// Logout the current user
export const logoutUser = async (setUser) => {
  try {
    console.log('🔄 Logging out...');

    // ✅ Clear all local storage
    // storage_user_data.clearAll();
    // console.log('🗑️ Local storage cleared');

    // ✅ Reset user state before sign-out
    setUser({
      id: null,
      selectedFruits: [],
      admin: false,
      isReminderEnabled: false,
      isSelectedReminderEnabled: false,
      avatar: null,
      points: 0, 
      isBlock:false,
      fcmToken:null,
      lastactivity:null,
      online:false,
      featured:0

    });
    // console.log('🔄 User state reset');

    // ✅ Sign out from Firebase
    await auth().signOut();
    // console.log('✅ User logged out successfully');
  } catch (error) {
    console.error('🔥 Error logging out:', error.message);
  }
};

// Delete the current user
export const deleteUser = async () => {
    try {
        const user = auth().currentUser;
        if (user) {
            await user.delete();
            // console.log('User deleted');
        } else {
            // console.log('No user is currently logged in.');
        }
    } catch (error) {
        console.error('Error deleting user:', error.message);
        throw error;
    }
};

