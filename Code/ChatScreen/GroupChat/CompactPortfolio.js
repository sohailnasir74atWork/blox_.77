import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { getThemeColors } from '../../Helper/themeColors';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';

/**
 * CompactPortfolio — Owned & Wishlist fruits with rarity badges and value display
 */
const CompactPortfolio = ({ ownedPets, wishlistPets, isDarkMode, t, loadingPets, renderPetBubble, lookupPetValue }) => {
  const c = getThemeColors(isDarkMode);

  const ownedTotal = (ownedPets || []).reduce((sum, pet) => sum + (lookupPetValue ? lookupPetValue(pet) : 0), 0);
  const wishlistTotal = (wishlistPets || []).reduce((sum, pet) => sum + (lookupPetValue ? lookupPetValue(pet) : 0), 0);

  return (
    <View
      style={{
        borderRadius: 14,
        padding: 12,
        backgroundColor: c.bgAlt,
        marginBottom: 8,
      }}
    >
      {/* Section Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{
            width: 24, height: 24, borderRadius: 8,
            backgroundColor: isDarkMode ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.1)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="briefcase" size={12} color="#8b5cf6" />
          </View>
          <Text style={{ fontSize: 12, fontWeight: '700', color: c.text }}>
            {t('profile.portfolio') || 'Portfolio'}
          </Text>
        </View>
        {(ownedPets?.length > 0 || wishlistPets?.length > 0) && (
          <View style={{
            backgroundColor: c.border,
            paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999,
          }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: c.textSecondary }}>
              {(ownedPets?.length || 0) + (wishlistPets?.length || 0)} items
            </Text>
          </View>
        )}
      </View>

      {loadingPets ? (
        <ActivityIndicator size="small" color={config.colors.primary} />
      ) : (
        <>
          {/* Owned Section */}
          <View style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="cube" size={11} color={config.colors.hasBlockGreen || '#10B981'} />
                <Text style={{ fontSize: 11, fontWeight: '600', color: c.text }}>
                  {t('profile.owned') || 'Owned'}
                </Text>
                <View style={{
                  backgroundColor: isDarkMode ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)',
                  paddingHorizontal: 5, paddingVertical: 1, borderRadius: 999,
                }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: config.colors.hasBlockGreen || '#10B981' }}>
                    {ownedPets?.length || 0}
                  </Text>
                </View>
              </View>
              {ownedTotal > 0 && (
                <Text style={{
                  fontSize: 10, fontWeight: '700',
                  color: config.colors.hasBlockGreen || '#10B981',
                  backgroundColor: (config.colors.hasBlockGreen || '#10B981') + '15',
                  paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                }}>
                  {formatValue(ownedTotal)}
                </Text>
              )}
            </View>

            {(!ownedPets || ownedPets.length === 0) ? (
              <Text style={{ fontSize: 11, color: c.textMuted, fontStyle: 'italic' }}>
                {t('profile.no_owned') || 'No fruits listed.'}
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: 6 }}
              >
                <View style={{ flexDirection: 'row' }}>
                  {ownedPets.map((pet, index) => renderPetBubble(pet, index))}
                </View>
              </ScrollView>
            )}
          </View>

          {/* Wishlist Section */}
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="heart" size={11} color={config.colors.wantBlockRed || '#EF4444'} />
                <Text style={{ fontSize: 11, fontWeight: '600', color: c.text }}>
                  {t('profile.wishlist') || 'Wishlist'}
                </Text>
                <View style={{
                  backgroundColor: isDarkMode ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
                  paddingHorizontal: 5, paddingVertical: 1, borderRadius: 999,
                }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: config.colors.wantBlockRed || '#EF4444' }}>
                    {wishlistPets?.length || 0}
                  </Text>
                </View>
              </View>
              {wishlistTotal > 0 && (
                <Text style={{
                  fontSize: 10, fontWeight: '700',
                  color: config.colors.wantBlockRed || '#EF4444',
                  backgroundColor: (config.colors.wantBlockRed || '#EF4444') + '15',
                  paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                }}>
                  {formatValue(wishlistTotal)}
                </Text>
              )}
            </View>

            {(!wishlistPets || wishlistPets.length === 0) ? (
              <Text style={{ fontSize: 11, color: c.textMuted, fontStyle: 'italic' }}>
                {t('profile.no_wishlist') || 'No wishlist fruits yet.'}
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: 6 }}
              >
                <View style={{ flexDirection: 'row' }}>
                  {wishlistPets.map((pet, index) => renderPetBubble(pet, index))}
                </View>
              </ScrollView>
            )}
          </View>
        </>
      )}
    </View>
  );
};

const formatValue = (value) => {
  if (!value || typeof value !== 'number') return '0';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
};

export default React.memo(CompactPortfolio);
