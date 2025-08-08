import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, Image, Dimensions, StyleSheet, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import StyledUsernamePreview from './StyledName';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
const iconMap = {
  "camping": require("../../../assets/Icons/camping.png"),
  "dinamite": require("../../../assets/Icons/dinamite.png"),
  "fire": require("../../../assets/Icons/fire.png"),
  "grenade": require("../../../assets/Icons/grenade.png"),
  "handheld-game": require("../../../assets/Icons/handheld-game.png"),
  "paw-print": require("../../../assets/Icons/paw-print.png"),
  "play": require("../../../assets/Icons/play.png"),
  "shooting-star": require("../../../assets/Icons/shooting-star.png"),
  "smile": require("../../../assets/Icons/smile.png"),
  "symbol": require("../../../assets/Icons/symbol.png"),
  "treasure-map": require("../../../assets/Icons/treasure-map.png"),
};

const Emojies = [
  'e1.png',
  'e2.png',
  'e3.png',
  'e4.png',
  'e5.png',
  'e6.png',
  'e7.png',
  'e8.png',
  'e9.png',
  'e10.png',
  'e11.png',
  'e12.png',
  'e13.png',
  'e14.png',
  'e15.png',
  'e16.png'
];


const windowHeight = Dimensions.get('window').height;

const PurchaseModal = ({
  visible,
  selectedItem,
  selectedVariant,
  setSelectedVariant,
  styleOptions,
  getStyleLabel,
  confirmPurchase,
  onClose,
  backgroundImages,
  hdImages,
  downloadImage,
  styles,
  loading,
  maxBuyable, // NEW PROP
  valueOverrideRobuxQty, // NEW PROP
  userCoins
}) => {
  // Track selected image for background/HD image items
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageLoaded, setImageLoaded] = useState({});
  const [robuxCoinInput, setRobuxCoinInput] = useState('');
  const { user, theme } = useGlobalState();
  const isDark = theme === 'dark'
  // selectedVariant is now passed as prop from parent
  const [options, setOptions] = useState({
    caps: false,
    underline: false,
    blur: false,
    bold: false,
    italic: false,
    blackwhite: false,
  });
  const [selectedIcons, setSelectedIcons] = useState([]);


  // Reset selected image when modal opens or item changes
  useEffect(() => {
    setSelectedImage(null);
    if (valueOverrideRobuxQty !== null && valueOverrideRobuxQty !== undefined) {
      setRobuxCoinInput(valueOverrideRobuxQty.toString());
    } else {
      setRobuxCoinInput('');
    }
  }, [visible, selectedItem, backgroundImages, hdImages, valueOverrideRobuxQty]);

  // Reset imageLoaded state when modal opens or item changes
  useEffect(() => {
    setImageLoaded({});
  }, [visible, selectedItem, backgroundImages, hdImages]);

  // Inside your useEffect hook to set default style/selected icons when modal opens
