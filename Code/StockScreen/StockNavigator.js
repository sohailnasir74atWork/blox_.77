import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import config from '../Helper/Environment';
import TimerScreen from './TimerScreen';
// import ValueScreen from '../ValuesScreen/ValueScreen';
import { useGlobalState } from '../GlobelStats';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import ThemeHeader from '../Design/componenets/ThemeHeader';
import { useTranslation } from 'react-i18next';


// Shown from the More hub (MoreNavigator.js, route MoreStock) since the Stock
// tab became the More tab (2026-10-08); `showBack` is the only difference.
const TopLevelStockComponent = ({ selectedTheme, showBack = false }) => {
  const [activeTab, setActiveTab] = useState('Stock'); // Default tab is 'Stock'
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const { t } = useTranslation();
  const background = isDarkMode ? '#0f172a' : '#f8fafc';

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <ThemeHeader title={t('tabs.stock', { defaultValue: 'Stocks' })} showBack={showBack} />
      {/* Tab Buttons */}
      {/* <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'Stock' && styles.activeTab]}
          onPress={() => setActiveTab('Stock')}
        >
          <Text style={[styles.tabText, activeTab === 'Stock' && styles.tabTextActive]}>Stock</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'Values & Codes' && styles.activeTab]}
          onPress={() => setActiveTab('Values & Codes')}
        >
          <Text style={[styles.tabText, activeTab === 'Values & Codes' && styles.tabTextActive]}>Values & Codes</Text>
        </TouchableOpacity>
      
      </View> */}

      {/* Tab Content */}
      {activeTab === 'Stock' && <TimerScreen selectedTheme={selectedTheme} />}
      {/* {activeTab === 'Values & Codes' && <ValueScreen selectedTheme={ selectedTheme }  />} */}
      {/* {activeTab === 'Code' && <CodeComponent />} */}
      {/* Same collapsible banner as before (BannerAdComponent renders nothing
          for Pro). The wrapper adds a nav-bar spacer only when this page is
          opened outside the tab bar (Values > More > Stock in the root stack). */}
      <ScreenBottomBanner background={background} collapsible />
    </View>
  );
};

const getStyles = (isDarkMode, user) =>
  StyleSheet.create({
    container: {
      flex: 1,
      // padding: 10,
    },
    tabs: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      // marginBottom: 20,
      borderRadius: 12,
      backgroundColor: isDarkMode ? '#34495E' : 'white',
      padding: 5,
      marginBottom: 5,
      margin: 10
    },
    tabButton: {
      paddingVertical: 15,
      // backgroundColor: '#ccc',
      // borderRadius: 5,
      width: '50%',
      borderRadius: 12,

    },
    tabText: {
      fontSize: 16,
      color: 'grey',
      alignSelf: 'center',
      fontWeight: 'bold'
    },
    tabTextActive: {
      fontSize: 16,
      color: 'white',
      alignSelf: 'center',
      fontWeight: 'bold'
    },
    activeTab: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    tabContent: {
      padding: 20,
      backgroundColor: '#f5f5f5',
      borderRadius: 10,
    },
  });

export default TopLevelStockComponent;
