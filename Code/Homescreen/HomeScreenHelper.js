import { Alert } from "react-native";
import firestore from '@react-native-firebase/firestore';
import { showMessage } from "react-native-flash-message";

const tradesCollection = firestore().collection('trades');

// Debug Mode (Enable verbose logging if true)
// const debugMode = false;

export const submitTrade = async (user, hasItems, wantsItems, hasTotal, wantsTotal, description, ) => {
  // if (debugMode) console.log("🔥 submitTrade() called");

  // 🔍 Filter out invalid items
  const filteredHasItems = hasItems.filter(item => item && item.Name);
  const filteredWantsItems = wantsItems.filter(item => item && item.Name);

  if (filteredHasItems.length === 0 || filteredWantsItems.length === 0) {
    // Alert.alert("Error", "Please add at least one valid item to both 'You' and 'Them' sections.");
    showMessage({
      message: t("home.alert.error"),
      description: t("home.alert.missing_items_error"),
      type: "danger",
    });
    return;
  }

  // ✅ Prepare trade object for Firestore
  let newTrade = {
    userId: user?.id || "Anonymous",
    traderName: user?.displayName || "Anonymous",
    avatar: user?.avatar || null,
    isPro: user.isPro,
    hasItems: filteredHasItems.map(item => ({ name: item.Name, type: item.Type })), 
    wantsItems: filteredWantsItems.map(item => ({ name: item.Name, type: item.Type })),
    hasTotal: { price: hasTotal?.price || 0, value: hasTotal?.value || 0 },
    wantsTotal: { price: wantsTotal?.price || 0, value: wantsTotal?.value || 0 },
    description: description || "",
    timestamp: firestore.FieldValue.serverTimestamp(),
  };

  // 🔥 Default Empty Trade Object
  const resetNewTrade = {
    userId: null,
    traderName: null,
    avatar: null,
    isPro: null,
    hasItems: [],
    wantsItems: [],
    hasTotal: null,
    wantsTotal: null,
    description: null,
    timestamp: null,
  };

  // ✅ Prevent Submitting Default/Empty Trades
  if (JSON.stringify(newTrade) === JSON.stringify(resetNewTrade)) {
    Alert.alert("Error", "Trade cannot be empty.");
    return;
  }

  try {
    // 🔥 Step 1: Attempt to Add Trade to Firestore
    await tradesCollection.add(newTrade);

    // ✅ Step 2: Reset newTrade after successful submission
    Object.assign(newTrade, resetNewTrade); // ✅ Correct way to reset newTrade

    // ✅ Step 3: Reset trade state in UI if function is provided
    if (typeof resetTradeState === "function") {
      resetTradeState();
    } else {
      console.warn("⚠️ resetTradeState is not a function, skipping reset.");
    }

    // ✅ Step 4: Success Alert
    Alert.alert("Success", "Trade submitted successfully!");

  } catch (error) {
    console.error("🔥 Firestore Write Error:", error);
    Alert.alert("Error", `Failed to create trade: ${error.message}`);
  }
};
