import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, Modal, Image, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { getStyles } from './../Style';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';
import { showMessage } from 'react-native-flash-message';

const Emojies = [
  'e1.png',
  'e2.png',
  'e3.png',
  'e4.png',
  'e5.png',
  'e6.png',
  'e7.png',
  'e8.png',
  'e9.png',
  'e10.png',
  'e11.png',
  'e12.png',
  'e13.png',
  'e14.png',
  'e15.png',
  'e16.png'
];

const MessageInput = ({
  input,
  setInput,
  handleSendMessage,
  selectedTheme,
  replyTo,
  onCancelReply,
  selectedEmoji, // The selected Emoji state
  setSelectedEmoji, // Function to set selected Emoji
  gifAllowed, // new prop to check if GIFs/Emojis are allowed
}) => {
  const styles = getStyles(selectedTheme.colors.text === 'white');
  const [isSending, setIsSending] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const [messageCount, setMessageCount] = useState(0);
  const { t } = useTranslation();
  const { localState } = useLocalState();
  const [loadingImage, setLoadingImage] = useState(false);

  const [showEmojiPopup, setShowEmojiPopup] = useState(false); // To show the emoji selection popup
  const [showGifPopup, setShowGifPopup] = useState(false); // To show GIF selection popup

  const handleSend = async () => {
    triggerHapticFeedback('impactLight');
    const trimmedInput = input.trim();
    // if (!trimmedInput || isSending ) return; // Prevent empty messages or multiple sends
    setIsSending(true);

    const callbackfunction = () => {
      setIsSending(false)
    };

    try {
      await handleSendMessage(replyTo, trimmedInput);
      setInput('');
      if (selectedEmoji) setSelectedEmoji(''); // Clear selected emoji after sending message
      if (onCancelReply) onCancelReply();

      // Increment message count
      setMessageCount(prevCount => {
        const newCount = prevCount + 1;
        if ((!localState.isPro) && newCount % 15 === 0) {
          // Show ad only if user is NOT pro
          InterstitialAdManager.showAd(callbackfunction);
        } else {
          setIsSending(false);
        }
        return newCount;
      });
    } catch (error) {
      console.error('Error sending message:', error);
      setIsSending(false);
    }
  };
  const handleImageLoad = () => {
    setLoadingImage(false); // Image has finished loading
  };

  const handleImageLoadStart = () => {
    setLoadingImage(true); // Image is loading
  };

  // Emoji selection function
  const selectEmoji = (emoji) => {
    if (gifAllowed || localState.isPro) {
      // If GIFs/Emojis are allowed, toggle the emoji selection
      if (selectedEmoji === emoji) {
        setSelectedEmoji(null); // Deselect if the same emoji is clicked again
      } else {
        setSelectedEmoji(emoji); // Set the selected emoji
      }
      setShowEmojiPopup(false); // Close the emoji popup
    } else {
      // Show message if GIFs/Emojis are not allowed
      showMessage({
        message: "You need to purchase this item from the store in the reward section.",
        type: "info",
        duration: 3000, // Show the message for 3 seconds
      });
    }
  };

  // GIF selection function


  return (
    <View style={styles.inputWrapper}>
      {/* Reply context UI */}
      {replyTo && (
        <View style={styles.replyContainer}>
          <Text style={styles.replyText}>
            {t("chat.replying_to")}: {replyTo.text}
          </Text>
          <TouchableOpacity onPress={onCancelReply} style={styles.cancelReplyButton}>
            <Icon name="close-circle" size={24} color="#e74c3c" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.input, { color: selectedTheme.colors.text, paddingLeft: selectedEmoji && 50 }]}
          placeholder={t("chat.type_message")}
          placeholderTextColor="#888"
          value={input} // The input text, no emojis/GIFs added here
          onChangeText={setInput}
          multiline
        />


        {(selectedEmoji) && (
          <TouchableOpacity style={{
            position: 'absolute',
            left: 3,
            // width: 40,
            // height: 40,
            borderRadius: 15,
          }} onPress={() => setSelectedEmoji(null)}>
            {loadingImage && <ActivityIndicator size="small" color="#6A5ACD" />}


            <Image
              source={{ uri: selectedEmoji }}
              style={{
                width: 40,
                height: 40,
                resizeMode: 'contain',
              }}
              onLoadStart={handleImageLoadStart}
              onLoad={handleImageLoad}
            />
          </TouchableOpacity>
        )}







        {/* <TouchableOpacity onPress={() => setShowEmojiPopup(true)} style={styles.gifButton}>
          <Text style={{ fontSize: 25 }}>😊</Text>
        </TouchableOpacity> */}


        {/* Send Button */}
        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor:
                input.trim() || selectedEmoji && !isSending
                  ? '#1E88E5' // If there's text or emoji selected and no sending in progress
                  : config.colors.primary, // Default color if not enabled
            },
          ]}
          onPress={handleSend}
          disabled={!(input.trim() || selectedEmoji) || isSending}
        >
          <Text style={styles.sendButtonText}>{isSending ? t("chat.sending") : t("chat.send")}</Text>
        </TouchableOpacity>
      </View>

      {/* Emoji Popup Modal */}
    {/* Emoji Popup Modal */}
<Modal visible={showEmojiPopup} transparent animationType="slide">
  <TouchableOpacity style={modalStyles.backdrop} onPress={() => setShowEmojiPopup(false)}>
    <View style={modalStyles.sheet} onPress={(e) => e.stopPropagation()}>
      <View style={modalStyles.emojiListContainer}>
        {Emojies.map((item) => (
          <TouchableOpacity
            key={item}
            onPress={() => selectEmoji(`https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/${item}`)}
            style={modalStyles.emojiContainer}
          >
            <Image
              source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/${item}` }}
              style={modalStyles.emojiImage}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  </TouchableOpacity>
</Modal>





    </View>
  );
};

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  emojiListContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap', // Allows emojis to wrap when they overflow
    justifyContent: 'space-between', // Aligns items to the start
    marginTop: 10,
  },
  emojiContainer: {
    margin: 10,
    width: 50, // emoji width
    height: 50, // emoji height
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
  },
});

export default MessageInput;
