import React, { memo, useMemo, useState, useCallback } from 'react';
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
import { resolveProfile, seedFromMessage } from '../../Helper/profileCache';
import FramedAvatar from './FramedAvatar';
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
}) => {
  const { theme, isAdmin, isModerator } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { triggerHapticFeedback } = useHaptic();

  const [selectedMessage, setSelectedMessage] = useState(null);

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
    showSuccessMessage('Success', 'Message Copied');
  }, [triggerHapticFeedback]);

  // Get reply preview text
  const getReplyPreview = useCallback((replyTo) => {
    if (!replyTo || typeof replyTo !== 'object') return '[Deleted message]';

    if (replyTo.text && typeof replyTo.text === 'string' && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }

    if (replyTo.imageUrl) {
      return '[Image]';
    }

    if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
      const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
      return count > 0
        ? `[${count} pet(s) message]`
        : '[Pets message]';
    }

    return '[Deleted message]';
  }, []);

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
                  Replying to: {'\n'}
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
                        {senderName}
                      </Text>

                      {/* Pro badge */}
                      {item?.isPro && (
                        <Image
                          source={require('../../../assets/pro.png')}
                          style={{ width: 16, height: 16, marginLeft: 4 }}
                        />
                      )}

                      {/* Verified badge */}
                      {item?.robloxUsernameVerified && (
                        <Image
                          source={require('../../../assets/verification.png')}
                          style={{ width: 16, height: 16, marginLeft: 4 }}
                        />
                      )}

                      {/* Trophy badge (recent win) */}
                      {hasRecentWin && (
                        <Image
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
                          }}>Creator</Text>
                        </View>
                      )}
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
                        <Image source={{ uri: item.imageUrl }} style={styles.chatImage} />
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
                            <Image
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
                                · Value: {Number(fruit.value || 0).toLocaleString()}
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
                            Total:
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
                  <Text style={styles.menuOptionText}>Copy</Text>
                </MenuOption>
                {userId && onReply && (
                  <MenuOption onSelect={() => onReply(item)}>
                    <Text style={styles.menuOptionText}>{t('chat.reply')}</Text>
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
    [userId, user, groupData, styles, fruitColors, myFruitColors, handleCopy, navigation, triggerHapticFeedback, onUserPress, isDarkMode, onReply, scrollToMessage, highlightedMessageId, getReplyPreview, t]
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
      extraData={highlightedMessageId} // Re-render when highlight changes
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
            <Text style={styles.emptyText}>No messages yet</Text>
          </View>
        ) : null
      }
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
  );
};

export default memo(GroupMessageList);
