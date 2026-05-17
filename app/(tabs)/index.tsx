import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";

const SECONDS_KEY = "todaysReadingSeconds";
const DATE_KEY = "lastReadDate";
const STREAK_KEY = "currentStreak";
const LIFETIME_SECONDS_KEY = "lifetimeReadingSeconds";
const TOTAL_DAYS_READ_KEY = "totalDaysRead";
const SESSIONS_KEY = "readingSessions";
const CURRENT_BOOK_KEY = "currentBookTitle";
const ACTIVE_SESSION_START_KEY = "activeReadingSessionStartTime";
const ACTIVE_SESSION_TODAY_START_SECONDS_KEY =
  "activeReadingSessionTodayStartSeconds";
const ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY =
  "activeReadingSessionLifetimeStartSeconds";
const DAILY_GOAL_MINUTES = 10;

const encouragementMessages = [
  "One more page.",
  "Tiny sessions compound.",
  "Momentum matters.",
  "Your future self remembers this.",
  "A little reading still counts.",
];

const ritualPrompts = [
  "Settle in.\nWe’ve got time.",
  "Your book is waiting.",
  "One page becomes momentum.",
  "Reading time, not screen time.",
  "You don’t need hours.\nJust a moment.",
  "Open the book.\nWe’ll keep time.",
];

const colors = {
  background: "#F7F3EA",
  card: "#FFFFFF",
  text: "#1F2933",
  mutedText: "#6B7280",
  accent: "#2F5D50",
  accentDark: "#24483E",
  danger: "#B4533A",
  success: "#2F5D50",
  softAccent: "#DDEBE4",
  sessionBackground: "#123F34",
  sessionBackgroundLight: "#1E5C4C",
};

type ReadingSession = {
  id: string;
  title: string;
  minutes: string;
  createdAt?: string;
  date?: string;
};

function getTodayDateString() {
  return new Date().toISOString().split("T")[0];
}

function getYesterdayDateString() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split("T")[0];
}

function calculateElapsedSeconds(startTime: number) {
  return Math.max(0, Math.floor((Date.now() - startTime) / 1000));
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatSessionTimestamp(createdAt?: string, fallbackDate?: string) {
  if (!createdAt) return fallbackDate || "Recently";

  const sessionDate = new Date(createdAt);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const time = sessionDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sessionDate.toDateString() === today.toDateString()) {
    return `Today • ${time}`;
  }

  if (sessionDate.toDateString() === yesterday.toDateString()) {
    return `Yesterday • ${time}`;
  }

  return `${sessionDate.toLocaleDateString()} • ${time}`;
}

