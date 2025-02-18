import auth from '@react-native-firebase/auth';
import database from '@react-native-firebase/database';



// Create a new user with email and password
export const createUserWithEmail = async (email, password) => {
    try {
        const userCredential = await auth().createUserWithEmailAndPassword(email, password);
        // console.log('User created:', userCredential.user.uid);
        return userCredential.user;
    } catch (error) {
        console.error('Error creating user with email:', error.message);
        throw error;
    }
};
export const signInWithGoogle = async () => {
    try {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const signInResult = await GoogleSignin.signIn();
        const idToken = signInResult.idToken;  // Directly use idToken from the result
        if (!idToken) {
            throw new Error('No ID token found');
        }

        // Create a Google credential with the token
        const googleCredential = auth.GoogleAuthProvider.credential(idToken);

        // Sign-in the user with the credential
        return auth().signInWithCredential(googleCredential);
    } catch (error) {
        console.error('Google Sign-In Error:', error);
        throw error;
    }
}

// Login a user with email and password
export const loginUserWithEmail = async (email, password) => {
    try {
        const userCredential = await auth().signInWithEmailAndPassword(email, password);
        // console.log('User logged in:', userCredential.user.uid);
        return userCredential.user;
    } catch (error) {
        console.error('Error logging in user with email:', error.message);
        throw error;
    }
};



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

// Save user data to the Firebase Realtime Database
export const saveUserData = async (userId, data) => {
    try {
        await database().ref(`/users/${userId}`).set(data);
        // console.log('User data saved successfully');
    } catch (error) {
        console.error('Error saving user data:', error.message);
        throw error;
    }
};

// Update specific fields in user data
export const updateUserData = async (userId, updates) => {
    try {
        await database().ref(`/users/${userId}`).update(updates);
        // console.log('User data updated successfully');
    } catch (error) {
        console.error('Error updating user data:', error.message);
        throw error;
    }
};

// Get user data from the Firebase Realtime Database
export const getUserData = async (userId) => {
    try {
        const snapshot = await database().ref(`/users/${userId}`).once('value');
        const data = snapshot.val();
        return data;
    } catch (error) {
        console.error('Error retrieving user data:', error.message);
        throw error;
    }
};

// Check if a fruit is available in the stock
export const isFruitAvailable = async (fruitName) => {
    try {
        const snapshot = await database().ref('/stock').once('value');
        const stock = snapshot.val();
        const isAvailable = stock?.some((item) => item.name === fruitName);
        // console.log(`${fruitName} availability:`, isAvailable);
        return isAvailable;
    } catch (error) {
        console.error('Error checking fruit availability:', error.message);
        throw error;
    }
};

// Send a push notification to the user (using Firebase Cloud Messaging)
import messaging from '@react-native-firebase/messaging';
import { resetUserState } from '../Globelhelper';

export const sendPushNotification = async (title, body, token) => {
    try {
        const message = {
            notification: {
                title,
                body,
            },
            token,
        };

        const response = await messaging().sendMessage(message);
        // console.log('Push notification sent:', response);
    } catch (error) {
        console.error('Error sending push notification:', error.message);
        throw error;
    }
};

// Monitor user authentication state
export const monitorAuthState = (callback) => {
    auth().onAuthStateChanged((user) => {
        if (user) {
            // console.log('User is logged in:', user.uid);
            callback(user);
        } else {
            // console.log('No user is logged in.');
            callback(null);
        }
    });
};
