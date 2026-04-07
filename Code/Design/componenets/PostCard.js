import React, { useState, useCallback, memo, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity, Alert, Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import { mixpanel } from '../../AppHelper/MixPenel';
import { useNavigation } from '@react-navigation/native';
import CommentModal from './CommentsModal';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { showMessage } from 'react-native-flash-message';
import ReportModal from './ReportModal';
import dayjs from 'dayjs';
import ProfileBottomDrawer from '../../ChatScreen/GroupChat/BottomDrawer';
import { banUserwithEmail as banUserwithEmailUtils } from '../../ChatScreen/utils';
import { isUserOnline } from '../../ChatScreen/utils';
import RoleBadges from './RoleBadges';
import FramedAvatar from '../../ChatScreen/GroupChat/FramedAvatar';

const REACTION_EMOJIS = ['❤️', '🔥', '😍', '💀', '🎯'];

const TAG_CONFIG = {
  'scam alert': { color: '#EF4444', icon: 'shield-halved' },
  'looking for trade': { color: '#10B981', icon: 'handshake' },
  'discussion': { color: '#3B82F6', icon: 'comments' },
  'real or fake': { color: '#8B5CF6', icon: 'magnifying-glass' },
  'need help': { color: '#F59E0B', icon: 'circle-question' },
  'misc.': { color: '#6B7280', icon: 'ellipsis' },
  'misc': { color: '#6B7280', icon: 'ellipsis' },
};

const PostCard = ({ item, userId, onReaction, localState, appdatabase, onDelete, onDeleteAll }) => {
  const navigation = useNavigation();

  const [showComments, setShowComments] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [isOnline, setIsOnline] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [heartScale] = useState(new Animated.Value(1));

  // Merge legacy likes + new reactions
  const mergedReactions = useMemo(() => {
    const map = {};
    if (item.likes) {
      Object.keys(item.likes).forEach(uid => {
        if (!item.reactions?.[uid]) map[uid] = '❤️';
      });
    }
    if (item.reactions) {
      Object.entries(item.reactions).forEach(([uid, emoji]) => {
        map[uid] = emoji;
      });
    }
    return map;
  }, [item.likes, item.reactions]);

  const myReaction = mergedReactions[userId] || null;
  const totalReactions = Object.keys(mergedReactions).length;

  const reactionCounts = useMemo(() => {
    const counts = {};
    Object.values(mergedReactions).forEach(emoji => {
      counts[emoji] = (counts[emoji] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [mergedReactions]);

  useEffect(() => {
    setBannedUsers(localState.bannedUsers);
  }, [localState.bannedUsers]);

  const { theme, isAdmin, isModerator } = useGlobalState();
  const canModerate = isAdmin || isModerator;
  const isDark = theme === 'dark';

  const getTagConfig = (tag) => TAG_CONFIG[tag?.toLowerCase()] || { color: config.colors.primary, icon: 'tag' };

  const banUserwithEmail = async (email, admin) => {
    try {
      await banUserwithEmailUtils(email, admin || isAdmin);
      if (item?.userId) await onDeleteAll(item.userId);
    } catch (err) {
      console.error('Ban error:', err);
    }
  };

  const closeProfileDrawer = () => setIsDrawerVisible(false);

  const openProfileDrawer = async () => {
    if (!userId) {
      showMessage({ message: 'Please sign in to message', type: 'warning' });
      return;
    }
    try {
      const online = await isUserOnline(item?.userId);
      setIsOnline(online);
    } catch {
      setIsOnline(false);
    }
    setIsDrawerVisible(true);
  };

  const selectedUser = {
    senderId: item.userId,
    sender: item.displayName,
    avatar: item.avatar,
    flage: item?.flage,
  };

  const handleChatNavigation = useCallback(() => {
    if (!userId) {
      showMessage({ message: 'Please sign in to message', type: 'warning' });
      return;
    }
    mixpanel.track('Design Screen');
    navigation.navigate('PrivateChatDesign', { selectedUser, item });
  }, [userId, item, navigation]);

  const handleEmojiTap = useCallback((emoji) => {
    setShowEmojiPicker(false);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, useNativeDriver: true, speed: 40 }),
      Animated.spring(heartScale, { toValue: 1.0, useNativeDriver: true, speed: 40 }),
    ]).start();
    onReaction(item, emoji);
  }, [item, onReaction]);

  const s = getStyles(isDark);
  const formattedTime = item.createdAt ? dayjs(item.createdAt.toDate()).fromNow() : 'Anonymous';
  const hasNoImages = !Array.isArray(item.imageUrl) || item.imageUrl.length === 0;

  return (
    <View style={s.card}>

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={openProfileDrawer} activeOpacity={0.8}>
          <View style={s.avatarWrapper}>
            <FramedAvatar
              avatarUri={item.avatar}
              frame={item.profileFrame || null}
              isDarkMode={isDark}
              avatarSize={40}
            />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={{ marginLeft: 10, flex: 1 }} onPress={openProfileDrawer} activeOpacity={0.8}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            <Text style={s.name} numberOfLines={1}>{item.displayName}</Text>
            <RoleBadges userItem={item} />
            {item.isPro && (
              <Image source={require('../../../assets/pro.png')} style={s.badge} />
            )}
            {item.robloxUsernameVerified && (
              <Image source={require('../../../assets/verification.png')} style={s.badge} />
            )}
            {(() => {
              const hasRecentWin =
                !!item?.hasRecentGameWin ||
                (typeof item?.lastGameWinAt === 'number' &&
                  Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);
              return hasRecentWin ? (
                <Image source={require('../../../assets/trophy.webp')} style={s.badge} />
              ) : null;
            })()}
          </View>
          <Text style={s.time}>{formattedTime}</Text>
        </TouchableOpacity>

        {/* Kebab menu */}
        <Menu>
          <MenuTrigger>
            <View style={s.menuBtn}>
              <Icon name="ellipsis-v" size={14} color={isDark ? '#94a3b8' : '#64748b'} />
            </View>
          </MenuTrigger>
          <MenuOptions customStyles={{ optionsContainer: { borderRadius: 14, overflow: 'hidden', backgroundColor: isDark ? '#1e293b' : '#fff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 8, minWidth: 160 } }}>
            <MenuOption onSelect={() => setShowReportModal(true)}>
              <View style={s.menuItem}>
                <FontAwesome6 name="flag" size={12} color="#F59E0B" solid />
                <Text style={[s.menuItemText, { color: '#F59E0B' }]}>Report</Text>
              </View>
            </MenuOption>
            {(userId === item.userId || canModerate) && (
              <MenuOption onSelect={() => Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', onPress: () => onDelete(item.id), style: 'destructive' },
              ])}>
                <View style={[s.menuItem, { borderTopWidth: 1, borderTopColor: isDark ? '#334155' : '#f1f5f9' }]}>
                  <FontAwesome6 name="trash" size={12} color="#EF4444" solid />
                  <Text style={[s.menuItemText, { color: '#EF4444' }]}>Delete</Text>
                </View>
              </MenuOption>
            )}
            {canModerate && (
              <MenuOption onSelect={() => Alert.alert('Delete All Posts', 'Delete all posts from this user?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete All', onPress: () => onDeleteAll(item.userId), style: 'destructive' },
              ])}>
                <View style={[s.menuItem, { borderTopWidth: 1, borderTopColor: isDark ? '#334155' : '#f1f5f9' }]}>
                  <FontAwesome6 name="trash-can" size={12} color="#EF4444" solid />
                  <Text style={[s.menuItemText, { color: '#EF4444' }]}>Delete All</Text>
                </View>
              </MenuOption>
            )}
          </MenuOptions>
        </Menu>
      </View>

      {/* ── Text-only: tags in flow above description ── */}
      {hasNoImages && (
        <View style={s.textOnlyWrapper}>
          {item.selectedTags?.length > 0 && (
            <View style={s.tagsRow}>
              {item.selectedTags.map((tag, idx) => {
                const cfg = getTagConfig(tag);
                return (
                  <View key={idx} style={[s.overlayPill, { backgroundColor: cfg.color }]}>
                    <FontAwesome6 name={cfg.icon} size={9} color="#fff" solid />
                    <Text style={s.overlayPillText}>{tag}</Text>
                  </View>
                );
              })}
            </View>
          )}
          {!!item?.desc && (
            <Text style={s.desc}>
              {item.desc}
            </Text>
          )}
        </View>
      )}

      {/* ── Images ── */}
      {!hasNoImages && (
        <View style={s.imageWrapper}>
          {/* Tag overlay */}
          <View style={s.tagOverlay}>
            {item.selectedTags?.map((tag, idx) => {
              const cfg = getTagConfig(tag);
              return (
                <View key={idx} style={[s.overlayPill, { backgroundColor: cfg.color }]}>
                  <FontAwesome6 name={cfg.icon} size={9} color="#fff" solid />
                  <Text style={s.overlayPillText}>{tag}</Text>
                </View>
              );
            })}
          </View>

          <View style={s.imageContainer}>
            {item.imageUrl.length === 1 ? (
              <TouchableOpacity
                activeOpacity={0.95}
                onPress={() => navigation.navigate('ImageViewerScreen', { images: item.imageUrl, initialIndex: 0 })}
              >
                <Image source={{ uri: item.imageUrl[0] }} style={s.singleImage} />
              </TouchableOpacity>
            ) : (
              <View style={s.multiGrid}>
                {item.imageUrl.slice(0, 4).map((url, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[s.gridCell, item.imageUrl.length === 3 && idx === 0 && s.gridCellWide]}
                    activeOpacity={0.9}
                    onPress={() => navigation.navigate('ImageViewerScreen', { images: item.imageUrl, initialIndex: idx })}
                  >
                    <Image source={{ uri: url }} style={s.gridImage} />
                    {idx === 3 && item.imageUrl.length > 4 && (
                      <View style={s.moreOverlay}>
                        <Text style={s.moreText}>+{item.imageUrl.length - 4}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          <ReportModal visible={showReportModal} onClose={() => setShowReportModal(false)} item={item} />
        </View>
      )}

      {/* Description below images when both exist */}
      {!hasNoImages && !!item?.desc && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <Text style={s.desc}>{item.desc}</Text>
        </View>
      )}

      {hasNoImages && (
        <ReportModal visible={showReportModal} onClose={() => setShowReportModal(false)} item={item} />
      )}

      {/* ── Reaction Summary ── */}
      {reactionCounts.length > 0 && (
        <View style={s.reactionSummary}>
          {reactionCounts.map(([emoji, count]) => (
            <View key={emoji} style={[s.reactionChip, mergedReactions[userId] === emoji && s.reactionChipActive]}>
              <Text style={{ fontSize: 11 }}>{emoji}</Text>
              <Text style={s.reactionChipCount}>{count}</Text>
            </View>
          ))}
          {totalReactions > 0 && (
            <Text style={s.totalReactionsText}>{totalReactions} {totalReactions === 1 ? 'reaction' : 'reactions'}</Text>
          )}
        </View>
      )}

      {/* ── Action Bar ── */}
      <View style={s.actionBar}>
        {/* React */}
        <Animated.View style={{ transform: [{ scale: heartScale }] }}>
          <TouchableOpacity
            style={[s.actionBtn, myReaction && s.actionBtnActive]}
            onPress={() => setShowEmojiPicker(v => !v)}
            activeOpacity={0.75}
          >
            <Text style={{ fontSize: 14 }}>{myReaction || '🤍'}</Text>
            {totalReactions > 0 && (
              <Text style={[s.actionBtnLabel, myReaction && { color: '#EF4444' }]}>{totalReactions}</Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Comment */}
        <TouchableOpacity style={s.actionBtn} onPress={() => setShowComments(true)} activeOpacity={0.75}>
          <Icon name="comment-o" size={14} color={isDark ? '#94a3b8' : '#64748b'} />
          <Text style={s.actionBtnLabel}>
            {item.commentCount ? `${item.commentCount} comments` : '0 Comments'}
          </Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        {/* Chat button */}
        <TouchableOpacity style={s.chatBtn} onPress={openProfileDrawer} activeOpacity={0.8}>
          <Icon name="paper-plane" size={11} color="#fff" />
          <Text style={s.chatBtnLabel}>Chat</Text>
        </TouchableOpacity>
      </View>

      {/* ── Emoji Picker ── */}
      {showEmojiPicker && (
        <View style={s.emojiPicker}>
          {REACTION_EMOJIS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={[s.emojiBtn, myReaction === emoji && s.emojiBtnActive]}
              onPress={() => handleEmojiTap(emoji)}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 22 }}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <CommentModal
        visible={showComments}
        onClose={() => setShowComments(false)}
        postId={item.id}
        appdatabase={appdatabase}
      />

      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={closeProfileDrawer}
        startChat={handleChatNavigation}
        selectedUser={selectedUser}
        isOnline={isOnline}
        bannedUsers={bannedUsers}
      />
    </View>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    card: {
      marginHorizontal: 12,
      marginVertical: 6,
      borderRadius: 20,
      backgroundColor: isDark ? '#1a2540' : '#ffffff',
      borderWidth: 1,
      borderColor: isDark ? '#243050' : '#f0f4ff',
      shadowColor: isDark ? '#000' : '#1a1a2e',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.35 : 0.07,
      shadowRadius: 12,
      elevation: isDark ? 6 : 3,
      overflow: 'hidden',
    },

    /* Header */
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 10,
    },
    avatarWrapper: {
      shadowColor: config.colors.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      borderWidth: 2.5,
      borderColor: config.colors.primary,
    },
    badge: {
      width: 14,
      height: 14,
    },
    name: {
      fontWeight: '800',
      fontSize: 14,
      color: isDark ? '#e2e8f0' : '#0f172a',
      letterSpacing: 0.1,
    },
    time: {
      fontSize: 11,
      color: isDark ? '#475569' : '#94a3b8',
      marginTop: 2,
    },
    menuBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: isDark ? '#243050' : '#f8fafc',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    menuItemText: {
      fontSize: 13,
      fontWeight: '600',
    },

    /* Tags (text-only) */
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingHorizontal: 14,
      paddingBottom: 8,
    },
    tagPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1.5,
    },
    tagPillText: {
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'capitalize',
    },

    /* Description */
    desc: {
      fontSize: 14,
      color: isDark ? '#cbd5e1' : '#374151',
      lineHeight: 21,
    },

    /* Text-only wrapper */
    textOnlyWrapper: {
      paddingHorizontal: 14,
      paddingBottom: 10,
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 8,
      justifyContent: 'flex-end',
    },
    imageWrapper: {
      marginHorizontal: 14,
      marginBottom: 8,
      borderRadius: 16,
      overflow: 'hidden',
    },
    tagOverlay: {
      position: 'absolute',
      top: 8,
      right: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      zIndex: 10,
    },
    overlayPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 999,
    },
    overlayPillText: {
      fontSize: 10,
      color: '#fff',
      fontWeight: '800',
    },
    imageContainer: {
      borderRadius: 16,
      overflow: 'hidden',
    },
    singleImage: {
      width: '100%',
      height: 230,
      resizeMode: 'cover',
    },
    multiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 3,
    },
    gridCell: {
      width: '49.3%',
      height: 140,
      borderRadius: 10,
      overflow: 'hidden',
    },
    gridCellWide: {
      width: '100%',
      height: 180,
    },
    gridImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    moreOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    moreText: {
      color: '#fff',
      fontSize: 22,
      fontWeight: '800',
    },

    /* Action bar */
    actionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingBottom: 12,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: isDark ? '#243050' : '#f1f5f9',
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    actionBtnActive: {
      backgroundColor: isDark ? '#1e293b' : '#fff1f2',
      borderColor: '#EF4444',
    },
    actionBtnLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: isDark ? '#94a3b8' : '#64748b',
    },

    /* Reaction summary */
    reactionSummary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 14,
      paddingBottom: 6,
      flexWrap: 'wrap',
    },
    reactionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    reactionChipActive: {
      backgroundColor: isDark ? '#1e3a5f' : '#eff6ff',
      borderColor: isDark ? '#3b82f6' : '#bfdbfe',
    },
    reactionChipCount: {
      fontSize: 10,
      fontWeight: '700',
      color: isDark ? '#94a3b8' : '#64748b',
    },
    totalReactionsText: {
      fontSize: 10,
      color: isDark ? '#475569' : '#94a3b8',
      marginLeft: 2,
    },

    /* Emoji picker */
    emojiPicker: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      marginHorizontal: 14,
      marginBottom: 10,
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      borderRadius: 20,
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    emojiBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    emojiBtnActive: {
      backgroundColor: isDark ? '#1e3a5f' : '#eff6ff',
      borderWidth: 2,
      borderColor: config.colors.primary,
    },

    chatBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: config.colors.primary,
      shadowColor: config.colors.primary,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.35,
      shadowRadius: 6,
      elevation: 4,
    },
    chatBtnLabel: {
      color: '#ffffff',
      fontWeight: '800',
      fontSize: 11,
    },
  });

export default memo(PostCard, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.likes === nextProps.item.likes &&
    prevProps.item.reactions === nextProps.item.reactions &&
    prevProps.item.commentCount === nextProps.item.commentCount &&
    prevProps.userId === nextProps.userId &&
    prevProps.localState?.isPro === nextProps.localState?.isPro &&
    prevProps.appdatabase === nextProps.appdatabase &&
    prevProps.onReaction === nextProps.onReaction
  );
});