export default function HomeScreen() {
  const [isReading, setIsReading] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [lifetimeSeconds, setLifetimeSeconds] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [totalDaysRead, setTotalDaysRead] = useState(0);
  const [lastReadDate, setLastReadDate] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [sessionStartSeconds, setSessionStartSeconds] = useState(0);
  const [lifetimeSessionStartSeconds, setLifetimeSessionStartSeconds] =
    useState(0);
  const [activeSessionStartTime, setActiveSessionStartTime] = useState<
    number | null
  >(null);
  const [pendingSessionSeconds, setPendingSessionSeconds] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [currentBookTitle, setCurrentBookTitle] = useState("");
  const [showBookInput, setShowBookInput] = useState(false);
  const [recentSessions, setRecentSessions] = useState<ReadingSession[]>([]);
  const [showRitualScreen, setShowRitualScreen] = useState(false);
  const [ritualPrompt] = useState(
    () => ritualPrompts[Math.floor(Math.random() * ritualPrompts.length)],
  );

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ritualOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!showRitualScreen) return;

    ritualOpacity.setValue(0);

    const animation = Animated.sequence([
      Animated.timing(ritualOpacity, {
        toValue: 1,
        duration: 650,
        useNativeDriver: true,
      }),
      Animated.delay(1800),
      Animated.timing(ritualOpacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]);

    animation.start(({ finished }) => {
      if (finished) {
        setShowRitualScreen(false);
      }
    });

    return () => {
      animation.stop();
    };
  }, [ritualOpacity, showRitualScreen]);

  useEffect(() => {
    const loadSavedData = async () => {
      try {
        const savedSeconds = await AsyncStorage.getItem(SECONDS_KEY);
        const savedDate = await AsyncStorage.getItem(DATE_KEY);
        const savedStreak = await AsyncStorage.getItem(STREAK_KEY);
        const savedLifetimeSeconds =
          await AsyncStorage.getItem(LIFETIME_SECONDS_KEY);
        const savedTotalDaysRead =
          await AsyncStorage.getItem(TOTAL_DAYS_READ_KEY);
        const savedSessions = await AsyncStorage.getItem(SESSIONS_KEY);
        const savedCurrentBook = await AsyncStorage.getItem(CURRENT_BOOK_KEY);
        const savedActiveSessionStartTime = await AsyncStorage.getItem(
          ACTIVE_SESSION_START_KEY,
        );
        const savedActiveSessionTodayStartSeconds = await AsyncStorage.getItem(
          ACTIVE_SESSION_TODAY_START_SECONDS_KEY,
        );
        const savedActiveSessionLifetimeStartSeconds =
          await AsyncStorage.getItem(ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY);

        const today = getTodayDateString();
        const savedTodaySeconds =
          savedSeconds !== null ? Number(savedSeconds) : 0;
        const savedLifetimeTotalSeconds =
          savedLifetimeSeconds !== null ? Number(savedLifetimeSeconds) : 0;
        const todaySecondsToLoad = savedDate === today ? savedTodaySeconds : 0;

        setSeconds(todaySecondsToLoad);

        if (savedDate !== null) setLastReadDate(savedDate);
        if (savedStreak !== null) setCurrentStreak(Number(savedStreak));
        setLifetimeSeconds(savedLifetimeTotalSeconds);
        if (savedTotalDaysRead !== null)
          setTotalDaysRead(Number(savedTotalDaysRead));
        if (savedSessions !== null)
          setRecentSessions(JSON.parse(savedSessions));

        if (savedActiveSessionStartTime !== null) {
          const restoredStartTime = Number(savedActiveSessionStartTime);
          const restoredTodayStartSeconds =
            savedActiveSessionTodayStartSeconds !== null
              ? Number(savedActiveSessionTodayStartSeconds)
              : todaySecondsToLoad;
          const restoredLifetimeStartSeconds =
            savedActiveSessionLifetimeStartSeconds !== null
              ? Number(savedActiveSessionLifetimeStartSeconds)
              : savedLifetimeTotalSeconds;

          if (!Number.isNaN(restoredStartTime)) {
            const elapsed = calculateElapsedSeconds(restoredStartTime);

            setSessionStartSeconds(restoredTodayStartSeconds);
            setLifetimeSessionStartSeconds(restoredLifetimeStartSeconds);
            setActiveSessionStartTime(restoredStartTime);
            setSeconds(restoredTodayStartSeconds + elapsed);
            setLifetimeSeconds(restoredLifetimeStartSeconds + elapsed);
            setIsReading(true);
          }
        }

        if (savedCurrentBook !== null) {
          setCurrentBookTitle(savedCurrentBook);
          setBookTitle(savedCurrentBook);
        }
      } catch (error) {
        console.log("Failed to load Rouse data:", error);
      } finally {
        setIsLoaded(true);
      }
    };

    loadSavedData();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.setItem(SECONDS_KEY, String(seconds));
  }, [seconds, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.setItem(LIFETIME_SECONDS_KEY, String(lifetimeSeconds));
  }, [lifetimeSeconds, isLoaded]);

  useEffect(() => {
    const stopTimerInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const syncTimerWithClock = () => {
      if (!activeSessionStartTime) return;

      const elapsed = calculateElapsedSeconds(activeSessionStartTime);
      setSeconds(sessionStartSeconds + elapsed);
      setLifetimeSeconds(lifetimeSessionStartSeconds + elapsed);
    };

    stopTimerInterval();

    if (isReading && activeSessionStartTime) {
      syncTimerWithClock();

      intervalRef.current = setInterval(() => {
        syncTimerWithClock();
      }, 1000);
    }

    return () => {
      stopTimerInterval();
    };
  }, [
    activeSessionStartTime,
    isReading,
    lifetimeSessionStartSeconds,
    sessionStartSeconds,
  ]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState !== "active" || !isReading || !activeSessionStartTime) {
        return;
      }

      const elapsed = calculateElapsedSeconds(activeSessionStartTime);
      setSeconds(sessionStartSeconds + elapsed);
      setLifetimeSeconds(lifetimeSessionStartSeconds + elapsed);
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    return () => {
      subscription.remove();
    };
  }, [
    activeSessionStartTime,
    isReading,
    lifetimeSessionStartSeconds,
    sessionStartSeconds,
  ]);

  const updateStreakIfNeeded = async () => {
    const today = getTodayDateString();
    const yesterday = getYesterdayDateString();

    if (lastReadDate === today) return;

    let newStreak = 1;

    if (lastReadDate === yesterday) {
      newStreak = currentStreak + 1;
    }

    const newTotalDaysRead = totalDaysRead + 1;

    setCurrentStreak(newStreak);
    setTotalDaysRead(newTotalDaysRead);
    setLastReadDate(today);

    await AsyncStorage.setItem(STREAK_KEY, String(newStreak));
    await AsyncStorage.setItem(TOTAL_DAYS_READ_KEY, String(newTotalDaysRead));
    await AsyncStorage.setItem(DATE_KEY, today);
  };

  const handlePress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (!isReading) {
      await updateStreakIfNeeded();

      const now = Date.now();

      setSessionStartSeconds(seconds);
      setLifetimeSessionStartSeconds(lifetimeSeconds);
      setActiveSessionStartTime(now);
      setPendingSessionSeconds(0);
      setSessionMessage(null);
      setBookTitle(currentBookTitle);
      setShowBookInput(false);
      setShowRitualScreen(true);
      setIsReading(true);

      await AsyncStorage.multiSet([
        [ACTIVE_SESSION_START_KEY, String(now)],
        [ACTIVE_SESSION_TODAY_START_SECONDS_KEY, String(seconds)],
        [ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY, String(lifetimeSeconds)],
      ]);
    } else if (activeSessionStartTime) {
      const sessionSeconds = calculateElapsedSeconds(activeSessionStartTime);
      const updatedTodaySeconds = sessionStartSeconds + sessionSeconds;
      const updatedLifetimeSeconds =
        lifetimeSessionStartSeconds + sessionSeconds;
      const sessionMinutes = (sessionSeconds / 60).toFixed(1);

      setSeconds(updatedTodaySeconds);
      setLifetimeSeconds(updatedLifetimeSeconds);
      setPendingSessionSeconds(sessionSeconds);
      setShowRitualScreen(false);
      setIsReading(false);
      setActiveSessionStartTime(null);

      await AsyncStorage.multiSet([
        [SECONDS_KEY, String(updatedTodaySeconds)],
        [LIFETIME_SECONDS_KEY, String(updatedLifetimeSeconds)],
      ]);
      await AsyncStorage.multiRemove([
        ACTIVE_SESSION_START_KEY,
        ACTIVE_SESSION_TODAY_START_SECONDS_KEY,
        ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY,
      ]);

      setBookTitle(currentBookTitle);
      setShowBookInput(true);
      setSessionMessage(`+${sessionMinutes} minutes added`);
    }
  };

  const saveSession = async (title: string) => {
    const sessionSeconds = pendingSessionSeconds;
    const sessionMinutes = (sessionSeconds / 60).toFixed(1);

    const newSession = {
      id: Date.now().toString(),
      title,
      minutes: sessionMinutes,
      createdAt: new Date().toISOString(),
    };

    const updatedSessions = [newSession, ...recentSessions].slice(0, 5);

    setRecentSessions(updatedSessions);
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updatedSessions));

    return sessionMinutes;
  };

  const saveBookForSession = async () => {
    const trimmedTitle = bookTitle.trim();
    const titleToSave = trimmedTitle || "Unassigned reading";

    const sessionMinutes = await saveSession(titleToSave);

    if (trimmedTitle) {
      setCurrentBookTitle(trimmedTitle);
      await AsyncStorage.setItem(CURRENT_BOOK_KEY, trimmedTitle);
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    if (trimmedTitle) {
      setSessionMessage(`+${sessionMinutes} min • ${trimmedTitle}`);
    } else {
      setSessionMessage(`+${sessionMinutes} minutes added`);
    }

    setShowBookInput(false);

    setTimeout(() => {
      setSessionMessage(null);
    }, 4000);
  };

  const skipBookForSession = async () => {
    await saveSession("Unassigned reading");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    setShowBookInput(false);

    setTimeout(() => {
      setSessionMessage(null);
    }, 3000);
  };

  const formattedTime = formatTime(seconds);
  const goalProgress = seconds / 60;
  const lifetimeMinutes = lifetimeSeconds / 60;
  const goalReached = seconds >= DAILY_GOAL_MINUTES * 60;
  const hasReadToday = lastReadDate === getTodayDateString();
  const visibleSessions = recentSessions.slice(0, 3);
  const encouragement =
    encouragementMessages[totalDaysRead % encouragementMessages.length];

  if (!isLoaded) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText style={styles.loadingText}>Loading Rousd...</ThemedText>
      </ThemedView>
    );
  }

  if (isReading) {
    const activeSessionSeconds = Math.max(0, seconds - sessionStartSeconds);

    return (
      <ThemedView style={styles.sessionScreen}>
        <View style={styles.dimLayer} />

        <View style={styles.quietSessionContent}>
          <ThemedText style={styles.quietSessionLabel}>Reading</ThemedText>
          <ThemedText style={styles.quietTimerText}>
            {formatTime(activeSessionSeconds)}
          </ThemedText>
          <ThemedText style={styles.quietSessionSubtitle}>
            Enjoy your book.
          </ThemedText>
        </View>

        <View style={styles.quietBottomArea}>
          <Pressable
            style={({ pressed }) => [
              styles.quietEndSessionButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={handlePress}
          >
            <ThemedText style={styles.quietEndSessionText}>
              End session
            </ThemedText>
          </Pressable>
        </View>

        {showRitualScreen && (
          <Animated.View
            pointerEvents="none"
            style={[styles.ritualOverlay, { opacity: ritualOpacity }]}
          >
            <View style={styles.sessionGlowOne} />
            <View style={styles.sessionGlowTwo} />

            <View style={styles.sessionContent}>
              <ThemedText style={styles.sessionBookIcon}>📖</ThemedText>
              <ThemedText style={styles.sessionTitle}>
                Your reading session has begun
              </ThemedText>
              <ThemedText style={styles.sessionSubtitle}>
                Settle in.{"\n"}We&apos;ve got time.
              </ThemedText>

              <View style={styles.focusPill}>
                <ThemedText style={styles.focusPillText}>
                  You read. We’ll keep time.
                </ThemedText>
              </View>
            </View>
          </Animated.View>
        )}
      </ThemedView>
    );
  }

  if (showBookInput) {
    const pendingMinutes = (pendingSessionSeconds / 60).toFixed(1);

    return (
      <ThemedView style={styles.closeSessionScreen}>
        <View style={styles.sessionGlowOne} />
        <View style={styles.sessionGlowTwo} />

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.closeSessionContent}
        >
          <ThemedText style={styles.closeEyebrow}>Nice session.</ThemedText>
          <ThemedText style={styles.closeTitle}>
            What were you reading?
          </ThemedText>
          <ThemedText style={styles.closeMinutes}>
            +{pendingMinutes} minutes added
          </ThemedText>

          <TextInput
            placeholder="Book title"
            placeholderTextColor="rgba(255,255,255,0.45)"
            value={bookTitle}
            onChangeText={setBookTitle}
            style={styles.closeBookInput}
            returnKeyType="done"
            onSubmitEditing={saveBookForSession}
          />

          <ThemedText style={styles.closeHelperText}>
            This helps build your book-specific reading stats.
          </ThemedText>

          <View style={styles.closeButtonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.closeSecondaryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={skipBookForSession}
            >
              <ThemedText style={styles.closeSecondaryButtonText}>
                Skip for now
              </ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.closeSaveButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={saveBookForSession}
            >
              <ThemedText style={styles.closeSaveButtonText}>
                Save book
              </ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
    >
      <ThemedView style={styles.container}>
        <View pointerEvents="none" style={styles.warmVignetteTop} />
        <View pointerEvents="none" style={styles.warmVignetteBottom} />
        <View pointerEvents="none" style={styles.mountainBackdrop}>
          <View style={styles.mountainFarLeft} />
          <View style={styles.mountainFarCenter} />
          <View style={styles.mountainFarRight} />
        </View>
        <View pointerEvents="none" style={styles.paperTexture}>
          <View style={[styles.grainDot, styles.grainDotOne]} />
          <View style={[styles.grainDot, styles.grainDotTwo]} />
          <View style={[styles.grainDot, styles.grainDotThree]} />
          <View style={[styles.grainDot, styles.grainDotFour]} />
          <View style={[styles.grainDot, styles.grainDotFive]} />
          <View style={[styles.grainDot, styles.grainDotSix]} />
          <View style={[styles.grainDot, styles.grainDotSeven]} />
          <View style={[styles.grainDot, styles.grainDotEight]} />
        </View>

        <ThemedView style={styles.headerRow}>
          <View>
            <ThemedText style={styles.appName}>Rousd</ThemedText>
            <ThemedText style={styles.headerSubtitle}>
              Build your reading rhythm.
            </ThemedText>
          </View>

          <View style={styles.streakPill}>
            <ThemedText style={styles.streakPillText}>
              🔥 {currentStreak}
            </ThemedText>
          </View>
        </ThemedView>

        <View style={styles.ritualCopyBlock}>
          <ThemedText style={styles.ritualLine}>{ritualPrompt}</ThemedText>
          <View style={styles.ritualDividerRow}>
            <View style={styles.ritualDivider} />
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.startHero,
            goalReached && styles.startHeroGoalReached,
            pressed && styles.buttonPressed,
          ]}
          onPress={handlePress}
        >
          <View style={styles.startHeroContent}>
            <ThemedText style={styles.startHeroIcon}>📖</ThemedText>
            <View style={styles.startHeroCopy}>
              <ThemedText
                style={styles.startHeroTitle}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.88}
              >
                Start Reading
              </ThemedText>
              <ThemedText style={styles.startHeroSubtitle}>
                Your reading session begins now.
              </ThemedText>
            </View>
          </View>
        </Pressable>

        <ThemedView style={styles.todayCard}>
          <View style={styles.todayLeftColumn}>
            <ThemedText style={styles.todayLabel}>Today</ThemedText>
            <ThemedText style={styles.todayTime}>{formattedTime}</ThemedText>
            <ThemedText style={styles.todayCaption}>minutes read</ThemedText>
          </View>

          <View style={styles.todayDivider} />

          <View style={styles.todayRightColumn}>
            <View style={styles.checkCircle}>
              <ThemedText style={styles.checkText}>✓</ThemedText>
            </View>
            <ThemedText style={styles.goalStatus}>
              {goalReached ? "Goal reached" : "Daily goal"}
            </ThemedText>
            <ThemedText style={styles.goalDetail}>
              {goalProgress.toFixed(1)} / {DAILY_GOAL_MINUTES} min
            </ThemedText>
          </View>
        </ThemedView>

        <ThemedView style={styles.currentBookCard}>
          <View style={styles.coverPlaceholder}>
            <ThemedText style={styles.coverPlaceholderText}>📚</ThemedText>
          </View>
          <View style={styles.currentBookCopy}>
            <ThemedText style={styles.premiumCurrentBookLabel}>
              Currently reading
            </ThemedText>
            <ThemedText style={styles.currentBookTitleText} numberOfLines={2}>
              {currentBookTitle || "No book set"}
            </ThemedText>
          </View>
          <ThemedText style={styles.currentBookChevron}>›</ThemedText>
        </ThemedView>

        {sessionMessage && (
          <ThemedView style={styles.sessionToast}>
            <ThemedText style={styles.sessionToastText}>
              {sessionMessage}
            </ThemedText>
          </ThemedView>
        )}

        <View style={styles.sessionsHeaderRow}>
          <ThemedText style={styles.sessionsTitle}>Recent sessions</ThemedText>
          {recentSessions.length > 3 && (
            <ThemedText style={styles.viewAllText}>View all</ThemedText>
          )}
        </View>

        <ThemedView style={styles.sessionsCard}>
          {recentSessions.length === 0 ? (
            <ThemedText style={styles.emptySessionsText}>
              Finish your first session to start building your reading archive.
            </ThemedText>
          ) : (
            visibleSessions.map((session, index) => (
              <View
                key={session.id}
                style={[
                  styles.sessionRow,
                  index === visibleSessions.length - 1 && styles.lastSessionRow,
                ]}
              >
                <View style={styles.sessionIconCircle}>
                  <ThemedText style={styles.sessionRowIcon}>📖</ThemedText>
                </View>

                <View style={styles.sessionTextContainer}>
                  <ThemedText style={styles.sessionBookTitle}>
                    {session.title}
                  </ThemedText>
                  <ThemedText style={styles.sessionDate}>
                    {formatSessionTimestamp(session.createdAt, session.date)}
                  </ThemedText>
                </View>

                <ThemedText style={styles.sessionMinutes}>
                  {session.minutes}m
                </ThemedText>
              </View>
            ))
          )}
        </ThemedView>

        <ThemedView style={styles.statsRow}>
          <ThemedView style={styles.statCard}>
            <View style={styles.statIconCircle}>
              <ThemedText style={styles.statIcon}>◷</ThemedText>
            </View>
            <ThemedText style={styles.statNumber}>
              {lifetimeMinutes.toFixed(1)}
            </ThemedText>
            <ThemedText style={styles.statLabel}>Minutes Read</ThemedText>
          </ThemedView>

          <ThemedView style={styles.statCard}>
            <View style={styles.statIconCircle}>
              <ThemedText style={styles.statIcon}>▦</ThemedText>
            </View>
            <ThemedText style={styles.statNumber}>{totalDaysRead}</ThemedText>
            <ThemedText style={styles.statLabel}>Days Read</ThemedText>
          </ThemedView>
        </ThemedView>
      </ThemedView>
    </ScrollView>
  );
}

