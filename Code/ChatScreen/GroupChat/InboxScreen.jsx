import React, {  useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useGlobalState } from '../../GlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useTranslation } from 'react-i18next';
import database from '@react-native-firebase/database';
import { showSuccessMessage } from '../../Helper/MessageHelper';

const InboxScreen = ({ chats, setChats, loading, bannedUsers }) => {
  const navigation = useNavigation();
  // const { chats = [], setChats } = route.params || {}; // ✅ Prevents errors if `params` is missing  
  const { user, theme } = useGlobalState();
  const { t } = useTranslation();

// console.log(chats)

  // console.log('inbox', chats)
  const filteredChats = useMemo(() => {
    return chats.filter(chat =>
      chat.chatId && !bannedUsers.includes(chat.otherUserId)
    );
  }, [chats, bannedUsers]);
  
  // const [loading, setLoading] = useState(false);
  const isDarkMode = theme === 'dark';
  const styles = getStyles(isDarkMode);

 const handleDelete = (chatId) => {
  Alert.alert(
    t("chat.delete_chat"),
    t("chat.delete_chat_confirmation"),
    [
      { text: t("chat.cancel"), style: 'cancel' },
      {
        text: t("chat.delete"),
        style: 'destructive',
        onPress: async () => {
          try {
            const chatToDelete = chats.find(chat => chat.chatId === chatId);
            if (!chatToDelete) return;

            const otherUserId = chatToDelete.otherUserId;
            if (!otherUserId) return;

            // 1. Delete chat metadata for the current user
            const senderChatRef = database().ref(`chat_meta_data/${user.id}/${otherUserId}`);
            const snapshot = await senderChatRef.once('value');

            if (snapshot.exists()) {
              await senderChatRef.remove();
            }

            // 2. Delete full chat thread using chatId
            const fullChatRef = database().ref(`private_messages/${chatId}`);
            await fullChatRef.remove();

            // 3. Update local state
            setChats((prevChats) => prevChats.filter((chat) => chat.chatId !== chatId));

            showSuccessMessage(t("home.alert.success"), t("chat.chat_success_message"));
          } catch (error) {
            console.error('❌ Error deleting chat:', error);
          }
        },
      },
    ],
    { cancelable: true }
  );
};



  // console.log(chats)
  const handleOpenChat = async (chatId, otherUserId, otherUserName, otherUserAvatar) => {
    if (!user?.id) return;
  
    try {
      // ✅ Check if user is online before navigating
      // const online = await isUserOnline(otherUserId);
      // console.log(online)
  
      // ✅ Update local state to reset unread count
      setChats((prevChats) =>
        prevChats.map((chat) =>
          chat.chatId === chatId ? { ...chat, unreadCount: 0 } : chat
        )
      );
  
      // ✅ Navigate to PrivateChat with isOnline status
      navigation.navigate('PrivateChat', {
        selectedUser: {
          senderId: otherUserId,
          sender: otherUserName,
          avatar: otherUserAvatar,
        },
        // online,
      });
  
    } catch (error) {
      console.error("Error checking online status:", error);
    }
  };
  






  const renderChatItem = ({ item }) => (
    <View style={styles.itemContainer}>
      <TouchableOpacity
        style={styles.chatItem}
        onPress={() =>
          handleOpenChat(item.chatId, item.otherUserId, item.otherUserName, item.otherUserAvatar,
            item.isOnline, 
            // item.isBanned
          )
        }
      >
        <Image source={{ uri: item.otherUserId !== user.id ? item.otherUserAvatar : user.avatar }} style={styles.avatar} />
        <View style={styles.textContainer}>
          <Text style={styles.userName}>
            {item.otherUserName}
            {item.isOnline && !item.isBanned && <Text style={{ color: config.colors.hasBlockGreen }}> - Online</Text>}
            {/* {item.isBanned && <Text style={{ color: config.colors.wantBlockRed }}> - Banned</Text>} */}
          </Text>
          <Text style={styles.lastMessage} numberOfLines={1}>
            {item.lastMessage}
          </Text>
        </View>
        {item.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>
              {item.unreadCount > 99 ? '99+' : item.unreadCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>
      <Menu>
        <MenuTrigger>
          <Icon
            name="ellipsis-vertical-outline"
            size={20}
            color={config.colors.primary}
            style={{ paddingLeft: 10 }}
          />
        </MenuTrigger>
        <MenuOptions>
          <MenuOption onSelect={() => handleDelete(item.chatId)}>
            <Text style={{ color: 'red', fontSize: 16, padding: 10 }}> {t("chat.delete")}</Text>
          </MenuOption>
        </MenuOptions>
      </Menu>
    </View>
  );
  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color="#1E88E5" style={{ flex: 1 }} />
      ) : filteredChats.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}> {t("chat.no_chats_available")}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredChats}
          keyExtractor={(item, index) => item.chatId || index.toString()} // ✅ Ensure a unique key
          renderItem={renderChatItem}
        />
      )}
    </View>
  );
};

// Styles
const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      padding: 10,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',

    },
    itemContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: '#ccc',
    },
    chatItem: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 15,
      justifyContent: 'space-between'
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      marginRight: 10,
      backgroundColor: 'white'
    },
    textContainer: {
      flex: 1,
    },
    userName: {
      fontSize: 14,
      fontFamily: 'Lato-Bold',
      color: isDarkMode ? '#fff' : '#333',
    },
    lastMessage: {
      fontSize: 14,
      color: '#555',
    },
    unreadBadge: {
      backgroundColor: config.colors.hasBlockGreen,
      borderRadius: 12,
      minWidth: 24,
      height: 24,
      justifyContent: 'center',
      alignItems: 'center',
    },
    unreadBadgeText: {
      color: '#fff',
      fontSize: 12,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyText: {
      color: isDarkMode ? 'white' : 'black',
      textAlign: 'center'
    }
  });

export default InboxScreen;
