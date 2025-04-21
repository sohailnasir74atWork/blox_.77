import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,

} from 'react-native';
import { get, ref } from '@react-native-firebase/database';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useLocalState } from '../../LocalGlobelStats';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage } from '../../Helper/MessageHelper';


const BlockedUsersScreen = () => {
  const { user, theme, appdatabase } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const { t } = useTranslation();


  const isDarkMode = theme === 'dark';
  const styles = getStyles(isDarkMode);

  const [blockedUsers, setBlockedUsers] = useState([]);

  useEffect(() => {
    let isMounted = true;

    const fetchBlockedUsers = async () => {
      if (!user?.id || !appdatabase) {
        console.warn('⚠️ Missing required data: user ID or database instance');
        return;
      }

      try {
        const bannedUserIds = Array.isArray(localState?.bannedUsers) 
          ? localState.bannedUsers 
          : [];

        if (bannedUserIds.length === 0) {
          if (isMounted) {
            setBlockedUsers([]);
          }
          return;
        }

        const userDetailsPromises = bannedUserIds.map(async (id) => {
          if (!id) return null;

          try {
            const userRef = ref(appdatabase, `users/${id}`);
            const userSnapshot = await get(userRef);

            if (!userSnapshot?.exists()) return null;

            const userData = userSnapshot.val();
            if (!userData) return null;

            return {
              id,
              displayName: userData.displayName?.trim() || 'Anonymous',
              avatar: userData.avatar?.trim() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            };
          } catch (error) {
            console.error(`❌ Error fetching user ${id}:`, error);
            return null;
          }
        });

        const resolvedUsers = await Promise.all(userDetailsPromises);
        const validUsers = resolvedUsers.filter(user => user !== null);

        if (isMounted) {
          setBlockedUsers(validUsers);
        }
      } catch (error) {
        console.error("❌ Error in fetchBlockedUsers:", error);
        if (isMounted) {
          setBlockedUsers([]);
        }
      }
    };

    fetchBlockedUsers();

    return () => {
      isMounted = false;
    };
  }, [user?.id, localState?.bannedUsers, appdatabase]);
// console.log(blockedUsers)
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
      showSuccessMessage(t("home.alert.success"), t("chat.user_unblocked"));
    } catch (error) {
      console.error('❌ Error unblocking user:', error);
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
