import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  FlatList,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { debounce } from '../Helper/debounce';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import CodesDrawer from './Code';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../AppHelper/MixPenel';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import MyAppAds from '../Ads/CustomAds';

const ValueScreen = ({ selectedTheme }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [filterDropdownVisible, setFilterDropdownVisible] = useState(false);
  const {  reload, theme } = useGlobalState();
  const {localState, toggleAd} = useLocalState()
  const isDarkMode = theme === 'dark'
  const [filteredData, setFilteredData] = useState([]);
  const [valuesData, setValuesData] = useState([]);
  const [codesData, setCodesData] = useState([]);
  const { t } = useTranslation();
  const filters = ['All', 'PET', 'GEAR',  'FRUIT'];
  const displayedFilter = selectedFilter === 'PREMIUM' ? 'GAME PASS' : selectedFilter;
  const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const [selectedFruit, setSelectedFruit] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // State for pull-to-refresh
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const editValuesRef = useRef({
    Value: '',
    Permanent: '',
    Biliprice: '',
    Robuxprice: '',
  });

  const openEditModal = (fruit) => {
    if (!fruit) return;
    setSelectedFruit(fruit);

    // Store values in ref, NOT state
    editValuesRef.current = {
      Value: fruit.Value.toString(),
      Permanent: fruit.Permanent.toString(),
      Biliprice: fruit.Biliprice.toString(),
      Robuxprice: fruit.Robuxprice.toString(),
    };

    setIsModalVisible(true);
  };

  const handleRefresh = async () => {
    setRefreshing(true);

    try {
      await reload(); // Re-fetch stock data
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleDrawer = () => {

    triggerHapticFeedback('impactLight');
    const callbackfunction = () => {
      setHasAdBeenShown(true); // Mark the ad as shown
      setIsDrawerVisible(!isDrawerVisible);
    };

    if (!hasAdBeenShown && !localState.isPro) {
      InterstitialAdManager.showAd(callbackfunction);
    }
    else {
      setIsDrawerVisible(!isDrawerVisible);

    }
    mixpanel.track("Code Drawer Open");
  }

  // const updateFruitData = () => {
  //   if (!selectedFruit || !selectedFruit.Name) {
  //     console.error("❌ No fruit selected for update or missing Name property");
  //     return;
  //   }

  //   let localData = localState.data;

  //   // Ensure localState.data is parsed correctly if it's a string
  //   if (typeof localData === "string") {
  //     try {
  //       localData = JSON.parse(localData);
  //     } catch (error) {
  //       console.error("❌ Failed to parse localState.data as JSON", error, localData);
  //       return;
  //     }
  //   }

  //   // Check again to ensure it's a valid object
  //   if (!localData || typeof localData !== "object" || Array.isArray(localData)) {
  //     console.error("❌ localState.data is missing or not a valid object", localData);
  //     return;
  //   }

  //   // Find the correct record key (case-insensitive match)
  //   const recordKey = Object.keys(localData).find(key => {
  //     const record = localData[key];

  //     if (!record || !record.Name) {
  //       console.warn(`⚠️ Skipping record ${key} due to missing Name field`, record);
  //       return false;
  //     }

  //     return record.Name.trim().toLowerCase() === selectedFruit.Name.trim().toLowerCase();
  //   });

  //   if (!recordKey) {
  //     console.error(`❌ Error: Record key not found for ${selectedFruit.Name}`);
  //     return;
  //   }

  //   // Ensure values are valid before updating
  //   const updatedValues = {
  //     Value: isNaN(Number(editValuesRef.current.Value)) ? 0 : Number(editValuesRef.current.Value),
  //     Permanent: isNaN(Number(editValuesRef.current.Permanent)) ? 0 : Number(editValuesRef.current.Permanent),
  //     Biliprice: isNaN(Number(editValuesRef.current.Biliprice)) ? 0 : Number(editValuesRef.current.Biliprice),
  //     Robuxprice: editValuesRef.current.Robuxprice || "N/A",
  //   };

  //   // Reference to the correct Firebase record
  //   const fruitRef = ref(appdatabase, `/fruit_data/${recordKey}`);

  //   update(fruitRef, updatedValues)
  //     .then(() => {
  //       setIsModalVisible(false);
  //     })
  //     .catch((error) => {
  //       console.error("❌ Error updating fruit:", error);
  //     });
  // };
  const applyFilter = (filter) => {
    setSelectedFilter(filter);
  };
  
  useEffect(() => {
    if (localState.data) {
      try {
        // ✅ Ensure it's a string before parsing
        const parsedValues = typeof localState.data === 'string' ? JSON.parse(localState.data) : localState.data;

        if (typeof parsedValues !== 'object' || parsedValues === null) {
          throw new Error('Parsed data is not a valid object');
        }

        setValuesData(Object.values(parsedValues));
      } catch (error) {
        console.error("❌ Error parsing data:", error, "📝 Raw Data:", localState.data);
        setValuesData([]); // Fallback to empty array
      }
    }
  }, [localState.data]);


  useEffect(() => {
    if (localState.codes) {
      try {
        // ✅ Handle both JSON string & object cases
        const parsedCodes = typeof localState.codes === 'string' ? JSON.parse(localState.codes) : localState.codes;

        // ✅ Ensure parsedCodes is a valid object
        if (typeof parsedCodes !== 'object' || parsedCodes === null) {
          throw new Error('Parsed codes is not a valid object');
        }

        const extractedCodes = Object.values(parsedCodes);
        setCodesData(extractedCodes.length > 0 ? extractedCodes : []);
      } catch (error) {
        console.error("❌ Error parsing codes:", error, "📝 Raw Codes Data:", localState.codes);
        setCodesData([]); // Fallback to empty array
      }
    }
  }, [localState.codes]);

  const handleFilterChange = (filter) => {
    triggerHapticFeedback('impactLight');
    setSelectedFilter(filter === 'GAME PASS' ? 'PREMIUM' : filter);
    setFilterDropdownVisible(false);
  };

  const handleSearchChange = debounce((text) => {
    setSearchText(text);
  }, 300);
  const closeDrawer = () => {
    setFilterDropdownVisible(false);
  };
  useEffect(() => {
    if (!Array.isArray(valuesData) || valuesData.length === 0) {
      setFilteredData([]);
      return;
    }

    const filtered = valuesData.filter((item) => {
      if (!item?.name) return false;

      const itemType =
        item?.category == 'gamepass' ? 'GAME PASS' : item?.category?.toUpperCase();
      return (
        item.name.toLowerCase().includes(searchText.toLowerCase()) &&
        (selectedFilter === 'All' || itemType === selectedFilter)
      );
    });

    setFilteredData(filtered);
  }, [valuesData, searchText, selectedFilter]);
  const EditFruitModal = () => (
    <Modal visible={isModalVisible} transparent={true} animationType="slide">
      <View style={styles.modalContainer}>
        <Text style={styles.modalTitle}>Edit {selectedFruit?.name}</Text>

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Value}
          onChangeText={(text) => (editValuesRef.current.Value = text)}
          keyboardType="numeric"
          placeholder="Value"
        />

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Permanent}
          onChangeText={(text) => (editValuesRef.current.Permanent = text)}
          keyboardType="numeric"
          placeholder="Permanent Value"
        />

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Biliprice}
          onChangeText={(text) => (editValuesRef.current.Biliprice = text)}
          keyboardType="numeric"
          placeholder="Beli Price"
        />

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Robuxprice}
          onChangeText={(text) => (editValuesRef.current.Robuxprice = text)}
          keyboardType="default"
          placeholder="Robux Price"
        />


        <TouchableOpacity style={styles.saveButton}>
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setIsModalVisible(false)} style={styles.cencelButton}>
          <Text style={styles.saveButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );

  const formatNameNew = (name) => {
    return name
      .split('_')                        // Split on underscore
      .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
      .join(' ');                        // Join with space
  };
  
  const renderItem = React.useCallback(({ item }) => {
    const { attributes = {}, value } = item;
  
    const formatLabel = label =>
      label.toLowerCase().split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  
    const infoRow = (label, content) => (
      <View style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        // paddingVertical: 6,
        // borderBottomWidth: 1,
        borderColor: '#eee',
        flexWrap:'wrap'
      }}>
        <Text style={{ fontWeight: '500', fontSize: 12, color: isDarkMode ? '#fff' : '#555' }}>{label}:</Text>
        <Text style={{ fontSize: 12, color: isDarkMode ? '#fff' : '#555'}}>{content}</Text>
      </View>
    );
  
    return (
      <View style={{
        backgroundColor: isDarkMode ? '#1f2a35' : '#ffffff',
        // paddingVertical:6,
        borderRadius: 8,
        marginVertical: 3
      }}>
        {/* Header */}
        
        <View style={{ flexDirection: 'row', alignItems: 'flex-start',  paddingHorizontal:6, paddingTop:6 }}>
          <Image
            source={{ uri: item.picture }}
            style={{ width: 72, height: 72, borderRadius: 12, marginRight: 14, marginBottom:3 }}
          />
          <View style={{ flex: 1, alignItems:'flex-start', marginTop:15 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: isDarkMode ? '#fff' : '#111' }}>
              {formatNameNew(item.name)}
            </Text>
            <Text style={{ fontSize: 12, color: '#888' }}>{formatLabel(item.category)}</Text>
            <Text style={{ fontSize: 12, color: '#aaa' }}>{formatLabel(item.tier)}</Text>
          </View>
          {value != null && (
            <View style={{ alignItems: 'flex-end', justifyContent:'flex-end', alignItems:'flex-start' }}>
              {/* <Text style={{ fontSize: 12, color: '#999' }}></Text> */}
              <Text style={{ fontSize: 14, fontWeight: '600', color: isDarkMode ? '#888' : '#111' }}>Value: {value.toLocaleString()}</Text>
            </View>
          )}
        </View>
        <View style={{backgroundColor: isDarkMode ? '#34495E' : '#B2C6D5', paddingHorizontal:6, borderBottomRightRadius:8, borderBottomLeftRadius:8, paddingBottom:6}}>
        {/* Info Table */}
        <View style={{marginVertical:5}}>
          {attributes.robux_price != null && infoRow("Robux Price", attributes.robux_price)}
          {attributes.in_game_price != null && infoRow("Buy Price", Number(attributes.in_game_price).toLocaleString())}
          {attributes.min_sale_in_game_price != null && infoRow("Min Sale Price", Number(attributes.min_sale_in_game_price).toLocaleString())}
          {attributes.num_stock_items_min != null && attributes.num_stock_items_max != null &&
            infoRow("Shop Amount", `${attributes.num_stock_items_min} - ${attributes.num_stock_items_max}`)}
          {attributes.multi_harvest != null && infoRow("Multi Harvest", attributes.multi_harvest ? "Yes" : "No")}
          {attributes.obtainable != null && infoRow("Obtainable", attributes.obtainable ? "Yes" : "No")}
          {attributes.use && infoRow("Best Used For: ", attributes.use)}
        </View>
  
        {/* Hatch Chances */}
        {Array.isArray(attributes.hatch_chances) && attributes.hatch_chances.length > 0 && (
          <View style={{ marginTop: 1 }}>
            <Text style={{ fontWeight: '600', fontSize: 14, color:isDarkMode ? 'lightgrey' : '#111' }}>Hatch Chances</Text>
            {attributes.hatch_chances.map((hc, idx) => (
              <View key={idx} style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                // paddingVertical: 4,
              }}>
                <Text style={{ color: '#888',fontSize: 12  }}>{formatLabel(hc.egg)}</Text>
                <Text style={{ color: '#888', fontSize: 12  }}>{hc.hatch_chance}%</Text>
              </View>
            ))}
          </View>
        )}
      </View></View>
    );
  }, [isDarkMode]);
  





  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          {/* <Text style={[styles.description, { color: selectedTheme.colors.text }]}>
            {t("value.description")}
          </Text> */}
                 <MyAppAds currentAppId="gog" mode="rotate" />


          <View style={styles.searchFilterContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search"
              placeholderTextColor="#888"
              onChangeText={handleSearchChange}

            />
            <Menu>
              <MenuTrigger onPress={() => {}}>
                <View style={styles.filterButton}>
                  <Text style={styles.filterText}>{displayedFilter}</Text>
                  <Icon name="chevron-down-outline" size={18} color="white" />
                </View>
              </MenuTrigger>

              <MenuOptions customStyles={{ optionsContainer: styles.menuOptions }}>
                {filters.map((filter) => (
                  <MenuOption
                    key={filter}
                    onSelect={() => {
                      applyFilter(filter);
                    }}
                  >
                    <Text style={[styles.filterOptionText, selectedFilter === filter && styles.selectedOption]}>
                      {filter}
                    </Text>
                  </MenuOption>
                ))}
              </MenuOptions>
            </Menu>
            <TouchableOpacity
              style={[styles.filterDropdown, { backgroundColor: config.colors.hasBlockGreen }]}
              onPress={toggleDrawer}
            >
              <Text style={[styles.filterText, { color: 'white' }]}> {t("value.codes")}</Text>
            </TouchableOpacity>
          </View>







          {filteredData.length > 0 ? (
            <>
              <FlatList
                data={filteredData}
                keyExtractor={(item) => item.name}
                renderItem={renderItem}
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={true}
                numColumns={!config.isNoman ? 1 : 1}
                refreshing={refreshing}
                onRefresh={handleRefresh}
              // columnWrapperStyle={!config.isNoman ? styles.columnWrapper : styles.columnWrapper}
              />
              {isModalVisible && selectedFruit && <EditFruitModal />}
            </>
          ) : (
            <Text style={[styles.description, { textAlign: 'center', marginTop: 20, color: 'gray' }]}>
              {t("value.no_results")}
            </Text>
          )
          }

        </View>
        <CodesDrawer isVisible={isDrawerVisible} toggleModal={toggleDrawer} codes={codesData} />
      </GestureHandlerRootView>
      {!localState.isPro && <BannerAdComponent/>}

      {/* {!localState.isPro && <View style={{ alignSelf: 'center' }}>
        {isAdVisible && (
          <BannerAd
            unitId={bannerAdUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdLoaded={() => setIsAdVisible(true)}
            onAdFailedToLoad={() => setIsAdVisible(false)}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
          />
        )}
      </View>} */}
    </>
  );
};
export const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: { paddingHorizontal: 8, marginHorizontal: 2, flex: 1 },
    searchFilterContainer: { flexDirection: 'row', marginVertical: 5, alignItems: 'center' },
    searchInput: {   height: 40,
      borderColor: isDarkMode ? config.colors.hasBlockGreen : 'white',
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',

      borderWidth: 1,
      borderRadius: 5,
      marginVertical: 8,
      paddingHorizontal: 10,
      color: isDarkMode ? 'white' : 'black',
      flex: 1,
      borderRadius: 10, marginRight:10 // Ensure smooth corners
       },
    filterDropdown: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E0E0E0', padding: 10, borderRadius: 10, height: 40, marginLeft: 10 },
    filterOption: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
    filterTextOption: { fontSize: 12 },
    // itemContainer: { alignItems: 'flex-start', backgroundColor: 'red', borderRadius: 10, padding: 10, 
    //    width: '100%', marginVertical: 5 },
    icon: { width: 50, height: 50, borderRadius: 5, marginRight: 10, alignItems:'center', marginTop:-10 },
    infoContainer: { flex: 1 },
    name: {
      fontSize: 16, fontFamily: 'Lato-Bold',
      color: isDarkMode ? '#fff' : '#000',
      lineHeight: 18,
    },
    value: {
      fontSize: 10, fontFamily: 'Lato-Regular',
      color: isDarkMode ? '#fff' : '#000',
      lineHeight: 14,
    },
    permanentValue: {
      fontSize: 10, fontFamily: 'Lato-Regular', color: 'white', lineHeight: 14,
    },
    beliPrice: {
      fontSize: 10, fontFamily: 'Lato-Regular', color: 'white', lineHeight: 14,
    },
    robuxPrice: {
      fontSize: 10, fontFamily: 'Lato-Regular', color: 'white', lineHeight: 14,
    },
    // statusContainer: { alignItems: 'left', alignSelf: 'flex-end', position: 'absolute', bottom: 0 },
    status: {
      paddingHorizontal: 8, paddingVertical: 4, borderTopLeftRadius: 10, borderBottomRightRadius: 10, color: '#FFF', fontSize: 12, fontFamily: 'Lato-Bold'
    },
    filterText: { fontSize: 14, fontFamily: 'Lato-Regular', marginRight: 5 },
    description: {
      fontSize: 14, lineHeight: 18, marginVertical: 10, fontFamily: 'Lato-Regular',
    },
    loadingIndicator: { marginVertical: 20, alignSelf: 'center' },
    containerBannerAd: {
      justifyContent: 'center',
      alignItems: 'center',
    },

    row: {
      justifyContent: 'space-between', // Space items evenly in a row
      marginVertical: 10, // Add vertical spacing between rows
    },
    imageContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      // flex: 1,
      alignItems: 'center',
      
    },
    headerContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      flex: 1,
      alignItems: 'center',
      width: '100%',
      marginBottom:3

    },
    devider: {
      width: '100%',
      height: 1,
      backgroundColor: 'lightgrey',
      marginVertical: 10
    },
    columnWrapper: {
      justifyContent: 'space-between', // Distribute items evenly in each row
      marginBottom: 10, // Add space between rows  
      flex: 1
    },
    itemContainer: {
      alignItems: 'flex-start',
      borderRadius: 10,
      paddingVertical: 10,
      // backgroundColor: config.colors.hasBlockGreen,
      width: !config.isNoman ? '99%' : '99%',
      // marginBottom: !config.isNoman ? 10 : 10,
      // ...(!config.isNoman && {
      //   borderWidth: 5,
      //   borderColor: config.colors.hasBlockGreen,
      // }),
    },
    editButton: {
      backgroundColor: "#3498db",
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 5,
      marginTop: 5,
      alignSelf: "flex-end",
    },
    editButtonText: {
      color: "#fff",
      fontSize: 12,
      fontFamily: 'Lato-Bold',
    },
    modalContainer: {
      backgroundColor: "#fff",
      padding: 20,
      borderRadius: 10,
      width: '80%',
      alignSelf: 'center', // Centers the modal horizontally
      position: 'absolute',
      top: '50%', // Moves modal halfway down the screen
      left: '10%', // Centers horizontally considering width: '80%'
      transform: [{ translateY: -150 }], // Adjusts for perfect vertical centering
      justifyContent: 'center',
      // alignItems: 'center',
      elevation: 5, // Adds a shadow on Android
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    }
    ,
    modalTitle: {
      fontSize: 18,
      fontFamily: 'Lato-Bold',
      marginBottom: 10,
    },
    input: {
      borderWidth: 1,
      borderColor: "#ccc",
      padding: 8,
      marginVertical: 5,
      borderRadius: 5,
    },
    saveButton: {
      backgroundColor: "#2ecc71",
      paddingVertical: 10,
      borderRadius: 5,
      marginTop: 10,
    },
    saveButtonText: {
      color: "#fff",
      fontSize: 14,
      fontFamily: 'Lato-Bold',
      textAlign: "center",
    },
    cencelButton: {
      backgroundColor: "red",
      paddingVertical: 10,
      borderRadius: 5,
      marginTop: 10,
    },
    rarity: {
      backgroundColor: config.colors.hasBlockGreen,
      paddingVertical: 1
      ,
      paddingHorizontal: 5,
      borderRadius: 5,
      color: 'white',
      fontSize: 12
    },
    headertext: {
      backgroundColor: config.colors.hasBlockGreen,
      paddingVertical: 1,
      paddingHorizontal: 5,
      borderRadius: 5,
      color: 'white',
      fontSize: 10,
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: "flex-start",
      marginRight: 10

    },
    pointsBox: {
      width: '49%', // Ensures even spacing
      backgroundColor: isDarkMode ? '#34495E' : '#bdefe1', // Dark: darker contrast, Light: White
      borderRadius: 8,
      // alignItems: 'center',
      padding: 10,
    },
    rowcenter: {
      flexDirection: 'row',
      // justifyContent:'center',
      alignItems: 'center',
      fontSize: 12,
      marginTop: 5,
      flexWrap:'wrap'

    },
    menuContainer: {
      alignSelf: "center",
    },
    filterButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: config.colors.hasBlockGreen,
      paddingVertical: 10,
      paddingHorizontal: 15,
      borderRadius: 8,
    },
    filterText: {
      color: "white",
      fontSize: 14,
      fontFamily: 'Lato-Bold',
      marginRight: 5,
    },
    filterOptionText: {
      fontSize: 14,
      padding: 10,
      color: "#333",
    },
    selectedOption: {
      fontFamily: 'Lato-Bold',
      color: "#34C759",
    },
    adContainer: {
      // backgroundColor: '#F5F5F5', // Light background color for the ad
      paddingHorizontal: 15,
      borderRadius: 10,
      marginBottom: 15,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderWidth:1,

    },
    adContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start', // Aligns text and image in a row
    },
    adIcon: {
      width: 50,
      height: 50,
      borderRadius: 5,
      marginRight: 15,
    },
    adTitle: {
      fontSize: 18,
      fontFamily: 'Lato-Bold',
      color: '#333',
      // marginBottom: 5, // Adds space below the title
    },
    tryNowText: {
      fontSize: 14,
      fontFamily: 'Lato-Regular',
      color: config.colors.hasBlockGreen, // Adds a distinct color for the "Try Now" text
      // marginTop: 5, // Adds space between the title and the "Try Now" text
    },
    downloadButton: {
      backgroundColor: '#34C759',
      paddingVertical: 8,
      paddingHorizontal: 15,
      borderRadius: 5,
      // marginTop: 10, // Adds spacing between the text and the button
    },
    downloadButtonText: {
      color: 'white',
      fontSize: 14,
      fontFamily: 'Lato-Bold',
    },
  });

export default ValueScreen;