const cardShadow = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.07,
  shadowRadius: 14,
  elevation: 4,
};

const softCardShadow = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.045,
  shadowRadius: 12,
  elevation: 3,
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    position: "relative",
    paddingHorizontal: 24,
    paddingTop: 66,
    paddingBottom: 40,
    gap: 16,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  warmVignetteTop: {
    position: "absolute",
    top: -80,
    left: -80,
    right: -80,
    height: 230,
    borderRadius: 140,
    backgroundColor: "rgba(255,255,255,0.38)",
  },
  warmVignetteBottom: {
    position: "absolute",
    left: -90,
    right: -90,
    bottom: 230,
    height: 260,
    borderRadius: 150,
    backgroundColor: "rgba(224,204,166,0.14)",
  },
  mountainBackdrop: {
    position: "absolute",
    top: 218,
    left: -44,
    right: -44,
    height: 118,
    opacity: 0.14,
    alignItems: "center",
    justifyContent: "flex-end",
    zIndex: 0,
  },
  mountainFarLeft: {
    position: "absolute",
    bottom: -58,
    left: 8,
    width: 190,
    height: 190,
    borderRadius: 44,
    backgroundColor: "rgba(47,93,80,0.39)",
    transform: [{ rotate: "45deg" }, { scaleY: 0.72 }],
  },
  mountainFarCenter: {
    position: "absolute",
    bottom: -70,
    width: 255,
    height: 255,
    borderRadius: 56,
    backgroundColor: "rgba(47,93,80,0.33)",
    transform: [{ rotate: "45deg" }, { scaleY: 0.7 }],
  },
  mountainFarRight: {
    position: "absolute",
    bottom: -62,
    right: -4,
    width: 205,
    height: 205,
    borderRadius: 48,
    backgroundColor: "rgba(47,93,80,0.35)",
    transform: [{ rotate: "45deg" }, { scaleY: 0.72 }],
  },
  paperTexture: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.42,
  },
  grainDot: {
    position: "absolute",
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(47,93,80,0.16)",
  },
  grainDotOne: {
    top: 118,
    left: 42,
  },
  grainDotTwo: {
    top: 232,
    right: 58,
  },
  grainDotThree: {
    top: 390,
    left: 90,
  },
  grainDotFour: {
    top: 520,
    right: 100,
  },
  grainDotFive: {
    top: 680,
    left: 36,
  },
  grainDotSix: {
    top: 760,
    right: 42,
  },
  grainDotSeven: {
    top: 890,
    left: 132,
  },
  grainDotEight: {
    top: 1020,
    right: 148,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  loadingText: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: "transparent",
    marginBottom: 10,
    zIndex: 2,
  },
  appName: {
    fontSize: 42,
    lineHeight: 50,
    fontWeight: "900",
    color: colors.text,
    letterSpacing: -1.4,
  },
  headerSubtitle: {
    fontSize: 16,
    lineHeight: 23,
    color: colors.mutedText,
    marginTop: 6,
  },
  streakPill: {
    backgroundColor: "rgba(255,255,255,0.68)",
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 15,
    marginTop: 9,
    ...cardShadow,
  },
  streakPillText: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    fontWeight: "800",
  },
  startHero: {
    minHeight: 80,
    backgroundColor: "#345F52",
    borderRadius: 23,
    paddingHorizontal: 21,
    justifyContent: "center",
    shadowColor: "#315F52",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.13,
    shadowRadius: 16,
    elevation: 5,
    zIndex: 3,
  },
  startHeroGoalReached: {
    backgroundColor: colors.accentDark,
  },
  startHeroContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "transparent",
  },
  startHeroIcon: {
    fontSize: 22,
    lineHeight: 28,
  },
  startHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  startHeroTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: -0.4,
    flexShrink: 1,
  },
  startHeroSubtitle: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
    fontWeight: "600",
    flexShrink: 1,
  },
  todayCard: {
    backgroundColor: "rgba(255,255,255,0.54)",
    borderRadius: 23,
    paddingVertical: 17,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.055)",
    ...softCardShadow,
    zIndex: 2,
  },
  todayLeftColumn: {
    flex: 1,
    backgroundColor: "transparent",
  },
  todayLabel: {
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(107,114,128,0.78)",
    fontWeight: "800",
    marginBottom: 6,
  },
  todayTime: {
    fontSize: 28,
    lineHeight: 35,
    fontWeight: "750",
    color: "rgba(47,93,80,0.72)",
    letterSpacing: -0.55,
  },
  todayCaption: {
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(107,114,128,0.72)",
    fontWeight: "600",
    marginTop: 2,
  },
  todayDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: "rgba(47,93,80,0.055)",
    marginHorizontal: 17,
  },
  todayRightColumn: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  checkCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(221,235,228,0.58)",
    marginBottom: 8,
  },
  checkText: {
    fontSize: 21,
    lineHeight: 26,
    color: "rgba(47,93,80,0.72)",
    fontWeight: "800",
  },
  goalStatus: {
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(47,93,80,0.7)",
    fontWeight: "750",
    textAlign: "center",
  },
  goalDetail: {
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(31,41,51,0.72)",
    marginTop: 3,
    fontWeight: "500",
    textAlign: "center",
  },
  identityCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    paddingVertical: 20,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    ...cardShadow,
  },
  identityColumn: {
    flex: 1,
    backgroundColor: colors.card,
  },
  identityDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: "#ECECEC",
    marginHorizontal: 16,
  },
  identityTitle: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "900",
    color: colors.text,
  },
  identitySubtext: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.accent,
    fontWeight: "800",
    marginTop: 8,
  },
  identityLabel: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.mutedText,
    fontWeight: "800",
    marginBottom: 6,
  },
  bookTitleText: {
    fontSize: 17,
    lineHeight: 23,
    color: colors.text,
    fontWeight: "900",
  },
  currentBookLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    marginBottom: 7,
  },
  currentBookIcon: {
    fontSize: 16,
    lineHeight: 20,
  },
  premiumCurrentBookLabel: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.mutedText,
    fontWeight: "800",
    marginBottom: 3,
  },
  currentBookTitleText: {
    fontSize: 19,
    lineHeight: 25,
    color: colors.text,
    fontWeight: "900",
    letterSpacing: -0.25,
  },
  ritualCopyBlock: {
    minHeight: 128,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
    marginTop: 16,
    marginBottom: 18,
    zIndex: 2,
  },
  mistLayerBack: {
    position: "absolute",
    left: -40,
    right: -40,
    bottom: 12,
    height: 92,
    borderRadius: 80,
    backgroundColor: "rgba(47,93,80,0.045)",
    transform: [{ scaleX: 1.15 }],
  },
  mistLayerFront: {
    position: "absolute",
    left: -22,
    right: -22,
    bottom: -10,
    height: 86,
    borderRadius: 70,
    backgroundColor: "rgba(47,93,80,0.06)",
    transform: [{ scaleX: 1.08 }],
  },
  treeLine: {
    position: "absolute",
    bottom: 22,
    flexDirection: "row",
    gap: 12,
    opacity: 0.28,
  },
  treePeak: {
    width: 0,
    height: 0,
    borderLeftWidth: 18,
    borderRightWidth: 18,
    borderBottomWidth: 44,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: colors.accent,
  },
  treePeakSmall: {
    width: 0,
    height: 0,
    borderLeftWidth: 14,
    borderRightWidth: 14,
    borderBottomWidth: 34,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: colors.accent,
    marginTop: 10,
  },
  ritualLine: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    textAlign: "center",
    letterSpacing: -0.05,
    zIndex: 2,
  },
  ritualDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 15,
    zIndex: 2,
  },
  ritualDivider: {
    width: 44,
    height: 1,
    backgroundColor: "rgba(47,93,80,0.12)",
  },
  ritualLeaf: {
    color: colors.accent,
    fontSize: 18,
    lineHeight: 22,
    opacity: 0.72,
  },
  currentBookCard: {
    backgroundColor: "rgba(255,255,255,0.62)",
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
    ...softCardShadow,
    zIndex: 2,
  },
  coverPlaceholder: {
    width: 48,
    height: 64,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.12)",
  },
  coverPlaceholderText: {
    fontSize: 23,
    lineHeight: 29,
  },
  currentBookCopy: {
    flex: 1,
    backgroundColor: "transparent",
  },
  currentBookChevron: {
    color: "rgba(31,41,51,0.34)",
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "300",
  },
  sessionToast: {
    backgroundColor: colors.softAccent,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  sessionToastText: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.success,
    fontWeight: "900",
    textAlign: "center",
  },
  bookInputContainer: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 18,
    gap: 12,
    ...cardShadow,
  },
  bookInputLabel: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "800",
    color: colors.text,
  },
  bookInput: {
    backgroundColor: "#F3F4F6",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  bookButtonRow: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.card,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.softAccent,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
  saveBookButton: {
    flex: 1,
    backgroundColor: colors.accent,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
  },
  saveBookButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  sessionsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "transparent",
    marginTop: 6,
    marginBottom: -4,
    zIndex: 2,
  },
  sessionsTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "800",
    color: "rgba(31,41,51,0.78)",
  },
  viewAllText: {
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(47,93,80,0.72)",
    fontWeight: "750",
  },
  sessionsCard: {
    backgroundColor: "rgba(255,255,255,0.68)",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    ...softCardShadow,
  },
  emptySessionsText: {
    color: colors.mutedText,
    fontSize: 15,
    lineHeight: 22,
    padding: 20,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#ECECEC",
    backgroundColor: colors.card,
  },
  lastSessionRow: {
    borderBottomWidth: 0,
  },
  sessionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.softAccent,
    marginRight: 14,
  },
  sessionRowIcon: {
    fontSize: 20,
    lineHeight: 24,
  },
  sessionTextContainer: {
    flex: 1,
    marginRight: 12,
    backgroundColor: colors.card,
  },
  sessionBookTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    color: colors.text,
  },
  sessionDate: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.mutedText,
    marginTop: 3,
    fontWeight: "600",
  },
  sessionMinutes: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    color: colors.accent,
  },
  statsRow: {
    flexDirection: "row",
    gap: 14,
    backgroundColor: "transparent",
    marginTop: 2,
    zIndex: 2,
  },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.58)",
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
  },
  statIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.softAccent,
    marginBottom: 14,
  },
  statIcon: {
    fontSize: 18,
    lineHeight: 22,
    color: colors.accent,
    fontWeight: "900",
  },
  statNumber: {
    fontSize: 23,
    lineHeight: 30,
    fontWeight: "800",
    color: colors.accent,
  },
  statLabel: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.mutedText,
    fontWeight: "600",
    marginTop: 3,
  },
  sessionScreen: {
    flex: 1,
    backgroundColor: "#081C16",
    paddingHorizontal: 30,
    paddingTop: 80,
    paddingBottom: 46,
    overflow: "hidden",
  },
  dimLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#06130F",
    opacity: 0.94,
  },
  quietSessionContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  quietSessionLabel: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  quietTimerText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 42,
    lineHeight: 52,
    fontWeight: "800",
    letterSpacing: -0.8,
    marginTop: 18,
  },
  quietSessionSubtitle: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "600",
    marginTop: 14,
  },
  quietBottomArea: {
    alignItems: "center",
    backgroundColor: "transparent",
  },
  quietEndSessionButton: {
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  quietEndSessionText: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  ritualOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.sessionBackground,
    paddingHorizontal: 30,
    paddingTop: 80,
    paddingBottom: 46,
  },
  sessionGlowOne: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.sessionBackgroundLight,
    opacity: 0.22,
    top: 80,
    right: -130,
  },
  sessionGlowTwo: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.sessionBackgroundLight,
    opacity: 0.14,
    bottom: 110,
    left: -120,
  },
  sessionContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  sessionBookIcon: {
    fontSize: 42,
    lineHeight: 50,
    marginBottom: 22,
  },
  sessionTitle: {
    color: "#FFFFFF",
    fontSize: 26,
    lineHeight: 34,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -0.3,
    maxWidth: 290,
  },
  sessionSubtitle: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 18,
  },
  focusPill: {
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 999,
    marginTop: 48,
  },
  focusPillText: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  closeSessionScreen: {
    flex: 1,
    backgroundColor: colors.sessionBackground,
    paddingHorizontal: 28,
    paddingTop: 76,
    paddingBottom: 40,
    overflow: "hidden",
  },
  closeSessionContent: {
    flexGrow: 1,
    justifyContent: "center",
    backgroundColor: "transparent",
    paddingVertical: 36,
  },
  closeEyebrow: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  closeTitle: {
    color: "#FFFFFF",
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "900",
    letterSpacing: -0.8,
    maxWidth: 330,
  },
  closeMinutes: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 22,
  },
  closeBookInput: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 15,
    fontSize: 20,
    color: "#FFFFFF",
    fontWeight: "600",
  },
  closeHelperText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    marginTop: 14,
    marginBottom: 24,
  },
  closeButtonRow: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "transparent",
  },
  closeSecondaryButton: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: "center",
  },
  closeSecondaryButtonText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "900",
  },
  closeSaveButton: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: "center",
  },
  closeSaveButtonText: {
    color: colors.sessionBackground,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "900",
  },

  currentBookContainer: {
    marginTop: 8,
    alignItems: "center",
    gap: 4,
  },
  currentBookLabel: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.mutedText,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  currentBookTitle: {
    fontSize: 18,
    lineHeight: 24,
    color: colors.text,
    fontWeight: "700",
    fontStyle: "italic",
  },
});
