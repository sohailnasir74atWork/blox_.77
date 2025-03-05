import React, { useCallback, useState } from 'react';
import {
  FlatList,
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  Vibration,
  Image,
  Linking,
  Alert,
  Keyboard,
} from 'react-native';
import { getStyles } from './../Style';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import ReportPopup from './../ReportPopUp';
import { parseMessageText } from '../ChatHelper';
import { useHaptic } from '../../Helper/HepticFeedBack';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';



const MessagesList = ({
  messages,
  handleLoadMore,
  user,
  isDarkMode,
  onPinMessage,
  onDeleteMessage,
  onReply,
  // isAdmin,
  refreshing,
  onRefresh,
  banUser,
  makeadmin,
  removeAdmin,
  unbanUser,
  // isOwner,
  toggleDrawer,
  setMessages
}) => {
  const styles = getStyles(isDarkMode);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const isAdmin = user?.id  ? 'illHUCN4EzPwcmZLzRD3hJXI4vm1' : false

  console.log(user)


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
    setMessages((prevMessages) =>
      prevMessages.map((msg) =>
        msg.id === reportedMessageId ? { ...msg, isReportedByUser: true } : msg
      )
    );
  };

  const handleProfileClick = (item) => {
    // console.log(item)
    if (user.id) { toggleDrawer(item); triggerHapticFeedback('impactLight'); }
    else return

  };
  // console.log(user)
  const renderMessage = useCallback(({ item, index }) => {
    const previousMessage = messages[index + 1];
    const currentDate = new Date(item.timestamp).toDateString();
    const previousDate = previousMessage
      ? new Date(previousMessage.timestamp).toDateString()
      : null;
    const shouldShowDateHeader = currentDate !== previousDate;


    return (
      <View>
        {/* Display the date header if it's a new day */}
        {shouldShowDateHeader && (
          <View>
            <Text style={styles.dateSeparator}>{currentDate}</Text>
          </View>
        )}

        {/* Render the message */}
        <View
          style={[
            item.senderId === user?.id ? styles.mymessageBubble : styles.othermessageBubble,
            item.senderId === user?.id ? styles.myMessage : styles.otherMessage, item.isReportedByUser && styles.reportedMessage,
          ]}
        >
          <View
            style={[
              styles.senderName,
            ]}
          >

            <TouchableOpacity onPress={() => handleProfileClick(item)} style={styles.profileImagecontainer}>
              <Image
                source={{
                  uri: item.avatar
                    ? item.avatar
                    : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                }}
                style={styles.profileImage}
              />
            </TouchableOpacity>

          </View>

          <View style={styles.messageTextBox}>
            {/* Render reply context if present */}
            {item.replyTo && (
              <View style={styles.replyContainer}>
                <Text style={styles.replyText}>
                  Replying to: {'\n'}{item.replyTo.text || '[Deleted message]'}
                </Text>
              </View>
            )}

            {/* Render main message */}

            <Menu style={styles.menu}>
              <MenuTrigger
                onLongPress={() => handleLongPress(item)} // Set the message for context menu
                delayLongPress={300}
                customStyles={{
                  TriggerTouchableComponent: TouchableOpacity,
                }}
              >
                <Text
                  style={
                    item.senderId === user?.id
                      ? styles.myMessageText
                      : styles.otherMessageText
                  }
                >
                  <Text style={styles.userName}>{item.sender}
                    {item?.isPro && <Icon
                      name="checkmark-done-circle"
                      size={16}
                      color={config.colors.hasBlockGreen}
                    />}{'    '}
                  </Text>

                  {(!!item.isAdmin) &&
                    <View style={styles.adminContainer}>
                      <Text style={styles.admin}>{t("chat.admin")}</Text>
                    </View>}
                  {'\n'}
                  {parseMessageText(item?.text)}



                </Text>
              </MenuTrigger>
              <MenuOptions customStyles={{
                optionsContainer: styles.menuoptions,
              }}>
                {user.id && <MenuOption
                  onSelect={() => onReply(item)}
                  text={t("chat.reply")}
                  customStyles={{
                    optionWrapper: styles.menuOption,
                    optionText: styles.menuOptionText,
                  }}
                />}
                <MenuOption
                  onSelect={() => handleReport(item)}
                  text={t("chat.report")}
                  customStyles={{
                    optionWrapper: styles.menuOption,
                    optionText: styles.menuOptionText,
                  }}
                />
              </MenuOptions>
            </Menu>

            {(item.reportCount > 0 || item.isReportedByUser) && (
              <Text style={styles.reportIcon}>Reported</Text>
            )}

          </View>


          {/* Admin Actions or Timestamp */}


          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Text style={styles.timestamp}>
              {new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>

          </View>
          {(isAdmin) && (
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
                  <MenuOption onSelect={() => banUser(item.senderId)} style={styles.deleteButton}>
                    <Text style={styles.adminTextAction}>Block</Text>
                  </MenuOption>
                  <MenuOption onSelect={() => unbanUser(item.senderId)} style={styles.deleteButton}>
                    <Text style={styles.adminTextAction}>Unblock</Text>
                  </MenuOption>
                  {isAdmin && (
                    <MenuOption onSelect={() => makeadmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Make Admin</Text>
                    </MenuOption>
                  )}
                  {isAdmin && (
                    <MenuOption onSelect={() => removeAdmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Remove Admin</Text>
                    </MenuOption>
                  )}
                </View>
              </MenuOptions>
            </Menu>
          )}


        </View>

      </View>
    );
  }, [messages]);

  return (
    <>
      <FlatList
        data={messages}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={({ item, index }) => renderMessage({ item, index })}
        contentContainerStyle={styles.chatList}
        inverted
        onEndReachedThreshold={0.1}
        onEndReached={handleLoadMore}
        initialNumToRender={20} // Render the first 20 messages upfront
        maxToRenderPerBatch={10} // Render 10 items per batch for smoother performance
        windowSize={5} // Adjust the window size for rendering nearby items
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={isDarkMode ? '#FFF' : '#000'}
          />
        }
        onScroll={() => Keyboard.dismiss()}
        onTouchStart={() => Keyboard.dismiss()}
        keyboardShouldPersistTaps="handled" // Ensures taps o
      />
      <ReportPopup
        visible={showReportPopup}
        message={selectedMessage}
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

export default MessagesList;
