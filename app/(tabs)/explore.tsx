import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { RousdPalette } from "@/constants/theme";
import type { BookMetadataFields } from "@/types/book";
import { formatDuration } from "@/utils/formatDuration";

const SESSIONS_KEY = "readingSessions";

const colors = {
  background: RousdPalette.parchment,
  text: RousdPalette.text,
  title: RousdPalette.title,
  mutedText: RousdPalette.muted,
  accent: RousdPalette.green,
  accentDark: RousdPalette.greenDark,
};

type ReadingSession = {
  id: string;
  title: string;
  minutes: string;
  note?: string;
  reflection?: string | null;
  createdAt?: string;
  date?: string;
  source?: "timed" | "logged";
} & BookMetadataFields;

function getSessionTime(session: ReadingSession) {
  const createdTime = session.createdAt
    ? new Date(session.createdAt).getTime()
    : Number.NaN;
  if (Number.isFinite(createdTime)) return createdTime;

  const dateTime = session.date ? new Date(session.date).getTime() : Number.NaN;
  if (Number.isFinite(dateTime)) return dateTime;

  const idTime = Number(session.id);
  return Number.isFinite(idTime) ? idTime : 0;
}

function formatDiaryDate(session: ReadingSession) {
  const sessionTime = getSessionTime(session);
  const sessionDate = sessionTime > 0 ? new Date(sessionTime) : new Date();

  return sessionDate.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function DiaryScreen() {
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<ReadingSession[]>([]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadSessions = async () => {
        try {
          const savedSessions = await AsyncStorage.getItem(SESSIONS_KEY);
          const parsedSessions: ReadingSession[] = savedSessions
            ? JSON.parse(savedSessions)
            : [];
          const chronologicalSessions = [...parsedSessions].sort(
            (first, second) => getSessionTime(second) - getSessionTime(first),
          );

          if (isActive) {
            setSessions(chronologicalSessions);
          }
        } catch (error) {
          console.log("Failed to load Rousd diary:", error);
          if (isActive) {
            setSessions([]);
          }
        }
      };

      loadSessions();

      return () => {
        isActive = false;
      };
    }, []),
  );

  if (sessions.length === 0) {
    return (
      <ThemedView style={styles.screen}>
        <View style={[styles.emptyContent, { paddingTop: insets.top }]}>
          <ThemedText style={styles.title}>Your reading life</ThemedText>
          <ThemedText style={styles.emptyText}>
            Your reading will gather here.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 48 },
        ]}
      >
        <ThemedText style={styles.title}>Your reading life</ThemedText>
        <ThemedText style={styles.subtitle}>A private record.</ThemedText>

        <View style={styles.timeline}>
          <View pointerEvents="none" style={styles.timelineLine} />

          {sessions.map((session) => {
            const reflection =
              session.reflection?.trim() || session.note?.trim();

            return (
              <View key={session.id} style={styles.timelineEntry}>
                <View style={styles.timelineDot} />
                <View style={styles.entryContent}>
                  <ThemedText style={styles.entryDate}>
                    {formatDiaryDate(session)}
                  </ThemedText>
                  <ThemedText style={styles.entryBook} numberOfLines={2}>
                    {session.title}
                  </ThemedText>
                  <ThemedText style={styles.entryDuration}>
                    {formatDuration(Number(session.minutes))}
                  </ThemedText>
                  {reflection ? (
                    <ThemedText style={styles.entryReflection}>
                      {reflection}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: 26,
    paddingTop: 88,
    paddingBottom: 126,
  },
  emptyContent: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: colors.background,
  },
  title: {
    color: colors.title,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: "400",
    letterSpacing: -0.5,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  subtitle: {
    color: "rgba(47,93,80,0.54)",
    fontSize: 16,
    lineHeight: 23,
    fontStyle: "italic",
    fontWeight: "600",
    marginTop: 8,
  },
  emptyText: {
    color: "rgba(47,93,80,0.56)",
    fontSize: 17,
    lineHeight: 26,
    fontStyle: "italic",
    fontWeight: "600",
    marginTop: 20,
  },
  timeline: {
    position: "relative",
    backgroundColor: "transparent",
    marginTop: 42,
    paddingLeft: 30,
  },
  timelineLine: {
    position: "absolute",
    top: 9,
    bottom: 24,
    left: 4,
    width: 1,
    backgroundColor: "rgba(47,93,80,0.16)",
  },
  timelineEntry: {
    position: "relative",
    backgroundColor: "transparent",
    marginBottom: 42,
  },
  timelineDot: {
    position: "absolute",
    top: 8,
    left: -31,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "rgba(47,93,80,0.66)",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.9)",
  },
  entryContent: {
    backgroundColor: "transparent",
  },
  entryDate: {
    color: colors.accentDark,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
  },
  entryBook: {
    color: "rgba(31,41,51,0.50)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 7,
  },
  entryDuration: {
    color: "rgba(47,93,80,0.72)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "800",
    marginTop: 8,
  },
  entryReflection: {
    color: "rgba(31,41,51,0.70)",
    fontSize: 16,
    lineHeight: 25,
    fontStyle: "italic",
    fontWeight: "600",
    marginTop: 15,
    paddingLeft: 15,
    borderLeftWidth: 1,
    borderLeftColor: "rgba(201,133,104,0.28)",
  },
});
