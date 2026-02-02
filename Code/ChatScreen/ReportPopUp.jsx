import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useGlobalState } from "../GlobelStats";
import config from "../Helper/Environment";
import { ref, get, update, remove } from "@react-native-firebase/database";
import { useTranslation } from "react-i18next";
import { banUserwithEmail } from "./utils";

const ReportPopup = ({ visible, message, onClose, chatId, isPrivateChat = false }) => {
  const [selectedReason, setSelectedReason] = useState("Spam");
  const [customReason, setCustomReason] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme, appdatabase, user, strikeInfo, isAdmin } = useGlobalState();
  const isDarkMode = theme === "dark";
  const { t } = useTranslation();

  const handleSubmit = async () => {
    if (!message) {
      Alert.alert("Error", "Invalid message. Unable to report.");
      return;
    }

    // ✅ Block users with strikes from reporting (admins are exempt)
    if (strikeInfo && !isAdmin) {
      const { strikeCount, bannedUntil } = strikeInfo;
      const now = Date.now();

      if (bannedUntil === 'permanent') {
        Alert.alert("⛔ Permanently Banned", "You are permanently banned from making reports.");
        return;
      }

      if (typeof bannedUntil === 'number' && now < bannedUntil) {
        const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        Alert.alert(
          `⚠️ Strike ${strikeCount}`,
          `You are banned from making reports for ${timeLeftText} more minute(s).`
        );
        return;
      }
    }

    setLoading(true);

    try {
      let messageRef;
      let senderEmail = null;

      if (isPrivateChat && chatId) {
        // ✅ Private chat: messages are in private_messages/{chatId}/messages/{messageId}
        // Message ID is the timestamp (Firebase key)
        let messageId = null;

        // Try to get message ID from various possible fields
        if (message.id && message.id !== 'undefined' && message.id !== 'null') {
          messageId = String(message.id);
        } else if (message.timestamp) {
          messageId = String(message.timestamp);
        } else {
          console.error("❌ Private chat message missing ID:", JSON.stringify(message, null, 2));
          throw new Error("Invalid message ID for private chat - missing both id and timestamp");
        }

        if (!chatId || chatId === 'undefined' || chatId === 'null') {
          console.error("❌ Invalid chatId:", chatId);
          throw new Error("Invalid chatId for private chat");
        }

        const messagePath = `private_messages/${chatId}/messages/${messageId}`;
        // console.log("🔍 Reporting private chat message - Path:", messagePath, "Message ID:", messageId, "ChatId:", chatId);
        messageRef = ref(appdatabase, messagePath);

        // ✅ Fetch sender's email from user data
        if (message.senderId) {
          try {
            const userRef = ref(appdatabase, `users/${message.senderId}`);
            const userSnap = await get(userRef);
            if (userSnap.exists()) {
              const userData = userSnap.val();
              senderEmail = userData.email || null;

              // ✅ Log for debugging
              if (!senderEmail) {
                console.warn("⚠️ Sender email not found in user data for userId:", message.senderId);
                console.warn("User data:", JSON.stringify(userData, null, 2));
              } else {
                // console.log("✅ Found sender email:", senderEmail);
              }
            } else {
              console.error("❌ User not found in Firebase for senderId:", message.senderId);
            }
          } catch (err) {
            console.error("Error fetching sender email:", err);
          }
        } else {
          console.error("❌ Message missing senderId:", JSON.stringify(message, null, 2));
        }
      } else {
        // ✅ Group chat: messages are in chat_new/{messageId}
        const sanitizedId = message.id.startsWith("chat-")
          ? message.id.replace("chat-", "")
          : message.id;

        if (!sanitizedId) {
          throw new Error("Invalid message ID");
        }

        messageRef = ref(appdatabase, `chat_new/${sanitizedId}`);
        senderEmail = message.currentUserEmail || null;
      }

      const snapshot = await get(messageRef);
      if (!snapshot.exists()) {
        // ✅ Better error message with debugging info
        const errorMsg = isPrivateChat
          ? `Message not found in private chat. Path: private_messages/${chatId}/messages/${message.id}`
          : `Message not found in group chat. ID: ${message.id}`;
        console.error("❌", errorMsg);
        console.error("Message object:", JSON.stringify(message, null, 2));
        throw new Error(errorMsg);
      }

      const data = snapshot.val();
      const reportCount = Number(data?.reportCount || 0);

      if (reportCount >= 1) {
        // ✅ Second report: delete the message and ban user (increment strike)
        if (senderEmail) {
          // console.log("🔨 Applying ban to email:", senderEmail, "from private chat report");
          try {
            // ✅ Construct rich user data for the ban record
            const userInfo = {
              id: message.senderId,
              displayName: message.sender || 'Unknown',
              avatar: message.avatar || null,
              email: senderEmail
            };

            const bannerInfo = {
              id: user?.id,
              displayName: user?.userName || 'System',
              avatar: user?.avatar || null
            };

            await banUserwithEmail(senderEmail, false, message.senderId, userInfo, bannerInfo); // false = not admin, so no alert shown
            // console.log("✅ Ban applied successfully");
          } catch (banError) {
            console.error("❌ Error applying ban:", banError);
            // Continue with message deletion even if ban fails
          }
        } else {
          console.error("❌ Cannot ban user - sender email not found for senderId:", message.senderId);
        }
        await remove(messageRef);
        Alert.alert(t("chat.report_submitted"), t("chat.report_submitted_message"));
        onClose(true);
      } else {
        // ✅ First report: set to 1 (don't increment beyond this)
        await update(messageRef, { reportCount: 1 });
        Alert.alert(t("chat.report_submitted"), t("chat.report_submitted_message"));
        onClose(true);
      }
    } catch (error) {
      console.error("Error reporting message:", error);
      Alert.alert("Error", "Failed to submit the report. Please try again.");
    } finally {
      setLoading(false);
    }
  };




  const styles = getStyles(isDarkMode);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.popup}>
          <Text style={styles.title}>Report Message</Text>
          <Text style={styles.messageText}>{`Message: "${message?.text}"`}</Text>
          <Text style={styles.messageText}>{`Sender: ${message?.sender || "Anonymous"}`}</Text>

          {/* Standard Reasons */}
          <View style={styles.optionsContainer}>
            {[t("chat.spam"), t("chat.religious"), t("chat.hate_speech")].map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[
                  styles.option,
                  selectedReason === reason && styles.selectedOption,
                ]}
                onPress={() => {
                  setSelectedReason(reason);
                  setShowCustomInput(false);
                }}
              >
                <Text
                  style={[
                    styles.optionText,
                    selectedReason === reason && styles.selectedOptionText,
                  ]}
                >
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Custom Option */}
            <TouchableOpacity
              style={[
                styles.option,
                showCustomInput && styles.selectedOption,
              ]}
              onPress={() => setShowCustomInput(true)}
            >
              <Text
                style={[
                  styles.optionText,
                  showCustomInput && styles.selectedOptionText,
                ]}
              >
                {t("chat.other")}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Custom Input for "Other" */}
          {showCustomInput && (
            <TextInput
              style={styles.input}
              placeholder="Enter custom reason"
              placeholderTextColor="#888"
              value={customReason}
              onChangeText={setCustomReason}
            />
          )}

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>{t("home.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: config.colors.hasBlockGreen },
              ]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.buttonText}> {t("chat.submit")}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
    },
    popup: {
      width: "80%",
      backgroundColor: isDarkMode ? "#121212" : "#f2f2f7",
      borderRadius: 10,
      padding: 20,
      elevation: 5,
    },
    title: {
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 10,
      color: isDarkMode ? "white" : "black",
    },
    messageText: {
      fontSize: 14,
      color: isDarkMode ? "white" : "black",
      marginBottom: 15,
    },
    optionsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginBottom: 10,
    },
    option: {
      paddingHorizontal: 3,
      backgroundColor: "#ddd",
      borderRadius: 10,
      marginRight: 10,
      marginBottom: 10,
    },
    selectedOption: {
      borderColor: config.colors.primary,
      backgroundColor: config.colors.hasBlockGreen,
    },
    optionText: {
      fontSize: 14,
      color: isDarkMode ? "#888" : "#444",
      paddingHorizontal: 5,
    },
    selectedOptionText: {
      color: "white",
    },
    input: {
      borderWidth: 1,
      borderColor: "#ddd",
      borderRadius: 5,
      padding: 5,
      marginTop: 10,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 15,
    },
    button: {
      paddingVertical: 5,
      paddingHorizontal: 20,
      backgroundColor: config.colors.primary,
      borderRadius: 5,
    },
    buttonText: {
      color: "white",
      fontSize: 16,
    },
  });

export default ReportPopup;
