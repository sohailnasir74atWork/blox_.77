import auth from '@react-native-firebase/auth';
import { resetUserState } from '../Globelhelper';


// Logout the current user
export const logoutUser = async (setUser) => {
    try {
      await auth().signOut();
    //   console.log('User logged out');
      resetUserState(setUser); // Reset the user state only after logout is complete
    } catch (error) {
      console.error('Error logging out:', error.message);
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

