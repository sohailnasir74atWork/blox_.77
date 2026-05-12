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
import { ref, push } from "@react-native-firebase/database";
import { doc, getDoc, updateDoc } from "@react-native-firebase/firestore";

const ReportTradePopup = ({ visible, trade, onClose }) => {
  const [selectedReason, setSelectedReason] = useState("Inappropriate");
  const [customReason, setCustomReason] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme, user, appdatabase, strikeInfo, isAdmin, firestoreDB, isUserBlocked } = useGlobalState();
  const isDarkMode = theme === "dark";

  const handleSubmit = async () => {
    if (showCustomInput && !customReason.trim()) {
      Alert.alert("Error", "Please enter a reason for reporting.");
      return;
    }

    // Block banned users from reporting (admins are exempt). Defer expiry
    // to the server-time-validated `isUserBlocked` flag so a clock-rolled
    // device can't slip past — strikeInfo is used only for the message.
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

    if (!trade?.id) {
      Alert.alert("Error", "Invalid trade. Unable to report.");
      return;
    }

    setLoading(true);

    try {
      // Bump the trade's report counter for admin review. Auto-ban on
      // threshold was removed — bans are now manual (admin/mod only).
      const tradeRef = doc(firestoreDB, "trades_new_upgrade", trade.id);
      const tradeSnap = await getDoc(tradeRef);

      if (tradeSnap.exists()) {
        const currentReports = Number(tradeSnap.data().reportCount || 0);
        await updateDoc(tradeRef, { reportCount: currentReports + 1 });
      }

      // Log the report details to RTDB (Legacy/Admin Logs)
      const reportsRef = ref(appdatabase, "tradeReports");
      const reportData = {
        tradeId: trade.id,
        reportedBy: user?.id,
        reason: showCustomInput ? customReason : selectedReason,
        timestamp: Date.now(),
      };

      await push(reportsRef, reportData);

      setLoading(false);
      Alert.alert(
        "Report Submitted",
        `Trade ID: ${trade.id}\nReason: ${showCustomInput ? customReason : selectedReason
        }\nThank you for reporting this trade.`
      );
      onClose(true);

    } catch (error) {
      console.error("Error reporting trade:", error);
      setLoading(false);
      Alert.alert("Error", "Failed to submit the report. Please try again.");
    }
  };

  const styles = getStyles(isDarkMode);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.popup}>
          <Text style={styles.title}>Report Trade</Text>
          <Text style={styles.messageText}>{`Trade ID: ${trade?.id || "Anonymous"}`}</Text>
          <Text style={styles.messageText}>{`Trader: ${trade?.traderName || "Anonymous"}`}</Text>

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
                  {reason}
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
                Other
              </Text>
            </TouchableOpacity>
          </View>

          {showCustomInput && (
            <TextInput
              style={styles.input}
              placeholder="Enter custom reason"
              placeholderTextColor="#888"
              value={customReason}
              onChangeText={setCustomReason}
            />
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>Cancel</Text>
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
                <Text style={styles.buttonText}>Submit</Text>
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
