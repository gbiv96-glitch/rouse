import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { RousdPalette } from '@/constants/theme';
import { typographyFontsToLoad } from '@/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://7464b16b60bdbba00951a5533c3729ad@o4511662991736832.ingest.us.sentry.io/4511662995537920',

  // Keep crash reports privacy-conscious for Rousd.
  // Do not collect default PII unless we intentionally revisit privacy policy and consent.
  sendDefaultPii: false,

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash screen may already be hidden in development reloads.
});

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

export default Sentry.wrap(function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts(typographyFontsToLoad);
  const isTypographyReady = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (!isTypographyReady) return;

    SplashScreen.hideAsync().catch(() => {
      // A hidden splash should not block app rendering.
    });
  }, [isTypographyReady]);

  if (!isTypographyReady) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? rousdDarkTheme : rousdLightTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
});
