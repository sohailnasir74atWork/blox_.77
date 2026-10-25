/**
 * FruitCard — one trading card, drawn in code at any size (adoptme PET_CARDS_PLAN.md §3; Blox: FRUIT_CARDS_PLAN.md).
 *
 *   <FruitCard card={c} finish="holo" serial={42} width={320} />
 *
 * The front carries only what never changes: art, name, rarity, family,
 * finish, collector number, serial. Live values stay off the card (they move
 * weekly; the viewer's back shows them with a date).
 *
 * Layers, back to front: frame (material by finish) → inner panel → art window
 * (painted background, holo, fruit) → pop-out fruit (Mythic Aura / Full Art) → text →
 * shine. `shine` = { x, y } Animated values in -1..1 from CardShine; without
 * it the card is static (album thumbnails).
 *
 * size="thumb" drops the type line and uses the 512 px art, so a 3-column
 * album page stays light.
 */

import React, { memo, useState } from 'react';
import { View, Text, Image, Animated, StyleSheet, I18nManager, PixelRatio, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  RARITY_STYLE, FIRST_EDITION_MAX, THEMES, DARK_THEMES, themeOf, themeIdFor, bgIdFor, fruitArtUrl,
} from './cardConfig';
import { paintFor, bgAssetId, assetUri, hasFruitArt } from './cardArt';
import RarityGem from './RarityGem';
import CardIcon from './cardIcons';

const TEX = {
  conic: require('../../assets/fruit-cards/t_conic.webp'),
  cosmos: require('../../assets/fruit-cards/h_cosmos.webp'),
  starlight: require('../../assets/fruit-cards/h_starlight.webp'),
  paws: require('../../assets/fruit-cards/h_paws.webp'),
  web: require('../../assets/fruit-cards/h_web.webp'),
  paper: require('../../assets/fruit-cards/t_paper.webp'),
  brushed: require('../../assets/fruit-cards/t_brushed.webp'),
};

// The same tiles repeated from the top-left into one 512x768 px sheet
// (scripts/fruit-cards/make-texture-sheets.py, lossless). Android draws
// resizeMode="repeat" by painting a new bitmap per image view, uncached, so an
// album page of small cards built dozens of them while opening; a sheet is one
// decoded bitmap every card shares, drawn at the tile's own pixel size from
// the top-left — exactly what "repeat" shows. Areas bigger than the sheet
// (full-size cards) keep "repeat", and so does iOS (it tiles natively, at
// the image's point size, so it has neither the cost nor the same scale).
const SHEET = {
  paper: require('../../assets/fruit-cards/t_paper_sheet.webp'),
  brushed: require('../../assets/fruit-cards/t_brushed_sheet.webp'),
  cosmos: require('../../assets/fruit-cards/h_cosmos_sheet.webp'),
  starlight: require('../../assets/fruit-cards/h_starlight_sheet.webp'),
  web: require('../../assets/fruit-cards/h_web_sheet.webp'),
};
const SHEET_PX = { w: 512, h: 768 }; // keep in step with make-texture-sheets.py

/** A tiled texture filling a w x h (dp) box whose parent clips (overflow hidden). */
function Texture({ name, w, h, style }) {
  const px = PixelRatio.get();
  const sheet = SHEET[name];
  if (Platform.OS === 'android' && sheet && w * px <= SHEET_PX.w && h * px <= SHEET_PX.h) {
    return (
      <Image resizeMethod="resize"
        source={sheet}
        resizeMode="stretch"
        fadeDuration={0}
        style={[{ position: 'absolute', left: 0, top: 0, width: SHEET_PX.w / px, height: SHEET_PX.h / px }, style]}
      />
    );
  }
  return <Image resizeMethod="resize" source={TEX[name]} resizeMode="repeat" style={[StyleSheet.absoluteFill, style]} />;
}

