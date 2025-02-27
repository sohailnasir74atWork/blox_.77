import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { get, ref } from '@react-native-firebase/database';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useLocalState } from '../../LocalGlobelStats';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';
import { developmentMode } from '../../Ads/ads';
import { showMessage } from 'react-native-flash-message';


const BlockedUsersScreen = () => {
  const { user, theme, appdatabase } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const { t } = useTranslation();


  const isDarkMode = theme === 'dark';
  const styles = getStyles(isDarkMode);

  const [blockedUsers, setBlockedUsers] = useState([]);

  useEffect(() => {
    const fetchBlockedUsers = async () => {
      if (!user?.id) return;

      const bannedUserIds = localState?.bannedUsers || [];

      if (!Array.isArray(bannedUserIds) || bannedUserIds.length === 0) {
        setBlockedUsers([]); // No banned users
        return;
      }

      try {
        // Fetch user details from Firebase for each banned user
        const userDetailsPromises = bannedUserIds.map(async (id) => {
          const userRef = ref(appdatabase, `users/${id}`);
          const userSnapshot = await get(userRef);

          if (userSnapshot.exists()) {
            const userData = userSnapshot.val();
            // if (developmentMode) {
            //   const userdata = JSON.stringify(userData).length / 1024; 
            //   // console.log(`🚀 Downloaded data: ${userData.toFixed(2)} KB from blockuser file`);
            // }
            // console.log(userData)
            return {
              id,
              displayName: userData?.displayName || userData?.displayname || 'Anonymous',
              avatar: userData?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            };
          } else {
            return null; // Handle deleted users
          }
        });

        const resolvedUsers = await Promise.all(userDetailsPromises);
        const validUsers = resolvedUsers.filter(user => user !== null);
        setBlockedUsers(validUsers);
      } catch (error) {
        // console.error("❌ Error fetching blocked users:", error);
      }
    };

    fetchBlockedUsers();
  }, [user?.id, localState?.bannedUsers]);
console.log(blockedUsers)
  const handleUnblockUser = async (selectedUserId) => {
    try {
      const updatedBannedUsers = (localState.bannedUsers || []).filter(id => id !== selectedUserId);

      // ✅ Update Local Storage
      await updateLocalState('bannedUsers', updatedBannedUsers);

      // ✅ Update UI immediately
      setBlockedUsers(prevBlockedUsers =>
        prevBlockedUsers.filter((blockedUser) => blockedUser.id !== selectedUserId)
      );

      // ✅ Show Alert
      // Alert.alert(t("home.success"), t("chat.user_unblocked"));
      showMessage({
        message: t("home.alert.success"),
        description:t("chat.user_unblocked"),
        type: "success",
      });
    } catch (error) {
      console.error('❌ Error unblocking user:', error);
      // Alert.alert('Error', 'Failed to unblock the user.');
    }
  };

  const renderBlockedUser = ({ item }) => (
    <View style={styles.userContainer}>
      <Image source={{ uri: item.avatar }} style={styles.avatar} />
      <View style={styles.textContainer}>
        <Text style={styles.userName}>{item.displayName}</Text>
        <TouchableOpacity
          style={styles.unblockButton}
          onPress={() => handleUnblockUser(item.id)}
        >
          <Icon name="person-remove-outline" size={20} color={isDarkMode ? 'white' : 'black'} />
          <Text style={styles.unblockText}>{t("chat.unblock")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {blockedUsers.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>{t("chat.no_user_blocked")}</Text>
        </View>
      ) : (
        <FlatList
          data={blockedUsers}
          keyExtractor={(item) => item.id}
          renderItem={renderBlockedUser}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

export const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      padding: 10,
    },
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 16,
      color: isDarkMode ? 'white' : 'black',
      textAlign: 'center',
    },
    userContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 15,
      padding: 10,
      backgroundColor: config.colors.card,
      borderRadius: 10,
      borderBottomWidth: 1,
      borderColor: isDarkMode ? 'white' : 'black',
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      marginRight: 10,
      backgroundColor: 'white',
    },
    textContainer: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    userName: {
      fontSize: 16,
      color: isDarkMode ? 'white' : 'black',
    },
    unblockButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: config.colors.danger,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 5,
    },
    unblockText: {
      marginLeft: 5,
      color: isDarkMode ? 'white' : 'black',
      fontSize: 14,
    },
  });

export default BlockedUsersScreen;
