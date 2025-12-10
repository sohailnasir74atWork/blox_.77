// CustomTopTabs.js
import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  StyleSheet,
} from "react-native";
import Icon from "react-native-vector-icons/Ionicons";
import ValueScreen from "./ValueScreen";
import config from "../Helper/Environment";
import HDWallpaperScreen from "./HDwallpaper";
import NewsScreen from "./News";
import { useGlobalState } from "../GlobelStats";
import NewsFeedbackReport from "./AdminReport";

const MemoValueScreen = React.memo(ValueScreen);

const CustomTopTabs = ({ selectedTheme }) => {
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorWidth = useRef(new Animated.Value(0)).current;
  const { isAdmin } = useGlobalState();

  // 🔹 Build tabs list dynamically based on isAdmin
  const tabs = useMemo(() => {
    const base = [
      {
        label: "Items",
        key: "values",
        icon: "pricetags-outline",
        iconActive: "pricetags",
      },
      {
        label: "HD Wallpaper",
        key: "wallpaper",
        icon: "image-outline",
        iconActive: "image",
      },
      {
        label: "News",
        key: "News",
        icon: "newspaper-outline",
        iconActive: "newspaper",
      },
    ];

    if (isAdmin) {
      base.push({
        label: "Admin",
        key: "Admin",
        icon: "analytics-outline",
        iconActive: "analytics",
      });
    }

    return base;
  }, [isAdmin]);

  const [activeKey, setActiveKey] = useState(tabs[0].key);
  const [mountedTabs, setMountedTabs] = useState({ [tabs[0].key]: true });
  const [tabLayouts, setTabLayouts] = useState({});

  // if tabs change (e.g. Admin disappears), make sure activeKey is valid
  useEffect(() => {
    if (!tabs.find((t) => t.key === activeKey)) {
      const firstKey = tabs[0]?.key;
      if (firstKey) {
        setActiveKey(firstKey);
        setMountedTabs((prev) => ({ ...prev, [firstKey]: true }));
      }
    }
  }, [tabs, activeKey]);

  const animateIndicatorToTab = useCallback(
    (tabKey) => {
      const layout = tabLayouts[tabKey];
      if (!layout) return;

      Animated.spring(indicatorX, {
        toValue: layout.x,
        useNativeDriver: false,
        speed: 18,
        bounciness: 8,
      }).start();

      Animated.spring(indicatorWidth, {
        toValue: layout.width,
        useNativeDriver: false,
        speed: 18,
        bounciness: 8,
      }).start();
    },
    [indicatorX, indicatorWidth, tabLayouts]
  );

  const handlePress = useCallback(
    (index) => {
      const key = tabs[index].key;
      setActiveKey(key);

      setMountedTabs((prev) => ({
        ...prev,
        [key]: true,
      }));

      animateIndicatorToTab(key);
    },
    [tabs, animateIndicatorToTab]
  );

  const onTabLayout = useCallback(
    (tabKey, e) => {
      const { x, width } = e.nativeEvent.layout;

      setTabLayouts((prev) => {
        const next = { ...prev, [tabKey]: { x, width } };

        if (!prev[tabKey] && tabKey === tabs[0].key) {
          indicatorX.setValue(x);
          indicatorWidth.setValue(width);
        }

        return next;
      });
    },
    [indicatorX, indicatorWidth, tabs]
  );

  const activeBg = config.colors.hasBlockGreen;
  const inactiveBorder = "grey";
  const inactiveText = "grey";

  return (
    <View style={styles.wrapper}>
      {/* Tabs header */}
      <View style={styles.container}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabContainer}
        >
          <View style={styles.pillGroup}>
            {tabs.map((tab, index) => {
              const isActive = activeKey === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => handlePress(index)}
                  style={[
                    styles.tabPill,
                    isActive
                      ? { backgroundColor: activeBg, borderColor: activeBg }
                      : {
                          backgroundColor: "transparent",
                          borderColor: inactiveBorder,
                        },
                  ]}
                  activeOpacity={0.85}
                  onLayout={(e) => onTabLayout(tab.key, e)}
                >
                  <Icon
                    name={isActive ? tab.iconActive || tab.icon : tab.icon}
                    size={12}
                    color={isActive ? "#ffffff" : inactiveText}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.tabText,
                      isActive && styles.tabTextActive,
                      { color: isActive ? "#ffffff" : inactiveText },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        <Animated.View
          style={[
            styles.indicator,
            {
              left: indicatorX,
              width: indicatorWidth,
            },
          ]}
        />
      </View>

      {/* Screens */}
      <View style={styles.contentContainer}>
        {mountedTabs.values && (
          <View
            style={[
              styles.screen,
              activeKey !== "values" && styles.hiddenScreen,
            ]}
          >
            <MemoValueScreen selectedTheme={selectedTheme} />
          </View>
        )}

        {mountedTabs.wallpaper && (
          <View
            style={[
              styles.screen,
              activeKey !== "wallpaper" && styles.hiddenScreen,
            ]}
          >
            <HDWallpaperScreen />
          </View>
        )}

        {mountedTabs.News && (
          <View
            style={[
              styles.screen,
              activeKey !== "News" && styles.hiddenScreen,
            ]}
          >
            <NewsScreen />
          </View>
        )}

        {/* 🔹 Admin tab content, only mounted if the tab exists & was visited */}
        {mountedTabs.Admin && isAdmin && (
          <View
            style={[
              styles.screen,
              activeKey !== "Admin" && styles.hiddenScreen,
            ]}
          >
            <NewsFeedbackReport />
            {/* or <YourAdminScreen /> */}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    padding: 8,
  },
  container: {
    paddingBottom: 8,
  },
  tabContainer: {},
  pillGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  tabPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginRight: 8,
    borderWidth: 1,
  },
  tabText: {
    fontSize: 12,
    fontFamily: "Lato-Regular",
  },
  tabTextActive: {
    fontFamily: "Lato-Bold",
  },
  indicator: {
    position: "absolute",
    bottom: 0,
    height: 0, // change >0 if you want underline also
    backgroundColor: config.colors.hasBlockGreen,
    borderRadius: 3,
  },
  contentContainer: {
    flex: 1,
    position: "relative",
  },
  screen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  hiddenScreen: {
    opacity: 0,
    pointerEvents: "none",
  },
});

export default CustomTopTabs;
