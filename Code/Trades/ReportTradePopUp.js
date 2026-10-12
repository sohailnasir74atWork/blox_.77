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
import { ref, push } from "@react-native-firebase/database";
import { doc, getDoc, updateDoc } from "@react-native-firebase/firestore";
import { submitUserReport } from "../Helper/userReports";
import { useTranslation } from "react-i18next";

const ReportTradePopup = ({ visible, trade, onClose }) => {
  const [selectedReason, setSelectedReason] = useState("Inappropriate");
  const [customReason, setCustomReason] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme, user, appdatabase, firestoreDB, getModGate } = useGlobalState();
  const isDarkMode = theme === "dark";
  const { t } = useTranslation();
  const reasonLabel = (reason) => (reason === "Fraud" ? t('trade.report_trade_popup.reason_fraud') : reason === "Inappropriate" ? t('trade.report_trade_popup.reason_inappropriate') : reason);

  const handleSubmit = async () => {
    if (showCustomInput && !customReason.trim()) {
      Alert.alert(t('trade.report_trade_popup.error'), t('trade.report_trade_popup.enter_reason'));
      return;
    }

    // Block banned users from reporting (admins exempt). Reports aren't
    // chat, so a mute doesn't apply. Decision uses server-time-validated state.
    const modGate = getModGate('content');
    if (modGate) {
      const { title, message } = modGateText(modGate, 'report');
      Alert.alert(title, message);
      return;
    }

    if (!user?.id) {
      Alert.alert(t('trade.report_trade_popup.error'), t('trade.report_trade_popup.signin_required'));
      return;
    }

    if (!trade?.id) {
      Alert.alert(t('trade.report_trade_popup.error'), t('trade.report_trade_popup.invalid_trade'));
      return;
    }

    setLoading(true);

    try {
      // The report itself goes to Firestore user_reports, which the Admin
      // Dashboard reads. If that write is refused (user_reports rules not
      // deployed yet) fall back to the legacy RTDB tradeReports node, which
      // the dashboard keeps reading for old builds.
      try {
        await submitUserReport(firestoreDB, {
          type: 'trade',
          targetId: trade.id,
          targetUid: trade.userId || null,
          reporterUid: user.id,
          reason: showCustomInput ? 'Other' : selectedReason,
          text: showCustomInput ? customReason : '',
        });
      } catch (reportErr) {
        console.warn("user_reports write failed, using tradeReports:", reportErr?.message || reportErr);
        await push(ref(appdatabase, "tradeReports"), {
          tradeId: trade.id,
          reportedBy: user.id,
          reason: showCustomInput ? customReason : selectedReason,
          timestamp: Date.now(),
        });
      }

      // Bump the trade's report counter for admin review (best-effort — the
      // report above already landed). Auto-ban on threshold was removed —
      // bans are now manual (admin/mod only).
      try {
        const tradeRef = doc(firestoreDB, "trades_new_upgrade", trade.id);
        const tradeSnap = await getDoc(tradeRef);
        if (tradeSnap.exists()) {
          const currentReports = Number(tradeSnap.data().reportCount || 0);
          await updateDoc(tradeRef, { reportCount: currentReports + 1 });
        }
      } catch (countErr) {
        console.warn("Trade reportCount bump failed:", countErr?.message || countErr);
      }

      setLoading(false);
      Alert.alert(
        t('trade.report_trade_popup.submitted_title'),
        t("trade.report_trade_popup.submitted_body", { id: trade.id, reason: showCustomInput ? customReason : reasonLabel(selectedReason) })
      );
      onClose(true);

    } catch (error) {
      console.error("Error reporting trade:", error);
      setLoading(false);
      Alert.alert(t('trade.report_trade_popup.error'), t('trade.report_trade_popup.submit_failed'));
    }
  };

  const styles = getStyles(isDarkMode);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.popup}>
          <Text style={styles.title}>{t('trade.report_trade_popup.title')}</Text>
          <Text style={styles.messageText}>{t("trade.report_trade_popup.trade_id", { id: trade?.id || t('trade.report_trade_popup.anonymous') })}</Text>
          <Text style={styles.messageText}>{t("trade.report_trade_popup.trader", { name: trade?.traderName || t('trade.report_trade_popup.anonymous') })}</Text>

          <View style={styles.optionsContainer}>
            {["Inappropriate", "Fraud"].map((reason) => (
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
                  {reasonLabel(reason)}
                </Text>
              </TouchableOpacity>
            ))}

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
                {t('trade.report_trade_popup.reason_other')}
              </Text>
            </TouchableOpacity>
          </View>

          {showCustomInput && (
            <TextInput
              style={styles.input}
              placeholder={t('trade.report_trade_popup.custom_reason_placeholder')}
              placeholderTextColor="#888"
              value={customReason}
              onChangeText={setCustomReason}
            />
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>{t("common.cancel")}</Text>
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
                <Text style={styles.buttonText}>{t('trade.report_trade_popup.submit')}</Text>
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
      width: "90%",
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

export default ReportTradePopup;
