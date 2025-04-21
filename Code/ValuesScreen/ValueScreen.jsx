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
import { ref, update } from '@react-native-firebase/database';
import { mixpanel } from '../AppHelper/MixPenel';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';

const ValueScreen = ({ selectedTheme }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [filterDropdownVisible, setFilterDropdownVisible] = useState(false);
  const { analytics, appdatabase, isAdmin, reload, theme } = useGlobalState()
  const isDarkMode = theme === 'dark'
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const [filteredData, setFilteredData] = useState([]);
  const { localState } = useLocalState()
  const [valuesData, setValuesData] = useState([]);
  const [codesData, setCodesData] = useState([]);
  const { t } = useTranslation();
  const filters = ['All', 'COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY', 'MYTHICAL', 'GAME PASS', 'LIMITED'];
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

  const updateFruitData = () => {
    if (!selectedFruit || !selectedFruit.Name) {
      console.error("❌ No fruit selected for update or missing Name property");
      return;
    }

    let localData = localState.data;

    // Ensure localState.data is parsed correctly if it's a string
    if (typeof localData === "string") {
      try {
        localData = JSON.parse(localData);
      } catch (error) {
        console.error("❌ Failed to parse localState.data as JSON", error, localData);
        return;
      }
    }

    // Check again to ensure it's a valid object
    if (!localData || typeof localData !== "object" || Array.isArray(localData)) {
      console.error("❌ localState.data is missing or not a valid object", localData);
      return;
    }

    // Find the correct record key (case-insensitive match)
    const recordKey = Object.keys(localData).find(key => {
      const record = localData[key];

      if (!record || !record.Name) {
        console.warn(`⚠️ Skipping record ${key} due to missing Name field`, record);
        return false;
      }

      return record.Name.trim().toLowerCase() === selectedFruit.Name.trim().toLowerCase();
    });

    if (!recordKey) {
      console.error(`❌ Error: Record key not found for ${selectedFruit.Name}`);
      return;
    }

    // Ensure values are valid before updating
    const updatedValues = {
      Value: isNaN(Number(editValuesRef.current.Value)) ? 0 : Number(editValuesRef.current.Value),
      Permanent: isNaN(Number(editValuesRef.current.Permanent)) ? 0 : Number(editValuesRef.current.Permanent),
      Biliprice: isNaN(Number(editValuesRef.current.Biliprice)) ? 0 : Number(editValuesRef.current.Biliprice),
      Robuxprice: editValuesRef.current.Robuxprice || "N/A",
    };

    // Reference to the correct Firebase record
    const fruitRef = ref(appdatabase, `/fruit_data/${recordKey}`);

    update(fruitRef, updatedValues)
      .then(() => {
        setIsModalVisible(false);
      })
      .catch((error) => {
        console.error("❌ Error updating fruit:", error);
      });
  };
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
        item?.rarity == 'gamepass' ? 'GAME PASS' : item?.rarity?.toUpperCase();
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



  const renderItem = React.useCallback(({ item }) => (
    <View style={styles.itemContainer}>
      <View style={styles.headerContainer}>
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.name)}_Icon.webp` }}
            style={styles.icon}
            resizeMode="cover"
          />

          <View>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.value}> Robux Price: ${Number(item?.robux).toLocaleString()}</Text>
            <Text style={styles.value}> Beli Price: ${Number(item?.beli).toLocaleString()}</Text>

          </View>
        </View>

        <View>

        </View>
        <View>
          <Text style={styles.rarity}>{item.rarity}</Text>
        </View>

      </View>
      <View style={styles.headerContainer}>
        <View style={styles.pointsBox}>
          <View style={styles.rowcenter}>
            <Text style={styles.headertext}>Value: </Text>
            <Text style={styles.value}>${item?.value ? Number(item?.value).toLocaleString() : 'N/A'} </Text>
          </View>
          <View style={styles.rowcenter}>
            <Text style={styles.headertext}>Status: </Text>
            <Text style={styles.value}>{item?.physicalStatus ? item?.physicalStatus : 'N/A'} </Text>
          </View>
          <View style={styles.rowcenter}>
            <Text style={styles.headertext}>Demand: </Text>
            <Text style={styles.value}>{item?.demand ? item?.demand : 'N/A'} </Text>
          </View>
        </View>

        <View style={styles.pointsBox}>
          <View style={styles.rowcenter}>
            <Text style={styles.headertext}>Perm Value: </Text>
            <Text style={styles.value}>${item?.permValue ? Number(item?.permValue).toLocaleString() : 'N/A'}</Text>
          </View>
          <View style={styles.rowcenter}>
            <Text style={styles.headertext}>Perm Status: </Text>
            <Text style={styles.value}>{item?.permanentStatus ? item?.permanentStatus : 'N/A'}</Text>
          </View>
          <View style={styles.rowcenter}>
            <Text style={styles.headertext}>Perm Demand: </Text>
            <Text style={styles.value}>{item?.permDemand ? item?.permDemand : 'N/A'}</Text>
          </View>

        </View>


      </View>
      <View style={{ backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF', width: '100%', borderRadius: 8, padding: 10, marginTop: 10 }}>
        <View style={styles.rowcenter}>
          <Text style={styles.headertext}>TYPE : </Text>
          <Text style={styles.value}>{item.type ? item.type : 'N/A'} </Text>
        </View>
        <View style={styles.rowcenter}>
          <Text style={styles.headertext}>BEST USED FOR :</Text>
          <Text style={styles.value}>{item.bestUsedFor ? item.bestUsedFor :'N/A'} </Text>

        </View>
        <View style={styles.rowcenter}>
          {/* <Text style={styles.headertext}>AWAKENING PRICE (Fragments)</Text> */}
        </View>

        {/* <View style={styles.rowcenter}>
  {["X", "V", "Z", "F", "C"].map((key) => {
    const value = item.fragments?.[key.toLowerCase()] ?? "N/A"; // ✅ Prevent undefined values
    return (
      <Text key={key} style={[styles.value, { paddingRight: 10 }]}>{key}: {value}</Text>
    );
  })}
</View>

<Text style={styles.value}>
  Total Price: {Object.values(item.fragments || {}).reduce((sum, val) => sum + (val || 0), 0)}
</Text> */}



      </View>
      {isAdmin && (
        <TouchableOpacity onPress={() => openEditModal(item)} style={styles.editButton}>
          <Text style={styles.editButtonText}>Edit</Text>
        </TouchableOpacity>
      )}
      <View style={styles.devider}></View>

    </View>
  ));






  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          {/* <Text style={[styles.description, { color: selectedTheme.colors.text }]}>
            {t("value.description")}
          </Text> */}
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
              style={[styles.filterDropdown, { backgroundColor: config.colors.primary }]}
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
      borderColor: isDarkMode ? config.colors.primary : 'white',
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
    icon: { width: 50, height: 50, borderRadius: 5, marginRight: 10 },
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
      // backgroundColor: config.colors.primary,
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
      backgroundColor: '#6A5ACD',
      paddingVertical: 1
      ,
      paddingHorizontal: 5,
      borderRadius: 5,
      color: 'white',
      fontSize: 12
    },
    headertext: {
      backgroundColor: '#6A5ACD',
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
      backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF', // Dark: darker contrast, Light: White
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

    },
    menuContainer: {
      alignSelf: "center",
    },
    filterButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: config.colors.primary,
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
  });

export default ValueScreen;
