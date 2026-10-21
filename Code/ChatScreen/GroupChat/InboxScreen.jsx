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
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
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
} from '../../Supabase/chatMetaBackend';
import { SUPABASE_CHAT_META_ENABLED } from '../../Supabase/featureFlags';

// ✅ Constants for pagination (moved outside component to avoid recreation)
const INITIAL_LOAD = 15; // ✅ Initial chats to display
const LOAD_MORE = 10; // ✅ Load 10 more on scroll
// While realtime updates stream in, the list is redrawn at most about this
// often (timer, then the next idle moment, capped at the same again).
const LIST_FLUSH_MS = 250;

const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

// One inbox row. Memoized on primitive props so a profile/mute update or a
// realtime batch re-renders only the rows it touches — before this, each one
// re-rendered every row, framed avatar and popup Menu on screen, which is
// what made opening a long inbox stall. (Ported from adoptme-jan7.)
const ChatRow = React.memo(({
  chatId, otherUserId, otherUserName, otherUserAvatar, frame,
  lastMessage, unreadCount, muted, isDarkMode, styles, deleteLabel,
  onOpen, onToggleMute, onDelete,
}) => (
  <View style={styles.itemContainer}>
    <TouchableOpacity
      style={styles.chatItem}
      onPress={() => onOpen(chatId, otherUserId, otherUserName, otherUserAvatar)}
    >
      <View style={{ marginRight: 10 }}>
        <FramedAvatar
          avatarUri={otherUserAvatar}
          frame={frame}
          isDarkMode={isDarkMode}
          avatarSize={46}
        />
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.userName}>{otherUserName}</Text>
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
      onPress={() => onToggleMute(otherUserId, otherUserName, muted)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={{ paddingHorizontal: 6 }}
    >
      <Icon
        name={muted ? 'notifications-off' : 'notifications-outline'}
        size={20}
        color={muted ? '#EF4444' : (isDarkMode ? '#94A3B8' : '#64748B')}
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
        <MenuOption onSelect={() => onDelete(chatId)}>
          <Text style={{ color: 'red', fontSize: 16, padding: 10 }}> {deleteLabel}</Text>
        </MenuOption>
      </MenuOptions>
    </Menu>
  </View>
));

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

  // Banned list via ref: keeps the shared chat-meta subscription alive across
  // `bannedUsers` identity changes instead of re-subscribing (see ChatNavigator).
  const bannedUsersRef = useRef(bannedUsers);
  bannedUsersRef.current = bannedUsers;

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
    // Always the latest banned list (via ref) without being an effect dependency.
    const getBanned = () => (Array.isArray(bannedUsersRef.current) ? bannedUsersRef.current : []);

    const flushChatsList = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const updatedChats = Array.from(chatsMap.values())
        .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
      setLocalChats(updatedChats);
      if (!hasLoadedOnce.current) {
        setLocalLoading(false);
        hasLoadedOnce.current = true;
        if (initialLoadTimerRef.current) clearTimeout(initialLoadTimerRef.current);
      }
    };

    // Both code paths feed into this.
    const updateChatsList = () => {
      // First paint: the rows are usually already in memory (the shared
      // subscription replays them synchronously), so show them on the next
      // tick — a delay here held a re-opened inbox on the spinner for up to
      // 1.5 s, then flashed "No chats".
      if (!hasLoadedOnce.current) {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(flushChatsList, 0);
        return;
      }
      // Later updates: one redraw per LIST_FLUSH_MS window. Events in between
      // only update the map; the scheduled flush picks them up. (This used to
      // restart a 500 ms timer on every event, so a steady stream of messages
      // kept the list from updating at all until it stopped.)
      if (debounceTimerRef.current) return;
      debounceTimerRef.current = setTimeout(() => {
        requestIdleCallback(flushChatsList, { timeout: LIST_FLUSH_MS });
      }, LIST_FLUSH_MS);
    };

    // ── Supabase path ────────────────────────────────────────────────
    if (SUPABASE_CHAT_META_ENABLED) {
      const handleSupaUpsert = (row) => {
        if (!row || !row.partnerId) return;
        const chatPartnerId = row.partnerId;
        const isBlocked = getBanned().includes(chatPartnerId);
        const rawUnread = row.unreadCount || 0;
        // A blocked partner's server count is reset by ChatNavigator, which
        // gets the same rows from the shared subscription; here it only shows 0.

        chatsMap.set(chatPartnerId, {
          chatId: row.chatId,
          otherUserId: chatPartnerId,
          lastMessage: row.lastMessage || '',
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
          // Initial load complete: paint the rows now (not just drop the
          // spinner, which showed "No chats" until the debounced flush).
          if (!hasLoadedOnce.current) flushChatsList();
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
      const isBlocked = getBanned().includes(chatPartnerId);
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
        lastMessage: chatData.lastMessage || '',
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
    // bannedUsers intentionally omitted: read via bannedUsersRef / getBanned().
  }, [user?.id, appdatabase]);

  // Hold the first row mount until the push animation ends. Mounting a page
  // of framed avatars, images and popup Menus mid-fade is what stalled the
  // transition from the public chat. The timeout covers a transitionEnd that
  // never fires (e.g. no animation).
  const [transitionDone, setTransitionDone] = useState(false);
  useEffect(() => {
    const unsubscribe = navigation.addListener('transitionEnd', (e) => {
      if (!e?.data?.closing) setTransitionDone(true);
    });
    const fallback = setTimeout(() => setTransitionDone(true), 400);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [navigation]);

  const allChats = localChats;
  const displayLoading = localLoading || !transitionDone;
  // Latest chat list via ref so handleDelete keeps a stable identity —
  // otherwise every realtime batch hands each memoized ChatRow a new callback.
  const localChatsRef = useRef(localChats);
  localChatsRef.current = localChats;

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

              const chats = localChatsRef.current;
              if (!Array.isArray(chats) || chats.length === 0) {
                console.error('❌ Chats array not available');
                return;
              }

              const chatToDelete = chats.find(chat => chat?.chatId === chatId);
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

              // Update local state (and the realtime map, or the next flush
              // would bring the row back before the delete echo arrives).
              chatsMapRef.current.delete(otherUserId);
              setLocalChats((prevChats) => {
                if (!Array.isArray(prevChats)) return [];
                return prevChats.filter((chat) => chat?.chatId !== chatId);
              });

              showSuccessMessage(t("home.alert.success"), t("chat.chat_success_message"));
            } catch (error) {
              console.error('❌ Error deleting chat:', error);
              Alert.alert(t('chat.error'), t('chat.inbox_screen.delete_failed'));
            }
          },
        },
      ],
      { cancelable: true }
    );
  }, [user?.id, t]);

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
          ? t('chat.inbox_screen.notifications_muted', { name: otherUserName })
          : t('chat.inbox_screen.notifications_enabled', { name: otherUserName }),
      );
    } catch (error) {
      console.warn('[Inbox] toggle mute error:', error?.message);
      Alert.alert(t('chat.error'), t('chat.inbox_screen.notifications_failed'));
    }
  }, [user?.id, t]);

  // ✅ Memoize handleOpenChat with useCallback
  // One chat at a time: a second tap before the first chat had opened changed
  // the open chat's person mid-navigation, so the header showed one player over
  // another player's messages (owner report, 2026-10-18). Released when the
  // inbox is focused again, or after 1.5 s if the navigation never happened.
  const openingChatRef = useRef(false);
  useFocusEffect(useCallback(() => { openingChatRef.current = false; }, []));

  const handleOpenChat = useCallback(async (chatId, otherUserId, otherUserName, otherUserAvatar) => {
    if (openingChatRef.current) return;
    openingChatRef.current = true;
    setTimeout(() => { openingChatRef.current = false; }, 1500);
    if (!user?.id) {
      console.error('❌ User ID not available');
      return;
    }

    if (!chatId || !otherUserId) {
      console.error('❌ Invalid chat parameters');
      return;
    }

    try {
      // ✅ Update local state to reset unread count. The realtime map too:
      // otherwise the next flush shows the old count until PrivateChat's
      // reset comes back from the server.
      const mapped = chatsMapRef.current.get(otherUserId);
      if (mapped?.unreadCount) chatsMapRef.current.set(otherUserId, { ...mapped, unreadCount: 0 });
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
      Alert.alert(t('chat.error'), t('chat.inbox_screen.open_failed'));
    }
  }, [user?.id, navigation, t]);

  // Rows read the props they need; ChatRow's memo skips the unchanged ones.
  // profileCacheVersion isn't referenced here; the FlatList `extraData` prop
  // below carries it so rows pick up the warmed cache.
  const renderChatItem = useCallback(({ item }) => {
    if (!item || typeof item !== 'object') return null;

    const otherUserId = item.otherUserId;
    // Cached profile gives us the partner's cosmetic frame (and freshest
    // avatar) without any network — rows themselves don't carry cosmetics.
    const cachedProfile = getCachedProfile(otherUserId);
    const otherUserAvatar = cachedProfile?.avatar || item.otherUserAvatar || DEFAULT_AVATAR;

    return (
      <ChatRow
        chatId={item.chatId}
        otherUserId={otherUserId}
        otherUserName={item.otherUserName || 'Anonymous'}
        otherUserAvatar={otherUserId !== user?.id ? otherUserAvatar : (user?.avatar || DEFAULT_AVATAR)}
        frame={cachedProfile?.profileFrame || null}
        lastMessage={item.lastMessage || t('chat.message_common.no_messages')}
        unreadCount={item.unreadCount || 0}
        muted={!!item.muted}
        isDarkMode={isDarkMode}
        styles={styles}
        deleteLabel={t('chat.delete')}
        onOpen={handleOpenChat}
        onToggleMute={handleToggleMute}
        onDelete={handleDelete}
      />
    );
  }, [styles, user?.id, user?.avatar, handleOpenChat, handleDelete, handleToggleMute, isDarkMode, t]);

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
                  {t('chat.inbox_screen.loading_more', { shown: displayedChatsCount, total: filteredChats.length })}
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
