import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
import { isUserOnline } from '../utils';
import { ref } from '@react-native-firebase/database';

const InboxScreen = ({ chats, setChats, loading, bannedUsers }) => {
  const navigation = useNavigation();
  // const { chats = [], setChats } = route.params || {}; // ✅ Prevents errors if `params` is missing  
  const { user, theme, appdatabase } = useGlobalState();
  // console.log('inbox', chats)
  const filteredChats = useMemo(() => {
    return chats.filter(chat => !bannedUsers.includes(chat.otherUserId));
  }, [chats, bannedUsers]);
  // const [loading, setLoading] = useState(false);
  const isDarkMode = theme === 'dark';
  const styles = getStyles(isDarkMode);

  const handleDelete = (chatId) => {
    Alert.alert(
      'Delete Chat',
      'Are you sure you want to delete this chat?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Remove chat from Firebase
              const chatRef = ref(appdatabase, `private_chat/${chatId}`);
              await chatRef.remove();

              // Update the local state to remove the chat
              setChats((prevChats) => prevChats.filter((chat) => chat.chatId !== chatId));
            } catch (error) {
              console.error('Error deleting chat:', error);
              Alert.alert('Error', 'Failed to delete the chat. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };
// console.log(chats)
  const handleOpenChat = (chatId, otherUserId, otherUserName, otherUserAvatar, 
    // isOnline, 
    // isBanned
  ) => {
    if (!user?.id) return;
  
    // ✅ Update local state to reset unread count
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.chatId === chatId ? { ...chat, unreadCount: 0 } : chat
      )
    );
  
    // ✅ Navigate to PrivateChat
    navigation.navigate('PrivateChat', {
      selectedUser: {
        senderId: otherUserId,
        sender: otherUserName,
        avatar: otherUserAvatar,
      },
      // isOnline,
      // isBanned,
    });
  };

 




  const renderChatItem = ({ item }) => (
    <View style={styles.itemContainer}>
      <TouchableOpacity
        style={styles.chatItem}
        onPress={() =>
          handleOpenChat(item.chatId, item.otherUserId, item.otherUserName, item.otherUserAvatar, 
            // item.isOnline, 
            // item.isBanned
          )
        }
      >
        <Image source={{ uri: item.otherUserId !== user.id ? item.otherUserAvatar : user.avatar }} style={styles.avatar} />
        <View style={styles.textContainer}>
          <Text style={styles.userName}>
            {item.otherUserName}
            {/* {item.isOnline && !item.isBanned && <Text style={{ color: config.colors.hasBlockGreen }}> - Online</Text>} */}
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
            style={{paddingLeft:10}}
          />
        </MenuTrigger>
        <MenuOptions>
          <MenuOption onSelect={() => handleDelete(item.chatId)}>
            <Text style={{ color: 'red', fontSize: 16, padding: 10 }}>Delete</Text>
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
        <Text style={styles.emptyText}>Currently, there are no chats available. To start a chat, select a user's profile picture and initiate a conversation.</Text>
      </View>
    ) : (
      <FlatList
        data={filteredChats}
        keyExtractor={(item) => item.chatId}
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
      backgroundColor:'white'
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
    emptyText:{
      color: isDarkMode ? 'white' : 'black',
      textAlign:'center'
    }
  });

export default InboxScreen;
