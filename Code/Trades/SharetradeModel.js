import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, Modal, TouchableOpacity, Switch, StyleSheet, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot, { captureRef } from 'react-native-view-shot';
import Share from 'react-native-share';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import getAdUnitId from '../Ads/ads';
import { AdEventType, InterstitialAd } from 'react-native-google-mobile-ads';

const interstitialAdUnitId = getAdUnitId('interstitial');
const interstitial = InterstitialAd.createForAdRequest(interstitialAdUnitId);

const ShareTradeModal = ({ visible, onClose, tradeData }) => {
    const viewRef = useRef();

    // ✅ Add state for switches
    const [includeProfitLoss, setIncludeProfitLoss] = useState(true);
    const [includeHasWants, setIncludeHasWants] = useState(true);
    const [includeDescription, setIncludeDescription] = useState(true);
    const [includeValue, setIncludeValue] = useState(true);
    const [includePrice, setIncludePrice] = useState(true);
    const [includePercentage, setIncludePercentage] = useState(true);
    const [includeAppTag, setIncludeAppTag] = useState(true);
    const {theme} = useGlobalState()
    const isDarkMode = theme === 'dark'
    const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
    const {localState} = useLocalState()
    const [showofferwall, setShowofferwall] = useState(false);
    const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
    // console.log(localState.isPro, 'from share model')




    useEffect(() => {
        interstitial.load();
      
        const unsubscribeLoaded = interstitial.addAdEventListener(AdEventType.LOADED, () => {
          setIsAdLoaded(true);
        });
      
        const unsubscribeClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
          setIsAdLoaded(false);
          setIsShowingAd(false);
          interstitial.load(); // Reload ad for next use
        });
      
        const unsubscribeError = interstitial.addAdEventListener(AdEventType.ERROR, (error) => {
          setIsAdLoaded(false);
          setIsShowingAd(false);
          console.error('Ad Error:', error);
        });
      
        return () => {
          unsubscribeLoaded();  // ✅ Correct way to remove event listeners
          unsubscribeClosed();
          unsubscribeError();
        };
      }, []);
      
      
    
      const showInterstitialAd = (callback) => {
        if (isAdLoaded && !isShowingAd && !localState.isPro) {
          setIsShowingAd(true);
          try {
            interstitial.show();
            interstitial.addAdEventListener(AdEventType.CLOSED, callback);
          } catch (error) {
            // console.error('Error showing interstitial ad:', error);
            setIsShowingAd(false);
            callback(); // Proceed with fallback in case of error
          }
        } else {
          callback(); // If ad is not loaded, proceed immediately
        }
      };
    


    if (!tradeData) return null;
    // console.log(tradeData)

    const { hasItems, wantsItems, hasTotal, wantsTotal, description } = tradeData;

    const tradeRatio = wantsTotal.value / hasTotal.value;
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));
    const isProfit = tradeRatio < 1; // Loss if tradeRatio < 1, Profit if > 1
    const neutral = tradeRatio === 1; // Exactly 1:1 trade

    const formatName = (name) => name.replace(/\s+/g, '-');



    const sharewithAds = ()=>{
        showInterstitialAd(()=>{
            handleShare()
        })
    }

    const handleShare = async () => {
        try {
            if (!viewRef.current) return;
            const uri = await captureRef(viewRef, {
                format: 'png',
                quality: 0.8,
                result: 'tmpfile',
            });



            await Share.open({
                url: `file://${uri}`,
                type: 'image/png',
            });

            onClose();
        } catch (error) {
            console.error('Error sharing:', error);
        }
    };

    const chunkArray = (array, size) => {
        const chunkedArr = [];
        for (let i = 0; i < array.length && i < 4; i += size) {
            chunkedArr.push(array.slice(i, i + size));
        }
        return chunkedArr;
    };
    const ensureFourItems = (items) => {
        const filledItems = [...items];
        while (filledItems.length < 4) {
            filledItems.push({ name: '', type: 'placeholder' }); // Placeholder item
        }
        return filledItems;
    };

    const hasItemsChunks = chunkArray(ensureFourItems(hasItems), 2);
    const wantItemsChunk = chunkArray(ensureFourItems(wantsItems), 2);

    const handleRemoveAttribute = () => {
        if (!localState?.isPro) {
          Alert.alert(
            "Pro Feature", 
            "Only Pro users can remove this. Do you want to upgrade?", 
            [
              { text: "Cancel", style: "cancel" },
              { text: "Upgrade", onPress: () => setShowofferwall(true) }
            ]
          );
          return;
        }
      
        setIncludeAppTag(!includeAppTag); // Assuming this is what you intended
      };
      


    return (
        <Modal transparent visible={visible} animationType="slide">
            <View style={styles.modalOverlay}>
                <View style={styles.modalContainer}>
                    {/* Trade Details */}
                    <ViewShot ref={viewRef} style={{ backgroundColor: 'white', padding: 5, borderRadius:8,         backgroundColor:'#E8F9FF'
 }}>
                        {includeHasWants && (
                            <View style={styles.tradeDetails}>
                                {/* Has Items */}
                                <View style={styles.gridContainer}>
                                    {hasItemsChunks.map((row, rowIndex) => (
                                        <View key={rowIndex} style={styles.row}>
                                            {row.map((item, index) => (
                                                <View key={`${item.name}-${item.type}-${index}`} style={styles.gridItem}>
                                                    <View style={item.name !== '' && styles.top}>
                                                        <Text style={styles.itemText}>
                                                        {item.name !== '' ? item.value : ''}
                                                        </Text></View>
                                                    <Image
                                                        source={{
                                                            uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.name)}_Icon.webp`,
                                                        }}
                                                        style={styles.itemImage}
                                                    />
                                                    <View style={item.name !== '' && styles.bottom}>
                                                        <Text style={styles.itemText}>
                                                            {item.name} {item.type === 'p' && '(P)'}
                                                        </Text></View>
                                                </View>
                                            ))}
                                        </View>
                                    ))}
                                </View>

                                {/* Transfer Icon */}
                                <View style={styles.transfer}>
                                    <Image source={require('../../assets/transfer.png')} style={styles.transferImage} />
                                </View>

                                {/* Wants Items */}
                                <View style={styles.gridContainer}>
                                    {wantItemsChunk.map((row, rowIndex) => (
                                        <View key={rowIndex} style={styles.row}>
                                            {row.map((item, index) => (
                                                <View key={`${item.name}-${item.type}-${index}`} style={styles.gridItem}>
                                                    <View style={item.name !== '' && styles.top}>
                                                        <Text style={styles.itemText}>
                                                        {item.name !== '' ? item.value : ''}
                                                        </Text></View>
                                                    <Image
                                                        source={{
                                                            uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.name)}_Icon.webp`,
                                                        }}
                                                        style={styles.itemImage}
                                                    />
                                                    <View style={item.name !== '' && styles.bottom}>
                                                        <Text style={styles.itemText}>
                                                            {item.name} {item.type === 'p' && '(P)'}
                                                        </Text></View>
                                                </View>
                                            ))}
                                        </View>
                                    ))}
                                </View>
                            </View>
                        )}

                        {/* Profit/Loss (Optional) */}
                        {includeProfitLoss && (
                            <View style={styles.tradeTotals}>
                                <View style={styles.hasBackground}>
                                    <Text style={[styles.priceText]}>Has</Text>
                                    {includeValue && <Text style={[styles.priceText, { borderTopWidth: 1, borderTopColor: 'lightgrey' }]}>Has Value: {hasTotal.value.toLocaleString()}</Text>}
                                    {includePrice && <Text style={[styles.priceText]}>Has Price: {hasTotal.price.toLocaleString()}</Text>}
                                </View>


                                {includePercentage && <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', width: '10%' }}>
                                    <Text style={[styles.priceTextProfit, { color: !isProfit ? 'green' : 'red' }]}>
                                        {tradePercentage}%{!neutral && (
                                            <Icon
                                                name={isProfit ? 'arrow-down-outline' : 'arrow-up-outline'}
                                                size={12}
                                                color={isProfit ? 'red' : 'green'}
                                            />
                                        )}
                                    </Text>
                                </View>}
                                <View style={styles.wantBackground}>
                                    <Text style={[styles.priceText]}>Want</Text>
                                    {includeValue && <Text style={[styles.priceText, { borderTopWidth: 1, borderTopColor: 'lightgrey' }]}>Wants Value: {wantsTotal.value.toLocaleString()}</Text>}
                                    {includePrice && <Text style={[styles.priceText]}>Wants Price: {hasTotal.price.toLocaleString()}</Text>}
                                </View>
                            </View>
                        )}

                        {/* Description (Optional) */}
                        {includeDescription && description && <Text style={styles.description}>Note: {description}</Text>}

                        {includeAppTag &&
                            <View style={styles.footer}>
                                <Text style={styles.footerText}>Created with {config.appName}</Text>

                                <Image
                                    source={require('../../assets/logo.webp')} // Replace with the actual local image path
                                    style={styles.footerImage}
                                />
                            </View>

                        }
                    </ViewShot>
                    {/* ✅ Switches Section */}
                    <View style={styles.switchContainer}>
                        <View style={styles.switchRow}>
                            <Text style={styles.switchLabel}>Include %Age</Text>
                            <Switch
                                value={includePercentage}
                                onValueChange={setIncludePercentage}
                            />
                        </View>
                        <View style={styles.switchRow}>
                            <Text style={styles.switchLabel}>Include Values</Text>
                            <Switch
                                value={includeValue}
                                onValueChange={setIncludeValue}
                            />
                        </View>
                        <View style={styles.switchRow}>
                            <Text style={styles.switchLabel}>Include Prices</Text>
                            <Switch
                                value={includePrice}
                                onValueChange={setIncludePrice}
                            />
                        </View>
                        <View style={styles.switchRow}>
                            <Text style={styles.switchLabel}>Include Profit/Loss</Text>
                            <Switch
                                value={includeProfitLoss}
                                onValueChange={setIncludeProfitLoss}
                            />
                        </View>
                        <View style={styles.switchRow}>
                            <Text style={styles.switchLabel}>Include Description</Text>
                            <Switch
                                value={includeDescription}
                                onValueChange={setIncludeDescription}
                            />
                        </View>
                        <View style={styles.switchRow}>
                            <Text style={styles.switchLabel}>Remove Attributes</Text>
                            <Switch
                                value={includeAppTag}
                                onValueChange={handleRemoveAttribute}
                            />
                        </View>
                    </View>

                    {/* Buttons */}
                    <View style={styles.buttonContainer}>
                        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.shareButton} onPress={sharewithAds}>
                            <Text style={styles.cancelText}>Share</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
            <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} />
        </Modal>
    );
};

