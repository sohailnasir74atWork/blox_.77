import auth from '@react-native-firebase/auth';

export const logoutUser = async (setUser) => {
  try {
   
    await auth().signOut();
     setUser({
      id: null,
      selectedFruits: [],
      isReminderEnabled: false,
      isSelectedReminderEnabled: false,
      displayName: '',
      avatar: null,
      points: 0, 
      isBlock:false,
      fcmToken:null,
      lastactivity:null,
      online:false,

    });
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

