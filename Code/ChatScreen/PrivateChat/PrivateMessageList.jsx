import React, { memo, useState } from 'react';
import {
  FlatList,
  View,
  Text,
  RefreshControl,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Vibration,
  Keyboard,
} from 'react-native';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useGlobalState } from '../../GlobelStats';
import { getStyles } from '../Style';
import ReportPopup from '../ReportPopUp';

const PrivateMessageList = ({
  messages,
  userId,
  user,
  selectedUser,
  handleLoadMore,
  refreshing,
  onRefresh,
  isBanned,
  onReply,
  onReportSubmit,
  loading,
  selectedUserId, // Add selectedUserId to identify sender messages
}) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = getStyles(isDarkMode);

  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);

  // Filter messages: Keep only user's messages if `isBanned` is true
  const filteredMessages = isBanned
    ? messages.filter((message) => message.senderId === userId)
    : messages;

  // Open the report popup
  const handleReport = (message) => {
    setSelectedMessage(message);
    setShowReportPopup(true);
  };
// console.log(messages)
  // Submit the report
  const handleSubmitReport = (message, reason) => {
    onReportSubmit(message, reason);
    setShowReportPopup(false);
  };
  // console.log(selectedUserId === userId)

  // Render a single message
  const renderMessage = ({ item }) => {
    const isMyMessage = item.senderId === userId;

    // console.log(isMyMessage)
    // console.log(item, isMyMessage);
    // console.log('Selected User Avatar:', selectedUser?.avatar);
    const avatarUri = item.senderId !== userId
    ? selectedUser?.avatar || (console.warn('Missing senderAvatar, using default'), 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png')
    : user?.avatar || (console.warn('Missing receiverAvatar, using default'), 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png');
  
    return (
      <View
        style={
          isMyMessage
            ? [styles.mymessageBubble, styles.myMessage, {width:'80%'}]
            : [styles.othermessageBubble, styles.otherMessage, {width:'80%'}]
        }
      >
        {/* Avatar */}
        <Image
          source={{ uri: avatarUri }}
          style={styles.profileImagePvtChat}
        />
        {/* Message Content */}
        <Menu>
          <MenuTrigger
            onLongPress={() => Vibration.vibrate(50)}
            customStyles={{ TriggerTouchableComponent: TouchableOpacity }}
          >
            <Text style={isMyMessage ? styles.myMessageText : styles.otherMessageText}>
              {item.text}
            </Text>
          </MenuTrigger>
          <MenuOptions style={styles.menuoptions}>
            <MenuOption onSelect={() => onReply(item)} text="Reply" />
            <MenuOption onSelect={() => handleReport(item)} text="Report" />
          </MenuOptions>
        </Menu>
        <Text style={styles.timestamp}>
          {new Date(item.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    );
  };
  
  return (
    <View style={[styles.container]}>
      {loading && messages.length === 0 ? (
        <ActivityIndicator size="large" color="#1E88E5" style={styles.loader} />
      ) : (
        <FlatList
          data={filteredMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage} // Pass the render function directly
          inverted // Ensure list starts from the bottom
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
           onScroll={() => Keyboard.dismiss()}
        onTouchStart={() => Keyboard.dismiss()}
        keyboardShouldPersistTaps="handled" // Ensures taps o
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
      <ReportPopup
        visible={showReportPopup}
        message={selectedMessage}
        onClose={() => setShowReportPopup(false)}
        onSubmit={handleSubmitReport}
      />
    </View>
  );
};

export default memo(PrivateMessageList);