// Styles
const getStyles = (isDarkMode) =>
StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContainer: {
        backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
        // paddingVertical: 10,
        borderRadius: 8,
        width: '98%',
        alignItems: 'center',
    },
    tradeDetails: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
        
    },
    transfer: {
        width: '10%',
        alignItems: 'center',
    },
    transferImage: {
        width: 25,
        height: 25,
    },
    switchContainer: {
        width: '100%',
        marginBottom: 15,
        paddingTop: 20,
        paddingHorizontal: 5,
    },
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginVertical: 5,
    },
    switchLabel: {
        fontSize: 12,
        fontFamily:'Lato-Regular',
        color: isDarkMode ? '#f2f2f7' : '#121212' ,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        padding: 5,

    },
    cancelButton: {
        backgroundColor: config.colors.wantBlockRed,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 8,
        width: '48%'
    },
    shareButton: {
        backgroundColor: config.colors.hasBlockGreen,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 8,
        width: '48%'

    },
    gridContainer: {
        width: '45%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        width: '100%',
        marginBottom: 4, // Space between rows
    },
    gridItem: {
        width: '49%', // Each item takes ~45% of the row width
        alignItems: 'center',
        justifyContent: 'center',
        // padding: 4,
        borderWidth: !config.isNoman ? 1 : 0, // Optional: Add border for grid feel
        borderColor: '#ccc',
        borderRadius: 8,
        backgroundColor: !config.isNoman ? config.colors.primary : '' 
    },
    itemImage: {
        width: 50,
        height: 50,
        borderRadius: 8,
    },
    itemText: {
        fontSize: 10,
        marginTop: 3,
        textAlign: 'center',
        color: 'white',
        lineHeight: 16,
        paddingVertical: 2,
        fontFamily:'Lato-Bold'

    },
    cancelText: {
        color: 'white',
        fontFamily: 'Lato-Bold',
        alignSelf: 'center'
    },
    tradeTotals: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        // paddingHorizontal:20
    },
    bottom: {
        backgroundColor: config.colors.secondary, width: '100%', borderBottomEndRadius: 8, borderBottomStartRadius: 8
    },
    top: {
        backgroundColor: config.colors.hasBlockGreen, width: '100%', borderTopEndRadius: 8, borderTopStartRadius: 8
    },
    wantBackground: {
        backgroundColor: config.colors.wantBlockRed,
        paddingVertical: 3,
        paddingHorizontal: 5,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        width: '45%'

    },
    priceText: {
        color: 'white',
        fontFamily:'Lato-Regular',
        fontSize:12,
        lineHeight:20

    },
    hasBackground: {
        backgroundColor: config.colors.hasBlockGreen,
        paddingVertical: 3,
        paddingHorizontal: 5,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        width: '45%'
    },
    priceTextProfit: {
        fontSize: 12
    },
    description: {
        fontSize: 12,
        paddingVertical: 5
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        // marginTop: 10,
    },

    footerText: {
        fontSize: 10,
        color: '#666',
        marginRight: 5,
        fontStyle: "italic"
    },

    footerImage: {
        width: 40, // Adjust size as needed
        height: 40,
        resizeMode: 'contain',
    },

});

export default ShareTradeModal;