const RAINBOW = 'linear-gradient(115deg, #FF5FA2 0%, #FFD45E 18%, #5EFFB4 36%, #5EC8FF 54%, #B45EFF 72%, #FF5FA2 90%)';
const SHINE = 'linear-gradient(115deg, rgba(255,255,255,0) 38%, rgba(255,255,255,0.65) 50%, rgba(255,255,255,0) 62%)';
const GOLD = 'linear-gradient(135deg, #FFF3B0 0%, #E8B931 20%, #A8740F 42%, #F7D774 60%, #B8860B 80%, #FFE9A0 100%)';
const SHINE_OPACITY = { classic: 0.22, foil: 0.55, awakened: 0.3, holo: 0.5, gilded: 0.6, aura: 0.55, fullart: 0.4 };
const DARK_PANEL = new Set(['awakened', 'aura']);

// Frame material for each finish (the outer border of the card).
const frameStyle = (finish, rs, theme) => {
  switch (finish) {
    case 'foil':
      return { backgroundImage: `linear-gradient(125deg, #FFFFFF 0%, ${rs.light} 16%, ${rs.base} 38%, ${rs.dark} 56%, ${rs.light} 76%, #FFFFFF 100%)` };
    case 'awakened':
      return { backgroundColor: '#07060F' };
    case 'holo':
      return { backgroundImage: 'linear-gradient(125deg, #F8FAFF 0%, #C7D2E0 24%, #FFFFFF 44%, #AEB9C8 64%, #F1F5FA 100%)' };
    case 'gilded':
      return { backgroundImage: GOLD };
    case 'aura':
      return { backgroundColor: '#0B0A18' };
    case 'fullart':
      return { backgroundColor: '#0B0A18' };
    default:
      return DARK_THEMES.has(theme)
        ? { backgroundImage: `linear-gradient(155deg, ${rs.base} 0%, #2E1A52 55%, #0C0618 100%)` }
        : { backgroundImage: `linear-gradient(155deg, ${rs.light} 0%, ${rs.base} 40%, ${rs.dark} 100%)` };
  }
};

