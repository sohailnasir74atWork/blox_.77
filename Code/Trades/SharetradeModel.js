import React, {  useMemo, useRef, useState } from 'react';
import { View, Text, Image, Modal, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot, { captureRef } from 'react-native-view-shot';
import Share from 'react-native-share';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';

const ShareTradeModal = ({ visible, onClose, tradeData }) => {
    const viewRef = useRef();

    // ✅ Add state for badges
    const [includeProfitLoss, setIncludeProfitLoss] = useState(true);
    const [includeHasWants, setIncludeHasWants] = useState(true);
    const [includeDescription, setIncludeDescription] = useState(true);
    const [includeValue, setIncludeValue] = useState(true);
    const [includePrice, setIncludePrice] = useState(true);
    const [includePercentage, setIncludePercentage] = useState(true);
    const [includeAppTag, setIncludeAppTag] = useState(true);
    const [showLeftGrid, setShowLeftGrid] = useState(true);
    const [showRightGrid, setShowRightGrid] = useState(true);
    const {theme, proGranted} = useGlobalState()
    const isDarkMode = theme === 'dark'
    const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
    const {localState} = useLocalState()
    const [showofferwall, setShowofferwall] = useState(false);

    if (!tradeData) return null;
    // console.log(tradeData)

    const { hasItems, wantsItems, hasTotal, wantsTotal, description } = tradeData;

    const tradeRatio = wantsTotal.value / hasTotal.value;
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));
    const isProfit = tradeRatio < 1; // Loss if tradeRatio < 1, Profit if > 1
    const neutral = tradeRatio === 1; // Exactly 1:1 trade

    const formatName = (name) => name.replace(/\s+/g, '-');

    const callbackfunction = () => {
       handleShare()
      };

    const sharewithAds = ()=>{
       if(!localState.isPro && proGranted)
        {InterstitialAdManager.showAd(callbackfunction);}
        else {callbackfunction()}
    }

    const handleShare = async () => {
        try {
            if (!viewRef.current) return;
            mixpanel.track("Trade Share");
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
      
    const Badge = ({ label, icon, isSelected, onPress }) => (
        <TouchableOpacity
            style={[
                styles.badge,
                isSelected ? styles.badgeSelected : styles.badgeUnselected
            ]}
            onPress={onPress}
        >
            <Icon name={icon} size={12} color={isSelected ? '#fff' : '#666'} style={styles.badgeIcon} />
            <Text style={[
                styles.badgeText,
                isSelected ? styles.badgeTextSelected : styles.badgeTextUnselected
            ]}>
                {label}
            </Text>
        </TouchableOpacity>
    );

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
                                {showLeftGrid && (
                                    <View style={[styles.gridContainer, !showRightGrid && styles.fullWidthGrid]}>
                                        {hasItemsChunks.map((row, rowIndex) => (
                                            <View key={rowIndex} style={styles.row}>
                                                {row.map((item, index) => (
                                                    <View key={`${item.name}-${item.type}-${index}`} style={styles.gridItem}>
                                                        <View style={item.name !== '' && styles.top}>
                                                            <Text style={styles.itemText}>
                                                            {item.name !== '' ? (item.value === 0 || item.value === "N/A" ? 'Special' : item.value) : ''}
                                                            </Text></View>
                                                        <Image
                                                            source={{
                                                                uri: item.type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.name)}_Icon.webp`,
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
                                )}

                                {/* Transfer Icon */}
                                {showLeftGrid && showRightGrid && (
                                    <View style={styles.transfer}>
                                        <Image source={require('../../assets/transfer.png')} style={styles.transferImage} />
                                    </View>
                                )}

                                {/* Wants Items */}
                                {showRightGrid && (
                                    <View style={[styles.gridContainer, !showLeftGrid && styles.fullWidthGrid]}>
                                        {wantItemsChunk.map((row, rowIndex) => (
                                            <View key={rowIndex} style={styles.row}>
                                                {row.map((item, index) => (
                                                    <View key={`${item.name}-${item.type}-${index}`} style={styles.gridItem}>
                                                        <View style={item.name !== '' && styles.top}>
                                                            <Text style={styles.itemText}>
                                                            {item.name !== '' ? (item.value === 0 || item.value === "N/A" ? 'Special' : item.value) : ''}
                                                            </Text></View>
                                                        <Image
                                                            source={{
                                                                uri: item.type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.name)}_Icon.webp`,
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
                                )}
                            </View>
                        )}
                         

                        {/* Profit/Loss (Optional) */}
                        {includeProfitLoss && (
                            <View style={styles.tradeTotals}>
                                {showLeftGrid && (
                                    <View style={[styles.hasBackground, !showRightGrid && styles.fullWidthSummary]}>
                                        <Text style={[styles.priceText]}>Has</Text>
                                        {includeValue && <Text style={[styles.priceText, { borderTopWidth: 1, borderTopColor: 'lightgrey' }]}>Value: {hasTotal.value.toLocaleString()}</Text>}
                                        {includePrice && <Text style={[styles.priceText]}>Price: {hasTotal.price.toLocaleString()}</Text>}
                                    </View>
                                )}
                                {showRightGrid && (
                                    <View style={[styles.wantBackground, !showLeftGrid && styles.fullWidthSummary]}>
                                        <Text style={[styles.priceText]}>Want</Text>
                                        {includeValue && <Text style={[styles.priceText, { borderTopWidth: 1, borderTopColor: 'lightgrey' }]}>Value: {wantsTotal.value.toLocaleString()}</Text>}
                                        {includePrice && <Text style={[styles.priceText]}>Price: {wantsTotal.price.toLocaleString()}</Text>}
                                    </View>
                                )}
                            </View>
                        )}
                        {includePercentage && showLeftGrid && showRightGrid && (
                            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', width: '100%', paddingVertical:10 }}>
                                <Text style={[styles.priceTextProfit, { color: !isProfit ? 'green' : 'red' }]}>
                                    {!isProfit ? 'Profit :' : 'Loss :'} {tradePercentage}%{!neutral && (
                                        <Icon
                                            name={isProfit ? 'arrow-down-outline' : 'arrow-up-outline'}
                                            size={12}
                                            color={isProfit ? 'red' : 'green'}
                                        />
                                    )}
                                </Text>
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

                    {/* ✅ Badges Section */}
                    <View style={styles.badgesContainer}>
                        <View style={styles.badgesWrapper}>
                            <Badge
                                label="Left Grid"
                                icon="grid"
                                isSelected={showLeftGrid}
                                onPress={() => {
                                    if (!showLeftGrid && !showRightGrid) {
                                        setShowLeftGrid(true);
                                    } else {
                                        setShowLeftGrid(!showLeftGrid);
                                    }
                                }}
                            />
                            <Badge
                                label="Right Grid"
                                icon="grid"
                                isSelected={showRightGrid}
                                onPress={() => {
                                    if (!showLeftGrid && !showRightGrid) {
                                        setShowRightGrid(true);
                                    } else {
                                        setShowRightGrid(!showRightGrid);
                                    }
                                }}
                            />
                            <Badge
                                label="Percentage"
                                icon="trending-up"
                                isSelected={includePercentage}
                                onPress={() => setIncludePercentage(!includePercentage)}
                            />
                            <Badge
                                label="Values"
                                icon="analytics"
                                isSelected={includeValue}
                                onPress={() => setIncludeValue(!includeValue)}
                            />
                            <Badge
                                label="Prices"
                                icon="pricetag"
                                isSelected={includePrice}
                                onPress={() => setIncludePrice(!includePrice)}
                            />
                            <Badge
                                label="Description"
                                icon="create"
                                isSelected={includeDescription}
                                onPress={() => setIncludeDescription(!includeDescription)}
                            />
                            <Badge
                                label="Items"
                                icon="list"
                                isSelected={includeHasWants}
                                onPress={() => setIncludeHasWants(!includeHasWants)}
                            />
                            <Badge
                                label="App Tag"
                                icon="information-circle"
                                isSelected={includeAppTag}
                                onPress={handleRemoveAttribute}
                            />
                        </View>
                    </View>

                    {/* Buttons */}
                    <View style={styles.buttonContainer}>
                        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.shareButton} onPress={sharewithAds}>
                            <Icon name="share-social" size={20} color="#fff" />
                            <Text style={styles.shareButtonText}>Share</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
            {showofferwall && <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} />}
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
        width: '2%',
        alignItems: 'center',
    },
    transferImage: {
        width: 10,
        height: 10,
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
        padding: 10,
        marginTop: 10,
    },
    cancelButton: {
        backgroundColor: config.colors.wantBlockRed,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 8,
        width: '48%',
        alignItems: 'center',
    },
    shareButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: config.colors.hasBlockGreen,
        paddingVertical: 8,
        paddingHorizontal: 20,
        borderRadius: 8,
        width: '48%',
    },
    shareButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    gridContainer: {
        width: '49%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullWidthGrid: {
        width: '100%',
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
        borderRadius: 6,
        backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF',
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
        backgroundColor: '#fe01ea', width: '100%', borderBottomEndRadius: 4, borderBottomStartRadius: 4
    },
    top: {
        backgroundColor: '#1dc226', width: '100%', borderTopEndRadius: 4, borderTopStartRadius: 4
    },
    wantBackground: {
        backgroundColor: config.colors.wantBlockRed,
        paddingVertical: 3,
        paddingHorizontal: 5,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        width: '49%'

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
        width: '49%'
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
    badgesContainer: {
        marginTop: 15,
        marginBottom: 10,
        width: '100%',
        paddingHorizontal: 10,
    },
    badgesWrapper: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 8,
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 20,
        // borderWidth: 1,
        borderColor: '#ddd',
        // minWidth: 100,
    },
    badgeSelected: {
        backgroundColor: config.colors.hasBlockGreen,
        // borderColor: config.colors.hasBlockGreen,
    },
    badgeUnselected: {
        backgroundColor: isDarkMode ? '#2C2C2E' : '#F2F2F7',
    },
    badgeIcon: {
        marginRight: 6,
    },
    badgeText: {
        fontSize: 10,
        fontWeight: '500',
    },
    badgeTextSelected: {
        color: '#fff',
    },
    badgeTextUnselected: {
        color: isDarkMode ? '#fff' : '#000',
    },
    fullWidthSummary: {
        width: '100%',
    },
});

export default ShareTradeModal;
