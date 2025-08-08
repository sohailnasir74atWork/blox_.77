import { View, FlatList, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { get, ref, set, update } from '@react-native-firebase/database';
import { Text, Image, TouchableOpacity, ScrollView, Alert, TextInput } from 'react-native';
import RNFS from 'react-native-fs';
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import { PERMISSIONS, request, check, RESULTS } from 'react-native-permissions';
import { Platform } from 'react-native';
import StoreItemGrid from './StoreItemGrid';
import PurchaseModal from './PurchaseModal';
import { getStyles } from './storeStyles';
import { downloadImage } from './storeUtils';
import SignInDrawer from '../../Firebase/SigninDrawer';
import { showMessage } from 'react-native-flash-message';
import { useLocalState } from '../../LocalGlobelStats';




export default function CoinStore() {
    const { theme, appdatabase, user, updateLocalStateAndDatabase , proGranted} = useGlobalState();
    const isDark = theme === 'dark';
    const styles = getStyles(isDark);
    const [selectedItem, setSelectedItem] = useState(null);
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedVariant, setSelectedVariant] = useState(null);
    const [backgroundImages, setBackgroundImages] = useState([]);
    const [hdImages, setHdImages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [signinDrawerVisible, setSigninDrawerVisible] = useState(false);
    const [storeItems, setStoreItems] = useState([]);
    const [itemsLoading, setItemsLoading] = useState(true);
    const [robuxQuantity, setRobuxQuantity] = useState(1);
    const [robuxPromptVisible, setRobuxPromptVisible] = useState(false);
    const [pendingRobuxPurchase, setPendingRobuxPurchase] = useState(null);
    const [maxBuyable, setMaxBuyable] = useState(null); // For Robux modal
    const [valueOverrideRobuxQty, setValueOverrideRobuxQty] = useState(null); // For Robux modal
    const [pendingRobuxModal, setPendingRobuxModal] = useState(false); // To control when to open 
    const {localState} = useLocalState();
    const [purchaseSuccess, setPurchaseSuccess] = useState(true)

    // modal for Robux


    useEffect(() => {
        const fetchImages = async () => {
            const snapshot1 = await get(ref(appdatabase, '/background'));
            const snapshot2 = await get(ref(appdatabase, '/hd'));

            const bgNames = snapshot1.exists() ? Object.values(snapshot1.val()) : [];
            const hdNames = snapshot2.exists() ? Object.values(snapshot2.val()) : [];

            setBackgroundImages(bgNames);
            setHdImages(hdNames);
        };

        fetchImages();
    }, []);
    useEffect(() => {
      const fetchStoreItems = async () => {
        setItemsLoading(true);
        try {
          const snapshot = await get(ref(appdatabase, '/storeItems'));
          if (snapshot.exists()) {
            let items = Object.values(snapshot.val());
            const userPurchases = user?.purchases || {}; // Assuming user has a 'purchases' field
    
            // Only check for these specific item IDs
            const specificItemIds = [0, 1, 2, 3, 4, 8];
            const robuxItemIds = [7];
    
            // Check if the user has purchased any of the specific items and update status
            items = items.map(item => {
              if (specificItemIds.includes(item.id)) {
                const purchase = userPurchases[item.id];
                if (purchase) {
                  const currentTime = Date.now();
                  if (purchase.expiresAt > currentTime || purchase.allowed < 1) {
                    // Update status to "Purchased" if not expired
                    item.status = "Purchased";
                  }
                }
              }
    
              // Additional check for item ID 7 (robux-based item)
              if (robuxItemIds.includes(item.id)) {
                const robuxAmount = item.robuxAmount || 0;  // Assuming the robuxAmount field is on the item object
                if (robuxAmount > 0) {
                  item.status = "Available";  // If robuxAmount is greater than 0, mark as available
                } else {
                  item.status = "Stock Reloading";  // Otherwise, mark as sold out
                }
              }
    
              return item;
            });
    
            setStoreItems(items);
          } else {
            setStoreItems([]);
          }
        } catch (e) {
          setStoreItems([]);
        } finally {
          setItemsLoading(false);
        }
      };
    
      fetchStoreItems();
    }, [appdatabase, purchaseSuccess]);
    

  // console.log(storeItems, 'storeitems')


  
    // console.log(backgroundImages, 'backgroundImages')
    // const requestStoragePermission = async () => {
    //     if (Platform.OS === 'android') {
    //       if (Platform.Version >= 33) {
    //         return await request(PERMISSIONS.ANDROID.READ_MEDIA_IMAGES);
    //       } else if (Platform.Version >= 29) {
    //         return await request(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE);
    //       } else {
    //         return await request(PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE);
    //       }
    //     } else {
    //       return await request(PERMISSIONS.IOS.PHOTO_LIBRARY_ADD_ONLY);
    //     }
    //   };
    // console.log('CameraRoll:', CameraRoll);

    const  styleOptions = [
        { key: 'rainbow', label: '🌈 Rainbow' },
        { key: 'candy',   label: '🍬 Candy' },
        { key: 'fire',    label: '🔥 Fire' },
        { key: 'ice',     label: '❄️ Ice' },
        { key: 'earth',   label: '🌍 Earth' },
        { key: 'ocean',   label: '🌊 Ocean' },
        { key: 'neon',    label: '💡 Neon' },
        { key: 'pastel',  label: '🧁 Pastel' },
        { key: 'galaxy',  label: '🌌 Galaxy' },
        { key: 'toxic',   label: '☣️ Toxic' },
        { key: 'bounce',   label: '🔄 Bounce' },
      ];

    // const getStyleLabel = (variant) => {
    //     switch (variant) {
    //         case 'rainbow': return '🌈 Rainbow';
    //         case 'bold': return '🖋 Bold';
    //         case 'glow': return '✨ Glow';
    //         default: return '🎨 Default';
    //     }
    // };

    const handleBuyPress = async (item) => {
        if (!user?.id) {
            setSigninDrawerVisible(true);
            return;
        }
        // if (item.status !== 'Available') {
        //     return Alert.alert('❌ This item is Sold Out!');
        // }
        if (item.status === "Sold Out") {
          showMessage({
              message: "❌ This item is sold out!",
              type: "warning",
              icon: "warning",
              backgroundColor: "grey",
              color: 'white',
          });
          return;
      }
  
      // If the item has already been Purchased
      if (item.status === "Purchased") {
          showMessage({
              message: "✔️ You've already purchased this item!",
              type: "info",
              icon: "info",
              backgroundColor: config.colors.hasBlockGreen,
              color: 'white',
          });
          return;
      }
        setSelectedItem(item);

// console.log(storeItems)
        if (item.category === 'robux') {
            // Fetch latest robuxAmount and coins to determine maxBuyable
            const itemRef = ref(appdatabase, `/storeItems/${item.id}`);
            const itemSnap = await get(itemRef);
            let robuxAmount = itemSnap.exists() && Number(item.robuxAmount);
            // console.log('robuxAmount', robuxAmount);
            const robuxCoinCost = item.cost || 1;
            const currentCoins = user?.coins ?? 0;
            const maxBuyableCalc = Math.min(Math.floor(currentCoins / robuxCoinCost), robuxAmount);
            // console.log('maxBuyableCalc', maxBuyableCalc, 'currentCoins', currentCoins, 'robuxCoinCost', robuxCoinCost, 'robuxAmount', robuxAmount);

            // Create a new item object with the latest robuxAmount
            const updatedItem = { ...item, robuxAmount };
            // console.log(updatedItem, 'updateditem')
            setMaxBuyable(maxBuyableCalc > 0 ? maxBuyableCalc : 0);
            setValueOverrideRobuxQty(null);
            setSelectedItem(updatedItem); // Pass the updated item to the modal
            setPendingRobuxModal(true);
            return;
        }
        if (item.category === 'styled') {
            setSelectedVariant('rainbow'); // default variant
        }
        setModalVisible(true);
    };
//  console.log(modalVisible)

    // Add a helper to update robux stock and sold count in the database
   /**
 * Increment the `sold` field for any store item.
 * For Robux we pass the exact quantity; all other items default to +1
 */
const updateSoldCount = async (itemId, quantity = 1) => {


    try {
      if (itemId === undefined || itemId === null) throw new Error('Invalid item ID');  
      // 🔸  NO off-by-one subtraction; use the id exactly as stored in DB
      const itemRef  = ref(appdatabase, `/storeItems/${itemId}`);
      // console.log(itemId)
  
      const snap     = await get(itemRef);
      // console.log(snap)
      const prevSold = snap.exists() ? Number(snap.val().sold) : 0;
      // console.log(prevSold, 'prevSold')
  
      await update(itemRef, { sold: prevSold + Number(quantity) });
      return prevSold + Number(quantity);
    } catch (err) {
      console.warn('⚠️ sold counter update failed:', err.message);
      return false;
    }
  };
  
 
    const handleRobuxConfirm = async () => {
        setRobuxPromptVisible(false);
        if (!pendingRobuxPurchase) return;
        await confirmPurchase(null, pendingRobuxPurchase.item, robuxQuantity);
        setPendingRobuxPurchase(null);
    };
    const confirmPurchase = async (
      imageName = null,
      styleData = null,
      // robuxQuantity,
      robuxQuantity = null,
      styledIcons = []
    ) => {
      const item = selectedItem;
      if (!item || !user?.id || !appdatabase) return;
      
    
      const currentCoins = user?.coins ?? 0;
      const userPurchases = user?.purchases || {};
      const existing = userPurchases[item.id];
      const total = item.cost;
      const now = Date.now();
      const proUser = localState.isPro || proGranted; 
      let expiresAt = null
      // Wallpapers / HD images
      if (item.category === 'link') {
        if (!proUser && currentCoins < total ) 
          { showMessage({
             message: "Not enough coins!",
             type: "warning",
             icon: "warning"
           });
           return
         }        if (item.validForDays && now) {
          expiresAt = now + (Number(item.validForDays) * 86400000); 
        }
        const purchaseObj = {
            id: item.id,
            title: item.title,
            allowed: 10,  
            expiresAt
            
        };

        setLoading(true);
        try {
            await updateLocalStateAndDatabase({
                [`purchases/${item.id}`]: purchaseObj,
                // coins: currentCoins - ,
                coins: proUser ? currentCoins : currentCoins - item.cost,
            });
            setPurchaseSuccess(!purchaseSuccess)
            showMessage({
                message: `🎉 Purchased ${item.title} for ${item.cost} coins.`,
                type: "success",
                icon: "success",
            });
        } catch (error) {
            showMessage({
                message: error.message || 'Something went wrong.',
                type: "danger",
                icon: "danger",
            });
        } finally {
            setLoading(false);
            setTimeout(() => setModalVisible(false), 10);

        }
        return;
    }
      if ((item.id === 5 || item.id === 6) && imageName) {
        const prevImages = existing?.images || [];
        if (prevImages.includes(imageName)) {
          setLoading(true);
          try {
            await downloadImage(imageName);
          } finally {
            setLoading(false);
          }
          return;
        }
        if (!proUser && currentCoins < total ) 
         { showMessage({
            message: "Not enough coins!",
            type: "warning",
            icon: "warning"
          });
          return
        }
          
          // return Alert.alert('Not enough coins!');
          setLoading(true);

        
        try {
          await updateLocalStateAndDatabase({
            [`purchases/${item.id}`]: {
              id: item.id,
              images: [...prevImages, imageName],
              title: item.title,
            },
            coins: proUser ? currentCoins : currentCoins - total,
          });
          await downloadImage(imageName);
          showMessage({
            message: "🎉 Purchased and downloaded image!",
            type: "success",
            icon: "success"
          });
          // Alert.alert(`🎉 Purchased and downloaded image!`);
          await updateSoldCount(item.id);
        } catch (error) {
          showMessage({
            message: error.message || 'Something went wrong.',
            type: "danger",
            icon: "danger"
          });
        } finally {
          setLoading(false);
          setTimeout(() => setModalVisible(false), 10);
        }
        return;
      }
    
      // Robux purchase
      if (item.category === 'robux') {
        // console.log(item)

        try {
          if (!item.id) throw new Error('Invalid item ID');
          const itemRef = ref(appdatabase, `/storeItems/${item.id}`);
          const itemSnap = await get(itemRef);
          const robuxAmount = Number(itemSnap.exists() ? itemSnap.val().robuxAmount : item.robuxAmount) || 0;
          const sold = Number(itemSnap.exists() ? Number(itemSnap.val().sold) : Number(item.sold)) || 0;
          const robuxCoinCost = item.cost || 1;
          const quantity = Number(robuxQuantity) || 1;
          const totalCost = quantity * robuxCoinCost

          // const maxBuyable = Math.min(Math.floor(currentCoins / robuxCoinCost), robuxAmount);
          // console.log(!proUser && currentCoins < totalCost, !proUser, currentCoins, totalCost, item.cost, quantity, robuxCoinCost)

          if (!proUser && currentCoins < totalCost ) 
            { showMessage({
               message: "Not enough coins!",
               type: "warning",
               icon: "warning"
             });
             return
           }

          // if (quantity > maxBuyable) {
          //   Alert.alert('Not enough coins or stock!');
          //   return;
          // }
          if (robuxAmount < quantity) {
            Alert.alert('Sold Out', 'No more Robux available to claim.');
            return;
          }
          setLoading(true);
          await updateLocalStateAndDatabase({
            robux: (user.robux || 0) + quantity,
            [`purchases/${item.id}`]: {
              id: item.id,
              total: (existing?.total || 0) + quantity,
              title: item.title,
            },
            coins:  currentCoins - (quantity * robuxCoinCost),
            // coins: currentCoins - (quantity * robuxCoinCost),
          });
          setPurchaseSuccess(!purchaseSuccess)
          // console.log(robuxAmount, quantity)
          await update(itemRef, {
            robuxAmount: robuxAmount - quantity,
            sold: sold + quantity,
            status: robuxAmount - quantity <= 0 ? 'Sold Out' : 'Available',
          });
          setStoreItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    robuxAmount: robuxAmount - quantity,
                    sold: sold + quantity,
                    status: robuxAmount - quantity <= 0 ? 'Sold Out' : 'Available',
                  }
                : it
            )
          );
          setSelectedItem((prev) =>
            prev && prev.id === item.id
              ? {
                  ...prev,
                  robuxAmount: robuxAmount - quantity,
                  sold: sold + quantity,
                  status: robuxAmount - quantity <= 0 ? 'Sold Out' : 'Available',
                }
              : prev
          );
          setTimeout(() => setModalVisible(false), 10);
          await updateSoldCount(item.id, quantity);
          showMessage({
            message: `🎉 Purchased ${quantity} Robux!`,
            type: "success",
            icon: "success"
          });
          // Alert.alert(`🎉 Purchased ${quantity} Robux!`);
        } catch (error) {
          showMessage({
            message: `⚠️ Error, ${error.message}`,
            type: "danger",
            icon: "danger"
          });
          // Alert.alert();
        } finally {
          setLoading(false);
          setTimeout(() => setModalVisible(false), 10);
        }
        return;
      }
    
      // Styled Username or Regular Item
      if (item.category === 'styled' || item.category === 'regular' ||  item.category === 'gif') {
        if (!proUser && currentCoins < total ) 
          { showMessage({
             message: "Not enough coins!",
             type: "warning",
             icon: "warning"
           });
           return
         }
        let expiresAt = null;
        if (item.validForDays) {
          expiresAt = now + item.validForDays * 86400000;
        }
    
        const purchaseObj = {
          id: item.id,
          title: item.title,
          expiresAt,
        };
    
        if (item.category === 'styled' && styleData) {
          purchaseObj.style = styleData;
        }
    
        setLoading(true);
        try {
          await updateLocalStateAndDatabase({
            [`purchases/${item.id}`]: purchaseObj,
            coins: proUser ? currentCoins : currentCoins - total,
          });
          setPurchaseSuccess(!purchaseSuccess)
          setTimeout(() => setModalVisible(false), 10);
          showMessage({
            message: `🎉 Purchased ${item.title} for ${total} coins.`,
            type: "success",
            icon: "success"
          });
          // Alert.alert();
          await updateSoldCount(item.id);
        } catch (error) {
          showMessage({
            message: error.message,
            type: "danger",
            icon: "danger"
          });
        } finally {
          setLoading(false);
          setTimeout(() => setModalVisible(false), 10);
        }
        return;
      }
    
      // 🆕 Icons Category
      if (item.category === 'icons') {
        // if (!proUser && currentCoins < total) return Alert.alert('Not enough coins!');
        if (!proUser && currentCoins < total ) 
          { showMessage({
             message: "Not enough coins!",
             type: "warning",
             icon: "warning"
           });
           return
         }
        if (!styledIcons || styledIcons.length === 0) return Alert.alert('Please select at least one icon!');
    
        const purchaseObj = {
          id: item.id,
          title: item.title,
          icons: styledIcons,
        };
        if (item.validForDays) {
          purchaseObj.expiresAt = now + item.validForDays * 86400000;
        }
    
        setLoading(true);
        try {
          await updateLocalStateAndDatabase({
            [`purchases/${item.id}`]: purchaseObj,
            coins: proUser ? currentCoins : currentCoins - total,
          });
          setPurchaseSuccess(!purchaseSuccess)
          showMessage({
            message: `🎉 Purchased ${styledIcons.length} icons!`,
            type: "success",
            icon: "success"
          });
          // Alert.alert(`🎉 Purchased ${styledIcons.length} icons!`);
          await updateSoldCount(item.id);
          setTimeout(() => setModalVisible(false), 100);
        } catch (error) {
          Alert.alert('⚠️ Error', error.message || 'Something went wrong.');
        } finally {
          setLoading(false);
        }
        return;
      }
    };
      
    const handleLoginSuccess = () => {
        setSigninDrawerVisible(false);
    };

    // Open the modal for Robux only after maxBuyable is set
    useEffect(() => {
      if (pendingRobuxModal && typeof maxBuyable === 'number') {
        setModalVisible(true);
        setPendingRobuxModal(false);
      }
    }, [pendingRobuxModal, maxBuyable]);

    // Add this effect to update user in the store if user.coins changes
    useEffect(() => {
      setStoreItems((prev) => [...prev]); // Trigger a re-render if needed
    }, [user?.coins]);

    return (
        <View style={styles.container}>
            {itemsLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="large" color="#6A5ACD" />
                </View>
            ) : (
                <StoreItemGrid items={storeItems} onItemPress={handleBuyPress} isDark={isDark} styles={styles} />
            )}
            <PurchaseModal
                visible={modalVisible}
                selectedItem={selectedItem}
                selectedVariant={selectedVariant}
                setSelectedVariant={setSelectedVariant}
                styleOptions={styleOptions}
                // getStyleLabel={getStyleLabel}
                confirmPurchase={confirmPurchase}
                onClose={() => { setModalVisible(false); setMaxBuyable(null); setValueOverrideRobuxQty(null); }}
                backgroundImages={backgroundImages}
                hdImages={hdImages}
                downloadImage={downloadImage}
                styles={styles}
                loading={loading}
                maxBuyable={maxBuyable}
                valueOverrideRobuxQty={valueOverrideRobuxQty}
                userCoins={ user?.coins ?? 0}
            />
            <SignInDrawer
                visible={signinDrawerVisible}
                onClose={handleLoginSuccess}
                selectedTheme={theme === 'dark' ? { colors: { text: '#fff' } } : { colors: { text: '#000' } }}
                message={'Sign in to purchase items from the store.'}
                screen='Store'
            />
            <Modal visible={robuxPromptVisible} transparent animationType="fade">
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
                    <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 24, width: 300, alignItems: 'center' }}>
                        <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>How many Robux?</Text>
                        <TextInput
                            style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8, width: '100%', textAlign: 'center', fontSize: 18, marginBottom: 16 }}
                            keyboardType="number-pad"
                            value={String(robuxQuantity)}
                            onChangeText={val => {
                                let num = parseInt(val.replace(/[^0-9]/g, '')) || 1;
                                if (pendingRobuxPurchase) {
                                    num = Math.max(1, Math.min(num, pendingRobuxPurchase.maxBuyable));
                                }
                                setRobuxQuantity(num);
                            }}
                            maxLength={5}
                        />
                        <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                            <TouchableOpacity
                                style={{ flex: 1, backgroundColor: '#eee', borderRadius: 8, padding: 12, alignItems: 'center', marginRight: 6 }}
                                onPress={() => { setRobuxPromptVisible(false); setPendingRobuxPurchase(null); }}
                            >
                                <Text style={{ color: '#6A5ACD', fontWeight: 'bold' }}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={{ flex: 1, backgroundColor: '#6A5ACD', borderRadius: 8, padding: 12, alignItems: 'center', marginLeft: 6 }}
                                onPress={handleRobuxConfirm}
                            >
                                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Confirm</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}
