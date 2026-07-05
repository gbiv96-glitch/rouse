import type { FontSource } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import {
  Literata_400Regular,
  Literata_400Regular_Italic,
  Literata_600SemiBold,
} from "@expo-google-fonts/literata";

const serifRegular = "Literata_400Regular";
const serifItalic = "Literata_400Regular_Italic";
const serifSemiBold = "Literata_600SemiBold";
const sansRegular = "Inter_400Regular";
const sansMedium = "Inter_500Medium";
const sansSemiBold = "Inter_600SemiBold";

export const typographyFontsToLoad: Record<string, FontSource> = {
  [serifRegular]: Literata_400Regular,
  [serifItalic]: Literata_400Regular_Italic,
  [serifSemiBold]: Literata_600SemiBold,
  [sansRegular]: Inter_400Regular,
  [sansMedium]: Inter_500Medium,
  [sansSemiBold]: Inter_600SemiBold,
};

export const typography = {
  fontFamily: {
    serifRegular,
    serifItalic,
    serifSemiBold,
    sansRegular,
    sansMedium,
    sansSemiBold,
  },
  role: {
    wordmark: {
      fontFamily: serifRegular,
      fontWeight: "400" as const,
      letterSpacing: 0,
    },
    pageTitle: {
      fontFamily: serifRegular,
      fontWeight: "400" as const,
      letterSpacing: 0,
    },
    bookTitle: {
      fontFamily: serifRegular,
      fontWeight: "400" as const,
      letterSpacing: 0,
    },
    prose: {
      fontFamily: serifItalic,
      fontWeight: "400" as const,
      fontStyle: "italic" as const,
      letterSpacing: 0,
    },
    metadata: {
      fontFamily: sansMedium,
      fontWeight: "500" as const,
      letterSpacing: 0,
    },
    label: {
      fontFamily: sansSemiBold,
      fontWeight: "600" as const,
      letterSpacing: 0,
    },
    helper: {
      fontFamily: sansRegular,
      fontWeight: "400" as const,
      letterSpacing: 0,
    },
    button: {
      fontFamily: sansSemiBold,
      fontWeight: "700" as const,
      letterSpacing: 0,
    },
    body: {
      fontFamily: sansRegular,
      fontWeight: "400" as const,
      letterSpacing: 0,
    },
  },
} as const;
