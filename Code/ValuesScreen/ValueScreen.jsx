import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  FlatList,
  Platform,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import debounce from 'lodash.debounce';
import { AdEventType, BannerAd, BannerAdSize, InterstitialAd } from 'react-native-google-mobile-ads';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import getAdUnitId from '../Ads/ads';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import CodesDrawer from './Code';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { logEvent } from '@react-native-firebase/analytics';
import { ref, update } from '@react-native-firebase/database';

const bannerAdUnitId = getAdUnitId('banner');
const interstitialAdUnitId = getAdUnitId('interstitial');
const interstitial = InterstitialAd.createForAdRequest(interstitialAdUnitId);


const ValueScreen = ({ selectedTheme }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [filterDropdownVisible, setFilterDropdownVisible] = useState(false);
  const { analytics, appdatabase, isAdmin } = useGlobalState()
  const [filteredData, setFilteredData] = useState([]);
  const { localState } = useLocalState()
  const [valuesData, setValuesData] = useState([]);
  const [codesData, setCodesData] = useState([]);
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();
  const [isAdVisible, setIsAdVisible] = useState(true);
  const filters = ['All', 'COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY', 'MYTHICAL', 'GAME PASS'];
  const displayedFilter = selectedFilter === 'PREMIUM' ? 'GAME PASS' : selectedFilter;
  const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const [selectedFruit, setSelectedFruit] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
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

  // const toggleDrawer = () => {
  //   setIsDrawerVisible(!isDrawerVisible);
  // };
  // console.log(valuesData)

  const toggleDrawer = () => {

    triggerHapticFeedback('impactLight');
    logEvent(analytics, `${platform}_code_drawer_open`);
    if (!hasAdBeenShown) {
      showInterstitialAd(() => {
        setHasAdBeenShown(true); // Mark the ad as shown
        setIsDrawerVisible(!isDrawerVisible);
      });
    }
    else {
      setIsDrawerVisible(!isDrawerVisible);

    }

  }

  // const openEditModal = (fruit) => {
  //   if (!fruit) return; // Prevent opening the modal if the fruit is undefined
  //   setSelectedFruit(fruit);
  //   setIsModalVisible(true);
  // };
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

    // console.log("📌 localState.data:", localData);
    // console.log("📌 Selected Fruit:", selectedFruit);

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

    // console.log(`✅ Found record key: ${recordKey} for ${selectedFruit.Name}`);

    // Ensure values are valid before updating
    const updatedValues = {
      Value: isNaN(Number(editValuesRef.current.Value)) ? 0 : Number(editValuesRef.current.Value),
      Permanent: isNaN(Number(editValuesRef.current.Permanent)) ? 0 : Number(editValuesRef.current.Permanent),
      Biliprice: isNaN(Number(editValuesRef.current.Biliprice)) ? 0 : Number(editValuesRef.current.Biliprice),
      Robuxprice: editValuesRef.current.Robuxprice || "N/A",
    };

    // console.log("🔄 Updating Firebase with values:", updatedValues);

    // Reference to the correct Firebase record
    const fruitRef = ref(appdatabase, `/testing/${recordKey}`);

    update(fruitRef, updatedValues)
      .then(() => {
        // console.log("✅ Fruit updated successfully!");
        setIsModalVisible(false);
      })
      .catch((error) => {
        console.error("❌ Error updating fruit:", error);
      });
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

        // console.log("🛠️ Parsed localState.codes:", parsedCodes);
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
      if (!item?.Name) return false;

      const itemType =
        item?.Type?.toUpperCase() === 'GAME PASS' ? 'PREMIUM' : item?.Type?.toUpperCase();
      return (
        item.Name.toLowerCase().includes(searchText.toLowerCase()) &&
        (selectedFilter === 'All' || itemType === selectedFilter)
      );
    });

    setFilteredData(filtered);
  }, [valuesData, searchText, selectedFilter]);
  const EditFruitModal = () => (
    <Modal visible={isModalVisible} transparent={true} animationType="slide">
      <View style={styles.modalContainer}>
        <Text style={styles.modalTitle}>Edit {selectedFruit?.Name}</Text>

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


        <TouchableOpacity onPress={updateFruitData} style={styles.saveButton}>
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
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` }}
          style={styles.icon}
          resizeMode="cover"
        />

        <View>
          <Text style={styles.name}>{item.Name}</Text>
          <Text style={styles.value}> {t("value.value")}: ${item.Value.toLocaleString()}</Text></View>
      </View>
      <View style={styles.devider}></View>
      <View style={styles.infoContainer}>
        <Text style={styles.permanentValue}>{t("value.permanent_value")}: ${item.Permanent.toLocaleString()}</Text>
        <Text style={styles.beliPrice}>{t("value.beli_price")}: ${item.Biliprice.toLocaleString()}</Text>
        <Text style={styles.robuxPrice}>{t("value.robux_price")}: ${item.Robuxprice}</Text>
      </View>
      {isAdmin && (
        <TouchableOpacity onPress={() => openEditModal(item)} style={styles.editButton}>
          <Text style={styles.editButtonText}>Edit</Text>
        </TouchableOpacity>
      )}
      {/* <View style={styles.statusContainer}>
        <Text style={[styles.status, { backgroundColor: item.Stability === 'Stable' ? config.colors.hasBlockGreen : config.colors.wantBlockRed }]}>
          {item.Stability}
        </Text>
      </View> */}
    </View>
  ));





  useEffect(() => {
    interstitial.load();

    const onAdLoaded = () => setIsAdLoaded(true);
    const onAdClosed = () => {
      setIsAdLoaded(false);
      setIsShowingAd(false);
      interstitial.load(); // Reload ad for the next use
    };
    const onAdError = (error) => {
      setIsAdLoaded(false);
      setIsShowingAd(false);
      console.error('Ad Error:', error);
    };

    const loadedListener = interstitial.addAdEventListener(AdEventType.LOADED, onAdLoaded);
    const closedListener = interstitial.addAdEventListener(AdEventType.CLOSED, onAdClosed);
    const errorListener = interstitial.addAdEventListener(AdEventType.ERROR, onAdError);

    return () => {
      loadedListener();
      closedListener();
      errorListener();
    };
  }, []);

  const showInterstitialAd = (callback) => {
    if (isAdLoaded && !isShowingAd && !localState.isPro) {
      setIsShowingAd(true);
      try {
        interstitial.show();
        interstitial.addAdEventListener(AdEventType.CLOSED, callback);
      } catch (error) {
        console.error('Error showing interstitial ad:', error);
        setIsShowingAd(false);
        callback(); // Proceed with fallback in case of error
      }
    } else {
      callback(); // If ad is not loaded, proceed immediately
    }
  };
  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          <Text style={[styles.description, { color: selectedTheme.colors.text }]}>
            {t("value.description")}
          </Text>
          <View style={styles.searchFilterContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search"
              placeholderTextColor="#888"
              onChangeText={handleSearchChange}

            />
            <TouchableOpacity
              style={[styles.filterDropdown, { backgroundColor: config.colors.hasBlockGreen }]}
              onPress={() => setFilterDropdownVisible(!filterDropdownVisible)}
            >
              <Text style={[styles.filterText, { color: selectedTheme.colors.text }]}>{displayedFilter}</Text>
              <Icon name="chevron-down-outline" size={18} color="#333" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterDropdown, { backgroundColor: config.colors.hasBlockGreen }]}
              onPress={toggleDrawer}
            >
              <Text style={[styles.filterText, { color: selectedTheme.colors.text }]}> {t("value.codes")}</Text>
            </TouchableOpacity>
          </View>


          {filterDropdownVisible && (
            <View style={styles.filterDropdownContainer}>
              {filters.map((filter) => (
                <TouchableOpacity
                  key={filter}
                  style={[
                    styles.filterOption,
                    { backgroundColor: selectedFilter === filter ? '#34C759' : '#F2F2F2' },
                  ]}
                  onPress={() => handleFilterChange(filter)}
                >
                  <Text
                    style={[
                      styles.filterTextOption,
                      { color: selectedFilter === filter ? '#FFF' : '#333' },
                    ]}
                  >
                    {filter}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}


          {filteredData.length > 0 ? (
            <>
              <FlatList
                data={filteredData}
                keyExtractor={(item) => item.Name}
                renderItem={renderItem}
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={true}
                numColumns={!config.isNoman ? 1 : 2}
                columnWrapperStyle={!config.isNoman ? null : styles.columnWrapper}
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

      {!localState.isPro && <View style={{ alignSelf: 'center' }}>
        {isAdVisible && (
          <BannerAd
            unitId={bannerAdUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdLoaded={() => setIsAdVisible(true)}
            onAdFailedToLoad={() => setIsAdVisible(false)}
          />
        )}
      </View>}
    </>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 8, marginHorizontal: 2, flex: 1 },
  searchFilterContainer: { flexDirection: 'row', marginBottom: 10, alignItems: 'center' },
  searchInput: { flex: 1, backgroundColor: '#E0E0E0', padding: 10, borderRadius: 10, marginRight: 10, height: 48 },
  filterDropdown: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E0E0E0', padding: 10, borderRadius: 10, height: 48, marginLeft: 10 },
  filterDropdownContainer: {
    position: 'absolute', top: 80, right: 10, width: 120, backgroundColor: '#FFF', borderRadius: 8,
    zIndex: 1
  },
  filterOption: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
  filterTextOption: { fontSize: 14 },
  // itemContainer: { alignItems: 'flex-start', backgroundColor: 'red', borderRadius: 10, padding: 10, 
  //    width: '100%', marginVertical: 5 },
  icon: { width: 50, height: 50, borderRadius: 5, marginRight: 10 },
  infoContainer: { flex: 1 },
  name: {
    fontSize: 16, fontFamily: 'Lato-Bold', color: 'white', lineHeight: 18,
  },
  value: {
    fontSize: 10, fontFamily: 'Lato-Regular', color: 'white', lineHeight: 14,
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
  filterText: { fontSize: 16, fontFamily: 'Lato-Regular', marginRight: 5 },
  description: {
    fontSize: 14, lineHeight: 18, marginVertical: 10, fontFamily: 'Lato-Regular',
  },
  loadingIndicator: { marginVertical: 20, alignSelf: 'center' },
  containerBannerAd: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  flateLiastContainer: {
    marginBottom: 70
  }
  , flateListContainer: {
    marginBottom: 120
  },
  row: {
    justifyContent: 'space-between', // Space items evenly in a row
    marginVertical: 10, // Add vertical spacing between rows
  },
  imageContainer: {
    flexDirection: 'row',
    flex: 1,
    alignItems: 'center',
  },
  devider: {
    width: '90%',
    height: 1,
    backgroundColor: 'lightgrey',
    marginVertical: 5
  },
  columnWrapper: {
    justifyContent: 'space-between', // Distribute items evenly in each row
    marginBottom: 10, // Add space between rows  
    flex: 1
  },
  itemContainer: {
    alignItems: 'flex-start',
    borderRadius: 10,
    padding: 10,
    backgroundColor: config.colors.primary,
    width: !config.isNoman ? '99%' : '49%',
    marginBottom: !config.isNoman ? 10 : 0,
    ...(!config.isNoman && {
      borderWidth: 5,
      borderColor: config.colors.hasBlockGreen,
    }),
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
    fontWeight: "bold",
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
    fontWeight: "bold",
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
    fontWeight: "bold",
    textAlign: "center",
  },
  cencelButton: {
    backgroundColor: "red",
    paddingVertical: 10,
    borderRadius: 5,
    marginTop: 10,
  },

});

export default ValueScreen;