useEffect(() => {
  if (visible && selectedItem) {
    // Set selected style (check if the user has previously purchased a style)
    if (user?.purchases?.[9]?.style) {
      setSelectedVariant(user.purchases[9].style.variant); // Set selected style (if any)
    } else {
      setSelectedVariant("rainbow"); // Default style if no style purchased
    }

    // Set selected icons (check if the user has previously selected icons)
    if (user?.purchases?.[10]?.icons) {
      setSelectedIcons(user.purchases[10].icons); // Set selected icons (if any)
    } else {
      setSelectedIcons([Object.keys(iconMap)[0]]); // Default to the first icon if none selected
    }
  }
}, [visible, selectedItem, user?.purchases]); // Run this effect when modal visibility or selectedItem changes
const toggleIconSelection = (icon) => {
  setSelectedIcons((prev) => {
    if (prev.includes(icon)) {
      return prev.filter((item) => item !== icon); // Deselect icon
    } else {
      if (prev.length < 4) {
        return [...prev, icon]; // Select icon (limit to 4 icons)
      }
      return prev; // Don't allow more than 4 icons to be selected
    }
  });
};


  // Helper to get the correct image list and url prefix
  const getImageList = () => {
    if (selectedItem?.id === 5) {
      return { list: backgroundImages, prefix: 'https://bloxfruitscalc.com/wp-content/uploads/2025/background/', suffix: '.jpg' };
    } else if (selectedItem?.id === 6) {
      return { list: hdImages, prefix: 'https://bloxfruitscalc.com/wp-content/uploads/2025/hd/', suffix: '.jpg' };
    }
    return { list: [], prefix: '', suffix: '' };
  };
  const getImageHeight = selectedItem?.id === 5 ?  180  : selectedItem?.id === 6 ? 100 : 0
  
   


  const { list: imageList, prefix: imagePrefix, suffix: imageSuffix } = getImageList();

  const imagesAreLoading = visible && ((selectedItem?.id === '5' && backgroundImages.length === 0) || (selectedItem?.id === '6' && hdImages.length === 0));

  // Robux purchase: calculate max coins user can spend
  let robuxCoinCost = selectedItem?.cost || 1;
  let robuxAmount = selectedItem?.robuxAmount || 0;
  let maxCoins = typeof maxBuyable === 'number' ? maxBuyable * robuxCoinCost : 0;
  if (maxCoins < robuxCoinCost) maxCoins = 0;
  // console.log(selectedItem, 'SELECTEDITEM')
  // Confirm handler for image items
  // const handleConfirm = () => {
  //   if ((selectedItem?.id === '5' || selectedItem?.id === '6')) {
  //     if (!selectedImage) {
  //       // Optionally show a warning
  //       return;
  //     }
  //     // Pass selected image url to parent
  //     confirmPurchase(selectedImage);
  //   } else {
  //     confirmPurchase();
  //   }
  // };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={modalStyles.backdrop} onPress={onClose}>
        <ConditionalKeyboardWrapper>
        <Pressable style={[modalStyles.sheet, { backgroundColor: isDark ? '#34495E' : 'white',}]} onPress={e => e.stopPropagation()}>
          <View style={modalStyles.handle} />
          <Text style={[ modalStyles.title, { color: isDark ? 'white' : 'balck'}]}>{selectedItem?.title}</Text>
          <Text style={[ modalStyles.cost, { color: isDark ? 'lightgrey' : 'balck'}]}>Cost: {selectedItem?.cost} coins</Text>
         {selectedItem?.validForDays && <Text style={[ modalStyles.cost, { color: isDark ? 'lightgrey' : 'balck'}]}>Validity: {selectedItem?.validForDays} Days</Text>}
          <Text style={[modalStyles.cost,  { color: isDark ? 'lightgrey' : 'balck'}]}>{selectedItem?.note} coins</Text>


          {/* Robux input field */}
          {selectedItem?.category === 'robux' && (
  <View style={{ width: '100%', marginBottom: 16 }}>
    <Text style={{ fontSize: 15, color: isDark ? 'lightgrey' : 'black' }}>
      Stock will be reloaded every 6 hrs
    </Text>
    <Text style={{ fontSize: 13, color: isDark ? 'lightgrey' : 'black' }}>
      Available coins: {userCoins}, Available Robux: {robuxAmount}
    </Text>
    {typeof maxBuyable !== 'number' ? (
      <View style={{ alignItems: 'center', marginVertical: 8 }}>
        <ActivityIndicator size="small" color="#6A5ACD" />
      </View>
    ) : maxBuyable < 1 ? (
      <Text style={{ color: isDark ? 'pink' : 'red', marginBottom: 8 }}>
        Not enough coins to buy Robux.
      </Text>
    ) : (
      
      <TextInput
        style={{
          borderWidth: 1,
          borderColor: '#ccc',
          borderRadius: 8,
          padding: 8,
          width: '100%',
          textAlign: 'center',
          fontSize: 18,
          marginBottom: 8,
        }}
        keyboardType="number-pad"
        value={robuxCoinInput}
        onChangeText={(text) => {
          // Ensure input is numeric and do not exceed maxBuyable
          const numericInput = text.replace(/[^0-9]/g, ''); // Only allow numbers
          const inputValue = Math.min(Number(numericInput), maxBuyable);
          setRobuxCoinInput(inputValue.toString()); // Update the state
        }}
        maxLength={10}
        placeholder={typeof maxBuyable === 'number' ? `Up to ${maxBuyable}` : ''}
        editable={maxBuyable > 0} // Disable input if maxBuyable is 0 or less
      />
    )}
    {robuxCoinInput && Number(robuxCoinInput) >= robuxCoinCost && typeof maxBuyable === 'number' && maxBuyable >= 1 && (
      <Text style={{ fontSize: 13, color: '#6A5ACD' }}>
        You will get {Math.floor(Number(robuxCoinInput) / robuxCoinCost)} Robux
      </Text>
    )}
  </View>
)}


          {selectedItem?.category === 'styled' && (
            <View>
              <StyledUsernamePreview variant={selectedVariant} text={user.displayName} options={options} />


              <View style={modalStyles.styledOptionsRow}>
                {styleOptions.map((option) => (
                  <TouchableOpacity
                    key={option.key}
                    onPress={() => setSelectedVariant(option.key)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      backgroundColor: selectedVariant === option.key ? '#6A5ACD' : '#eee',
                      margin: 4,
                      borderRadius: 50,
                    }}
                  >
                    <Text style={{ color: selectedVariant === option.key ? '#fff' : '#333' }}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8, justifyContent: 'center' }}>
                <TouchableOpacity onPress={() => setOptions(prev => ({ ...prev, caps: !prev.caps }))}>
                  <Text style={{ margin: 4, padding: 6, backgroundColor: options.caps ? '#6A5ACD' : '#ccc', borderRadius: 6, color: options.caps ? 'white' : 'black' }}>Caps</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setOptions(prev => ({ ...prev, underline: !prev.underline }))}>
                  <Text style={{ margin: 4, padding: 6, backgroundColor: options.underline ? '#6A5ACD' : '#ccc', borderRadius: 6, color: options.underline ? 'white' : 'black' }}>Underline</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setOptions(prev => ({ ...prev, blur: !prev.blur }))}>
                  <Text style={{ margin: 4, padding: 6, backgroundColor: options.blur ? '#6A5ACD' : '#ccc', borderRadius: 6, color: options.blur ? 'white' : 'black' }}>Blur BG</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setOptions(prev => ({ ...prev, bold: !prev.bold }))}>
                  <Text style={{ margin: 4, padding: 6, backgroundColor: options.bold ? '#6A5ACD' : '#ccc', borderRadius: 6, color: options.bold ? 'white' : 'black' }}>Bold</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setOptions(prev => ({ ...prev, italic: !prev.italic }))}>
                  <Text style={{ margin: 4, padding: 6, backgroundColor: options.italic ? '#6A5ACD' : '#ccc', borderRadius: 6, color: options.italic ? 'white' : 'black' }}>Italic</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setOptions(prev => ({ ...prev, blackwhite: !prev.blackwhite }))}>
                  <Text style={{ margin: 4, padding: 6, backgroundColor: options.blackwhite ? '#6A5ACD' : '#ccc', borderRadius: 6, color: options.blackwhite ? 'white' : 'black' }}>B/W</Text>
                </TouchableOpacity>
              </View>

            </View>
          )}

          {(selectedItem?.id === 6 || selectedItem?.id === 5) && (
            <ScrollView style={modalStyles.imageScroll}>
              {imagesAreLoading ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
                  <ActivityIndicator size="large" color="#6A5ACD" />
                </View>
              ) : (
                <View style={modalStyles.imageGrid}>
                  {imageList.map((name) => {
                    const url = imagePrefix + name + imageSuffix;
                    const isSelected = selectedImage === url;
                    return (
                      <TouchableOpacity
                        key={name}
                        onPress={() => setSelectedImage(url)}
                        style={[
                          modalStyles.imageItem,
                          isSelected && { borderColor: '#6A5ACD', borderWidth: 2 }, {height: getImageHeight}
                        ]}
                      >
                        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                          {!imageLoaded[url] && (
                            <ActivityIndicator size="small" color="#6A5ACD" style={StyleSheet.absoluteFill} />
                          )}
                          <Image
                            source={{ uri: url }}
                            style={[modalStyles.image, !imageLoaded[url] && { opacity: 0 }]}
                            onLoad={() => setImageLoaded((prev) => ({ ...prev, [url]: true }))}
                          />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          )}
{selectedItem?.id === 10 && (
  <>
    {/* Username + Icons Preview */}
    <View style={{ alignItems: 'center', marginBottom: 12, paddingHorizontal: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', flexShrink: 1, flexGrow: 0 }}>
        <View style={{ flexShrink: 1, maxWidth: '70%' }}>
          {selectedVariant ? (
            <StyledUsernamePreview
              text={user.displayName}
              variant={selectedVariant}
              options={options}
            />
          ) : (
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#333' }}>
              {user.displayName}
            </Text>
          )}
        </View>

        {/* Selected Icons */}
        {selectedIcons.map((name) => (
          <Image
            key={name}
            source={iconMap[name]}
            style={{
              width: 24,
              height: 24,
              marginLeft: 4,
              resizeMode: 'contain',
            }}
          />
        ))}
      </View>
    </View>

    {/* Icon Selection Grid */}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
      {Object.keys(iconMap).map((name) => {
        const isSelected = selectedIcons.includes(name);
        
        const toggleSelection = () => {
          setSelectedIcons((prev) => {
            if (isSelected) return prev.filter((n) => n !== name);
            if (prev.length < 4) return [...prev, name];
            return prev;
          });
        };

        return (
          <TouchableOpacity
            key={name}
            onPress={() => toggleIconSelection(name)}
            style={{
              borderWidth: isSelected ? 2 : 1,
              borderColor: isSelected ? '#6A5ACD' : '#ccc',
              borderRadius: 10,
              padding: 4,
              margin: 6,
              opacity: selectedIcons.length >= 4 && !isSelected ? 0.5 : 1,
            }}
          >
            <Image
              source={iconMap[name]}
              style={{
                width: 50,
                height: 50,
                borderRadius: 6,
                resizeMode: 'contain',
              }}
            />
          </TouchableOpacity>
        );
      })}
    </View>

    {/* Selection Count */}
    <Text style={{ marginTop: 6, fontSize: 13, color: '#6A5ACD', textAlign: 'center' }}>
      {selectedIcons.length} / 4 selected
    </Text>
  </>
)}

{selectedItem?.id === 11 && (
  <>
    {/* Username + Emojis Preview */}
    <View style={{ alignItems: 'center', marginBottom: 12, paddingHorizontal: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flexShrink: 1, justifyContent:'center' }}>
        
        {/* Loop through the Emojies array */}
        {Emojies.map((emoji) => (
          <Image
            key={emoji}
            source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/${emoji}` }}
            style={{
              width: 50,
              height: 50,
              marginLeft: 4,
              resizeMode: 'contain',
            }}
          />
        ))}
      </View>
    </View>
  </>
)}




          <View style={modalStyles.buttonRow}>
            <TouchableOpacity
              style={modalStyles.cancelButton}
              onPress={onClose}
              disabled={loading}
            >
              <Text style={modalStyles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[modalStyles.confirmButton, loading && { opacity: 0.7 }]}
              onPress={() => {
                const styledData =
                  selectedItem?.category === 'styled'
                    ? {
                      variant: selectedVariant,
                      ...options, // includes caps, blur, bold, etc.
                    }
                    : null;

                if (selectedItem?.category === 'robux') {
                  const coinsToSpend = Math.max(
                    robuxCoinCost,
                    Math.min(parseInt(robuxCoinInput) || 0, maxCoins)
                  );
                  confirmPurchase(null, null, Number(robuxCoinInput));
                } else if (
                  (selectedItem?.id === 6 || selectedItem?.id === 5) &&
                  selectedImage
                ) {
                  confirmPurchase(selectedImage, styledData);
                }   else if (
                  (selectedItem?.id === 10) &&
                  selectedIcons
                ) {
                  confirmPurchase(null, null, null, selectedIcons);

                }else {
                  confirmPurchase(null, styledData);
                }
              }}
              // disabled={
              //   loading ||
              //   (selectedItem?.category === 'robux' &&
              //     (typeof maxBuyable !== 'number' ||
              //       maxBuyable < 1 ||
              //       !robuxCoinInput ||
              //       Number(robuxCoinInput) < robuxCoinCost))
              // }
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={modalStyles.confirmButtonText}>Confirm</Text>
              )}
            </TouchableOpacity>

          </View>
       
        </Pressable>
        </ConditionalKeyboardWrapper>
      </Pressable>
    </Modal>
  );
};

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 12,
    // minHeight: 260,
    maxHeight: windowHeight * 0.85,
    width: '100%',
    paddingBottom: 20
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#eee',
    borderRadius: 2,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    marginBottom: 6,
  },
  cost: {
    fontSize: 17,
    color: '#6A5ACD',
    marginBottom: 2,
  },
  note: {
    marginBottom: 14,
    color: '#888',
    fontSize: 14,
  },
  styledOptionsRow: {
    flexDirection: 'row',
    marginTop: 12,
    marginBottom: 10,
    flexWrap: 'wrap',
    justifyContent: 'space-evenly'
  },
  styledOption: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  styledOptionSelected: {
    borderWidth: 2,
  },
  styledOptionText: {
    fontFamily: 'Lato-Regular',
    fontSize: 15,
  },
  imageScroll: {
    width: '100%',
    marginTop: 10,
    marginBottom: 10,
    maxHeight: windowHeight * 0.35,
  },
  imageSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#6A5ACD',
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  imageItem: {
    margin: 5,
    height: 180,
    borderWidth: 1,
    borderRadius: 8,
    borderColor: 'grey',
  },
  image: {
    width: 100,
    height: '100%',
    borderRadius: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#eee',
    resizeMode: 'contain',
  },
  imageLabel: {
    textAlign: 'center',
    fontSize: 12,
    color: '#444',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 18,
    gap: 12,
  },
  confirmButton: {
    backgroundColor: '#6A5ACD',
    paddingVertical: 12,
    borderRadius: 12,
    flex: 1,
    alignItems: 'center',
    shadowColor: '#6A5ACD',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  cancelButton: {
    backgroundColor: '#eee',
    paddingVertical: 12,
    borderRadius: 12,
    flex: 1,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontFamily: 'Lato-Bold',
    fontSize: 17,
  },
  cancelButtonText: {
    color: '#6A5ACD',
    fontFamily: 'Lato-Regular',
    fontSize: 16,
  },
});

export default PurchaseModal; 