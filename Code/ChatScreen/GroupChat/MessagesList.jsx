import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  FlatList,
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  Vibration,
  Image,
  Alert,
  Keyboard,
  StyleSheet,
  Animated,
} from 'react-native';
import { getStyles } from './../Style';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import ReportPopup from './../ReportPopUp';
import { parseMessageText } from '../ChatHelper';
import { useHaptic } from '../../Helper/HepticFeedBack';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../../GlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import axios from 'axios';
import { useLocalState } from '../../LocalGlobelStats';
import { getDeviceLanguage } from '../../../i18n';
import { mixpanel } from '../../AppHelper/MixPenel';
import StyledUsernamePreview from '../../SettingScreen/Store/StyledName';
import { banUserwithEmail, unbanUserWithEmail } from '../utils';
import RoleBadges from '../../Design/componenets/RoleBadges';
import { resolveProfile, seedFromMessage, warmProfileCache, getCachedProfile } from '../../Helper/profileCache';
import { getSafeTextColor, RainbowText, isMultiColorText, getMultiColorPalette } from '../../Helper/contrastHelper';
import FramedAvatar from './FramedAvatar';

const FRUIT_KEYWORDS = [
  'rocket', 'spin', 'chop', 'spring', 'bomb', 'spike', 'blade',
  'smoke', 'flame', 'ice', 'sand', 'dark', 'diamond', 'falcon',
  'rubber', 'barrier', 'ghost', 'light', 'magma', 'quake', 'love',
  'spider', 'sound', 'portal', 'pain', 'rumble', 'blizzard', 'buddha',
  'phoenix', 'gravity', 'shadow', 'venom', 'control', 'spirit', 'dough',
  'gas', 'dragon', 'leopard', 'kitsune', 'mammoth', 't-rex', 'yeti', 'perm', 'west', 'east', 'gamepass', 'skin', 'chromatic', 'permanent', 'Fruit Storage', 'game pass', 'Eagle', 'Creation', 'gamepass'
];


const iconMap = {
  camping: require('../../../assets/Icons/camping.png'),
  dinamite: require('../../../assets/Icons/dinamite.png'),
  fire: require('../../../assets/Icons/fire.png'),
  grenade: require('../../../assets/Icons/grenade.png'),
  'handheld-game': require('../../../assets/Icons/handheld-game.png'),
  'paw-print': require('../../../assets/Icons/paw-print.png'),
  play: require('../../../assets/Icons/play.png'),
  'shooting-star': require('../../../assets/Icons/shooting-star.png'),
  smile: require('../../../assets/Icons/smile.png'),
  symbol: require('../../../assets/Icons/symbol.png'),
  'treasure-map': require('../../../assets/Icons/treasure-map.png'),
};


