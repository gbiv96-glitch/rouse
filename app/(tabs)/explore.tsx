import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { formatDuration } from "@/utils/formatDuration";

const SESSIONS_KEY = "readingSessions";

const colors = {
  background: "#F7F3EA",
  text: "#1F2933",
  mutedText: "#6B7280",
  accent: "#2F5D50",
  accentDark: "#24483E",
  softCream: "#FFF8ED",
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
};

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
        <View style={styles.emptyContent}>
          <ThemedText style={styles.title}>Your reading life</ThemedText>
          <ThemedText style={styles.emptyText}>
            Your first session will appear here.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <ThemedText style={styles.title}>Your reading life</ThemedText>
        <ThemedText style={styles.subtitle}>A private record.</ThemedText>

        <View style={styles.timeline}>
          <View pointerEvents="none" style={styles.timelineLine} />

          {sessions.map((session) => {
            const reflection = session.reflection?.trim();

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
    paddingHorizontal: 24,
    paddingTop: 74,
    paddingBottom: 120,
  },
  emptyContent: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: colors.background,
  },
  title: {
    color: "#1B2A22",
    fontSize: 40,
    lineHeight: 46,
    fontWeight: "400",
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  subtitle: {
    color: "rgba(47,93,80,0.58)",
    fontSize: 16,
    lineHeight: 22,
    fontStyle: "italic",
    fontWeight: "600",
    marginTop: 7,
  },
  emptyText: {
    color: "rgba(47,93,80,0.58)",
    fontSize: 17,
    lineHeight: 25,
    fontStyle: "italic",
    fontWeight: "600",
    marginTop: 18,
  },
  timeline: {
    position: "relative",
    backgroundColor: "transparent",
    marginTop: 34,
    paddingLeft: 28,
  },
  timelineLine: {
    position: "absolute",
    top: 7,
    bottom: 18,
    left: 5,
    width: 1,
    backgroundColor: "rgba(47,93,80,0.22)",
  },
  timelineEntry: {
    position: "relative",
    backgroundColor: "transparent",
    marginBottom: 34,
  },
  timelineDot: {
    position: "absolute",
    top: 6,
    left: -28,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.softCream,
  },
  entryContent: {
    backgroundColor: "transparent",
  },
  entryDate: {
    color: colors.accentDark,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "900",
  },
  entryBook: {
    color: "rgba(31,41,51,0.54)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    marginTop: 6,
  },
  entryDuration: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "900",
    marginTop: 4,
  },
  entryReflection: {
    color: "rgba(31,41,51,0.68)",
    fontSize: 16,
    lineHeight: 24,
    fontStyle: "italic",
    fontWeight: "600",
    marginTop: 10,
  },
});
