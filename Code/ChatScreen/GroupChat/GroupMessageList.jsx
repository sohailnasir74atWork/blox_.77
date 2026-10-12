import React, { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  FlatList,
  View,
  Text,
  RefreshControl,
  Image,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useGlobalState } from '../../GlobelStats';
import { getStyles } from '../Style';
import { useTranslation } from 'react-i18next';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { useNavigation } from '@react-navigation/native';
import { FRUIT_KEYWORDS } from '../../Helper/filter';
import { fruitStyles } from '../PrivateChat/PrivateMessageList';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { parseMessageText } from '../ChatHelper';
import { resolveProfile, seedFromMessage, warmProfileCache, getCachedProfile } from '../../Helper/profileCache';
import RoleBadges from '../../Design/componenets/RoleBadges';
import FramedAvatar from './FramedAvatar';
import { BirthdayCake } from '../../Birthdays/BirthdayBits';
import { getSafeTextColor, RainbowText, isMultiColorText, getMultiColorPalette } from '../../Helper/contrastHelper';

const GroupMessageList = ({
  messages,
  userId,
  user,
  groupData,
  handleLoadMore,
  refreshing,
  onRefresh,
  loading,
  isPaginating,
  onUserPress, // Callback to open profile drawer
  onReply, // Callback to reply to a message
  onDeleteMessage, // Callback to delete a single message
  onDeleteAllMessage, // Callback to delete all messages from a user
  scrollToMessage, // Function to scroll to a message
  highlightedMessageId, // ID of highlighted message
  flatListRef, // Ref for FlatList
  onPinMessage = null, // Callback to pin / unpin a message
  canPin = false, // The group's creator may pin too (staff always can)
  pinnedIds = null, // Set of pinned message ids (the menu then offers Unpin)
}) => {
  const { theme, isAdmin, isModerator, appdatabase } = useGlobalState();

  // Group messages carry no role fields, so staff/role badges come from the
  // profile cache (Supabase user_roles), same as the public chat.
  const [profileCacheVersion, setProfileCacheVersion] = useState(0);
  useEffect(() => {
    if (!appdatabase || !Array.isArray(messages) || messages.length === 0) return;
    const uids = [...new Set(messages.map(m => m?.senderId).filter(Boolean))]
      .filter(uid => {
        const c = getCachedProfile(uid);
        return !c || c._seeded;
      });
    if (uids.length === 0) return;
    let cancelled = false;
    warmProfileCache(appdatabase, uids).then(() => {
      if (!cancelled) setProfileCacheVersion(v => v + 1);
    });
    return () => { cancelled = true; };
  }, [messages, appdatabase]);
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { triggerHapticFeedback } = useHaptic();

  const [selectedMessage, setSelectedMessage] = useState(null);

  // Jumping to a reply or a pin far up the list: the row isn't laid out yet,
  // so get close by the average row height, then retry.
  const scrollRetryRef = useRef(0);
  const handleScrollToIndexFailed = useCallback((info) => {
    const list = flatListRef?.current;
    if (!list) return;
    list.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    // At most three retries per jump; the window reopens after 2 s.
    if (scrollRetryRef.current >= 3) return;
    scrollRetryRef.current += 1;
    if (scrollRetryRef.current === 1) setTimeout(() => { scrollRetryRef.current = 0; }, 2000);
    setTimeout(() => {
      try {
        flatListRef?.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
      } catch (e) { /* the next failure callback retries */ }
    }, 250);
  }, [flatListRef]);

  const fruitColors = useMemo(
    () => ({
      wrapperBg: isDarkMode ? '#0f172a55' : '#e5e7eb55',
      name: isDarkMode ? '#f9fafb' : '#111827',
      valueColor: isDarkMode ? '#e5e7eb' : '#4b5563',
      divider: isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel: isDarkMode ? '#e5e7eb' : '#4b5563',
      totalValue: isDarkMode ? '#f97373' : '#b91c1c',
    }),
    [isDarkMode],
  );

  // "My" bubble is always blue, so the fruits portfolio needs light text in both themes for contrast.
  const myFruitColors = useMemo(
    () => ({
      wrapperBg: '#ffffff1f',
      name: '#ffffff',
      valueColor: '#e0e7ff',
      divider: '#ffffff33',
      totalLabel: '#e0e7ff',
      totalValue: '#fecaca',
    }),
    [],
  );

  // Pre-compile regex patterns for FRUIT_KEYWORDS
  const fruitRegexPatterns = useMemo(() => {
    return FRUIT_KEYWORDS.map((word, index) => ({
      regex: new RegExp(`\\b${word}\\b`, 'gi'),
      placeholder: `__FRUIT_${index}__`,
      word,
    }));
  }, []);

  const handleCopy = useCallback((message) => {
    if (!message || !message.text) return;
    Clipboard.setString(message.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage(t('chat.message_common.success'), t('chat.message_common.message_copied'));
  }, [triggerHapticFeedback, t]);

  // Get reply preview text
  const getReplyPreview = useCallback((replyTo) => {
    if (!replyTo || typeof replyTo !== 'object') return t('chat.message_common.reply_deleted');

    if (replyTo.text && typeof replyTo.text === 'string' && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }

    if (replyTo.imageUrl) {
      return t('chat.message_common.reply_image');
    }

    if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
      const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
      return count > 0
        ? t('chat.message_common.reply_pets_count', { count })
        : t('chat.message_common.reply_pets');
    }

    return t('chat.message_common.reply_deleted');
  }, [t]);

  // Filtered messages (sorted descending for inverted FlatList)
  const filteredMessages = useMemo(() => {
    if (!Array.isArray(messages)) return [];
    return [...messages].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
  }, [messages]);

  const renderMessage = useCallback(
    ({ item }) => {
      if (!item || typeof item !== 'object') return null;

      const isMyMessage = item.senderId === userId;
      // Pick fruit-portfolio colors that contrast with this message's bubble.
      const fc = isMyMessage ? myFruitColors : fruitColors;

      // ✅ Resolve profile for cosmetics (text color, bubble bg, etc.)
      const profile = resolveProfile(item);
      seedFromMessage(item);
      const senderName = item.sender || 'Anonymous';
      const senderAvatar =
        item.avatar ||
        groupData?.members?.[item.senderId]?.avatar ||
        'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

      const fruits = Array.isArray(item.fruits) ? item.fruits : [];
      const hasFruits = fruits.length > 0;
      const totalFruitValue = hasFruits
        ? fruits.reduce((sum, f) => sum + (Number(f?.value) || 0), 0)
        : 0;

      // Check for recent win
      const hasRecentWin =
        item?.hasRecentGameWin ||
        (typeof item?.lastGameWinAt === 'number' &&
          Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);

      return (
        <View
          style={[
            isMyMessage ? styles.mymessageBubble : styles.othermessageBubble,
            isMyMessage ? styles.myMessage : styles.otherMessage,
            item.id === highlightedMessageId && {
              backgroundColor: isDarkMode ? '#3a2a10' : '#fef3c7',
              borderWidth: 2,
              borderColor: '#F59E0B',
            },
          ]}
        >
          {/* Avatar Container - matching main chat structure */}
          <View style={styles.senderName}>
            <TouchableOpacity
              onPress={() => {
                if (onUserPress && item.senderId) {
                  onUserPress({
                    senderId: item.senderId,
                    sender: senderName,
                    avatar: senderAvatar,
                  });
                }
              }}
              disabled={!onUserPress}
              activeOpacity={0.7}
              style={{ alignItems: 'center', justifyContent: 'center' }}
            >
              <FramedAvatar
                avatarUri={senderAvatar ||
                  'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                frame={profile.profileFrame || null}
                isDarkMode={isDarkMode}
                avatarSize={34}
              />
            </TouchableOpacity>
          </View>

          {/* Message Content Container */}
          <View style={styles.messageTextBox}>
            {/* Reply Preview */}
            {item.replyTo && (
              <TouchableOpacity
                style={[
                  styles.replyContainer,
                  { backgroundColor: isDarkMode ? '#374151' : '#E5E7EB' },
                ]}
                activeOpacity={0.7}
                onPress={() => scrollToMessage && scrollToMessage(item.replyTo.id)}
              >
                <Text style={[styles.replyText, { color: isDarkMode ? '#9CA3AF' : '#6B7280' }]} numberOfLines={2}>
                  {t('chat.replying_to')} {'\n'}
                  {getReplyPreview(item.replyTo)}
                </Text>
              </TouchableOpacity>
            )}

            {/* Username with badges - shown for ALL messages (including current user) */}


            <Menu>
              <MenuTrigger
                onLongPress={() => triggerHapticFeedback('impactMedium')}
                customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
              >
                {/* Message Content Wrapper - matching main chat structure */}
                <View style={[
                  isMyMessage ? styles.myMessageText : styles.otherMessageText,
                  profile.chatBubbleBg
                    ? { backgroundColor: isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color }
                    : null,
                ]}>
                  <TouchableOpacity
                    onPress={() => {
                      if (onUserPress && item.senderId) {
                        onUserPress({
                          senderId: item.senderId,
                          sender: senderName,
                          avatar: senderAvatar,
                        });
                      }
                    }}
                    disabled={!onUserPress}
                    activeOpacity={0.7}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      flexWrap: 'nowrap',
                    }}>
                      <Text
                        style={[
                          styles.userNameText,
                          // "My" bubble is always blue; force white name for contrast in light mode.
                          isMyMessage && { color: '#ffffff' },
                          { flexShrink: 1 },
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {item.sender || t('chat.anonymous')}
                      </Text>
                      <BirthdayCake uid={item.senderId} />

                      {/* Pro badge */}
                      {item?.isPro && (
                        <Image resizeMethod="resize"
                          source={require('../../../assets/pro.png')}
                          style={{ width: 16, height: 16, marginLeft: 4 }}
                        />
                      )}

                      {/* Verified badge */}
                      {item?.robloxUsernameVerified && (
                        <Image resizeMethod="resize"
                          source={require('../../../assets/verification.png')}
                          style={{ width: 16, height: 16, marginLeft: 4 }}
                        />
                      )}

                      {/* Trophy badge (recent win) */}
                      {hasRecentWin && (
                        <Image resizeMethod="resize"
                          source={require('../../../assets/trophy.webp')}
                          style={{ width: 10, height: 10, marginLeft: 4 }}
                        />
                      )}

                      {/* Creator badge */}
                      {item?.isCreator && (
                        <View style={{
                          backgroundColor: '#8B5CF6',
                          paddingHorizontal: 4,
                          paddingVertical: 1,
                          borderRadius: 3,
                          marginLeft: 4,
                        }}>
                          <Text style={{
                            color: '#FFF',
                            fontSize: 9,
                            fontWeight: '600'
                          }}>{t('chat.message_common.creator_badge')}</Text>
                        </View>
                      )}

                      <RoleBadges userItem={item} cacheVersion={profileCacheVersion} />
                    </View>
                  </TouchableOpacity>
                  {/* Image */}
                  {item.imageUrl && (
                    <View style={{ marginBottom: 4 }}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() =>
                          navigation.navigate('ImageViewerScreenChat', {
                            images: [item.imageUrl],
                            initialIndex: 0,
                          })
                        }
                      >
                        <Image resizeMethod="resize" source={{ uri: item.imageUrl }} style={styles.chatImage} />
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* 🐾 Fruits list (matching main chat style) */}
                  {hasFruits && (
                    <View
                      style={[
                        fruitStyles.fruitsWrapper,
                        { backgroundColor: fc.wrapperBg },
                      ]}
                    >
                      {fruits.map((fruit, index) => {
                        const valueType = (fruit.valueType || 'd').toLowerCase();

                        let valueBadgeStyle = fruitStyles.badgeDefault;
                        if (valueType === 'n') valueBadgeStyle = fruitStyles.badgeNeon;
                        if (valueType === 'm') valueBadgeStyle = fruitStyles.badgeMega;

                        return (
                          <View
                            key={`${fruit.id || fruit.name}-${index}`}
                            style={fruitStyles.fruitCard}
                          >
                            <Image resizeMethod="resize"
                              source={{ uri: fruit.imageUrl }}
                              style={fruitStyles.fruitImage}
                            />

                            <View style={fruitStyles.fruitInfo}>
                              <Text
                                style={[
                                  fruitStyles.fruitName,
                                  { color: fc.name },
                                ]}
                                numberOfLines={1}
                              >
                                {`${fruit.name || fruit.Name}  `}
                              </Text>

                              <Text
                                style={[
                                  fruitStyles.fruitValue,
                                  { color: fc.valueColor },
                                ]}
                              >
                                {t('chat.message_common.fruit_value', { value: Number(fruit.value || 0).toLocaleString() })}
                              </Text>

                              <View style={fruitStyles.badgeRow}>
                                {/* D / N / M badge */}
                                <View style={[fruitStyles.badge, valueBadgeStyle]}>
                                  <Text style={fruitStyles.badgeText}>
                                    {valueType.toUpperCase()}
                                  </Text>
                                </View>

                                {/* Fly badge */}
                                {fruit.isFly && (
                                  <View style={[fruitStyles.badge, fruitStyles.badgeFly]}>
                                    <Text style={fruitStyles.badgeText}>F</Text>
                                  </View>
                                )}

                                {/* Ride badge */}
                                {fruit.isRide && (
                                  <View style={[fruitStyles.badge, fruitStyles.badgeRide]}>
                                    <Text style={fruitStyles.badgeText}>R</Text>
                                  </View>
                                )}
                              </View>
                            </View>
                          </View>
                        );
                      })}

                      {/* ✅ Total row – only if more than one fruit */}
                      {fruits.length > 1 && (
                        <View
                          style={[
                            fruitStyles.totalRow,
                            { borderTopColor: fc.divider },
                          ]}
                        >
                          <Text
                            style={[
                              fruitStyles.totalLabel,
                              { color: fc.totalLabel },
                            ]}
                          >
                            {t('chat.message_common.total')}
                          </Text>
                          <Text
                            style={[
                              fruitStyles.totalValue,
                              { color: fc.totalValue },
                            ]}
                          >
                            {totalFruitValue.toLocaleString()}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Normal text (can be empty if only fruits) - matching main chat */}
                  {!!item.text && (
                    isMultiColorText(profile.chatTextColor)
                      ? <RainbowText
                          colors={getMultiColorPalette(profile.chatTextColor)}
                          style={[isMyMessage ? styles.myMessageTextOnly : styles.otherMessageTextOnly]}
                        >{parseMessageText(item.text)}</RainbowText>
                      : <Text style={[
                          isMyMessage ? styles.myMessageTextOnly : styles.otherMessageTextOnly,
                          profile.chatTextColor
                            ? { color: getSafeTextColor(profile.chatTextColor, profile.chatBubbleBg ? (isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color) : null) }
                            : null,
                        ]}>
                          {parseMessageText(item.text)}
                        </Text>
                  )}
                </View>
              </MenuTrigger>

              <MenuOptions
                customStyles={{
                  optionsContainer: styles.menuoptions,
                  optionWrapper: styles.menuOption,
                  optionText: styles.menuOptionText,
                }}
              >
                <MenuOption onSelect={() => handleCopy(item)}>
                  <Text style={styles.menuOptionText}>{t('chat.copy')}</Text>
                </MenuOption>
                {userId && onReply && (
                  <MenuOption onSelect={() => onReply(item)}>
                    <Text style={styles.menuOptionText}>{t('chat.reply')}</Text>
                  </MenuOption>
                )}
                {onPinMessage && (isAdmin || isModerator || canPin) && (
                  <MenuOption onSelect={() => onPinMessage(item)}>
                    <Text style={styles.menuOptionText}>
                      {pinnedIds?.has(item.id)
                        ? t('chat.unpin_message', { defaultValue: 'Unpin' })
                        : t('chat.pin_this_message', { defaultValue: 'Pin Message' })}
                    </Text>
                  </MenuOption>
                )}
                {(isAdmin || isModerator) && onDeleteMessage && (
                  <MenuOption onSelect={() => onDeleteMessage(item.id)}>
                    <Text style={[styles.menuOptionText, { color: '#FF3B30' }]}>Delete</Text>
                  </MenuOption>
                )}
                {(isAdmin || isModerator) && onDeleteAllMessage && (
                  <MenuOption onSelect={() => onDeleteAllMessage(item?.senderId)}>
                    <Text style={[styles.menuOptionText, { color: '#FF3B30' }]}>Delete All</Text>
                  </MenuOption>
                )}
              </MenuOptions>
            </Menu>
          </View>

          <Text style={styles.timestamp}>
            {item.timestamp
              ? new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
              : ''}
          </Text>
        </View>
      );
    },
    [userId, user, groupData, styles, fruitColors, myFruitColors, handleCopy, navigation, triggerHapticFeedback, onUserPress, isDarkMode, onReply, scrollToMessage, highlightedMessageId, getReplyPreview, t, onPinMessage, canPin, pinnedIds, isAdmin, isModerator, profileCacheVersion]
  );

  const keyExtractor = useCallback((item, index) => {
    return item?.id || `msg-${index}`;
  }, []);

  const messageListStyles = useMemo(
    () => ({
      flex: 1,
    }),
    []
  );

  const messageListContentStyles = useMemo(
    () => ({
      flexGrow: 1,
      paddingHorizontal: 10,
      paddingVertical: 5,
      ...(filteredMessages.length === 0 && { justifyContent: 'flex-end' }),
    }),
    [filteredMessages.length]
  );


  return (
    <FlatList
      ref={flatListRef}
      data={filteredMessages}
      renderItem={renderMessage}
      keyExtractor={keyExtractor}
      inverted={true} // ✅ Latest messages at bottom
      style={messageListStyles}
      contentContainerStyle={messageListContentStyles}
      extraData={`${highlightedMessageId}-${profileCacheVersion}`} // Re-render on highlight / roles loaded
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
      }
      onEndReached={handleLoadMore} // ✅ Fires when scrolling to top (for inverted list)
      onEndReachedThreshold={0.3} // ✅ Trigger earlier for smoother loading
      initialNumToRender={15} // ✅ Render 15 messages initially
      maxToRenderPerBatch={8} // ✅ Smaller batches to reduce per-frame view creation pressure
      windowSize={5} // ✅ Optimize memory usage
      updateCellsBatchingPeriod={100} // ✅ Spread rendering across more frames
      removeClippedSubviews={false} // ✅ Fix for getChildDrawingOrder crash
      ListFooterComponent={
        isPaginating ? (
          <View style={{ padding: 16, alignItems: 'center' }}>
            <ActivityIndicator size="small" color="#8B5CF6" />
          </View>
        ) : null
      }
      ListEmptyComponent={
        !loading ? (
          <View style={{ padding: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={styles.emptyText}>{t('chat.message_common.no_messages')}</Text>
          </View>
        ) : null
      }
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      onScrollToIndexFailed={handleScrollToIndexFailed}
    />
  );
};

export default memo(GroupMessageList);
