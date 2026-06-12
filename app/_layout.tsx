import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { RousdPalette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

const rousdLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: RousdPalette.green,
    background: RousdPalette.parchment,
    card: RousdPalette.paper,
    text: RousdPalette.text,
    border: 'rgba(47,93,80,0.12)',
    notification: RousdPalette.brass,
  },
};

const rousdDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: RousdPalette.paper,
    background: RousdPalette.greenNight,
    card: RousdPalette.greenDeep,
    text: RousdPalette.paper,
    border: 'rgba(255,248,237,0.16)',
    notification: RousdPalette.brass,
  },
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? rousdDarkTheme : rousdLightTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