const MessagesList = ({
  messages,
  isAtBottom, setIsAtBottom,
  handleLoadMore,
  user,
  isDarkMode,
  onPinMessage,
  onDeleteMessage,
  onReply,
  // isAdmin,
  refreshing,
  flatListRef,
  onRefresh,
  banUser,
  makeadmin,
  removeAdmin,
  unbanUser,
  // isOwner,
  toggleDrawer,
  onDeleteAllMessage,
  chatPath,
  setMessages
}) => {
  const styles = getStyles(isDarkMode);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null); // 👈 NEW
  const [profileCacheVersion, setProfileCacheVersion] = useState(0);
  const { triggerHapticFeedback } = useHaptic();
  const scrollButtonOpacity = useMemo(() => new Animated.Value(0), []);
  // const [isAtBottom, setIsAtBottom] = useState(true);
  const { t } = useTranslation();
  // const { language, changeLanguage } = useLanguage();
  const { isAdmin, isModerator, api, freeTranslation, proGranted, appdatabase } = useGlobalState()
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState } = useLocalState();
  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);

  const handleCopy = (message) => {
    Clipboard.setString(message?.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage('Success', 'Message Copied');
  };

  const scrollToMessage = useCallback(
    (targetId) => {
      if (!flatListRef?.current || !targetId) return;

      const index = messages.findIndex((m) => m.id === targetId);
      if (index === -1) return;

      try {
        flatListRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });

        // highlight only the scrolled-to message
        setHighlightedMessageId(targetId);

        setTimeout(() => {
          setHighlightedMessageId((current) =>
            current === targetId ? null : current,
          );
        }, 1500);
      } catch (e) {
        // console.log('scrollToIndex error:', e);
      }
    },
    [flatListRef, messages],
  );





  const fruitColors = useMemo(
    () => ({
      wrapperBg: isDarkMode ? '#0f172a55' : '#e5e7eb55',
      name: isDarkMode ? '#f9fafb' : '#111827',
      valueColor: isDarkMode ? '#e5e7eb' : '#4b5563', // renamed from 'value' to avoid Reanimated false positive on .value
      divider: isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel: isDarkMode ? '#e5e7eb' : '#4b5563',
      totalValue: isDarkMode ? '#f97373' : '#b91c1c',
    }),
    [isDarkMode],
  );

  // console.log(messages)

  const translateText = async (text, targetLang = deviceLanguage) => {
    const placeholders = {};
    let maskedText = text;

    // Step 1: Replace fruit names with placeholders
    FRUIT_KEYWORDS.forEach((word, index) => {
      const placeholder = `__FRUIT_${index}__`;
      const regex = new RegExp(`\\b${word}\\b`, 'gi'); // match full word, case-insensitive
      maskedText = maskedText.replace(regex, placeholder);
      placeholders[placeholder] = word;
    });

    try {
      // Step 2: Send masked text for translation
      const response = await axios.post(
        `https://translation.googleapis.com/language/translate/v2`,
        {},
        {
          params: {
            q: maskedText,
            target: targetLang,
            key: api,
          },
        }
      );

      let translated = response.data.data.translations[0].translatedText;

      // Step 3: Replace placeholders back with original fruit names
      Object.entries(placeholders).forEach(([placeholder, word]) => {
        translated = translated.replace(new RegExp(placeholder, 'g'), word);
      });
      mixpanel.track("Translation", { lang: targetLang });

      return translated;
    } catch (err) {
      // ✅ HANDLED: Catch network/API errors gracefully (no crash)
      // Only log in development, suppress in production to avoid red banner
      if (__DEV__) {
        console.error('Translation Error:', err?.message || err);
      }
      return null; // Return null to trigger user-friendly error message
    }
  };

  const handleTranslate = async (item) => {
    // ✅ Check unlimited status
    const isUnlimited = freeTranslation || localState.isPro;

    // ✅ Check limit BEFORE translation (reads from storage for real-time accuracy)
    if (!isUnlimited && !canTranslate()) {
      Alert.alert('Limit Reached', 'You can only translate 5 messages per day.');
      return;
    }

    // ✅ Only increment AFTER successful translation
    const translated = await translateText(item?.text, deviceLanguage);

    if (translated) {
      // ✅ Increment count (reads from storage first, then updates)
      if (!isUnlimited) incrementTranslationCount();

      // ✅ Get remaining tries (reads from storage for real-time accuracy)
      const remaining = isUnlimited ? 'Unlimited' : `${getRemainingTranslationTries()} remaining`;

      Alert.alert(
        'Translated Message',
        `${translated}\n\n🧠 Daily Limit: ${remaining}${isUnlimited
          ? ''
          : '\n\n🔓 Want more? Upgrade to Pro for unlimited translations.'
        }`
      );
    } else {
      Alert.alert('Error', 'Translation failed. Please try again later.');
    }
  };


  const handleLongPress = (item) => {
    if (!user?.id) return;
    Vibration.vibrate(20); // Vibrate for feedback
    setSelectedMessage(item);
  };

  const handleReport = (message) => {
    triggerHapticFeedback('impactLight');
    setSelectedMessage(message);
    setShowReportPopup(true);
  };

  const handleReportSuccess = (reportedMessageId) => {
    triggerHapticFeedback('impactLight');
    setMessages(prevMessages => {
      const updated = prevMessages.map(msg =>
        msg?.id === reportedMessageId
          ? { ...msg, isReportedByUser: true }
          : msg
      );
      return updated;
    });
  };
  const getReplyPreview = (replyTo) => {
    if (!replyTo) return '[Deleted message]';

    if (replyTo.text && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }

    if (replyTo.gif) {
      return '[Emoji]';
    }

    if (replyTo.hasFruits) {
      const count = replyTo.fruitsCount || 0;
      return count > 0
        ? `[${count} pet(s) message]`
        : '[Pets message]';
    }

    return '[Deleted message]';
  };


  const handleProfileClick = (item) => {
    // console.log(item)
    if (user.id) { toggleDrawer(item); triggerHapticFeedback('impactLight'); }
    else return

  };

  // ✅ Scroll to bottom handler
  const handleScrollToBottom = useCallback(() => {
    if (!flatListRef?.current) return;

    triggerHapticFeedback('impactLight');

    try {
      // Since FlatList is inverted, index 0 is the bottom (newest message)
      flatListRef.current.scrollToIndex({
        index: 0,
        animated: true,
        viewPosition: 0,
      });
      setIsAtBottom(true);
    } catch (error) {
      // Fallback: scroll to offset 0
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
      setIsAtBottom(true);
    }
  }, [flatListRef, triggerHapticFeedback, setIsAtBottom]);

  // ✅ Warm profile cache for any senders not yet cached (fixes missing
  // avatar/username on cold start when messages are slim).
  useEffect(() => {
    if (!appdatabase || !Array.isArray(messages) || messages.length === 0) return;
    const uidsNeeded = [];
    for (const m of messages) {
      const uid = m?.senderId;
      if (!uid) continue;
      // Skip if message already carries avatar+sender (old format) or cache hit
      if ((m.avatar && m.sender) || getCachedProfile(uid)) continue;
      uidsNeeded.push(uid);
    }
    if (uidsNeeded.length === 0) return;
    let cancelled = false;
    warmProfileCache(appdatabase, uidsNeeded).then(() => {
      if (!cancelled) setProfileCacheVersion(v => v + 1);
    });
    return () => { cancelled = true; };
  }, [messages, appdatabase]);

  // ✅ Animate scroll button visibility
  useEffect(() => {
    Animated.timing(scrollButtonOpacity, {
      toValue: isAtBottom ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isAtBottom, scrollButtonOpacity]);
  // console.log(user)
  const renderMessage = useCallback(({ item, index }) => {
    // console.log(item)
    const previousMessage = messages[index + 1];
    const currentDate = new Date(item.timestamp).toDateString();
    const previousDate = previousMessage
      ? new Date(previousMessage.timestamp).toDateString()
      : null;
    const shouldShowDateHeader = currentDate !== previousDate;

    const fruits = Array.isArray(item.fruits) ? item.fruits : [];
    // console.log( item.fruits)

    const hasFruits = fruits.length > 0;
    const totalFruitValue = hasFruits
      ? fruits.reduce((sum, f) => sum + (Number(f.value) || 0), 0)
      : 0;

    // ✅ Resolve profile: message fields → cache → defaults (backwards compatible)
    const profile = resolveProfile(item);
    seedFromMessage(item); // Free cache population from old-format messages


    // ✅ Trophy badge (recent win within 24 hours)
    const hasRecentWin = profile.hasRecentGameWin;

    // console.log(user.id)

    return (
      <View>
        {/* Display the date header if it's a new day */}
        {shouldShowDateHeader && (
          <View>
            <Text style={styles.dateSeparator}>{currentDate}</Text>
          </View>
        )}

        {/* Render the message */}
        {!item.isReportedByUser && <View
          style={[
            item.senderId === user?.id ? styles.mymessageBubble : styles.othermessageBubble,
            (item.senderId === user?.id || item.isAdmin) ? styles.myMessage : styles.otherMessage, item.isReportedByUser && styles.reportedMessage,
            item.id === highlightedMessageId && styles.highlightedMessage, // 👈 NEW
          ]}
        >
          <View
            style={[
              styles.senderName,
            ]}
          >

            <TouchableOpacity onPress={() => handleProfileClick(item)}>
              <FramedAvatar
                avatarUri={profile.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                frame={profile.profileFrame}
                isDarkMode={isDarkMode}
                avatarSize={28}
              />
            </TouchableOpacity>

          </View>

          <View style={styles.messageTextBox}>
            {item.replyTo && (
              <TouchableOpacity
                style={styles.replyContainer}
                activeOpacity={0.7}
                onPress={() => scrollToMessage(item.replyTo.id)}
              >
                <Text style={styles.replyText} numberOfLines={2}>
                  Replying to: {'\n'}
                  {getReplyPreview(item.replyTo)}
                </Text>
              </TouchableOpacity>
            )}



            <Menu>
              <MenuTrigger
                onLongPress={() => handleLongPress(item)}
                customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
              >
                <View style={[
                  item.senderId === user?.id ? styles.myMessageText : styles.otherMessageText,
                  isAdmin && item.strikeCount === 1 ? { backgroundColor: 'pink' }
                    : isAdmin && item.strikeCount >= 2 ? { backgroundColor: 'red' }
                    : profile.chatBubbleBg
                      ? { backgroundColor: isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color }
                      : null,
                ]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                    {item?.style ? (
                      <StyledUsernamePreview
                        text={profile.displayName || item.sender || 'Anonymous'}
                        variant={item.style.variant}
                        options={item.style}
                        fontSize={14}
                        lineHeight={18}
                        marginVertical={0}
                      />
                    ) : (
                      <Text style={[
                        styles.userName,
                      ]}>{profile.displayName || item.sender || 'Anonymous'}</Text>
                    )}
                    {(profile.isPro || item?.isPro) && (
                      <Image
                        source={require('../../../assets/pro.png')}
                        style={styles.icon}
                      />
                    )}
                    {item?.proGranted && (
                      <Image
                        source={require('../../../assets/progranted.png')}
                        style={{ width: 16, height: 16, marginLeft: 2 }}
                      />
                    )}
                    {Array.isArray(item.icons) && item.icons.slice(0, 4).map(iconKey => (
                      <Image
                        key={iconKey}
                        source={iconMap[iconKey]}
                        style={{ width: 16, height: 16, marginLeft: 2, resizeMode: 'contain' }}
                      />
                    ))}
                    {(profile.robloxUsernameVerified || item?.robloxUsernameVerified) && (
                      <Image
                        source={require('../../../assets/verification.png')}
                        style={styles.icon}
                      />
                    )}
                    {hasRecentWin && (
                      <Image
                        source={require('../../../assets/trophy.webp')}
                        style={{ width: 10, height: 10, marginLeft: 4 }}
                      />
                    )}
                    <Text>{''}</Text>
                    <RoleBadges userItem={item} cacheVersion={profileCacheVersion} />

                    {isAdmin && item.OS && (
                      <View
                        style={[
                          styles.platformBadge,
                        ]}
                      >
                        <Icon
                          name={item.OS === 'ios' ? 'logo-apple' : 'logo-android'}
                          size={14}
                          color={item.OS === 'ios' ? '#007AFF' : '#34C759'}
                        />
                      </View>
                    )}

                  </View>



                  {/* {'\n'} */}

                  {item.gif && <View><Image src={item.gif} style={{ height: 50, width: 50, resizeMode: 'contain' }} /></View>}
                  {item?.text && (
                    isMultiColorText(profile.chatTextColor)
                      ? <RainbowText
                          colors={getMultiColorPalette(profile.chatTextColor)}
                          style={[item.senderId === user?.id ? styles.myMessageTextOnly : styles.otherMessageTextOnly]}
                        >{parseMessageText(item.text)}</RainbowText>
                      : <Text style={[
                          item.senderId === user?.id ? styles.myMessageTextOnly : styles.otherMessageTextOnly,
                          profile.chatTextColor
                            ? { color: getSafeTextColor(profile.chatTextColor, profile.chatBubbleBg ? (isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color) : null) }
                            : null,
                        ]}>{parseMessageText(item?.text)}</Text>
                  )}

                  {/* ✅ Fruits list inside bubble */}
                  {hasFruits && (
                    <View
                      style={[
                        fruitStyles.fruitsWrapper,
                        { backgroundColor: fruitColors.wrapperBg },
                      ]}
                    >
                      {fruits.map((fruit, index) => {
                        const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');

                        return (
                          <View
                            key={`${fruit.id || fruit.name}-${index}`}
                            style={fruitStyles.fruitCard}
                          >
                            <Image
                              source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/${fruit.type === 'n' ? '09' : '08'}/${formatName(fruit.name)}_Icon.webp` }}
                              style={fruitStyles.fruitImage}
                            />

                            <View style={fruitStyles.fruitInfo}>
                              <Text
                                style={[
                                  fruitStyles.fruitName,
                                  { color: fruitColors.name },
                                ]}
                                numberOfLines={1}
                              >
                                {`${fruit.name || fruit.Name} ${fruit.type === 'n' ? '' : '(P)'} `}
                              </Text>

                              <Text
                                style={[
                                  fruitStyles.fruitValue,
                                  { color: fruitColors.valueColor },
                                ]}
                              >
                                · Value: {Number(fruit.value || 0).toLocaleString()}
                              </Text>
                            </View>
                          </View>
                        );
                      })}

                      {/* ✅ Total row – only if more than one fruit */}
                      {fruits.length > 1 && (
                        <View
                          style={[
                            fruitStyles.totalRow,
                            { borderTopColor: fruitColors.divider },
                          ]}
                        >
                          <Text
                            style={[
                              fruitStyles.totalLabel,
                              { color: fruitColors.totalLabel },
                            ]}
                          >
                            Total:
                          </Text>
                          <Text
                            style={[
                              fruitStyles.totalValue,
                              { color: fruitColors.totalValue },
                            ]}
                          >
                            {totalFruitValue.toLocaleString()}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                </View>
              </MenuTrigger>
              <MenuOptions customStyles={{
                optionsContainer: styles.menuoptions,
                optionWrapper: styles.menuOption,
                optionText: styles.menuOptionText,
              }}>
                <MenuOption onSelect={() => handleCopy(item)}>
                  <Text style={styles.menuOptionText}>Copy</Text>
                </MenuOption>
                {user.id && (
                  <MenuOption onSelect={() => onReply(item)}>
                    <Text style={styles.menuOptionText}>{t("chat.reply")}</Text>
                  </MenuOption>
                )}
                <MenuOption onSelect={() => handleTranslate(item)}>
                  <Text style={styles.menuOptionText}>Translate</Text>
                </MenuOption>
                <MenuOption onSelect={() => handleReport(item)}>
                  <Text style={styles.menuOptionText}>{t("chat.report")}</Text>
                </MenuOption>
              </MenuOptions>
            </Menu>

            {/* {(item.reportCount > 0 || item.isReportedByUser) && (
              <Text style={styles.reportIcon}>Reported</Text>
            )} */}


          </View>




          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Text style={styles.timestamp}>
              {new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>

          </View>
          {(!isAdmin && !isModerator && item.senderId === user?.id) && (
            <Menu>
              <MenuTrigger>
                <Icon
                  name="ellipsis-vertical-outline"
                  size={16}
                  color={config.colors.hasBlockGreen}
                />
              </MenuTrigger>
              <MenuOptions >
                {/* <MenuOption onSelect={() => onPinMessage(item)} style={styles.pinButton}>
                    <Text style={styles.adminTextAction}>Pin</Text>
                  </MenuOption> */}
                <MenuOption onSelect={() => onDeleteMessage(item.id)} >
                  <Text style={[{ backgroundColor: 'red', padding: 10, color: 'white' }]}>Delete</Text>
                </MenuOption>





                {/* {isAdmin && (
                    <MenuOption onSelect={() => makeadmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Make Admin</Text>
                    </MenuOption>
                  )}
                  {isAdmin && (
                    <MenuOption onSelect={() => removeAdmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Remove Admin</Text>
                    </MenuOption>
                  )} */}
              </MenuOptions>
            </Menu>
          )}
          {(isAdmin || isModerator) && (
            <Menu>
              <MenuTrigger>
                <Icon
                  name="ellipsis-vertical-outline"
                  size={16}
                  color={config.colors.hasBlockGreen}
                />
              </MenuTrigger>
              <MenuOptions>
                <View style={styles.adminActions}>
                  <MenuOption onSelect={() => onPinMessage(item)} style={styles.pinButton}>
                    <Text style={styles.adminTextAction}>Pin</Text>
                  </MenuOption>
                  <MenuOption onSelect={() => onDeleteMessage(item.id)} style={styles.deleteButton}>
                    <Text style={styles.adminTextAction}>Delete</Text>
                  </MenuOption>
                  <MenuOption onSelect={() => onDeleteAllMessage(item?.senderId)} style={styles.deleteButton}>
                    <Text style={styles.adminTextAction}>Delete All</Text>
                  </MenuOption>



                  {/* {isAdmin && (
                    <MenuOption onSelect={() => makeadmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Make Admin</Text>
                    </MenuOption>
                  )} */}
                  {/* {isAdmin && (
                    <MenuOption onSelect={() => removeAdmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Remove Admin</Text>
                    </MenuOption>
                  )} */}
                </View>
              </MenuOptions>
            </Menu>
          )}


        </View>}

      </View>
    );
  }, [messages, highlightedMessageId, user?.id, profileCacheVersion]);

  return (
    <>
      <FlatList
        data={[...new Map(messages?.map(msg => [msg.id, msg])).values()]}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={({ item, index }) => renderMessage({ item, index })}
        contentContainerStyle={styles.chatList}
        inverted
        removeClippedSubviews={false}
        extraData={`${highlightedMessageId}-${profileCacheVersion}`}
        ref={flatListRef}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          const { contentOffset } = nativeEvent;
          const atBottom = contentOffset.y <= 60;
          // console.log("✅ isAtBottom (detected):", atBottom);
          setIsAtBottom(atBottom);
        }}
        onEndReachedThreshold={0.1}
        onEndReached={handleLoadMore}
        initialNumToRender={15} // Render 15 messages initially to reduce text view overload
        maxToRenderPerBatch={8} // Smaller batches to reduce per-frame view creation pressure
        windowSize={5} // Adjust the window size for rendering nearby items
        updateCellsBatchingPeriod={100} // Spread rendering across more frames
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={isDarkMode ? '#FFF' : '#000'}
          />
        }
        // onScroll={() => Keyboard.dismiss()}
        onTouchStart={() => Keyboard.dismiss()}
        keyboardShouldPersistTaps="handled" // Ensures taps o
      />
      {/* ✅ Scroll to Bottom Button */}
      {!isAtBottom && (
        <Animated.View
          style={[
            styles.scrollToBottomButton,
            {
              opacity: scrollButtonOpacity,
              transform: [
                {
                  scale: scrollButtonOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleScrollToBottom}
            activeOpacity={0.8}
            style={styles.scrollToBottomTouchable}
          >
            <Icon
              name="chevron-down-circle"
              size={48}
              color={config.colors.primary}
            />
          </TouchableOpacity>
        </Animated.View>
      )}
      <ReportPopup
        visible={showReportPopup}
        message={selectedMessage}
        chatPath={chatPath}
        onClose={(success) => {
          if (success) {
            handleReportSuccess(selectedMessage.id);
          }
          setSelectedMessage(null);
          setShowReportPopup(false);
        }}
      />
    </>
  );
};
export const fruitStyles = StyleSheet.create({
  fruitsWrapper: {
    marginTop: 1,
    // gap: 1,
    backgroundColor: '#1E293B15', // subtle blue-ish bg
    padding: 4,
    borderRadius: 8,

  },
  fruitCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',

    flex: 1,

  },
  fruitImage: {
    width: 20,
    height: 20,
    borderRadius: 2,
    marginRight: 2,
    backgroundColor: '#0002',
  },
  fruitInfo: {
    // flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    // backgroundColor:'red',
    alignItems: 'center'
  },
  fruitName: {
    fontSize: 12,
    fontWeight: '500',
    // color: '#fff',
  },
  fruitValue: {
    fontSize: 11,
    // color: '#e5e5e5',
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    // marginTop: 4,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    // minWidth: 16,
    // justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#fff',
  },
  badgeDefault: {
    backgroundColor: '#FF6666', // D
  },
  badgeNeon: {
    backgroundColor: '#2ecc71', // N
  },
  badgeMega: {
    backgroundColor: '#9b59b6', // M
  },
  badgeFly: {
    backgroundColor: '#3498db', // F
  },
  badgeRide: {
    backgroundColor: '#e74c3c', // R
  },
  totalRow: {
    flexDirection: 'row',
    // justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#ffffff22',
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  },
  totalValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FF6666',
  },
});
export default MessagesList;