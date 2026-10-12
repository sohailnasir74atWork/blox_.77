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
import { useGlobalState, modGateText } from "../GlobelStats";
import config from "../Helper/Environment";
import { useTranslation } from "react-i18next";
import { reportPrivateMessage } from "../Supabase/privateMessagesBackend";
import { reportPublicMessage } from "../Supabase/chatBackend";

const ReportPopup = ({ visible, message, onClose, chatId, isPrivateChat = false, chatPath = 'chat_new_upgrade' }) => {
  const [selectedReason, setSelectedReason] = useState("Spam");
  const [customReason, setCustomReason] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme, user, getModGate } = useGlobalState();
  const isDarkMode = theme === "dark";
  const { t } = useTranslation();

  const handleSubmit = async () => {
    if (!message) {
      Alert.alert(t('chat.error'), t('chat.report_popup.invalid_message'));
      return;
    }

    // Block banned users (admins exempt). Reports aren't chat, so a mute
    // doesn't apply. Decision uses server-time-validated state.
    const modGate = getModGate('content');
    if (modGate) {
      const { title, message: body } = modGateText(modGate, 'report');
      Alert.alert(title, body);
      return;
    }

    setLoading(true);

    try {
      // Run the report through Supabase. The helper still soft-deletes the
      // message once the report threshold is crossed; we just no longer
      // auto-ban the sender — bans are now manual (admin/mod only).
      const messageId = message?.id;
      if (!messageId) throw new Error('Invalid message ID');

      // Send the picked reason (or the typed one) with the report so
      // moderators see why it was flagged (report_message RPC p_reason).
      const reason = (showCustomInput ? customReason : selectedReason).trim().slice(0, 200) || null;
      if (showCustomInput && !reason) {
        Alert.alert(t('chat.error'), t('chat.report_popup.describe_problem'));
        return;
      }

      await (isPrivateChat
        ? reportPrivateMessage(messageId, user?.id ?? null, reason)
        : reportPublicMessage(messageId, user?.id ?? null, reason));

      Alert.alert(t('chat.report_submitted'), t('chat.report_submitted_message'));
      onClose(true);
    } catch (error) {
      console.error('Error reporting message:', error);
      Alert.alert(t('chat.error'), t('chat.report_popup.submit_failed'));
    } finally {
      setLoading(false);
    }
  };




  const styles = getStyles(isDarkMode);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.popup}>
          <Text style={styles.title}>{t('chat.report_popup.title')}</Text>
          <Text style={styles.messageText}>{t('chat.report_popup.message_line', { text: message?.text })}</Text>
          <Text style={styles.messageText}>{t('chat.report_popup.sender_line', { name: message?.sender || t('chat.anonymous') })}</Text>

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
              placeholder={t('chat.report_popup.custom_placeholder')}
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
