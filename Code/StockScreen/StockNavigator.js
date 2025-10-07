import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import config from '../Helper/Environment';
import TimerScreen from './TimerScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';
import { useGlobalState } from '../GlobelStats';
import BannerAdComponent from '../Ads/bannerAds';
import { useLocalState } from '../LocalGlobelStats';


const TopLevelStockComponent = ({ selectedTheme }) => {
  const [activeTab, setActiveTab] = useState('Stock'); // Default tab is 'Stock'
  const {theme, proGranted} = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const {localState} = useLocalState();

  return (
    <View style={styles.container}>
      {/* Tab Buttons */}
      <View style={styles.tabs}>
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
        {/* <TouchableOpacity
          style={[styles.tabButton, activeTab === 'Code' && styles.activeTab]}
          onPress={() => setActiveTab('Code')}
        >
          <Text style={[styles.tabText, activeTab === 'Code' && styles.tabTextActive]}>Code</Text>
        </TouchableOpacity> */}
      </View>

      {/* Tab Content */}
      {activeTab === 'Stock' && <TimerScreen selectedTheme={ selectedTheme } />}
      {activeTab === 'Values & Codes' && <ValueScreen selectedTheme={ selectedTheme }  />}
      {/* {activeTab === 'Code' && <CodeComponent />} */}
      {(!localState.isPro && !proGranted) && <BannerAdComponent/>}
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
    borderRadius:12,
    backgroundColor: isDarkMode ? '#34495E' : 'white',
    padding:5,
    marginBottom:5,
    margin:10
  },
  tabButton: {
    paddingVertical: 15,
    // backgroundColor: '#ccc',
    // borderRadius: 5,
    width:'50%',
    borderRadius:12,

  },
  tabText: {
    fontSize: 16,
    color: 'grey',
    alignSelf:'center',
    fontFamily:'Lato-Bold'
  },
  tabTextActive: {
    fontSize: 16,
    color: 'white',
    alignSelf:'center',
    fontFamily:'Lato-Bold'
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
