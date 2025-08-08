import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import StyledUsernamePreview from './StyledName';
import { useGlobalState } from '../../GlobelStats';

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

const StyledDisplayName = ({
  user,
  localState,
  displayName,
  fontSize = 16,
  lineHeight = 20,
  marginVertical = 2
}) => {
  const styleData = user?.purchases?.[9]?.style || null; // Styled Username purchase
  const iconNames = user?.purchases?.[10]?.icons || []; // Styled Icons purchase
  const { proTagBought, theme } = useGlobalState(); // Pro tag purchase status
  const isDark = theme === 'dark'

  // console.log(styleData, 'styleds', user.purchases)

  // Check if pro status is granted or pro tag is bought
  const isPro = localState?.isPro;
  const isProGranted = proTagBought;
  // console.log(user.displayName, styleData, 'bought')

  return (
    <View style={styles.container}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' }}>
        {/* Styled or regular username */}
        <View >
          {styleData ? (
            <StyledUsernamePreview
              text={user.displayName || user.displayname || 'Guest User'}
              variant={styleData.variant}
              options={styleData}
              fontSize={fontSize}
              lineHeight={lineHeight}
              marginVertical={marginVertical}
            />
          ) : (
            <Text style={[styles.userName, { color: isDark ? 'white' : 'black' }]}>
              {user.displayName || user.displayname || 'Guest User'}
            </Text>
          )}
        </View>

        {/* Badges */}
        {isPro && (
          <Image
            source={require('../../../assets/pro.png')}
            style={styles.badge}
          />
        )}
        {(isProGranted) && (
          <Image
            source={require('../../../assets/progranted.png')}
            style={styles.badge}
          />
        )}

        {/* Icons if any */}
        {iconNames.slice(0, 4).map((iconName) =>
          iconMap[iconName] ? (
            <Image
              key={iconName}
              source={iconMap[iconName]}
              style={styles.icon}
            />
          ) : null
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
  },
  userName: {
    fontFamily: 'Lato-Bold',
    color: '#333',
  },
  icon: {
    width: 20,
    height: 20,
    marginLeft: 4,
    resizeMode: 'contain',
  },
  badge: {
    width: 18,
    height: 18,
    marginLeft: 4,
    resizeMode: 'contain',
  },
});

export default StyledDisplayName;
