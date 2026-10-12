// Code/Helper/valueUpdateAlerts.js — the once-per-install notification
// permission ask and its startup timing. Native modules are mocked; the ad
// visibility/policy modules are the real (pure) ones.

const mockStore = new Map();
const mockNotifee = {
  getNotificationSettings: jest.fn(),
  requestPermission: jest.fn(),
};
const mockSkipNextForeground = jest.fn();
let mockGate;
let mockOpenGate;

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getBoolean: (key) => (mockStore.has(key) ? mockStore.get(key) : undefined),
    set: (key, value) => mockStore.set(key, value),
  }),
}));
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: mockNotifee,
  AuthorizationStatus: { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 },
}));
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getAPNSToken: jest.fn(async () => 'apns'),
  subscribeToTopic: jest.fn(async () => {}),
  unsubscribeFromTopic: jest.fn(async () => {}),
}));
jest.mock('../Code/Ads/init', () => ({
  whenAdsGateOpen: () => mockGate,
}));
jest.mock('../Code/Ads/openApp', () => ({
  __esModule: true,
  default: { skipNextForeground: mockSkipNextForeground },
}));

const ASKED = 'valueUpdatesPermissionAsked';
const SETTING = 'valueUpdateNotifications';

// Fresh module state (the once-per-launch scheduler flag) for every test.
const load = () => {
  jest.resetModules();
  require('react-native').AppState.currentState = 'active';
  return {
    alerts: require('../Code/Helper/valueUpdateAlerts'),
    adVisibility: require('../Code/Ads/adVisibility'),
  };
};

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  mockNotifee.getNotificationSettings.mockResolvedValue({ authorizationStatus: -1 });
  mockNotifee.requestPermission.mockResolvedValue({ authorizationStatus: 1 });
  mockGate = new Promise((resolve) => { mockOpenGate = resolve; });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('askPermissionOnce', () => {
  test('setting off: no ask, flag left unset', async () => {
    mockStore.set(SETTING, false);
    const { alerts } = load();
    await alerts.askPermissionOnce();
    expect(mockNotifee.getNotificationSettings).not.toHaveBeenCalled();
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
    expect(mockStore.has(ASKED)).toBe(false);
  });

  test('already asked on this install: no ask', async () => {
    mockStore.set(ASKED, true);
    const { alerts } = load();
    await alerts.askPermissionOnce();
    expect(mockNotifee.getNotificationSettings).not.toHaveBeenCalled();
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
  });

  test.each([
    ['authorized', 1],
    ['provisional', 2],
  ])('already %s: no prompt, but the flag is set', async (_label, status) => {
    mockNotifee.getNotificationSettings.mockResolvedValue({ authorizationStatus: status });
    const { alerts } = load();
    await alerts.askPermissionOnce();
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
    expect(mockStore.get(ASKED)).toBe(true);
  });

  test('otherwise asks exactly once, setting the flag before asking', async () => {
    let flagWhenAsked;
    mockNotifee.requestPermission.mockImplementation(async () => {
      flagWhenAsked = mockStore.get(ASKED);
      return { authorizationStatus: 0 };
    });
    const { alerts } = load();
    await alerts.askPermissionOnce();
    await alerts.askPermissionOnce();
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);
    expect(flagWhenAsked).toBe(true);
    // iOS (the preset's platform): the app-open ad skip is Android 13+ only.
    expect(mockSkipNextForeground).not.toHaveBeenCalled();
  });

  test('Android 13+: the app-open ad skips the return from the permission dialog', async () => {
    const { alerts } = load();
    const { Platform } = require('react-native');
    const restore = { OS: Platform.OS, Version: Platform.Version };
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'Version', { value: 33, configurable: true });
    try {
      await alerts.askPermissionOnce();
    } finally {
      Object.defineProperty(Platform, 'OS', { value: restore.OS, configurable: true });
      Object.defineProperty(Platform, 'Version', { value: restore.Version, configurable: true });
    }
    expect(mockSkipNextForeground).toHaveBeenCalledTimes(1);
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);
  });

  test('never throws, and a failed ask is not retried', async () => {
    mockNotifee.getNotificationSettings.mockRejectedValue(new Error('native'));
    const { alerts } = load();
    await expect(alerts.askPermissionOnce()).resolves.toBeUndefined();
    expect(mockStore.get(ASKED)).toBe(true);
  });
});

describe('scheduleValueUpdatePermissionAsk', () => {
  test('waits for the ads gate (onboarding + consent), then 3 s, then asks once', async () => {
    jest.useFakeTimers();
    const { alerts } = load();
    alerts.scheduleValueUpdatePermissionAsk();
    alerts.scheduleValueUpdatePermissionAsk();

    // Still onboarding / on a consent prompt: however long that takes, no ask.
    await jest.advanceTimersByTimeAsync(60000);
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();

    mockOpenGate();
    await jest.advanceTimersByTimeAsync(2900);
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(200);
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);
  });

  test('holds the ask while a full-screen ad is on screen', async () => {
    jest.useFakeTimers();
    const { alerts, adVisibility } = load();
    adVisibility.setFullScreenAdVisible(true);
    alerts.scheduleValueUpdatePermissionAsk();
    mockOpenGate();

    await jest.advanceTimersByTimeAsync(30000);
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();

    adVisibility.setFullScreenAdVisible(false);
    await jest.advanceTimersByTimeAsync(1000);
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);
  });

  test('not before the launch app-open ad window has closed', async () => {
    jest.useFakeTimers();
    mockGate = Promise.resolve();
    const { alerts } = load();
    alerts.scheduleValueUpdatePermissionAsk();

    // Gate already open + 3 s delay, but the launch-ad window (7 s from JS
    // start) is still running.
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(3000);
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);
  });

  test('already asked on this install: nothing scheduled', async () => {
    jest.useFakeTimers();
    mockStore.set(ASKED, true);
    const { alerts } = load();
    alerts.scheduleValueUpdatePermissionAsk();
    mockOpenGate();
    await jest.advanceTimersByTimeAsync(20000);
    expect(mockNotifee.getNotificationSettings).not.toHaveBeenCalled();
  });
});
