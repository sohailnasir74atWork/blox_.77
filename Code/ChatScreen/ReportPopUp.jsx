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
import { useTranslation } from "react-i18next";
import { reportPrivateMessage } from "../Supabase/privateMessagesBackend";
import { reportPublicMessage } from "../Supabase/chatBackend";

const ReportPopup = ({ visible, message, onClose, chatId, isPrivateChat = false, chatPath = 'chat_new_upgrade' }) => {
  const [selectedReason, setSelectedReason] = useState("Spam");
  const [customReason, setCustomReason] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme, user, strikeInfo, isAdmin, isUserBlocked } = useGlobalState();
  const isDarkMode = theme === "dark";
  const { t } = useTranslation();

  const handleSubmit = async () => {
    if (!message) {
      Alert.alert("Error", "Invalid message. Unable to report.");
      return;
    }

    // Block banned users (admins exempt). Defer expiry to server-time-
    // validated `isUserBlocked` so a clock-rolled device can't slip past.
    if (isUserBlocked && !isAdmin) {
      const { strikeCount, bannedUntil } = strikeInfo || {};

      if (bannedUntil === 'permanent') {
        Alert.alert("⛔ Permanently Banned", "You are permanently banned from making reports.");
        return;
      }

      if (typeof bannedUntil === 'number') {
        const remaining = Math.max(0, bannedUntil - Date.now());
        const totalMinutes = Math.ceil(remaining / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        Alert.alert(
          `⚠️ Strike ${strikeCount ?? ''}`.trim(),
          `You are banned from making reports for ${timeLeftText} more minute(s).`
        );
        return;
      }

      Alert.alert("⛔ Banned", "You are currently banned from making reports.");
      return;
    }

    setLoading(true);

    try {
      // Run the report through Supabase. The helper still soft-deletes the
      // message once the report threshold is crossed; we just no longer
      // auto-ban the sender — bans are now manual (admin/mod only).
      const messageId = message?.id;
      if (!messageId) throw new Error('Invalid message ID');

      await (isPrivateChat
        ? reportPrivateMessage(messageId, user?.id ?? null)
        : reportPublicMessage(messageId, user?.id ?? null));

      Alert.alert(t('chat.report_submitted'), t('chat.report_submitted_message'));
      onClose(true);
    } catch (error) {
      console.error('Error reporting message:', error);
      Alert.alert('Error', 'Failed to submit the report. Please try again.');
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
      backgroundColor: isDarkMode ? "#0f172a" : "#f2f2f7",
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
