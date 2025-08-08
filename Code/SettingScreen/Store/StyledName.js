import React, { useEffect, useRef } from 'react';
import { Text, StyleSheet, View, Animated, Easing } from 'react-native';

const colorPalettes = {
  rainbow: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#8F00FF'],
  candy: ['#FF66B2', '#FF99CC', '#FFCCE5', '#FFE6F2', '#FFB6C1'],
  fire: ['#FF6B00', '#FF8C00', '#FFA500', '#FFC04C', '#FFE066'],
  ice: ['#A6E3E9', '#71C9CE', '#CBF1F5', '#E3FDFD'],
  earth: ['#8B4513', '#A0522D', '#CD853F', '#DEB887'],
  ocean: ['#0077B6', '#00B4D8', '#48CAE4', '#90E0EF'],
  neon: ['#39FF14', '#0FF0FC', '#FF073A', '#FFAA00'],
  pastel: ['#AEC6CF', '#FFB347', '#B39EB5', '#77DD77', '#CFCFC4'],
  galaxy: ['#240046', '#5A189A', '#9D4EDD', '#C77DFF'],
  toxic: ['#B8FF00', '#DFFF00', '#A8FF04', '#ADFF2F'],
  blackWhite: ['#000000', '#FFFFFF'],
};

const StyledUsernamePreview = ({
  text = 'Styled User',
  variant = 'rainbow',
  options = {},
  fontSize = 24,
  lineHeight = 30,
  marginVertical = 8,
}) => {
  const floatAnim = useRef(new Animated.Value(0)).current;

  // console.log(options, variant)

  useEffect(() => {
    if (variant === 'bounce') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(floatAnim, {
            toValue: -2, // smaller bounce for smoothness
            duration: 1000,
            easing: Easing.inOut(Easing.sin), // smoother easing
            useNativeDriver: true,
          }),
          Animated.timing(floatAnim, {
            toValue: 2,
            duration: 1000,
            easing: Easing.inOut(Easing.sin), // smoother easing
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [variant]);
  

  const finalText = options.caps ? text.toUpperCase() : text;
  const colors = options.blackwhite
    ? colorPalettes.blackWhite
    : colorPalettes[variant] || colorPalettes.rainbow;

  return (
    <Animated.View
      style={[
        styles.container,
        { marginVertical },
        variant === 'bounce' && {
          transform: [{ translateY: floatAnim }],
        },
      ]}
    >
      <Text
        style={[
          styles.textWrapper,
          {
            lineHeight,
            fontSize,
            fontFamily: 'Lato-Regular',
          },
          options.blur && styles.blurGlowWrapper,
        ]}
      >
        {finalText.split('').map((char, i) => {
          const color = colors[i % colors.length];
          return (
            <Text
              key={i}
              style={[
                {
                  color,
                  fontSize,
                  lineHeight,
                  fontFamily: 'Lato-Regular',
                },
                options.bold && styles.bold,
                options.italic && styles.italic,
                options.underline && styles.underline,
                options.outline && styles.outline,
                options.upperGlow && styles.upperGlow,
                options.boldShadow && styles.boldShadow,
              ]}
            >
              {char}
            </Text>
          );
        })}
      </Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  textWrapper: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
  },
  blurGlowWrapper: {
    textShadowColor: '#999',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  boldShadow: {
    fontWeight: 'bold',
    textShadowColor: '#333',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  upperGlow: {
    textShadowColor: '#fff',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  underline: {
    textDecorationLine: 'underline',
  },
  outline: {
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },
  bold: {
    fontWeight: 'bold',
  },
  italic: {
    fontStyle: 'italic',
  },
});

export default StyledUsernamePreview;
