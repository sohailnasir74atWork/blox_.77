import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  InteractionManager,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useTranslation } from 'react-i18next';
import { ref, update, remove, onChildAdded, onChildChanged, onChildRemoved } from '@react-native-firebase/database';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import FramedAvatar from './FramedAvatar';
import { getCachedProfile, warmProfileCache } from '../../Helper/profileCache';
import {
  subscribeToChatMetaShared,
  setChatMuted as sbSetChatMuted,
  deleteChatForOwner as sbDeleteChatForOwner,
  resetUnreadCount as sbResetUnreadCount,
} from '../../Supabase/chatMetaBackend';
import { SUPABASE_CHAT_META_ENABLED } from '../../Supabase/featureFlags';

// ✅ Constants for pagination (moved outside component to avoid recreation)
const INITIAL_LOAD = 15; // ✅ Initial chats to display
const LOAD_MORE = 10; // ✅ Load 10 more on scroll

const InboxScreen = ({ bannedUsers }) => {
  const navigation = useNavigation();
  const { user, theme, appdatabase } = useGlobalState();
  const { t } = useTranslation();
  const [localLoading, setLocalLoading] = useState(false);
  const [localChats, setLocalChats] = useState([]);
  const [displayedChatsCount, setDisplayedChatsCount] = useState(INITIAL_LOAD);
  // Bumped when warmProfileCache lands so rows re-render with frames/avatars.
  const [profileCacheVersion, setProfileCacheVersion] = useState(0);
  const debounceTimerRef = useRef(null); // ✅ Debounce updateChatsList
  const hasLoadedOnce = useRef(false); // ✅ Track if initial load is done

  // ✅ OPTIMIZED: Use child listeners only — no get() call to avoid double-downloading
  // useEffect keeps listeners attached across tab switches (no re-download on every focus)
  const chatsMapRef = useRef(new Map());
  const initialLoadTimerRef = useRef(null);

  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setLocalChats([]);
      setLocalLoading(false);
      return;
    }

    if (!hasLoadedOnce.current) {
      setLocalLoading(true);
      // Safety timeout — if user has no chats, onChildAdded never fires
      initialLoadTimerRef.current = setTimeout(() => {
        if (!hasLoadedOnce.current) {
          setLocalLoading(false);
          hasLoadedOnce.current = true;
        }
      }, 2000);
    }

    const chatsMap = chatsMapRef.current;
    chatsMap.clear();
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];

    // Debounced flush — both code paths feed into this so the rapid
    // burst of inserts on first subscribe doesn't trigger N renders.
    const updateChatsList = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        InteractionManager.runAfterInteractions(() => {
          const updatedChats = Array.from(chatsMap.values())
            .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
          setLocalChats(updatedChats);
          if (!hasLoadedOnce.current) {
            setLocalLoading(false);
            hasLoadedOnce.current = true;
            if (initialLoadTimerRef.current) clearTimeout(initialLoadTimerRef.current);
          }
        });
      }, 500);
    };

    // ── Supabase path ────────────────────────────────────────────────
    if (SUPABASE_CHAT_META_ENABLED) {
      const handleSupaUpsert = (row) => {
        if (!row || !row.partnerId) return;
        const chatPartnerId = row.partnerId;
        const isBlocked = banned.includes(chatPartnerId);
        const rawUnread = row.unreadCount || 0;

        if (isBlocked && rawUnread > 0) {
          // Reset directly on Supabase (now the source of truth).
          sbResetUnreadCount(user.id, chatPartnerId);
        }

        chatsMap.set(chatPartnerId, {
          chatId: row.chatId,
          otherUserId: chatPartnerId,
          lastMessage: row.lastMessage || 'No messages yet',
          lastMessageTimestamp: row.timestamp || 0,
          unreadCount: isBlocked ? 0 : rawUnread,
          otherUserAvatar: row.receiverAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          otherUserName: row.receiverName || 'Anonymous',
          muted: !!row.muted,
        });
        updateChatsList();
      };

      const handleSupaRemove = (partnerId) => {
        if (!partnerId) return;
        chatsMap.delete(partnerId);
        updateChatsList();
      };

      const unsub = subscribeToChatMetaShared(user.id, {
        onUpsert: handleSupaUpsert,
        onRemove: handleSupaRemove,
        onReady: () => {
          // initial load complete; ensure the spinner clears even if zero chats
          if (!hasLoadedOnce.current) {
            setLocalLoading(false);
            hasLoadedOnce.current = true;
            if (initialLoadTimerRef.current) clearTimeout(initialLoadTimerRef.current);
          }
        },
      });

      return () => {
        unsub();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        if (initialLoadTimerRef.current) clearTimeout(initialLoadTimerRef.current);
      };
    }

    // ── RTDB fallback (original code) ────────────────────────────────
    const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);

    const handleChildChange = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const chatData = snapshot.val();
      if (!chatData || typeof chatData !== 'object') return;

      const chatPartnerId = snapshot.key;
      const isBlocked = banned.includes(chatPartnerId);
      const rawUnread = chatData?.unreadCount || 0;

      if (isBlocked && rawUnread > 0) {
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
        otherUserAvatar: chatData.receiverAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        otherUserName: chatData.receiverName || 'Anonymous',
        muted: !!chatData.muted,
      });

      updateChatsList();
    };

    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      chatsMap.delete(snapshot.key);
      updateChatsList();
    };

    const unsubAdded = onChildAdded(userChatsRef, handleChildChange);
    const unsubChanged = onChildChanged(userChatsRef, handleChildChange);
    const unsubRemoved = onChildRemoved(userChatsRef, handleChildRemoved);

    return () => {
      unsubAdded();
      unsubChanged();
      unsubRemoved();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (initialLoadTimerRef.current) clearTimeout(initialLoadTimerRef.current);
    };
  }, [user?.id, appdatabase, bannedUsers]);

  const allChats = localChats;
  const displayLoading = localLoading;

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

  // Warm the profile cache so avatar frames render on inbox rows (the
  // chat_meta rows don't carry cosmetics). COST: warm ONLY the on-screen
  // slice — uncached uids only, 30-min TTL, so repeat opens are free.
  useEffect(() => {
    if (!appdatabase || filteredChats.length === 0) return;
    const uncached = filteredChats
      .slice(0, displayedChatsCount)
      .map(chat => chat.otherUserId)
      .filter(id => id && id !== user?.id && !getCachedProfile(id));
    if (uncached.length === 0) return;
    let cancelled = false;
    warmProfileCache(appdatabase, uncached)
      .then(() => { if (!cancelled) setProfileCacheVersion(v => v + 1); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [filteredChats, displayedChatsCount, appdatabase, user?.id]);

  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode, c), [isDarkMode]);

  // ✅ Memoize handleDelete with useCallback
  const handleDelete = useCallback((chatId) => {
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

              // Delete chat metadata for the current user only — Supabase.
              // Partner's row is untouched (their inbox keeps the chat).
              await sbDeleteChatForOwner(user.id, otherUserId);

              // Update local state
              setLocalChats((prevChats) => {
                if (!Array.isArray(prevChats)) return [];
                return prevChats.filter((chat) => chat?.chatId !== chatId);
              });

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
  }, [allChats, user?.id, t]);

  // 🔔 Toggle mute for a private chat.
  //
  // Writes muted boolean to RTDB (source of truth). Mirror CF syncs to
  // Supabase. The realtime listener above receives the update and
  // re-renders the bell automatically — no local state to keep in sync.
  //
  // The notifyNewMessage Cloud Function reads this same flag and skips
  // pushes when muted = true.
  const handleToggleMute = useCallback(async (otherUserId, otherUserName, currentMuted) => {
    if (!user?.id || !otherUserId) return;
    const newMuted = !currentMuted;
    try {
      // Mute flag is now Supabase-native. The notifyNewMessage CF reads
      // it from Supabase (chat_meta_data table) when deciding whether to
      // suppress a push. The realtime listener picks up the UPDATE and
      // re-renders the bell automatically.
      await sbSetChatMuted(user.id, otherUserId, newMuted);
      showSuccessMessage(
        t('home.alert.success'),
        newMuted
          ? `Notifications muted for "${otherUserName}"`
          : `Notifications enabled for "${otherUserName}"`,
      );
    } catch (error) {
      console.warn('[Inbox] toggle mute error:', error?.message);
      Alert.alert('Error', 'Failed to update notification settings.');
    }
  }, [user?.id, t]);

  // ✅ Memoize handleOpenChat with useCallback
  const handleOpenChat = useCallback(async (chatId, otherUserId, otherUserName, otherUserAvatar) => {
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

      // ✅ Navigate to PrivateChat
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
  }, [user?.id, navigation]);

  // ✅ Memoize renderChatItem with useCallback
  const renderChatItem = useCallback(({ item }) => {
    if (!item || typeof item !== 'object') return null;

    const chatId = item.chatId;
    const otherUserId = item.otherUserId;
    // Cached profile gives us the partner's cosmetic frame (and freshest
    // avatar) without any network — rows themselves don't carry cosmetics.
    const cachedProfile = getCachedProfile(otherUserId);
    const otherUserName = item.otherUserName || 'Anonymous';
    const otherUserAvatar = cachedProfile?.avatar || item.otherUserAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
    const userAvatar = user?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
    const lastMessage = item.lastMessage || 'No messages yet';
    const unreadCount = item.unreadCount || 0;
    const isOnline = item.isOnline || false;
    const isBanned = item.isBanned || false;
    const isMuted = !!item.muted;

    return (
      <View style={styles.itemContainer}>
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => handleOpenChat(chatId, otherUserId, otherUserName, otherUserAvatar)}
        >
          <View style={{ marginRight: 10 }}>
            <FramedAvatar
              avatarUri={otherUserId !== user?.id ? otherUserAvatar : userAvatar}
              frame={cachedProfile?.profileFrame || null}
              isDarkMode={isDarkMode}
              avatarSize={46}
            />
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.userName}>
              {otherUserName}
              {isOnline && !isBanned && (
                <Text style={{ color: '#22c55e' }}> - Online</Text>
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
        <TouchableOpacity
          onPress={() => handleToggleMute(otherUserId, otherUserName, isMuted)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ paddingHorizontal: 6 }}
        >
          <Icon
            name={isMuted ? 'notifications-off' : 'notifications-outline'}
            size={20}
            color={isMuted ? '#EF4444' : (isDarkMode ? '#94A3B8' : '#64748B')}
          />
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
          <MenuOptions customStyles={{
            optionsContainer: {
              borderRadius: 8,
              padding: 4,
              backgroundColor: isDarkMode ? '#1e293b' : '#fff',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.15,
              shadowRadius: 4,
              elevation: 5,
              width: 150,
            },
          }}>
            <MenuOption onSelect={() => handleDelete(chatId)}>
              <Text style={{ color: 'red', fontSize: 16, padding: 10 }}> {t("chat.delete")}</Text>
            </MenuOption>
          </MenuOptions>
        </Menu>
      </View>
    );
  }, [styles, user, handleOpenChat, handleDelete, handleToggleMute, isDarkMode, t]);

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
          extraData={`${profileCacheVersion}-${displayedChatsCount}`}
          removeClippedSubviews={false}
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
const getStyles = (isDarkMode, c) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0f172a' : '#f2f2f7',
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
      fontSize: 15,
      fontWeight: 'bold',
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
      color: c.text,
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
      color: c.textSecondary,

    }
  });

export default React.memo(InboxScreen);
