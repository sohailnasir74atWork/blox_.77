import React, { useMemo, useCallback, useEffect, useState } from 'react';
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
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useGlobalState } from '../../GlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useTranslation } from 'react-i18next';
import database, { ref, onValue, get } from '@react-native-firebase/database';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';

// ✅ Constants for pagination (moved outside component to avoid recreation)
const INITIAL_LOAD = 15; // ✅ Initial chats to display
const LOAD_MORE = 10; // ✅ Load 10 more on scroll

const InboxScreen = ({ chats, setChats, loading, bannedUsers }) => {
  const navigation = useNavigation();
  const { user, theme, appdatabase } = useGlobalState();
  const { t } = useTranslation();
  const [localLoading, setLocalLoading] = useState(false);
  const [localChats, setLocalChats] = useState([]);
  const [displayedChatsCount, setDisplayedChatsCount] = useState(INITIAL_LOAD); // ✅ Start with 15 chats

  // ✅ OPTIMIZED: Use get() for initial load + child listeners for updates
  // This prevents re-downloading entire chat_meta_data on every change
  // Only downloads changed chats instead of all chats
  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !appdatabase) {
        setLocalChats([]);
        setLocalLoading(false);
        return;
      }

      setLocalLoading(true);
      const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);
      const chatsMap = new Map(); // Track chats locally
      const banned = Array.isArray(bannedUsers) ? bannedUsers : [];

      // ✅ OPTIMIZED: Initial load with get() (one-time read)
      const loadInitialChats = async () => {
        try {
          const snapshot = await userChatsRef.once('value');
          if (!snapshot.exists()) {
            setLocalChats([]);
            setLocalLoading(false);
            return;
          }

          const fetchedData = snapshot.val();
          if (!fetchedData || typeof fetchedData !== 'object') {
            setLocalChats([]);
            setLocalLoading(false);
            return;
          }

          Object.entries(fetchedData).forEach(([chatPartnerId, chatData]) => {
            if (!chatData || typeof chatData !== 'object') return;
            
            const isBlocked = banned.includes(chatPartnerId);
            const rawUnread = chatData?.unreadCount || 0;

            if (isBlocked && rawUnread > 0) {
              const { update } = require('@react-native-firebase/database');
              const blockedChatRef = ref(appdatabase, `chat_meta_data/${user.id}/${chatPartnerId}`);
              update(blockedChatRef, { unreadCount: 0 }).catch((error) => {
                console.error("Error resetting unread count:", error);
              });
            }

            chatsMap.set(chatPartnerId, {
              chatId: chatData.chatId,
              otherUserId: chatPartnerId,
              lastMessage: chatData.lastMessage || 'No messages yet',
              lastMessageTimestamp: chatData.timestamp || 0,
              unreadCount: isBlocked ? 0 : rawUnread,
              otherUserAvatar: chatData.receiverAvatar || 'https://example.com/default-avatar.jpg',
              otherUserName: chatData.receiverName || 'Anonymous',
            });
          });

          updateChatsList();
          setLocalLoading(false);
        } catch (error) {
          console.error("❌ Error loading initial chats:", error);
          setLocalLoading(false);
        }
      };

      // ✅ Helper function to update chats list from map
      const updateChatsList = () => {
        const updatedChats = Array.from(chatsMap.values())
          .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
        
        setLocalChats(updatedChats);
        setDisplayedChatsCount(INITIAL_LOAD);
        
        if (setChats && typeof setChats === 'function') {
          setChats(updatedChats);
        }
      };

      // ✅ OPTIMIZED: Use child listeners for updates (only downloads changed chats)
      const handleChildChange = (snapshot) => {
        if (!snapshot || !snapshot.key) return;
        const chatData = snapshot.val();
        if (!chatData || typeof chatData !== 'object') return;

        const chatPartnerId = snapshot.key;
        const isBlocked = banned.includes(chatPartnerId);
        const rawUnread = chatData?.unreadCount || 0;

        if (isBlocked && rawUnread > 0) {
          const { update } = require('@react-native-firebase/database');
          const blockedChatRef = ref(appdatabase, `chat_meta_data/${user.id}/${chatPartnerId}`);
          update(blockedChatRef, { unreadCount: 0 }).catch((error) => {
            console.error("Error resetting unread count:", error);
          });
        }

        chatsMap.set(chatPartnerId, {
          chatId: chatData.chatId,
          otherUserId: chatPartnerId,
          lastMessage: chatData.lastMessage || 'No messages yet',
          lastMessageTimestamp: chatData.timestamp || 0,
          unreadCount: isBlocked ? 0 : rawUnread,
          otherUserAvatar: chatData.receiverAvatar || 'https://example.com/default-avatar.jpg',
          otherUserName: chatData.receiverName || 'Anonymous',
        });

        updateChatsList();
      };

      const handleChildRemoved = (snapshot) => {
        if (!snapshot || !snapshot.key) return;
        chatsMap.delete(snapshot.key);
        updateChatsList();
      };

      // Load initial data
      loadInitialChats();

      // Listen to individual chat changes (only downloads changed chats, not all)
      userChatsRef.on('child_added', handleChildChange);
      userChatsRef.on('child_changed', handleChildChange);
      userChatsRef.on('child_removed', handleChildRemoved);

      // ✅ Cleanup listeners when screen loses focus
      return () => {
        userChatsRef.off('child_added', handleChildChange);
        userChatsRef.off('child_changed', handleChildChange);
        userChatsRef.off('child_removed', handleChildRemoved);
        setDisplayedChatsCount(INITIAL_LOAD);
      };
    }, [user?.id, appdatabase, bannedUsers, setChats])
  );

  // ✅ Use local chats if available, fallback to props for backward compatibility
  const allChats = localChats.length > 0 ? localChats : (chats || []);
  const displayLoading = localLoading || loading;

  // ✅ Safety check for bannedUsers array and filter
  const filteredChats = useMemo(() => {
    if (!Array.isArray(allChats)) return [];
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    return allChats.filter(chat =>
      chat?.chatId && !banned.includes(chat.otherUserId)
    );
  }, [allChats, bannedUsers]);

  // ✅ OPTIMIZED: Only display paginated chats (15 initially, then 10 more on scroll)
  const displayedChats = useMemo(() => {
    return filteredChats.slice(0, displayedChatsCount);
  }, [filteredChats, displayedChatsCount]);

  // ✅ Handle load more on scroll
  const handleLoadMore = useCallback(() => {
    if (displayedChatsCount < filteredChats.length) {
      setDisplayedChatsCount(prev => Math.min(prev + LOAD_MORE, filteredChats.length));
    }
  }, [displayedChatsCount, filteredChats.length]);
  
  // const [loading, setLoading] = useState(false);
  const isDarkMode = theme === 'dark';
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

 // ✅ Memoize handleDelete with useCallback
 const handleDelete = useCallback((chatId) => {
  // ✅ Safety check
  if (!chatId) {
    console.error('❌ Invalid chatId for handleDelete');
    return;
  }

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
            // ✅ Safety checks
            if (!user?.id) {
              console.error('❌ User ID not available');
              return;
            }

            if (!Array.isArray(allChats) || allChats.length === 0) {
              console.error('❌ Chats array not available');
              return;
            }

            const chatToDelete = allChats.find(chat => chat?.chatId === chatId);
            if (!chatToDelete) {
              console.error('❌ Chat not found');
              return;
            }

            const otherUserId = chatToDelete.otherUserId;
            if (!otherUserId) {
              console.error('❌ Other user ID not available');
              return;
            }

            // 1. Delete chat metadata for the current user
            const senderChatRef = database().ref(`chat_meta_data/${user.id}/${otherUserId}`);
            const snapshot = await senderChatRef.once('value');

            if (snapshot.exists()) {
              await senderChatRef.remove();
            }

            // 2. Delete full chat thread using chatId
            const fullChatRef = database().ref(`private_messages/${chatId}`);
            await fullChatRef.remove();

            // 3. Update local state - ✅ Validate setChats callback
            setLocalChats((prevChats) => {
              if (!Array.isArray(prevChats)) return [];
              return prevChats.filter((chat) => chat?.chatId !== chatId);
            });
            
            if (setChats && typeof setChats === 'function') {
              setChats((prevChats) => {
                if (!Array.isArray(prevChats)) return [];
                return prevChats.filter((chat) => chat?.chatId !== chatId);
              });
            }

            showSuccessMessage(t("home.alert.success"), t("chat.chat_success_message"));
          } catch (error) {
            console.error('❌ Error deleting chat:', error);
            Alert.alert('Error', 'Failed to delete chat. Please try again.');
          }
        },
      },
    ],
    { cancelable: true }
  );
}, [allChats, user?.id, setChats, t]);



  // ✅ Memoize handleOpenChat with useCallback
  const handleOpenChat = useCallback(async (chatId, otherUserId, otherUserName, otherUserAvatar) => {
    // ✅ Safety checks
    if (!user?.id) {
      console.error('❌ User ID not available');
      return;
    }

    if (!chatId || !otherUserId) {
      console.error('❌ Invalid chat parameters');
      return;
    }
  
    try {
      // ✅ Update local state to reset unread count
      setLocalChats((prevChats) => {
        if (!Array.isArray(prevChats)) return prevChats;
        return prevChats.map((chat) =>
          chat?.chatId === chatId ? { ...chat, unreadCount: 0 } : chat
        );
      });
      
      // ✅ Also update parent state if provided
      if (setChats && typeof setChats === 'function') {
        setChats((prevChats) => {
          if (!Array.isArray(prevChats)) return prevChats;
          return prevChats.map((chat) =>
            chat?.chatId === chatId ? { ...chat, unreadCount: 0 } : chat
          );
        });
      }
  
      // ✅ Navigate to PrivateChat with isOnline status
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('PrivateChat', {
          selectedUser: {
            senderId: otherUserId,
            sender: otherUserName || 'Anonymous',
            avatar: otherUserAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          },
        });
      }
  
    } catch (error) {
      console.error("Error opening chat:", error);
      Alert.alert('Error', 'Failed to open chat. Please try again.');
    }
  }, [user?.id, setChats, navigation]);
  






  // ✅ Memoize renderChatItem with useCallback
  const renderChatItem = useCallback(({ item }) => {
    // ✅ Safety checks
    if (!item || typeof item !== 'object') return null;

    const chatId = item.chatId;
    const otherUserId = item.otherUserId;
    const otherUserName = item.otherUserName || 'Anonymous';
    const otherUserAvatar = item.otherUserAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
    const userAvatar = user?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
    const lastMessage = item.lastMessage || 'No messages yet';
    const unreadCount = item.unreadCount || 0;
    const isOnline = item.isOnline || false;
    const isBanned = item.isBanned || false;

    return (
      <View style={styles.itemContainer}>
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => handleOpenChat(chatId, otherUserId, otherUserName, otherUserAvatar)}
        >
          <Image 
            source={{ 
              uri: otherUserId !== user?.id ? otherUserAvatar : userAvatar 
            }} 
            style={styles.avatar} 
          />
          <View style={styles.textContainer}>
            <Text style={styles.userName}>
              {otherUserName}
              {isOnline && !isBanned && (
                <Text style={{ color: config.colors.hasBlockGreen }}> - Online</Text>
              )}
            </Text>
            <Text style={styles.lastMessage} numberOfLines={1}>
              {lastMessage}
            </Text>
          </View>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {unreadCount > 99 ? '99+' : unreadCount}
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
            <MenuOption onSelect={() => handleDelete(chatId)}>
              <Text style={{ color: 'red', fontSize: 16, padding: 10 }}> {t("chat.delete")}</Text>
            </MenuOption>
          </MenuOptions>
        </Menu>
      </View>
    );
  }, [styles, user, handleOpenChat, handleDelete, t]);
  return (
    <View style={styles.container}>
      {displayLoading ? (
        <ActivityIndicator size="large" color="#1E88E5" style={{ flex: 1 }} />
      ) : filteredChats.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}> {t("chat.no_chats_available")}</Text>
        </View>
      ) : (
        <FlatList
          data={displayedChats}
          keyExtractor={(item, index) => item?.chatId || `chat-${index}`}
          renderItem={renderChatItem}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={10}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            displayedChatsCount < filteredChats.length ? (
              <View style={styles.loadMoreContainer}>
                <ActivityIndicator size="small" color="#1E88E5" />
                <Text style={styles.loadMoreText}>
                  Loading more chats... ({displayedChatsCount} of {filteredChats.length})
                </Text>
              </View>
            ) : null
          }
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
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
    },
    itemContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#333' : '#e5e7eb',
      paddingHorizontal: 10,
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
    },
    loadMoreContainer: {
      paddingVertical: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadMoreText: {
      marginTop: 8,
      fontSize: 12,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      fontFamily: 'Lato-Regular',
    }
  });

export default InboxScreen;
