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
import { ref, push, get } from "@react-native-firebase/database";
import { doc, getDoc, updateDoc } from "@react-native-firebase/firestore";
import { banUserwithEmail } from "../ChatScreen/utils";

const ReportTradePopup = ({ visible, trade, onClose }) => {
  const [selectedReason, setSelectedReason] = useState("Inappropriate");
  const [customReason, setCustomReason] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme, user, appdatabase, strikeInfo, isAdmin, firestoreDB } = useGlobalState();
  const isDarkMode = theme === "dark";

  const handleSubmit = async () => {
    if (showCustomInput && !customReason.trim()) {
      Alert.alert("Error", "Please enter a reason for reporting.");
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

    if (!trade?.id) {
      Alert.alert("Error", "Invalid trade. Unable to report.");
      return;
    }

    setLoading(true);

    try {
      // 1. Fetch reported user's data from RTDB
      let offenderEmail = null;
      let userData = {
        id: trade.userId,
        displayName: trade.traderName || 'Unknown',
        avatar: null
      };

      if (trade.userId) {
        const userRef = ref(appdatabase, `users/${trade.userId}`);
        const userSnap = await get(userRef);
        if (userSnap.exists()) {
          const fetchedData = userSnap.val();
          offenderEmail = fetchedData.email;
          userData = {
            id: trade.userId,
            displayName: fetchedData.displayName || trade.traderName || 'Unknown',
            avatar: fetchedData.avatar || null,
            email: offenderEmail
          }
        }
      }

      // 2. Check and limit reports in Firestore (Trades are in Firestore)
      const tradeRef = doc(firestoreDB, "trades_new", trade.id);
      const tradeSnap = await getDoc(tradeRef);

      if (tradeSnap.exists()) {
        const tradeData = tradeSnap.data();
        const currentReports = Number(tradeData.reportCount || 0);

        if (currentReports >= 1) {
          // This is the 2nd report -> Ban User
          if (offenderEmail) {
            const bannerInfo = {
              id: user?.id,
              displayName: user?.userName || 'System',
              avatar: user?.avatar || null
            };
            await banUserwithEmail(offenderEmail, false, trade.userId, userData, bannerInfo);
          }
          // Update count (optional, but good for record)
          await updateDoc(tradeRef, { reportCount: currentReports + 1 });
        } else {
          // First report -> just increment status
          await updateDoc(tradeRef, { reportCount: 1 });
        }
      }

      // 3. Log the report details to RTDB (Legacy/Admin Logs)
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

export default ReportTradePopup;
