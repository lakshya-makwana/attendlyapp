// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      getItem: jest.fn(async (key: string) => {
        return store[key] || null;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
    },
  };
});

// Mock op-sqlite
jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({
    executeSync: jest.fn((_query: string, _params?: any[]) => {
      return {
        rows: [],
      };
    }),
    execute: jest.fn(async () => ({ rows: [] })),
    close: jest.fn(),
  })),
}));

// Mock NetInfo
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addEventListener: jest.fn(() => jest.fn()),
}));

// Mock SafeAreaContext
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }: any) => children,
    SafeAreaView: ({ children, style }: any) => {
      const { View } = require('react-native');
      return <View style={style}>{children}</View>;
    },
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

// Mock react-native-svg
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockSvgComponent = (props: any) => React.createElement(View, props, props.children);
  return {
    __esModule: true,
    default: MockSvgComponent,
    Svg: MockSvgComponent,
    Path: MockSvgComponent,
    Circle: MockSvgComponent,
    Rect: MockSvgComponent,
    Line: MockSvgComponent,
    Polyline: MockSvgComponent,
    Polygon: MockSvgComponent,
    G: MockSvgComponent,
    Text: MockSvgComponent,
    TSpan: MockSvgComponent,
    Defs: MockSvgComponent,
    Use: MockSvgComponent,
    Symbol: MockSvgComponent,
    LinearGradient: MockSvgComponent,
    RadialGradient: MockSvgComponent,
    Stop: MockSvgComponent,
    ClipPath: MockSvgComponent,
    Pattern: MockSvgComponent,
    Mask: MockSvgComponent,
  };
});

// Mock lucide-react-native
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockIcon = (props: any) => React.createElement(View, { testID: 'mock-lucide-icon', ...props });
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return MockIcon;
      },
    }
  );
});

// Default fetch mock for isolated tests
if (!globalThis.fetch) {
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ is_setup: false, message: 'Setup required' }),
    text: async () => '',
  }));
}

// Window event dispatcher mock for React 19 testing in node environment
if (typeof window !== 'undefined' && !window.dispatchEvent) {
  window.dispatchEvent = () => true;
}