function FruitCard({
  card, finish = 'classic', serial = null, width = 300, size = 'full', owned = true,
  shine = null, style,
}) {
  const { t } = useTranslation();
  const [petFailed, setPetFailed] = useState(false);
  if (!card) return null;

  const thumb = size === 'thumb';
  const u = width / 100;
  const H = width * 1.4;
  const rs = RARITY_STYLE[card.rarity] || RARITY_STYLE.common;
  const themeId = themeIdFor(card);
  const theme = themeOf(themeId);
  const f = owned ? finish : 'classic';
  const fullArt = f === 'fullart';
  // Full Art has no window, so its fruit is always drawn on the card itself.
  const popOut = fullArt || (!thumb && f === 'aura');
  // Text colour follows the panel it sits on: Gilded's parchment is light even on skin cards.
  const dark = DARK_PANEL.has(f) || fullArt || (DARK_THEMES.has(themeId) && f !== 'gilded');
  // Light panels (sea cream, Gilded parchment) always take the sea theme's dark ink.
  const ink = dark ? '#F4ECFF' : THEMES.sea.panelText;
  const subInk = dark ? 'rgba(244,236,255,0.72)' : THEMES.sea.subText;

  const border = f === 'awakened' ? u * 2.4 : f === 'aura' ? u * 2.2 : fullArt ? 0 : u * 3.4;
  const radius = u * 4.6;
  const artTop = H * (thumb ? 0.15 : 0.135);
  const artH = H * (thumb ? 0.66 : 0.705);
  const artX = border + u * 2.4;
  const artW = width - artX * 2;

  const bgId = bgIdFor(card, f);
  const bgUri = assetUri(bgAssetId(bgId));
  const petUri = !petFailed && hasFruitArt(card.key) ? fruitArtUrl(card.key, thumb || width < 180 ? 512 : 1024) : null;
  const holo = owned && (f === 'holo' || f === 'aura' || fullArt);
  const pattern = card.rarity === 'limited' || card.rarity === 'mythical' ? 'starlight' : 'cosmos';

  // Shine moves opposite to the finger (or on its own idle loop).
  // A still card keeps a gloss highlight in the upper left.
  const shineTx = shine ? shine.x.interpolate({ inputRange: [-1, 1], outputRange: [width * 0.9, -width * 0.9] }) : -width * 0.35;
  const shineTy = shine ? shine.y.interpolate({ inputRange: [-1, 1], outputRange: [H * 0.5, -H * 0.5] }) : -H * 0.3;
  const holoTx = shine ? shine.x.interpolate({ inputRange: [-1, 1], outputRange: [-width * 0.6, width * 0.6] }) : 0;

  // Depth: while the finger tilts the card, the scenery slides against the
  // tilt and the fruit with it, so the fruit seems to stand in front of a window
  // instead of being printed on it. The scenery is drawn 8% larger so its
  // edges never show.
  const tilt = shine?.tilt;
  const depth = (k) => (tilt ? [
    { translateX: tilt.x.interpolate({ inputRange: [-1, 1], outputRange: [-u * k, u * k] }) },
    { translateY: tilt.y.interpolate({ inputRange: [-1, 1], outputRange: [-u * k * 0.7, u * k * 0.7] }) },
  ] : []);
  const sceneryDepth = tilt ? [...depth(-2.4), { scale: 1.08 }] : [];
  const petDepth = depth(2.2);

  const petSize = Math.min(artW, artH) * 0.94;
  // Pop-out fruits are drawn bigger than the window so they break out of its top.
  const popScale = fullArt ? 1.12 : 1.2;
  const fruit = petUri ? (
    <Image resizeMethod="resize"
      source={{ uri: petUri }}
      onError={() => setPetFailed(true)}
      resizeMode="contain"
      style={[
        { width: petSize, height: petSize },
        !owned && { tintColor: '#0B0B16', opacity: 0.55 },
      ]}
    />
  ) : (
    <View style={{ width: petSize, height: petSize, alignItems: 'center', justifyContent: 'center' }}>
      <CardIcon name="cards" size={petSize * 0.35} style={{ opacity: owned ? 0.9 : 0.4 }} />
    </View>
  );

  // Art background, shared by the window and Full Art.
  const artLayers = (w, h) => (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: sceneryDepth }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundImage: paintFor(bgId) }]} />
        {bgUri ? (
          <Image resizeMethod="resize"
            source={{ uri: bgUri }}
            resizeMode="cover"
            style={{ position: 'absolute', width: w, height: w * 1.4, left: 0, top: h >= w * 1.4 ? 0 : -(w * 1.4 - h) * 0.55 }}
          />
        ) : null}
      </Animated.View>
      {f === 'awakened' ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,4,30,0.45)' }]} /> : null}
      {holo ? (
        <>
          <Texture name={pattern} w={w} h={h} style={{ opacity: 0.32, mixBlendMode: 'screen' }} />
          <Animated.View
            style={{
              position: 'absolute', top: 0, bottom: 0, left: -w, width: w * 3,
              backgroundImage: RAINBOW, opacity: 0.38, mixBlendMode: 'color-dodge',
              transform: [{ translateX: holoTx }],
            }}
          />
        </>
      ) : null}
      {!owned ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,16,30,0.55)' }]} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundImage: 'radial-gradient(ellipse 75% 65% at 50% 55%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.28) 100%)' }]} />
      {/* contact shadow under the fruit */}
      <View style={{ position: 'absolute', left: w * 0.22, width: w * 0.56, bottom: h * 0.04, height: h * 0.1, backgroundImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 100%)' }} />
    </>
  );

  const nameSize = thumb ? u * 8 : u * 6.4;
  const glowText = f === 'awakened' || f === 'aura'
    ? { textShadowColor: rs.glow, textShadowRadius: u * 2.2, textShadowOffset: { width: 0, height: 0 } }
    : dark ? { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: u, textShadowOffset: { width: 0, height: u * 0.3 } } : null;

  const setLabel = card.family
    ? t(`fruit_cards.family.${card.family}`, { defaultValue: card.family })
    : t('fruit_cards.sets.all');
  const firstEd = serial != null && serial <= FIRST_EDITION_MAX;

  return (
    <View
      style={[
        {
          width, height: H, borderRadius: radius, overflow: 'hidden',
          boxShadow: f === 'awakened' || f === 'aura'
            ? `0 0 ${u * 5}px ${rs.glow}`
            : `0 ${u * 1.4}px ${u * 4}px rgba(0,0,0,0.3)`,
        },
        frameStyle(f, rs, themeId),
        style,
      ]}
    >
      {/* Mega: the rainbow wheel spins behind the frame (CardShine drives it). */}
      {f === 'aura' && owned ? (
        <Animated.Image resizeMethod="resize"
          source={TEX.conic}
          style={{
            position: 'absolute', width: H * 1.5, height: H * 1.5, left: (width - H * 1.5) / 2, top: (H - H * 1.5) / 2,
            transform: shine?.spin ? [{ rotate: shine.spin }] : [],
          }}
        />
      ) : null}
      {f === 'foil' || f === 'holo' ? (
        <Texture name="brushed" w={width} h={H} style={{ opacity: 0.55 }} />
      ) : null}
      {f === 'holo' ? (
        <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, left: -width, width: width * 3, backgroundImage: RAINBOW, opacity: 0.45, mixBlendMode: 'overlay', transform: [{ translateX: holoTx }] }} />
      ) : null}

      {/* Full Art: the painting is the card. */}
      {fullArt ? <View style={StyleSheet.absoluteFill}>{artLayers(width, H)}</View> : null}

      {/* Inner panel */}
      {!fullArt ? (
        <View
          style={{
            position: 'absolute', left: border, top: border, right: border, bottom: border,
            borderRadius: Math.max(2, radius - border * 0.6),
            backgroundColor: DARK_PANEL.has(f) ? '#0B0A18' : f === 'gilded' ? '#FBF3DD' : theme.panel,
            borderWidth: f === 'awakened' ? Math.max(1, u * 0.7) : Math.max(0.5, u * 0.35),
            borderColor: f === 'awakened' ? rs.glow : f === 'gilded' ? '#B8860B' : 'rgba(255,255,255,0.55)',
            boxShadow: f === 'awakened' ? `0 0 ${u * 2.6}px ${rs.glow}, inset 0 0 ${u * 2.2}px ${rs.glow}` : undefined,
            overflow: 'hidden',
          }}
        >
          {f === 'classic' && !dark ? <Texture name="paper" w={width - border * 2} h={H - border * 2} style={{ opacity: 0.9 }} /> : null}
        </View>
      ) : null}

      {/* Gilded corners (code-drawn until O-GILDED-CORNER is uploaded) */}
      {f === 'gilded' && !thumb ? (
        [[0, 0], [1, 0], [0, 1], [1, 1]].map(([cx, cy]) => (
          <View
            key={`${cx}${cy}`}
            style={{
              position: 'absolute', width: u * 7, height: u * 7,
              left: cx ? width - u * 9.5 : u * 2.5, top: cy ? H - u * 9.5 : u * 2.5,
              backgroundImage: GOLD, borderRadius: u, borderWidth: Math.max(0.5, u * 0.4), borderColor: '#7A5308',
              transform: [{ rotate: '45deg' }],
            }}
          />
        ))
      ) : null}

      {/* Art window */}
      {!fullArt ? (
        <View
          style={{
            position: 'absolute', left: artX, top: artTop, width: artW, height: artH,
            borderRadius: u * 2.6, overflow: 'hidden',
            borderWidth: Math.max(1, u * 0.55),
            borderColor: f === 'awakened' ? rs.glow : f === 'gilded' ? '#B8860B' : dark ? 'rgba(255,255,255,0.25)' : rs.base,
          }}
        >
          {artLayers(artW, artH)}
          {!popOut ? (
            <Animated.View style={{ position: 'absolute', left: (artW - petSize) / 2, bottom: artH * 0.02, transform: petDepth }}>{fruit}</Animated.View>
          ) : null}
        </View>
      ) : null}

      {/* Pop-out fruit: breaks out over the top of the window */}
      {popOut ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: (width - petSize) / 2,
            top: fullArt ? H * 0.13 : artTop + artH - petSize * popScale - artH * 0.02,
            transform: [...petDepth, { scale: popScale }],
          }}
        >
          {fruit}
        </Animated.View>
      ) : null}

      {/* Header: name + gem */}
      <View
        style={{
          position: 'absolute', left: border + u * 3, right: border + u * 3, top: border + u * (thumb ? 1.6 : 2.2),
          height: artTop - border - u * (thumb ? 2.2 : 3.2),
          flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', alignItems: 'center',
          ...(fullArt ? { backgroundColor: 'rgba(10,8,20,0.5)', borderRadius: u * 2, paddingHorizontal: u * 2 } : null),
        }}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={[{ flex: 1, fontSize: nameSize, fontWeight: '900', color: ink, letterSpacing: 0.2 }, glowText]}
        >
          {card.name}
        </Text>
        <RarityGem rarity={card.rarity} size={thumb ? u * 9 : u * 7.6} glow={f === 'awakened' || f === 'aura'} />
      </View>

      {!thumb ? (
        <>
          {/* Type line: origin · finish */}
          <View style={{ position: 'absolute', left: artX, right: artX, top: artTop + artH + u * 2.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={[{ flex: 1, fontSize: u * 4.2, fontWeight: '800', color: subInk }, fullArt && plates.dark]}>
              {setLabel}
            </Text>
            {f !== 'classic' ? (
              <View style={{ paddingHorizontal: u * 2.4, paddingVertical: u * 0.8, borderRadius: u * 3.2, backgroundImage: f === 'gilded' ? GOLD : RAINBOW, marginLeft: u }}>
                <Text style={{ fontSize: u * 3.4, fontWeight: '900', color: '#1A1030', letterSpacing: 0.6 }}>
                  {t(`fruit_cards.finish.${f}`).toUpperCase()}
                </Text>
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {/* Footer: collector number · serial */}
      <View style={{ position: 'absolute', left: artX, right: artX, bottom: border + u * (thumb ? 1.4 : 2), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[{ fontSize: thumb ? u * 5 : u * 2.9, fontWeight: '800', color: subInk }, fullArt && plates.dark]}>
          {/* Number alone: Pet Cards printed no/cards-with-art (700/579). */}
          {`#${card.no}`}
        </Text>
        {serial != null && !thumb ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {firstEd ? (
              <View style={{ paddingHorizontal: u * 1.4, paddingVertical: u * 0.3, borderRadius: u * 2, backgroundImage: GOLD, marginRight: u * 1.2 }}>
                <Text style={{ fontSize: u * 2.4, fontWeight: '900', color: '#3A2400' }}>{t('fruit_cards.first_edition')}</Text>
              </View>
            ) : null}
            <Text style={[{ fontSize: u * 3.1, fontWeight: '900', color: ink }, fullArt && plates.dark]}>
              #{String(serial).padStart(4, '0')}
            </Text>
          </View>
        ) : null}
        {serial == null && f === 'aura' && owned && !thumb ? (
          // Pulled Mythic Auras always carry a serial; one without is fused (fuse_card).
          <Text style={{ fontSize: u * 3.1, fontWeight: '900', color: rs.glow, letterSpacing: 0.6, ...glowText }}>
            {t('fruit_cards.fused_stamp').toUpperCase()}
          </Text>
        ) : null}
      </View>

      {/* Shine: the specular streak that follows tilt */}
      {owned && (shine || !thumb) ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', left: -width, top: -H, width: width * 3, height: H * 3,
            backgroundImage: SHINE, opacity: SHINE_OPACITY[f] ?? 0.25,
            mixBlendMode: f === 'awakened' || f === 'aura' ? 'screen' : 'overlay',
            transform: [{ translateX: shineTx }, { translateY: shineTy }],
          }}
        />
      ) : null}

      {/* Full Art keeps a hairline gold edge */}
      {fullArt ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: Math.max(1, u * 0.45), borderColor: '#E9C46A' }]} />
      ) : null}
    </View>
  );
}

const plates = StyleSheet.create({
  dark: { textShadowColor: 'rgba(0,0,0,0.75)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
});

export default memo(FruitCard);
