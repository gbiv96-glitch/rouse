/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

export const RousdPalette = {
  parchment: '#F7F3EA',
  paper: '#FFF8ED',
  card: '#FFFFFF',
  text: '#1F2933',
  title: '#1B2A22',
  muted: '#6B7280',
  warmMuted: '#8A8578',
  green: '#2F5D50',
  greenDark: '#24483E',
  greenDeep: '#1E3E32',
  greenNight: '#1C2E25',
  greenCover: '#173826',
  sage: '#DDEBE4',
  brass: '#C4945A',
  danger: '#B4533A',
};

export const RousdRadii = {
  control: 18,
  card: 24,
  largeCard: 28,
};

const tintColorLight = RousdPalette.green;
const tintColorDark = RousdPalette.paper;

export const Colors = {
  light: {
    text: RousdPalette.text,
    background: RousdPalette.parchment,
    tint: tintColorLight,
    icon: RousdPalette.greenDark,
    tabIconDefault: RousdPalette.muted,
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: RousdPalette.paper,
    background: RousdPalette.greenNight,
    tint: tintColorDark,
    icon: RousdPalette.sage,
    tabIconDefault: RousdPalette.sage,
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
