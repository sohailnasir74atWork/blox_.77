import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Image, Switch, TouchableOpacity, Alert, RefreshControl, Platform } from 'react-native';
import { useGlobalState } from '../GlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import FruitSelectionDrawer from './FruitSelectionDrawer';
import SigninDrawer from '../Firebase/SigninDrawer';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import { requestPermission } from '../Helper/PermissionCheck';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showWarningMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';


const TimerScreen = ({ selectedTheme }) => {
  const { user, updateLocalStateAndDatabase, theme, reload, stockNotifierPurchase } = useGlobalState();
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const [fruitRecords, setFruitRecords] = useState([]);
  const [isDrawerVisible, setDrawerVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isSigninDrawerVisible, setisSigninDrawerVisible] = useState(false);
  const [isAdVisible, setIsAdVisible] = useState(true);
  const [normalStock, setNormalStock] = useState([]);
  const [mirageStock, setmirageStock] = useState([]);
  const [prenormalStock, setPreNormalStock] = useState([]);
  const [premirageStock, setPremirageStock] = useState([]);
  const { t } = useTranslation();

  const isFocused = useIsFocused();
  const [currentTime, setCurrentTime] = useState(Date.now());
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState();
  const intervalRef = useRef(null);

  const isDarkMode = theme === 'dark';

  const parseJSONSafely = (data) => {
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (error) {
      console.error("JSON parse error:", error, "Raw data:", data);
      return {};
    }
  };

  // ✅ Track raw localState references to detect actual changes without JSON.stringify
  const prevDataRef = useRef(null);
  const prevNormalRef = useRef(null);
  const prevMirageRef = useRef(null);
  const prevPreNormalRef = useRef(null);
  const prevPreMirageRef = useRef(null);

  useEffect(() => {
    // Only re-parse and update state when the raw localState reference actually changed
    if (localState?.data !== prevDataRef.current) {
      prevDataRef.current = localState?.data;
      setFruitRecords(Object.values(parseJSONSafely(localState?.data)));
    }
    if (localState?.normalStock !== prevNormalRef.current) {
      prevNormalRef.current = localState?.normalStock;
      setNormalStock(Object.values(parseJSONSafely(localState?.normalStock)));
    }
    if (localState?.mirageStock !== prevMirageRef.current) {
      prevMirageRef.current = localState?.mirageStock;
      setmirageStock(Object.values(parseJSONSafely(localState?.mirageStock)));
    }
    if (localState?.prenormalStock !== prevPreNormalRef.current) {
      prevPreNormalRef.current = localState?.prenormalStock;
      setPreNormalStock(Object.values(parseJSONSafely(localState?.prenormalStock)));
    }
    if (localState?.premirageStock !== prevPreMirageRef.current) {
      prevPreMirageRef.current = localState?.premirageStock;
      setPremirageStock(Object.values(parseJSONSafely(localState?.premirageStock)));
    }
  }, [localState.data, localState.normalStock, localState.mirageStock, localState.prenormalStock, localState.premirageStock]);

  const openDrawer = () => {
    triggerHapticFeedback('impactLight');
    setDrawerVisible(true);
  };

  const handleLoginSuccess = () => {
    setisSigninDrawerVisible(false);
  };

  const closeDrawer = () => setDrawerVisible(false);

  const handleFruitSelect = async (fruit) => {
    triggerHapticFeedback('impactLight');

    const selectedFruits = user.selectedFruits || [];
    const isAlreadySelected = selectedFruits.some((item) => item.name === fruit.name);
    mixpanel.track("Select Fruit", { fruit: fruit.name });

    if (isAlreadySelected) {
      showWarningMessage(t("settings.notice"), t("stock.already_selected"));
      return;
    }

    if ((!localState.isPro && !stockNotifierPurchase) && selectedFruits.length >= 3) {
      Alert.alert(
        "Selection Limit Reached",
        "You can only select up to 3 fruits as a free user. Upgrade to Pro or purchse notifier to select more.",
        [{ text: "OK", onPress: () => {} }]
      );
      return;
    }

    const addFruitAndClose = async () => {
      const updatedFruits = [...selectedFruits, fruit];
      await updateLocalStateAndDatabase('selectedFruits', updatedFruits);
      showSuccessMessage(t("home.alert.success"), t("stock.fruit_selected"));
      setTimeout(() => {
        closeDrawer();
      }, 300);
    };

    addFruitAndClose();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleRemoveFruit = (fruit) => {
    triggerHapticFeedback('impactLight');
    const selectedFruits = user.selectedFruits || [];
    const updatedFruits = selectedFruits.filter((item) => item.name !== fruit.name);
    updateLocalStateAndDatabase('selectedFruits', updatedFruits);
  };

  const toggleSwitch = async () => {
    try {
      const permissionGranted = await requestPermission();
      if (!permissionGranted) return;

      if (user.id == null) {
        setisSigninDrawerVisible(true);
      } else {
        const currentValue = user.isReminderEnabled;
        updateLocalStateAndDatabase('isReminderEnabled', !currentValue);
      }
    } catch (error) {}
  };

  const toggleSwitch2 = async () => {
    try {
      const permissionGranted = await requestPermission();
      if (!permissionGranted) return;

      if (user?.id == null) {
        setisSigninDrawerVisible(true);
      } else {
        const currentValue = user.isSelectedReminderEnabled;
        updateLocalStateAndDatabase('isSelectedReminderEnabled', !currentValue);
      }
    } catch (error) {}
  };

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const calculateTimeLeft = (intervalHours) => {
    const now = currentTime;
    let nextReset = new Date();
    nextReset.setHours(1, 0, 0, 0);

    while (nextReset <= now) {
      nextReset.setHours(nextReset.getHours() + intervalHours);
    }
    return Math.floor((nextReset - now) / 1000);
  };

  const normalInterval = 4;
  const mirageInterval = 2;

  const normalTimer = useMemo(() => formatTime(calculateTimeLeft(normalInterval)), [currentTime]);
  const mirageTimer = useMemo(() => formatTime(calculateTimeLeft(mirageInterval)), [currentTime]);

  useEffect(() => {
    if (!isFocused) {
      clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [isFocused]);

  // ── Timer digit display ──
  const TimerDigits = ({ time, color }) => {
    const parts = time.split(':');
    return (
      <View style={styles.timerDigitsRow}>
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            <View style={[styles.timerDigitBox, { backgroundColor: color }]}>
              <Text style={styles.timerDigitText}>{part}</Text>
            </View>
            {i < parts.length - 1 && <Text style={[styles.timerColon, { color }]}>:</Text>}
          </React.Fragment>
        ))}
      </View>
    );
  };

  // ── Stock fruit card (compact, 2-per-row) ──
  const StockFruitCard = ({ item }) => (
    <View style={styles.fruitCard}>
      <Image
        source={{
          uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${item.Normal.replace(/^\+/, '').replace(/\s+/g, '-')}_Icon.webp`,
        }}
        style={styles.fruitCardImage}
      />
      <View style={styles.fruitCardInfo}>
        <Text style={[styles.fruitCardName, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]} numberOfLines={1}>{item.Normal}</Text>
        <View style={styles.fruitCardPrices}>
          <View style={[styles.priceBadge, { backgroundColor: config.colors.hasBlockGreen }]}>
            <Text style={styles.priceBadgeText}>{item.price}</Text>
          </View>
          {!!item.value && (
            <View style={[styles.priceBadge, { backgroundColor: config.colors.secondary, marginLeft: 4 }]}>
              <Text style={styles.priceBadgeText}>{item.value}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ── Stock section component ──
  const StockSection = ({ label, timer, timerColor, stockData, isPrevious }) => (
    <View style={[styles.stockSection, isPrevious && { opacity: 0.35 }]}>
      {/* Section header with timer */}
      <View style={[styles.stockSectionHeader, { backgroundColor: timerColor }]}>
        <View style={styles.stockSectionLabelWrap}>
          <Icon name="leaf" size={16} color="white" />
          <Text style={styles.stockSectionLabel}>{label}</Text>
        </View>
        <View style={styles.stockSectionTimerWrap}>
          <Icon name="time-outline" size={14} color="rgba(255,255,255,0.8)" />
          <Text style={styles.stockSectionTimer}>{timer}</Text>
        </View>
      </View>

      {/* Fruit grid — 2 per row */}
      <View style={styles.stockSectionBody}>
        {stockData.length > 0 && stockData[0]?.value === 'Fetching...' ? (
          <View style={styles.loadingWrap}>
            <Icon name="hourglass-outline" size={24} color={config.colors.hasBlockGreen} />
            <Text style={styles.loadingText}>{t('stock.fetching_data')}</Text>
          </View>
        ) : (
          <View style={styles.fruitGrid}>
            {stockData.length > 0 &&
              stockData.map((item, index) => (
                <StockFruitCard key={item.id || index} item={item} />
              ))}
          </View>
        )}
      </View>
    </View>
  );

  return (
    <>
      <GestureHandlerRootView>
        <View style={styles.container}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
          >
            {/* ── Notification Settings Card ── */}
            <View style={styles.notifCard}>
              <View style={styles.notifCardHeader}>
                <Text style={styles.notifCardTitle}>{t('stock.stock_updates')}</Text>
              </View>

              {/* Stock updates toggle */}
              <View style={styles.notifRow}>
                <View style={[styles.notifIconBubble, { backgroundColor: config.colors.primary + '20' }]}>
                  <Icon
                    name={user.isReminderEnabled ? 'notifications' : 'notifications-outline'}
                    size={20}
                    color={config.colors.primary}
                  />
                </View>
                <View style={styles.notifTextWrap}>
                  <Text style={[styles.notifLabel, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>{t('stock.stock_updates')}</Text>
                </View>
                <View style={styles.notifActions}>
                  <Switch
                    value={user.isReminderEnabled}
                    onValueChange={toggleSwitch}
                    trackColor={{ false: isDarkMode ? '#334155' : '#e2e8f0', true: config.colors.hasBlockGreen }}
                    thumbColor="white"
                    ios_backgroundColor={isDarkMode ? '#334155' : '#e2e8f0'}
                  />
                </View>
              </View>

              <View style={styles.notifDivider} />

              {/* Selected fruit notification toggle */}
              <View style={styles.notifRow}>
                <View style={[styles.notifIconBubble, { backgroundColor: config.colors.secondary + '20' }]}>
                  <Icon name="star" size={18} color={config.colors.secondary} />
                </View>
                <View style={styles.notifTextWrap}>
                  <Text style={[styles.notifLabel, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>{t('stock.selected_fruit_notification')}</Text>
                  <Text style={[styles.notifDesc, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>{t('stock.selected_fruit_notification_description')}</Text>
                </View>
                <View style={styles.notifActions}>
                  <Switch
                    value={user.isSelectedReminderEnabled}
                    onValueChange={toggleSwitch2}
                    trackColor={{ false: isDarkMode ? '#334155' : '#e2e8f0', true: config.colors.hasBlockGreen }}
                    thumbColor="white"
                    ios_backgroundColor={isDarkMode ? '#334155' : '#e2e8f0'}
                  />
                  <TouchableOpacity
                    onPress={openDrawer}
                    style={[styles.addFruitBtn, {
                      backgroundColor: user?.isSelectedReminderEnabled ? config.colors.hasBlockGreen : isDarkMode ? '#334155' : '#cbd5e1',
                    }]}
                    disabled={!user.isSelectedReminderEnabled}
                  >
                    <Icon name="add" size={18} color="white" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Selected fruits chips */}
              {user.selectedFruits?.length > 0 && (
                <View style={styles.chipsWrap}>
                  {user.selectedFruits.map((item) => (
                    <View key={item.name || item.Name} style={styles.chip}>
                      <Image
                        source={{
                          uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${item.name?.replace(/^\+/, '').replace(/\s+/g, '-') || item.Name?.replace(/^\+/, '').replace(/\s+/g, '-')}_Icon.webp`,
                        }}
                        style={styles.chipIcon}
                      />
                      <Text style={[styles.chipText, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>{item.name || item.Name}</Text>
                      <TouchableOpacity onPress={() => handleRemoveFruit(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Icon name="close-circle" size={16} color={config.colors.wantBlockRed} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* ── Current Stock Sections ── */}
            <StockSection
              label={t('stock.normal_stock')}
              timer={normalTimer}
              timerColor={config.colors.primary}
              stockData={normalStock}
            />

            <StockSection
              label={t('stock.mirage_stock')}
              timer={mirageTimer}
              timerColor={config.colors.secondary}
              stockData={mirageStock}
            />

            {/* ── Refresh Button ── */}
            <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh} activeOpacity={0.8}>
              <Icon name="refresh" size={18} color="white" />
              <Text style={styles.refreshBtnText}>REFRESH</Text>
            </TouchableOpacity>

            {/* ── Previous Stock Divider ── */}
            <View style={styles.prevDivider}>
              <View style={styles.prevLine} />
              <View style={styles.prevBadge}>
                <Icon name="time-outline" size={12} color={isDarkMode ? '#94a3b8' : '#64748b'} />
                <Text style={[styles.prevText, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>{t('stock.previous_stock')}</Text>
              </View>
              <View style={styles.prevLine} />
            </View>

            {/* ── Previous Stock Sections ── */}
            <StockSection
              label={t('stock.normal_stock')}
              timer="00:00:00"
              timerColor={config.colors.primary}
              stockData={prenormalStock}
              isPrevious
            />

            <StockSection
              label={t('stock.mirage_stock')}
              timer="00:00:00"
              timerColor={config.colors.secondary}
              stockData={premirageStock}
              isPrevious
            />

            <View style={{ height: 30 }} />

            <FruitSelectionDrawer
              visible={isDrawerVisible}
              onClose={closeDrawer}
              onSelect={handleFruitSelect}
              data={fruitRecords}
              selectedTheme={selectedTheme}
            />
            <SigninDrawer
              visible={isSigninDrawerVisible}
              onClose={handleLoginSuccess}
              selectedTheme={selectedTheme}
              message={t('stock.signin_required_message')}
              screen="Stock"
            />
          </ScrollView>
        </View>
      </GestureHandlerRootView>
    </>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 16,
      backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight,
    },
    scrollContent: {
      paddingTop: 12,
      paddingBottom: 40,
    },

    // ── Notification Card ──
    notifCard: {
      backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
      borderRadius: 20,
      padding: 18,
      marginTop: 8,
      ...Platform.select({
        ios: {
          shadowColor: isDarkMode ? '#000' : '#6A5ACD',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDarkMode ? 0.3 : 0.08,
          shadowRadius: 12,
        },
        android: { elevation: 3 },
      }),
    },
    notifCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
    },
    notifCardTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: isDarkMode ? '#94a3b8' : '#64748b',
      marginLeft: 6,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    notifRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
    },
    notifIconBubble: {
      width: 38,
      height: 38,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    notifTextWrap: {
      flex: 1,
      marginRight: 8,
    },
    notifLabel: {
      fontSize: 14,
      fontWeight: '700',
    },
    notifDesc: {
      fontSize: 11,
      marginTop: 2,
      lineHeight: 15,
    },
    notifDivider: {
      height: 1,
      backgroundColor: isDarkMode ? '#334155' : '#f1f5f9',
      marginVertical: 8,
      marginLeft: 50,
    },
    notifActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    addFruitBtn: {
      width: 32,
      height: 32,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: 6,
    },

    // ── Fruit Chips ──
    chipsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 10,
      gap: 8,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#334155' : '#f1f5f9',
      borderRadius: 24,
      paddingVertical: 6,
      paddingLeft: 6,
      paddingRight: 10,
    },
    chipIcon: {
      width: 26,
      height: 26,
      borderRadius: 13,
      marginRight: 6,
    },
    chipText: {
      fontSize: 12,
      fontWeight: '600',
      marginRight: 6,
    },

    // ── Stock Section ──
    stockSection: {
      marginTop: 16,
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: isDarkMode ? 0.25 : 0.08,
          shadowRadius: 10,
        },
        android: { elevation: 3 },
      }),
    },
    stockSectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    stockSectionLabelWrap: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    stockSectionLabel: {
      color: 'white',
      fontWeight: '800',
      fontSize: 16,
      marginLeft: 8,
    },
    stockSectionTimerWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.2)',
      borderRadius: 10,
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    stockSectionTimer: {
      color: 'white',
      fontWeight: '800',
      fontSize: 14,
      marginLeft: 6,
      fontVariant: ['tabular-nums'],
    },
    stockSectionBody: {
      backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
      paddingHorizontal: 14,
      paddingVertical: 14,
    },

    // ── Fruit Grid (2 per row) ──
    fruitGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 10,
    },
    fruitCard: {
      width: '48.5%',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#273548' : '#f1f5f9',
      borderRadius: 14,
      padding: 10,
    },
    fruitCardImage: {
      width: 36,
      height: 36,
      borderRadius: 10,
      marginRight: 8,
    },
    fruitCardInfo: {
      flex: 1,
    },
    fruitCardName: {
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 4,
    },
    fruitCardPrices: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 4,
    },
    priceBadge: {
      borderRadius: 8,
      paddingVertical: 3,
      paddingHorizontal: 7,
    },
    priceBadgeText: {
      color: 'white',
      fontSize: 10,
      fontWeight: '700',
    },

    // ── Loading ──
    loadingWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 20,
    },
    loadingText: {
      fontWeight: '700',
      fontSize: 14,
      color: config.colors.hasBlockGreen,
      marginLeft: 8,
    },

    // ── Timer digits (unused in current layout but available) ──
    timerDigitsRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    timerDigitBox: {
      borderRadius: 8,
      paddingVertical: 4,
      paddingHorizontal: 8,
    },
    timerDigitText: {
      color: 'white',
      fontWeight: '800',
      fontSize: 16,
      fontVariant: ['tabular-nums'],
    },
    timerColon: {
      fontWeight: '800',
      fontSize: 16,
      marginHorizontal: 2,
    },

    // ── Refresh Button ──
    refreshBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: config.colors.hasBlockGreen,
      borderRadius: 14,
      paddingVertical: 14,
      marginTop: 20,
      ...Platform.select({
        ios: {
          shadowColor: config.colors.hasBlockGreen,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 8,
        },
        android: { elevation: 3 },
      }),
    },
    refreshBtnText: {
      color: 'white',
      fontWeight: '800',
      fontSize: 14,
      marginLeft: 8,
      letterSpacing: 1,
    },

    // ── Previous Stock Divider ──
    prevDivider: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 24,
    },
    prevLine: {
      flex: 1,
      height: 1,
      backgroundColor: isDarkMode ? '#334155' : '#e2e8f0',
    },
    prevBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
      borderRadius: 20,
      paddingVertical: 6,
      paddingHorizontal: 14,
      marginHorizontal: 12,
    },
    prevText: {
      fontSize: 12,
      fontWeight: '600',
      marginLeft: 5,
    },
  });

export default TimerScreen;
