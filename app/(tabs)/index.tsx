import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  AppStateStatus,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { formatDuration } from "@/utils/formatDuration";

const SECONDS_KEY = "todaysReadingSeconds";
const DATE_KEY = "lastReadDate";
const LIFETIME_SECONDS_KEY = "lifetimeReadingSeconds";
const SESSIONS_KEY = "readingSessions";
const TOTAL_COMPLETED_SESSIONS_KEY = "totalCompletedSessions";
const CURRENT_BOOK_KEY = "currentBookTitle";
const COMPLETED_BOOKS_KEY = "completedBooks";
const HAS_SEEN_WELCOME_KEY = "hasSeenRousdWelcome";
const ACTIVE_SESSION_START_KEY = "activeReadingSessionStartTime";
const ACTIVE_SESSION_TODAY_START_SECONDS_KEY =
  "activeReadingSessionTodayStartSeconds";
const ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY =
  "activeReadingSessionLifetimeStartSeconds";
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
  reflection?: string | null;
  note?: string;
  createdAt?: string;
  source?: "timed" | "logged";
};

type CompletedBookReview = {
  id: string;
  title: string;
  review: string;
  completedAt: string;
  sessionMinutes: string;
  totalBookMinutes?: string;
  sessionCount?: number;
};

type CompletedBookMoment = {
  sessionId: string;
  title: string;
  sessionMinutes: string;
  totalBookMinutes: string;
  sessionCount: number;
};

type Screen =
  | "loading"
  | "welcome"
  | "home"
  | "ritual"
  | "active"
  | "closeTransition"
  | "bookInput"
  | "manualLog"
  | "completedBook"
  | "reveal"
  | "diary"
  | "finishedBooks";

type SanctuaryStage = {
  stage: number;
  title: string;
  subtitle: string;
  shortLabel: string;
};

type SanctuaryReveal = {
  sessionId: string;
  stage: number;
  stageChanged: boolean;
  bookTitle: string;
  title: string;
  subtitle: string;
  sessionMinutes: string;
  ctaText: string;
  source: "timed" | "logged";
};

const sanctuaryStages: SanctuaryStage[] = [
  {
    stage: 0,
    title: "Your place is here.",
    subtitle: "Start a session, then save the book you read.",
    shortLabel: "Reading Place",
  },
  {
    stage: 1,
    title: "The light is on.",
    subtitle: "Your first saved session gave this book a place.",
    shortLabel: "A Quiet Light",
  },
  {
    stage: 2,
    title: "This book is becoming familiar.",
    subtitle: "Your reading place is warming around it.",
    shortLabel: "A Familiar Book",
  },
  {
    stage: 3,
    title: "Your reading rhythm is gathering.",
    subtitle: "Sessions, minutes, and memory are collecting here.",
    shortLabel: "Private Thread",
  },
  {
    stage: 4,
    title: "This place is yours now.",
    subtitle: "Your reading life has a steady light in it.",
    shortLabel: "Steady Light",
  },
];

const readingRitualLines = [
  "The book is waiting.",
  "Take your time.",
  "You're here.",
  "This is enough.",
  "The rest can wait.",
];

const completedBookReflectionPrompts = [
  "What did this book give you?",
  "What will you carry from this?",
  "One line you'll remember.",
  "How did you feel when it ended?",
];

const completedBookSparkPositions = [
  { top: 24, left: 62 },
  { top: 52, right: 48 },
  { top: 126, left: 34 },
  { top: 156, right: 68 },
  { top: 90, left: 92 },
  { top: 18, right: 96 },
];

function getSanctuaryStage(totalSessions: number, totalMinutes: number) {
  if (totalSessions >= 10 || totalMinutes >= 360) return 4;
  if (totalSessions >= 6 || totalMinutes >= 180) return 3;
  if (totalSessions >= 3 || totalMinutes >= 60) return 2;
  if (totalSessions >= 1) return 1;
  return 0;
}

function getSanctuaryRevealCopy(stage: number, stageChanged: boolean) {
  if (!stageChanged) {
    return {
      title: "You returned to this book.",
      subtitle: "A little more time belongs to your reading life now.",
      ctaText: "Return home",
    };
  }

  if (stage === 1) {
    return {
      title: "This book has a place here.",
      subtitle: "Your reading life has a little more shape now.",
      ctaText: "Return home",
    };
  }

  if (stage === 2) {
    return {
      title: "You spent time with this book.",
      subtitle: "A quiet note in the day has been kept.",
      ctaText: "Return home",
    };
  }

  if (stage === 3) {
    return {
      title: "This thread continues.",
      subtitle: "Your reading life has another small marker.",
      ctaText: "Return home",
    };
  }

  return {
    title: "This place is yours now.",
    subtitle: "Your reading life has a steady light in it.",
    ctaText: "Return home",
  };
}

function getTodayDateString() {
  return new Date().toISOString().split("T")[0];
}

function calculateElapsedSeconds(startTime: number) {
  return Math.max(0, Math.floor((Date.now() - startTime) / 1000));
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

function getSessionDateValue(session: ReadingSession) {
  const legacyDate = (session as ReadingSession & { date?: string }).date;
  const sessionTime = session.createdAt ?? legacyDate;
  const timestamp = sessionTime ? new Date(sessionTime).getTime() : Number.NaN;

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDiaryDayHeader(session: ReadingSession) {
  const timestamp = getSessionDateValue(session);
  const sessionDate = timestamp > 0 ? new Date(timestamp) : new Date();
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (sessionDate.toDateString() === today.toDateString()) {
    return "Today";
  }

  if (sessionDate.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return sessionDate.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function getSessionNote(session: ReadingSession): string {
  return (session.reflection ?? session.note ?? "").trim();
}

function getBookReadingStats(title: string, sessions: ReadingSession[]) {
  const normalizedTitle = title.trim().toLowerCase();
  const bookSessions = sessions.filter(
    (session) => session.title.trim().toLowerCase() === normalizedTitle,
  );
  const totalMinutes = bookSessions.reduce(
    (sum, session) => sum + Number(session.minutes || 0),
    0,
  );

  return {
    sessionCount: bookSessions.length,
    totalMinutes,
  };
}

function getBookFirstSessionTimestamp(title: string, sessions: ReadingSession[]) {
  const normalizedTitle = title.trim().toLowerCase();
  const timestamps = sessions
    .filter((session) => session.title.trim().toLowerCase() === normalizedTitle)
    .map(getSessionDateValue)
    .filter((timestamp) => timestamp > 0);

  return timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
}

function getCompletedBookShelfDate(completedAt: string) {
  const timestamp = new Date(completedAt).getTime();

  if (!Number.isFinite(timestamp)) return "Recently";

  if (Date.now() - timestamp <= 5 * 60 * 1000) return "Just now";

  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function getTimeAwareGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour >= 22) return "Good night";
  return "Good evening";
}

function getValidBookTitle(title?: string | null) {
  const trimmedTitle = title?.trim() ?? "";
  return trimmedTitle.length > 0 ? trimmedTitle : null;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [isReading, setIsReading] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [lifetimeSeconds, setLifetimeSeconds] = useState(0);
  const [lastReadDate, setLastReadDate] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [sessionStartSeconds, setSessionStartSeconds] = useState(0);
  const [lifetimeSessionStartSeconds, setLifetimeSessionStartSeconds] =
    useState(0);
  const [activeSessionStartTime, setActiveSessionStartTime] = useState<
    number | null
  >(null);
  const [pendingSessionSeconds, setPendingSessionSeconds] = useState(0);
  const [screen, setScreen] = useState<Screen>("loading");
  const [isLoaded, setIsLoaded] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [currentBookTitle, setCurrentBookTitle] = useState("");
  const [showBookCompletedInput, setShowBookCompletedInput] = useState(false);
  const [completedBookReview, setCompletedBookReview] = useState("");
  const [completedBookMoment, setCompletedBookMoment] =
    useState<CompletedBookMoment | null>(null);
  const [completedBooks, setCompletedBooks] = useState<CompletedBookReview[]>(
    [],
  );
  const [manualLogMinutes, setManualLogMinutes] = useState("30");
  const [manualLogBookTitle, setManualLogBookTitle] = useState("");
  const [manualLogError, setManualLogError] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<ReadingSession[]>([]);
  const [totalCompletedSessions, setTotalCompletedSessions] = useState(0);
  const [sanctuaryReveal, setSanctuaryReveal] =
    useState<SanctuaryReveal | null>(null);
  const [sessionReflection, setSessionReflection] = useState("");
  const [ritualLineText, setRitualLineText] = useState(readingRitualLines[0]);
  const [manualLogNote, setManualLogNote] = useState("");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ritualOpacity = useRef(new Animated.Value(0)).current;
  const ritualScale = useRef(new Animated.Value(0.98)).current;
  const ritualLineOpacity = useRef(new Animated.Value(0)).current;
  const ritualLineTranslateY = useRef(new Animated.Value(8)).current;
  const ritualBreath = useRef(new Animated.Value(0)).current;
  const activeSessionOpacity = useRef(new Animated.Value(0)).current;
  const activeSessionTranslateY = useRef(new Animated.Value(8)).current;
  const closeTransitionOpacity = useRef(new Animated.Value(0)).current;
  const closeTransitionScale = useRef(new Animated.Value(0.97)).current;
  const closeTransitionTranslateY = useRef(new Animated.Value(12)).current;
  const revealOpacity = useRef(new Animated.Value(0)).current;
  const revealScale = useRef(new Animated.Value(0.96)).current;
  const revealTranslateY = useRef(new Animated.Value(18)).current;
  const revealSceneScale = useRef(new Animated.Value(0.98)).current;
  const completedBookPromptIndex = useRef(
    Math.floor(Math.random() * completedBookReflectionPrompts.length),
  ).current;
  const completedBookSparkValues = useRef(
    completedBookSparkPositions.map(() => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    if (screen === "completedBook" && !completedBookMoment) {
      console.warn(
        "Rousd completed-book screen opened without completedBookMoment; returning home.",
      );
      setCompletedBookReview("");
      setCompletedBookMoment(null);
      setSanctuaryReveal(null);
      setScreen("home");
      return;
    }

    if (
      screen === "reveal" &&
      (!sanctuaryReveal || !sanctuaryStages[sanctuaryReveal.stage])
    ) {
      console.warn(
        "Rousd reveal screen opened without a valid sanctuaryReveal; returning home.",
      );
      setSessionReflection("");
      setSanctuaryReveal(null);
      setCompletedBookMoment(null);
      setScreen("home");
    }
  }, [completedBookMoment, sanctuaryReveal, screen]);

  useEffect(() => {
    if (showBookCompletedInput && !getValidBookTitle(bookTitle)) {
      setShowBookCompletedInput(false);
      setCompletedBookReview("");
    }
  }, [bookTitle, showBookCompletedInput]);

  useEffect(() => {
    if (screen !== "ritual") return;

    ritualOpacity.setValue(0);
    ritualScale.setValue(0.98);
    ritualLineOpacity.setValue(0);
    ritualLineTranslateY.setValue(8);
    ritualBreath.setValue(0);
    setRitualLineText(
      readingRitualLines[Math.floor(Math.random() * readingRitualLines.length)],
    );

    const breathAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(ritualBreath, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(ritualBreath, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(ritualOpacity, {
          toValue: 1,
          duration: 560,
          useNativeDriver: true,
        }),
        Animated.timing(ritualScale, {
          toValue: 1,
          duration: 760,
          useNativeDriver: true,
        }),
        Animated.timing(ritualLineOpacity, {
          toValue: 1,
          duration: 720,
          useNativeDriver: true,
        }),
        Animated.timing(ritualLineTranslateY, {
          toValue: 0,
          duration: 720,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(1650),
      Animated.parallel([
        Animated.timing(ritualOpacity, {
          toValue: 0,
          duration: 520,
          useNativeDriver: true,
        }),
        Animated.timing(ritualLineOpacity, {
          toValue: 0,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    ]);

    breathAnimation.start();

    animation.start(({ finished }) => {
      if (finished) {
        setScreen("active");
      }
    });

    return () => {
      animation.stop();
      breathAnimation.stop();
    };
  }, [
    ritualBreath,
    ritualLineOpacity,
    ritualLineTranslateY,
    ritualOpacity,
    ritualScale,
    screen,
  ]);

  useEffect(() => {
    if (screen !== "active") return;

    activeSessionOpacity.setValue(0);
    activeSessionTranslateY.setValue(8);

    Animated.parallel([
      Animated.timing(activeSessionOpacity, {
        toValue: 1,
        duration: 520,
        useNativeDriver: true,
      }),
      Animated.timing(activeSessionTranslateY, {
        toValue: 0,
        duration: 620,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    activeSessionOpacity,
    activeSessionTranslateY,
    screen,
  ]);

  useEffect(() => {
    if (screen !== "closeTransition") return;

    closeTransitionOpacity.setValue(0);
    closeTransitionScale.setValue(0.97);
    closeTransitionTranslateY.setValue(12);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(closeTransitionOpacity, {
          toValue: 1,
          duration: 520,
          useNativeDriver: true,
        }),
        Animated.timing(closeTransitionScale, {
          toValue: 1,
          duration: 620,
          useNativeDriver: true,
        }),
        Animated.timing(closeTransitionTranslateY, {
          toValue: 0,
          duration: 620,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(1550),
      Animated.timing(closeTransitionOpacity, {
        toValue: 0,
        duration: 420,
        useNativeDriver: true,
      }),
    ]);

    animation.start(({ finished }) => {
      if (finished) {
        setScreen("bookInput");
      }
    });

    return () => {
      animation.stop();
    };
  }, [
    closeTransitionOpacity,
    closeTransitionScale,
    closeTransitionTranslateY,
    screen,
  ]);

  useEffect(() => {
    if (screen !== "reveal" || !sanctuaryReveal) return;

    revealOpacity.setValue(0);
    revealScale.setValue(0.96);
    revealTranslateY.setValue(18);
    revealSceneScale.setValue(0.98);

    if (sanctuaryReveal.stageChanged) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    Animated.parallel([
      Animated.timing(revealOpacity, {
        toValue: 1,
        duration: 620,
        useNativeDriver: true,
      }),
      Animated.timing(revealScale, {
        toValue: 1,
        duration: 720,
        useNativeDriver: true,
      }),
      Animated.timing(revealTranslateY, {
        toValue: 0,
        duration: 720,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(revealSceneScale, {
          toValue: 1.015,
          duration: 560,
          useNativeDriver: true,
        }),
        Animated.timing(revealSceneScale, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [
    revealOpacity,
    revealScale,
    revealSceneScale,
    revealTranslateY,
    sanctuaryReveal,
    screen,
  ]);

  useEffect(() => {
    if (screen !== "completedBook" || !completedBookMoment) return;

    const animations = completedBookSparkValues.map((sparkValue, index) => {
      sparkValue.setValue(0);

      const animation = Animated.loop(
        Animated.sequence([
          Animated.delay(index * 400),
          Animated.timing(sparkValue, {
            toValue: 1,
            duration: 1600,
            useNativeDriver: true,
          }),
          Animated.timing(sparkValue, {
            toValue: 0,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
      );

      animation.start();
      return animation;
    });

    return () => {
      animations.forEach((animation) => animation.stop());
    };
  }, [completedBookMoment, completedBookSparkValues, screen]);

  useEffect(() => {
    const loadSavedData = async () => {
      let nextScreen: Screen = "home";

      try {
        const savedSeconds = await AsyncStorage.getItem(SECONDS_KEY);
        const savedDate = await AsyncStorage.getItem(DATE_KEY);
        const savedLifetimeSeconds =
          await AsyncStorage.getItem(LIFETIME_SECONDS_KEY);
        const savedSessions = await AsyncStorage.getItem(SESSIONS_KEY);
        const savedTotalCompletedSessions = await AsyncStorage.getItem(
          TOTAL_COMPLETED_SESSIONS_KEY,
        );
        const savedCompletedBooks = await AsyncStorage.getItem(
          COMPLETED_BOOKS_KEY,
        );
        const savedCurrentBook = await AsyncStorage.getItem(CURRENT_BOOK_KEY);
        const savedHasSeenWelcome = await AsyncStorage.getItem(HAS_SEEN_WELCOME_KEY);
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
        setLifetimeSeconds(savedLifetimeTotalSeconds);
        if (savedSessions !== null) {
          const parsedSessions: ReadingSession[] = JSON.parse(savedSessions);
          let shouldPersistMigratedSessions = false;
          const migratedSessions = parsedSessions.map((session) => {
            if (session.note && !session.reflection) {
              shouldPersistMigratedSessions = true;
              return { ...session, reflection: session.note };
            }

            return session;
          });

          setRecentSessions(migratedSessions);

          if (shouldPersistMigratedSessions) {
            await AsyncStorage.setItem(
              SESSIONS_KEY,
              JSON.stringify(migratedSessions),
            );
          }

          if (savedTotalCompletedSessions !== null) {
            setTotalCompletedSessions(Number(savedTotalCompletedSessions));
          } else {
            setTotalCompletedSessions(migratedSessions.length);
          }
        } else if (savedTotalCompletedSessions !== null) {
          setTotalCompletedSessions(Number(savedTotalCompletedSessions));
        }

        if (savedCompletedBooks !== null) {
          const parsedCompletedBooks: CompletedBookReview[] =
            JSON.parse(savedCompletedBooks);
          setCompletedBooks(
            [...parsedCompletedBooks].sort(
              (first, second) =>
                new Date(second.completedAt).getTime() -
                new Date(first.completedAt).getTime(),
            ),
          );
        }

        if (savedHasSeenWelcome !== "true" && savedActiveSessionStartTime === null) {
          nextScreen = "welcome";
        }

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
            nextScreen = "active";
          }
        }

        if (savedCurrentBook !== null) {
          setCurrentBookTitle(savedCurrentBook);
          setBookTitle(savedCurrentBook);
        }
      } catch (error) {
        console.log("Failed to load Rousd data:", error);
      } finally {
        setScreen(nextScreen);
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

  const persistTodayDateIfNeeded = async () => {
    const today = getTodayDateString();

    if (lastReadDate === today) return;

    setLastReadDate(today);

    await AsyncStorage.setItem(DATE_KEY, today);
  };

  const handlePress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (!isReading) {
      await persistTodayDateIfNeeded();

      const now = Date.now();

      setSessionStartSeconds(seconds);
      setLifetimeSessionStartSeconds(lifetimeSeconds);
      setActiveSessionStartTime(now);
      setPendingSessionSeconds(0);
      setSessionMessage(null);
      setSanctuaryReveal(null);
      setCompletedBookMoment(null);
      setSessionReflection("");
      setBookTitle(currentBookTitle);
      setShowBookCompletedInput(false);
      setCompletedBookReview("");
      setIsReading(true);
      setScreen("ritual");

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
      const sessionDuration = formatDuration(sessionSeconds / 60);

      setSeconds(updatedTodaySeconds);
      setLifetimeSeconds(updatedLifetimeSeconds);
      setPendingSessionSeconds(sessionSeconds);
      setBookTitle(currentBookTitle);
      setSessionMessage(`+${sessionDuration} added`);
      setIsReading(false);
      setActiveSessionStartTime(null);
      setScreen("closeTransition");

      await AsyncStorage.multiSet([
        [SECONDS_KEY, String(updatedTodaySeconds)],
        [LIFETIME_SECONDS_KEY, String(updatedLifetimeSeconds)],
      ]);
      await AsyncStorage.multiRemove([
        ACTIVE_SESSION_START_KEY,
        ACTIVE_SESSION_TODAY_START_SECONDS_KEY,
        ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY,
      ]);
    }
  };

  const saveSession = async (title: string) => {
    const sessionSeconds = pendingSessionSeconds;
    const sessionMinutes = (sessionSeconds / 60).toFixed(1);
    const sessionDuration = formatDuration(sessionSeconds / 60);

    const newSession: ReadingSession = {
      id: Date.now().toString(),
      title,
      minutes: sessionMinutes,
      createdAt: new Date().toISOString(),
      source: "timed",
    };

    const updatedSessions = [newSession, ...recentSessions];

    const updatedTotalCompletedSessions = totalCompletedSessions + 1;
    const previousLifetimeMinutes = Math.max(
      0,
      (lifetimeSeconds - sessionSeconds) / 60,
    );
    const updatedLifetimeMinutes = lifetimeSeconds / 60;
    const previousSanctuaryStageNumber = getSanctuaryStage(
      totalCompletedSessions,
      previousLifetimeMinutes,
    );
    const updatedSanctuaryStageNumber = getSanctuaryStage(
      updatedTotalCompletedSessions,
      updatedLifetimeMinutes,
    );
    const didSanctuaryStageChange =
      updatedSanctuaryStageNumber > previousSanctuaryStageNumber;
    const revealCopy = getSanctuaryRevealCopy(
      updatedSanctuaryStageNumber,
      didSanctuaryStageChange,
    );

    setRecentSessions(updatedSessions);
    setTotalCompletedSessions(updatedTotalCompletedSessions);

    await AsyncStorage.multiSet([
      [SESSIONS_KEY, JSON.stringify(updatedSessions)],
      [
        TOTAL_COMPLETED_SESSIONS_KEY,
        String(updatedTotalCompletedSessions),
      ],
    ]);

    setSanctuaryReveal({
      sessionId: newSession.id,
      stage: updatedSanctuaryStageNumber,
      stageChanged: didSanctuaryStageChange,
      bookTitle: title,
      title: revealCopy.title,
      subtitle: revealCopy.subtitle,
      sessionMinutes: sessionDuration,
      ctaText: revealCopy.ctaText,
      source: "timed",
    });

    return {
      sessionId: newSession.id,
      sessionMinutes,
      updatedSessions,
    };
  };

  const saveBookForSession = async () => {
    const validBookTitle = getValidBookTitle(bookTitle);
    const titleToSave = validBookTitle || "Unassigned reading";
    const shouldCompleteBook = showBookCompletedInput && Boolean(validBookTitle);

    const savedSession = await saveSession(titleToSave);

    if (showBookCompletedInput && !validBookTitle) {
      console.warn(
        "Rousd skipped completed-book save because no valid book title was entered.",
      );
      setCompletedBookReview("");
    }

    if (shouldCompleteBook) {
      const bookStats = getBookReadingStats(
        titleToSave,
        savedSession.updatedSessions,
      );

      setCompletedBookMoment({
        sessionId: savedSession.sessionId,
        title: titleToSave,
        sessionMinutes: savedSession.sessionMinutes,
        totalBookMinutes: bookStats.totalMinutes.toFixed(1),
        sessionCount: bookStats.sessionCount,
      });
      setSanctuaryReveal(null);
    }

    if (validBookTitle) {
      setCurrentBookTitle(validBookTitle);
      await AsyncStorage.setItem(CURRENT_BOOK_KEY, validBookTitle);
    }

    if (validBookTitle) {
      setSessionMessage(`+${formatDuration(Number(savedSession.sessionMinutes))} • ${validBookTitle}`);
    } else {
      setSessionMessage(`+${formatDuration(Number(savedSession.sessionMinutes))} added`);
    }

    setShowBookCompletedInput(false);
    setScreen(shouldCompleteBook ? "completedBook" : "reveal");

    setTimeout(() => {
      setSessionMessage(null);
    }, 4000);
  };

  const skipBookForSession = async () => {
    const savedSession = await saveSession("Unassigned reading");

    setSessionMessage(`+${formatDuration(Number(savedSession.sessionMinutes))} added`);
    setShowBookCompletedInput(false);
    setCompletedBookReview("");
    setScreen("reveal");

    setTimeout(() => {
      setSessionMessage(null);
    }, 3000);
  };

  const saveCompletedBookReview = async (
    title: string,
    sessionMinutes: string,
    totalBookMinutes: string,
    sessionCount: number,
    sessionId: string,
    reviewOverride = completedBookReview,
  ) => {
    const trimmedReview = reviewOverride.trim();
    const savedCompletedBooks = await AsyncStorage.getItem(COMPLETED_BOOKS_KEY);
    const storedCompletedBooks: CompletedBookReview[] = savedCompletedBooks
      ? JSON.parse(savedCompletedBooks)
      : [];

    const completedBook: CompletedBookReview = {
      id: Date.now().toString(),
      title,
      review: trimmedReview,
      completedAt: new Date().toISOString(),
      sessionMinutes,
      totalBookMinutes,
      sessionCount,
    };

    const updatedSessions = recentSessions.map((session) =>
      session.id === sessionId && trimmedReview
        ? { ...session, reflection: trimmedReview }
        : session,
    );

    if (trimmedReview) {
      setRecentSessions(updatedSessions);
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updatedSessions));
    }

    const updatedCompletedBooks = [completedBook, ...storedCompletedBooks];

    setCompletedBooks(updatedCompletedBooks);
    await AsyncStorage.setItem(
      COMPLETED_BOOKS_KEY,
      JSON.stringify(updatedCompletedBooks),
    );
  };

  const finishCompletedBookMoment = async (reviewOverride?: string) => {
    if (!completedBookMoment) return;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await saveCompletedBookReview(
      completedBookMoment.title,
      completedBookMoment.sessionMinutes,
      completedBookMoment.totalBookMinutes,
      completedBookMoment.sessionCount,
      completedBookMoment.sessionId,
      reviewOverride ?? completedBookReview,
    );

    setCompletedBookReview("");
    setCompletedBookMoment(null);
    setSanctuaryReveal(null);
  };

  const openManualLog = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setManualLogMinutes("30");
    setManualLogBookTitle(currentBookTitle);
    setManualLogNote("");
    setManualLogError(null);
    setSanctuaryReveal(null);
    setCompletedBookMoment(null);
    setSessionMessage(null);
    setScreen("manualLog");
  };

  const cancelManualLog = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setManualLogNote("");
    setManualLogError(null);
    setScreen("home");
  };

  const saveManualReadingLog = async () => {
    const normalizedMinutes = manualLogMinutes.replace(",", ".").trim();
    const minutesNumber = Number(normalizedMinutes);

    if (!Number.isFinite(minutesNumber) || minutesNumber <= 0) {
      setManualLogError("Enter a reading time greater than 0 minutes.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    const cappedMinutes = Math.min(minutesNumber, 720);
    const manualSessionSeconds = Math.round(cappedMinutes * 60);
    const sessionMinutes = (manualSessionSeconds / 60).toFixed(1);
    const sessionDuration = formatDuration(manualSessionSeconds / 60);
    const trimmedTitle = manualLogBookTitle.trim();
    const trimmedNote = manualLogNote.trim();
    const titleToSave = trimmedTitle || "Logged reading";
    const previousLifetimeSeconds = lifetimeSeconds;
    const updatedTodaySeconds = seconds + manualSessionSeconds;
    const updatedLifetimeSeconds = lifetimeSeconds + manualSessionSeconds;

    await persistTodayDateIfNeeded();

    const newSession: ReadingSession = {
      id: Date.now().toString(),
      title: titleToSave,
      minutes: sessionMinutes,
      reflection: trimmedNote || null,
      createdAt: new Date().toISOString(),
      source: "logged",
    };

    const updatedSessions = [newSession, ...recentSessions];
    const updatedTotalCompletedSessions = totalCompletedSessions + 1;
    const previousSanctuaryStageNumber = getSanctuaryStage(
      totalCompletedSessions,
      previousLifetimeSeconds / 60,
    );
    const updatedSanctuaryStageNumber = getSanctuaryStage(
      updatedTotalCompletedSessions,
      updatedLifetimeSeconds / 60,
    );
    const didSanctuaryStageChange =
      updatedSanctuaryStageNumber > previousSanctuaryStageNumber;
    const revealCopy = getSanctuaryRevealCopy(
      updatedSanctuaryStageNumber,
      didSanctuaryStageChange,
    );

    setSeconds(updatedTodaySeconds);
    setLifetimeSeconds(updatedLifetimeSeconds);
    setRecentSessions(updatedSessions);
    setTotalCompletedSessions(updatedTotalCompletedSessions);
    setSanctuaryReveal({
      sessionId: newSession.id,
      stage: updatedSanctuaryStageNumber,
      stageChanged: didSanctuaryStageChange,
      bookTitle: titleToSave,
      title: revealCopy.title,
      subtitle: revealCopy.subtitle,
      sessionMinutes: sessionDuration,
      ctaText: revealCopy.ctaText,
      source: "logged",
    });
    setManualLogNote("");
    setSessionReflection("");
    setManualLogError(null);
    setScreen("reveal");

    if (trimmedTitle) {
      setCurrentBookTitle(trimmedTitle);
      await AsyncStorage.setItem(CURRENT_BOOK_KEY, trimmedTitle);
    }

    await AsyncStorage.multiSet([
      [SECONDS_KEY, String(updatedTodaySeconds)],
      [LIFETIME_SECONDS_KEY, String(updatedLifetimeSeconds)],
      [SESSIONS_KEY, JSON.stringify(updatedSessions)],
      [
        TOTAL_COMPLETED_SESSIONS_KEY,
        String(updatedTotalCompletedSessions),
      ],
    ]);

    setSessionMessage(`+${sessionDuration} • logged`);

    setTimeout(() => {
      setSessionMessage(null);
    }, 3500);
  };

  const saveSessionReflection = async () => {
    if (!sanctuaryReveal) return;

    const trimmedReflection = sessionReflection.trim();
    if (!trimmedReflection) return;

    const updatedSessions = recentSessions.map((session) =>
      session.id === sanctuaryReveal.sessionId
        ? { ...session, reflection: trimmedReflection }
        : session,
    );

    setRecentSessions(updatedSessions);
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updatedSessions));
  };

  const dismissSanctuaryReveal = async (options?: { saveReflection?: boolean }) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (options?.saveReflection) {
      await saveSessionReflection();
    }

    setScreen("home");
    setSessionReflection("");
    setSanctuaryReveal(null);
  };

  const dismissWelcomeScreen = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await AsyncStorage.setItem(HAS_SEEN_WELCOME_KEY, "true");
    setScreen("home");
  };

  const visibleSessions = recentSessions.slice(0, 3);
  const latestSession = recentSessions[0];
  const hasPlacedBook = Boolean(currentBookTitle || latestSession);
  const currentBookDisplayTitle =
    currentBookTitle || latestSession?.title || "Your next book";
  const currentBookMeta = currentBookTitle
    ? latestSession?.title === currentBookTitle
      ? `Last read ${formatSessionTimestamp(latestSession.createdAt)}`
      : "Saved as your current book"
    : "Save a session to place a book here";
  const readingPlaceContinuityCopy = hasPlacedBook
    ? "Your book is waiting."
    : "Your first book can live here.";
  const revealBookTitle =
    sanctuaryReveal?.bookTitle ||
    bookTitle.trim() ||
    manualLogBookTitle.trim() ||
    currentBookTitle ||
    latestSession?.title ||
    "your book";
  const timeAwareGreeting = getTimeAwareGreeting();
  const diarySessions = [...recentSessions].sort(
    (first, second) => getSessionDateValue(second) - getSessionDateValue(first),
  );

  const ritualBreathScale = ritualBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const ritualBreathOpacity = ritualBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.16, 0.34],
  });

  switch (screen) {
    case "loading":
      return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText style={styles.loadingWordmark}>Rousd</ThemedText>
      </ThemedView>
    );

    case "welcome":
      return (
      <ThemedView
        style={[styles.welcomeScreen, { paddingTop: insets.top + 28 }]}
      >
        <View pointerEvents="none" style={styles.welcomeGlowTop} />
        <View pointerEvents="none" style={styles.welcomeGlowBottom} />

        <View style={styles.welcomeCard}>
          <View style={styles.welcomeSanctuaryPreview}>
            <View style={styles.welcomeWindowGlow} />
            <View style={styles.welcomeWindowFrame} />
            <View style={styles.welcomeWindowDivider} />
            <View style={styles.welcomeFloor} />
            <View style={styles.welcomeChair} />
            <View style={styles.welcomeBookStack}>
              <View style={styles.welcomeBookOne} />
              <View style={styles.welcomeBookTwo} />
              <View style={styles.welcomeBookThree} />
            </View>
            <View style={styles.welcomePlantPot} />
            <View style={[styles.welcomeLeaf, styles.welcomeLeafOne]} />
            <View style={[styles.welcomeLeaf, styles.welcomeLeafTwo]} />
          </View>

          <ThemedText style={styles.welcomeEyebrow}>Welcome to Rousd</ThemedText>
          <ThemedText style={styles.welcomeTitle}>
            Keep a light on for your reading life.
          </ThemedText>
          <ThemedText style={styles.welcomeBody}>
            Start a session, open your book or e-reader, then put your phone down. Rousd keeps time and helps you save the session to the book you read.
          </ThemedText>

          <View style={styles.welcomeStepsCard}>
            <View style={styles.welcomeStepRow}>
              <ThemedText style={styles.welcomeStepNumber}>1</ThemedText>
              <ThemedText style={styles.welcomeStepText}>Start a reading session</ThemedText>
            </View>
            <View style={styles.welcomeStepRow}>
              <ThemedText style={styles.welcomeStepNumber}>2</ThemedText>
              <ThemedText style={styles.welcomeStepText}>Read your book or e-reader</ThemedText>
            </View>
            <View style={styles.welcomeStepRow}>
              <ThemedText style={styles.welcomeStepNumber}>3</ThemedText>
              <ThemedText style={styles.welcomeStepText}>Return and save the book you read</ThemedText>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.welcomeButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={dismissWelcomeScreen}
          >
            <ThemedText style={styles.welcomeButtonText}>Enter your reading place</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  

    case "closeTransition": {
      const pendingDuration = formatDuration(pendingSessionSeconds / 60);

      return (
      <ThemedView
        style={[
          styles.closeTransitionScreen,
          { paddingTop: insets.top + 36 },
        ]}
      >
        <View style={styles.sessionGlowOne} />
        <View style={styles.sessionGlowTwo} />

        <Animated.View
          style={[
            styles.closeTransitionContent,
            {
              opacity: closeTransitionOpacity,
              transform: [
                { translateY: closeTransitionTranslateY },
                { scale: closeTransitionScale },
              ],
            },
          ]}
        >
          <ThemedText style={styles.closeTransitionEyebrow}>
            Welcome back.
          </ThemedText>
          <ThemedText style={styles.closeTransitionTitle}>
            Your time was kept.
          </ThemedText>
          <ThemedText style={styles.closeTransitionMinutes}>
            +{pendingDuration} read
          </ThemedText>
          <ThemedText style={styles.closeTransitionSubtext}>
            {"Take a breath. Then we'll save this time to the book you read."}
          </ThemedText>
        </Animated.View>
      </ThemedView>
    );
    }

    case "ritual":
      return (
      <ThemedView
        style={[
          styles.ritualTransitionScreen,
          { paddingTop: insets.top + 36 },
        ]}
      >
        <View style={styles.sessionGlowOne} />
        <View style={styles.sessionGlowTwo} />

        <Animated.View
          style={[
            styles.sessionContent,
            { opacity: ritualOpacity, transform: [{ scale: ritualScale }] },
          ]}
        >
          <View style={styles.beaconMark}>
            <View style={styles.beaconBeam} />
            <View style={styles.sessionQuietDot} />
          </View>
          <View style={styles.ritualLineArea}>
            <Animated.View
              style={[
                styles.ritualBreathRing,
                {
                  opacity: ritualBreathOpacity,
                  transform: [{ scale: ritualBreathScale }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.ritualLineWrap,
                {
                  opacity: ritualLineOpacity,
                  transform: [{ translateY: ritualLineTranslateY }],
                },
              ]}
            >
              <ThemedText style={styles.ritualLineText}>
                {ritualLineText}
              </ThemedText>
            </Animated.View>
          </View>
        </Animated.View>
      </ThemedView>
    );

    case "active":
      return (
      <ThemedView
        style={[styles.sessionScreen, { paddingTop: insets.top + 36 }]}
      >
        <View style={styles.dimLayer} />

        <Animated.View
          style={[
            styles.quietSessionContent,
            {
              opacity: activeSessionOpacity,
              transform: [{ translateY: activeSessionTranslateY }],
            },
          ]}
        >
          <View style={styles.activeBeaconBadge}>
            <View style={styles.activeBeaconDot} />
          </View>
          <ThemedText style={styles.quietSessionEyebrow}>
            Reading session
          </ThemedText>
          <ThemedText style={styles.quietSessionTitle}>
            Your time is being kept.
          </ThemedText>
          <ThemedText style={styles.quietSessionSubtitle}>
            {"Return when you're ready."}
          </ThemedText>
        </Animated.View>

        <Animated.View
          style={[
            styles.quietBottomArea,
            {
              opacity: activeSessionOpacity,
              transform: [{ translateY: activeSessionTranslateY }],
            },
          ]}
        >
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
        </Animated.View>
      </ThemedView>
    );
  

    case "bookInput": {
      const pendingDuration = formatDuration(pendingSessionSeconds / 60);
      const canCompleteBook = Boolean(getValidBookTitle(bookTitle));

      return (
      <ThemedView
        style={[styles.bookReturnScreen, { paddingTop: insets.top + 32 }]}
      >
        <View pointerEvents="none" style={styles.bookReturnGlowTop} />
        <View pointerEvents="none" style={styles.bookReturnGlowBottom} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[
            styles.bookReturnContent,
            { paddingBottom: insets.bottom + 80 },
          ]}
        >
          <ThemedText style={styles.bookReturnEyebrow}>Welcome back</ThemedText>
          <ThemedText style={styles.bookReturnTitle}>
            What did you read?
          </ThemedText>
          <ThemedText style={styles.bookReturnMinutes}>
            Your time was kept • {pendingDuration}
          </ThemedText>

          <View style={styles.bookAttributionCard}>
            <View style={styles.bookAttributionCover}>
              <ThemedText style={styles.bookAttributionCoverText}>R</ThemedText>
            </View>
            <View style={styles.bookAttributionCopy}>
              <ThemedText style={styles.bookAttributionLabel}>Save this session to</ThemedText>
              <TextInput
                placeholder="Book title"
                placeholderTextColor="rgba(31,41,51,0.38)"
                value={bookTitle}
                onChangeText={setBookTitle}
                style={styles.bookAttributionInput}
                returnKeyType="done"
                onSubmitEditing={saveBookForSession}
              />
            </View>
          </View>

          {visibleSessions.length > 0 && (
            <View style={styles.recentBookPicker}>
              <ThemedText style={styles.recentBookPickerTitle}>Recent books</ThemedText>
              {visibleSessions.map((session) => (
                <Pressable
                  key={session.id}
                  style={({ pressed }) => [
                    styles.recentBookChoice,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => setBookTitle(session.title)}
                >
                  <View style={styles.recentBookMiniCover}>
                    <ThemedText style={styles.recentBookMiniCoverText}>R</ThemedText>
                  </View>
                  <View style={styles.recentBookChoiceCopy}>
                    <ThemedText style={styles.recentBookChoiceTitle} numberOfLines={1}>
                      {session.title}
                    </ThemedText>
                    <ThemedText style={styles.recentBookChoiceMeta}>
                      Last saved • {formatDuration(Number(session.minutes))}
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.bookCompletedCard}>
            <Pressable
              style={({ pressed }) => [
                styles.bookCompletedToggle,
                showBookCompletedInput && styles.bookCompletedToggleSelected,
                !canCompleteBook && { opacity: 0.4 },
                pressed && styles.buttonPressed,
              ]}
              disabled={!canCompleteBook}
              onPress={() => {
                setShowBookCompletedInput((value) => !value);
                if (showBookCompletedInput) {
                  setCompletedBookReview("");
                }
              }}
            >
              <View style={styles.bookCompletedToggleCopy}>
                <ThemedText style={styles.bookCompletedLabel}>
                  Finished this book?
                </ThemedText>
                <ThemedText style={styles.bookCompletedSubtext}>
                  Mark it complete — a quiet moment awaits.
                </ThemedText>
              </View>
              <View
                style={[
                  styles.bookCompletedSwitchTrack,
                  showBookCompletedInput &&
                    styles.bookCompletedSwitchTrackSelected,
                ]}
              >
                <View
                  style={[
                    styles.bookCompletedSwitchKnob,
                    showBookCompletedInput &&
                      styles.bookCompletedSwitchKnobSelected,
                  ]}
                />
              </View>
            </Pressable>
            {!canCompleteBook ? (
              <ThemedText style={styles.bookCompletedDisabledHelper}>
                Name the book first, then you can mark it finished.
              </ThemedText>
            ) : null}
          </View>

          <View style={styles.closeButtonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.bookReturnSecondaryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={skipBookForSession}
            >
              <ThemedText style={styles.bookReturnSecondaryButtonText}>
                Not this time
              </ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.bookReturnSaveButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={saveBookForSession}
            >
              <ThemedText style={styles.bookReturnSaveButtonText}>
                Save to book
              </ThemedText>
            </Pressable>
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </ThemedView>
    );
    }

    case "manualLog": {
      const presetMinutes = ["10", "20", "30", "45", "60"];

      return (
      <ThemedView
        style={[styles.closeSessionScreen, { paddingTop: insets.top + 32 }]}
      >
        <View style={styles.sessionGlowOne} />
        <View style={styles.sessionGlowTwo} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.closeSessionContent,
            { paddingBottom: insets.bottom + 80 },
          ]}
        >
          <ThemedText style={styles.closeEyebrow}>Manual log</ThemedText>
          <ThemedText style={styles.closeTitle}>What did the time hold?</ThemedText>
          <ThemedText style={styles.closeMinutes}>
            Capture a reading moment, with or without the timer.
          </ThemedText>

          <View style={styles.manualPresetRow}>
            {presetMinutes.map((minutes) => {
              const isSelected = manualLogMinutes === minutes;

              return (
                <Pressable
                  key={minutes}
                  style={({ pressed }) => [
                    styles.manualPresetChip,
                    isSelected && styles.manualPresetChipSelected,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => {
                    setManualLogMinutes(minutes);
                    setManualLogError(null);
                  }}
                >
                  <ThemedText
                    style={[
                      styles.manualPresetChipText,
                      isSelected && styles.manualPresetChipTextSelected,
                    ]}
                  >
                    {formatDuration(Number(minutes))}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            placeholder="Minutes read"
            placeholderTextColor="rgba(255,255,255,0.45)"
            value={manualLogMinutes}
            onChangeText={(value) => {
              setManualLogMinutes(value);
              setManualLogError(null);
            }}
            style={styles.closeBookInput}
            keyboardType="decimal-pad"
            returnKeyType="next"
          />

          <TextInput
            placeholder="Book title"
            placeholderTextColor="rgba(255,255,255,0.45)"
            value={manualLogBookTitle}
            onChangeText={setManualLogBookTitle}
            style={[styles.closeBookInput, styles.manualBookInput]}
            returnKeyType="next"
          />

          <TextInput
            placeholder="Optional note or reflection"
            placeholderTextColor="rgba(255,255,255,0.45)"
            value={manualLogNote}
            onChangeText={setManualLogNote}
            style={[styles.closeBookInput, styles.manualBookInput, styles.manualNoteInput]}
            multiline
            textAlignVertical="top"
          />

          {manualLogError && (
            <ThemedText style={styles.manualLogError}>
              {manualLogError}
            </ThemedText>
          )}

          <ThemedText style={styles.closeHelperText}>
            Capture reading time away from the timer. It will be marked as a logged session in your history.
          </ThemedText>

          <View style={styles.closeButtonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.closeSecondaryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={cancelManualLog}
            >
              <ThemedText style={styles.closeSecondaryButtonText}>
                Cancel
              </ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.closeSaveButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={saveManualReadingLog}
            >
              <ThemedText style={styles.closeSaveButtonText}>
                Log reading
              </ThemedText>
            </Pressable>
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </ThemedView>
    );
    }

    case "completedBook": {
      if (!completedBookMoment) {
        return (
          <ThemedView style={styles.loadingContainer}>
            <ThemedText style={styles.loadingText}>Returning home...</ThemedText>
          </ThemedView>
        );
      }

      const firstSessionTimestamp = getBookFirstSessionTimestamp(
        completedBookMoment.title,
        recentSessions,
      );
      const daysCount = Math.max(
        1,
        Math.round(
          (Date.now() - firstSessionTimestamp) / (1000 * 60 * 60 * 24),
        ),
      );
      const reflectionPrompt =
        completedBookReflectionPrompts[completedBookPromptIndex];
      const completedBookDaysLine =
        daysCount === 1
          ? "You read it today."
          : `You read it across ${daysCount} days.`;
      const completedBookSessionLabel =
        completedBookMoment.sessionCount === 1 ? "SESSION" : "SESSIONS";

      return (
      <ThemedView style={styles.completedBookScreen}>
        <KeyboardAvoidingView
          style={styles.completedBookKeyboardView}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={[
                styles.completedBookRevealContent,
                {
                  paddingTop: insets.top + 30,
                  paddingBottom: insets.bottom + 96,
                },
              ]}
            >
          <ThemedText style={styles.completedBookEyebrow}>FINISHED</ThemedText>

          <View style={styles.completedBookCoverStage}>
            <View style={styles.completedBookAmbientGlow} />
            {completedBookSparkValues.map((sparkValue, index) => (
              <Animated.View
                key={completedBookSparkPositions[index].top}
                pointerEvents="none"
                style={[
                  styles.completedBookSpark,
                  completedBookSparkPositions[index],
                  {
                    opacity: sparkValue.interpolate({
                      inputRange: [0, 0.55, 1],
                      outputRange: [0, 0.5, 0],
                    }),
                    transform: [
                      {
                        translateY: sparkValue.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, -30],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ))}
            <View style={styles.completedBookCover}>
              <ThemedText style={styles.completedBookCoverTitle} numberOfLines={5}>
                {completedBookMoment.title}
              </ThemedText>
            </View>
          </View>

          <ThemedText style={styles.completedBookTitle} numberOfLines={3}>
            {completedBookMoment.title}
          </ThemedText>

          <View style={styles.completedBookStatsRow}>
            <View style={styles.completedBookStat}>
              <ThemedText style={styles.completedBookStatValue}>
                {completedBookMoment.sessionCount}
              </ThemedText>
              <ThemedText style={styles.completedBookStatLabel}>
                {completedBookSessionLabel}
              </ThemedText>
            </View>
            <View style={styles.completedBookStatDivider} />
            <View style={styles.completedBookStat}>
              <ThemedText style={styles.completedBookStatValue}>
                {formatDuration(Number(completedBookMoment.totalBookMinutes))}
              </ThemedText>
              <ThemedText style={styles.completedBookStatLabel}>
                TIME SPENT
              </ThemedText>
            </View>
            <View style={styles.completedBookStatDivider} />
            <View style={styles.completedBookStat}>
              <ThemedText style={styles.completedBookStatValue}>
                {daysCount}
              </ThemedText>
              <ThemedText style={styles.completedBookStatLabel}>
                DAYS
              </ThemedText>
            </View>
          </View>

          <ThemedText style={styles.completedBookHeadline}>
            This book has a history with you now.
          </ThemedText>
          <ThemedText style={styles.completedBookSubline}>
            {`${completedBookDaysLine}\nIt will stay in your reading life.`}
          </ThemedText>

          <View style={styles.completedBookReflectionWrap}>
            <ThemedText style={styles.completedBookReflectionLabel}>
              {reflectionPrompt}
            </ThemedText>
            <TextInput
              placeholder="A thought, a line, a feeling…"
              placeholderTextColor="rgba(240,235,224,0.3)"
              value={completedBookReview}
              onChangeText={setCompletedBookReview}
              style={styles.completedBookReflectionInput}
              multiline
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={Keyboard.dismiss}
              textAlignVertical="top"
            />
          </View>

            <Pressable
              style={({ pressed }) => [
                styles.completedBookReturnButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={async () => {
                await finishCompletedBookMoment();
                setScreen("finishedBooks");
              }}
            >
              <ThemedText style={styles.completedBookReturnButtonText}>
                Save & remember this book
              </ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.completedBookSkipButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={async () => {
                await finishCompletedBookMoment("");
                setScreen("finishedBooks");
              }}
            >
              <ThemedText style={styles.completedBookSkipButtonText}>
                Save without a note
              </ThemedText>
            </Pressable>
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </ThemedView>
    );
    }

    case "reveal": {
      if (!sanctuaryReveal || !sanctuaryStages[sanctuaryReveal.stage]) {
        return (
          <ThemedView style={styles.loadingContainer}>
            <ThemedText style={styles.loadingText}>Returning home...</ThemedText>
          </ThemedView>
        );
      }

      const allowsSessionReflection = sanctuaryReveal.source === "timed";
      const hasSessionReflection =
        allowsSessionReflection && sessionReflection.trim().length > 0;

      return (
      <ThemedView
        style={[styles.bookRevealScreen, { paddingTop: insets.top + 30 }]}
      >
        <View pointerEvents="none" style={styles.bookReturnGlowTop} />
        <View pointerEvents="none" style={styles.bookReturnGlowBottom} />

        <KeyboardAvoidingView
          style={styles.completedBookKeyboardView}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Animated.View
            style={[
              styles.revealAnimatedShell,
              {
                opacity: revealOpacity,
                transform: [
                  { translateY: revealTranslateY },
                  { scale: revealScale },
                ],
              },
            ]}
          >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={[
              styles.bookRevealContent,
              { paddingBottom: insets.bottom + 96 },
            ]}
          >
            <ThemedText style={styles.bookRevealEyebrow}>Session saved</ThemedText>
            <ThemedText style={styles.bookRevealTitle}>
              {sanctuaryReveal.title}
            </ThemedText>

            <Animated.View
              style={[
                styles.bookRevealCard,
                { transform: [{ scale: revealSceneScale }] },
              ]}
            >
              <View style={styles.bookRevealCover}>
                <ThemedText style={styles.bookRevealCoverTitle} numberOfLines={4}>
                  {revealBookTitle}
                </ThemedText>
              </View>
              <View style={styles.bookRevealTextBlock}>
                <ThemedText style={styles.bookRevealLabel}>Saved to your reading place</ThemedText>
                <ThemedText style={styles.bookRevealBookTitle} numberOfLines={2}>
                  {revealBookTitle}
                </ThemedText>
                <ThemedText style={styles.bookRevealMeta}>
                  +{sanctuaryReveal.sessionMinutes} added
                </ThemedText>
              </View>
            </Animated.View>

            {allowsSessionReflection && (
              <View style={styles.sessionReflectionWrap}>
                <ThemedText style={styles.sessionReflectionLabel}>
                  {"A note, if you'd like one."}
                </ThemedText>
                <TextInput
                  placeholder="A thought, a line, a feeling…"
                  placeholderTextColor="rgba(47,93,80,0.42)"
                  value={sessionReflection}
                  onChangeText={setSessionReflection}
                  style={styles.sessionReflectionInput}
                  multiline
                  blurOnSubmit
                  onSubmitEditing={Keyboard.dismiss}
                  textAlignVertical="top"
                />
              </View>
            )}

            <View style={styles.revealCopyCard}>
              <ThemedText style={styles.revealStageLabel}>
                {sanctuaryStages[sanctuaryReveal.stage].shortLabel}
              </ThemedText>
              <ThemedText style={styles.revealMainCopy}>
                {sanctuaryReveal.stageChanged
                  ? "Your reading place changed."
                  : "This book has a little more history now."}
              </ThemedText>
              <ThemedText style={styles.revealSubCopy}>
                {sanctuaryReveal.subtitle}
              </ThemedText>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.bookRevealContinueButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() =>
                dismissSanctuaryReveal({
                  saveReflection: hasSessionReflection,
                })
              }
            >
              <ThemedText style={styles.bookRevealContinueButtonText}>
                {hasSessionReflection ? "Save note and return home" : "Return home"}
              </ThemedText>
            </Pressable>

            {allowsSessionReflection && hasSessionReflection && (
              <Pressable
                style={({ pressed }) => [
                  styles.bookRevealSecondaryButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => dismissSanctuaryReveal()}
              >
                <ThemedText style={styles.bookRevealSecondaryButtonText}>
                  Save without a note
                </ThemedText>
              </Pressable>
            )}
          </ScrollView>
        </Animated.View>
        </KeyboardAvoidingView>
      </ThemedView>
    );
    }

    case "diary":
      return (
        <ThemedView style={styles.diaryScreen}>
          <ScrollView
            style={styles.diaryScrollView}
            contentContainerStyle={styles.diaryContent}
          >
            <Pressable
              style={({ pressed }) => [
                styles.diaryBackButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => setScreen("home")}
            >
              <ThemedText style={styles.diaryBackButtonText}>
                Return home
              </ThemedText>
            </Pressable>

            <ThemedText style={styles.diaryTitle}>Your reading life</ThemedText>
            <ThemedText style={styles.diarySubtitle}>
              A private record.
            </ThemedText>

            <Pressable
              style={({ pressed }) => [
                styles.finishedBooksInlineButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => setScreen("finishedBooks")}
            >
              <ThemedText style={styles.finishedBooksInlineButtonText}>
                Finished books
              </ThemedText>
            </Pressable>

            {diarySessions.length === 0 ? (
              <View style={styles.diaryEmptyCard}>
                <ThemedText style={styles.diaryEmptyText}>
                  Your first session will appear here.
                </ThemedText>
              </View>
            ) : (
              <View style={styles.diaryTimeline}>
                {diarySessions.map((session, index) => {
                  const previousSession = diarySessions[index - 1];
                  const dayHeader = formatDiaryDayHeader(session);
                  const shouldShowHeader =
                    !previousSession ||
                    formatDiaryDayHeader(previousSession) !== dayHeader;
                  const sessionReflection = getSessionNote(session);
                  const legacyDate = (session as ReadingSession & {
                    date?: string;
                  }).date;

                  return (
                    <View key={session.id} style={styles.diaryEntryGroup}>
                      {shouldShowHeader && (
                        <ThemedText style={styles.diaryDateHeader}>
                          {dayHeader}
                        </ThemedText>
                      )}

                      <View style={styles.diaryEntryCard}>
                        <View style={styles.diaryEntryTopRow}>
                          <View style={styles.diaryEntryCopy}>
                            <ThemedText style={styles.diaryBookTitle}>
                              {session.title}
                            </ThemedText>
                            <ThemedText style={styles.diaryMeta}>
                              {session.source === "logged" ? "Logged" : "Timed"} •{" "}
                              {formatSessionTimestamp(
                                session.createdAt,
                                legacyDate,
                              )}
                            </ThemedText>
                          </View>

                          <ThemedText style={styles.diaryDuration}>
                            {formatDuration(Number(session.minutes))}
                          </ThemedText>
                        </View>

                        {sessionReflection ? (
                          <ThemedText style={styles.diaryReflection}>
                            {sessionReflection}
                          </ThemedText>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </ThemedView>
      );

    case "finishedBooks":
      return (
        <ThemedView style={styles.finishedBooksScreen}>
          <ScrollView
            style={styles.finishedBooksScrollView}
            contentContainerStyle={[
              styles.finishedBooksContent,
              { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 28 },
            ]}
          >
            <Pressable
              style={({ pressed }) => [
                styles.finishedBooksTopReturnButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => setScreen("home")}
            >
              <ThemedText style={styles.finishedBooksTopReturnButtonText}>
                Return home
              </ThemedText>
            </Pressable>

            <ThemedText style={styles.finishedBooksEyebrow}>
              FINISHED BOOKS
            </ThemedText>
            <ThemedText style={styles.finishedBooksTitle}>
              Your reading life, in full.
            </ThemedText>
            <ThemedText style={styles.finishedBooksSubtitle}>
              {"Every book you've finished. A private shelf."}
            </ThemedText>

            {completedBooks.length === 0 ? (
              <View style={styles.diaryEmptyCard}>
                <ThemedText style={styles.diaryEmptyText}>
                  Finished books will gather here.
                </ThemedText>
              </View>
            ) : (
              <View style={styles.finishedBooksShelf}>
                {completedBooks.map((book, index) => (
                  <View key={book.id}>
                    <View style={styles.finishedBookCard}>
                      <View
                        style={[
                          styles.finishedBookCover,
                          index % 2 === 1 && styles.finishedBookCoverAlt,
                        ]}
                      >
                        <ThemedText
                          style={styles.finishedBookCoverTitle}
                          numberOfLines={3}
                        >
                          {book.title}
                        </ThemedText>
                      </View>

                      <View style={styles.finishedBookCopy}>
                        <View style={styles.finishedBookTopRow}>
                          <ThemedText
                            style={styles.finishedBookTitle}
                            numberOfLines={2}
                          >
                            {book.title}
                          </ThemedText>
                          <ThemedText style={styles.finishedBookDate}>
                            {getCompletedBookShelfDate(book.completedAt)}
                          </ThemedText>
                        </View>
                        <ThemedText style={styles.finishedBookMeta}>
                          {formatDuration(Number(book.totalBookMinutes ?? book.sessionMinutes))} ·{" "}
                          {book.sessionCount ?? 1}{" "}
                          {(book.sessionCount ?? 1) === 1 ? "session" : "sessions"}
                        </ThemedText>
                        {book.review.trim() ? (
                          <ThemedText
                            style={styles.finishedBookReview}
                            numberOfLines={2}
                          >
                            {book.review.trim()}
                          </ThemedText>
                        ) : null}
                      </View>
                    </View>
                    {index < completedBooks.length - 1 ? (
                      <View style={styles.finishedBookSeparator} />
                    ) : null}
                  </View>
                ))}
              </View>
            )}

            {completedBooks.length === 1 ? (
              <View style={styles.finishedBooksNextCard}>
                <ThemedText style={styles.finishedBooksNextEyebrow}>
                  {"WHAT'S NEXT?"}
                </ThemedText>
                <ThemedText style={styles.finishedBooksNextBody}>
                  {"No rush. When you know what you'd like to read next, it will be here waiting."}
                </ThemedText>
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.finishedBooksReturnButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => setScreen("home")}
            >
              <ThemedText style={styles.finishedBooksReturnButtonText}>
                Return home
              </ThemedText>
            </Pressable>
          </ScrollView>
        </ThemedView>
      );
    case "home":
      return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: 132 + insets.bottom },
      ]}
    >
      <ThemedView
        style={[styles.container, { paddingTop: insets.top + 18 }]}
      >
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
              Keep a light on for your reading life.
            </ThemedText>
          </View>
        </ThemedView>

        <View style={styles.bookShrineHero}>
          <View pointerEvents="none" style={styles.bookShrineWarmGlow} />
          <View pointerEvents="none" style={styles.bookShrinePlantLeft}>
            <View style={styles.bookShrineStem} />
            <View style={[styles.bookShrineLeaf, styles.bookShrineLeafOne]} />
            <View style={[styles.bookShrineLeaf, styles.bookShrineLeafTwo]} />
          </View>

          <View style={styles.bookShrineTopRow}>
            <View style={styles.bookShrineIconPill}>
              <ThemedText style={styles.bookShrineIcon}>✦</ThemedText>
            </View>
            <ThemedText style={styles.bookShrineStage}>
              Reading place
            </ThemedText>
          </View>

          <ThemedText style={styles.bookShrineGreeting}>
            {timeAwareGreeting}
          </ThemedText>
          <ThemedText style={styles.bookShrineSubcopy}>
            Your place is here.
          </ThemedText>

          <View style={styles.bookShrineShelf}>
            <View style={styles.bookShrineCover}>
              <ThemedText style={styles.bookShrineCoverTitle} numberOfLines={4}>
                {currentBookDisplayTitle}
              </ThemedText>
            </View>
            <View style={styles.bookShrineLantern}>
              <View style={styles.bookShrineLanternGlow} />
              <View style={styles.bookShrineLanternTop} />
              <View style={styles.bookShrineLanternBody} />
              <View style={styles.bookShrineLanternBase} />
            </View>
          </View>

          <View style={styles.bookShrineInfoCard}>
            <ThemedText style={styles.bookShrineBookTitle} numberOfLines={2}>
              {currentBookDisplayTitle}
            </ThemedText>
            <ThemedText style={styles.bookShrineBookMeta}>
              {currentBookMeta}
            </ThemedText>
            <View style={styles.bookShrineContinuityRow}>
              <View style={styles.bookShrineContinuityDot} />
              <ThemedText style={styles.bookShrineContinuityText}>
                {readingPlaceContinuityCopy}
              </ThemedText>
            </View>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.startHero,
            pressed && styles.buttonPressed,
          ]}
          onPress={handlePress}
        >
          <View style={styles.startHeroContent}>
            <ThemedText style={styles.startHeroIcon}>R</ThemedText>
            <View style={styles.startHeroCopy}>
              <ThemedText
                style={styles.startHeroTitle}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.88}
              >
                Start Reading
              </ThemedText>
            </View>
            <View style={styles.startHeroArrowCircle}>
              <ThemedText style={styles.startHeroArrow}>✦</ThemedText>
            </View>
          </View>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.manualLogButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={openManualLog}
        >
          <View style={styles.manualLogButtonContent}>
            <ThemedText style={styles.manualLogButtonText}>
              Add a reading moment
            </ThemedText>
            <ThemedText style={styles.manualLogChevron}>✦</ThemedText>
          </View>
        </Pressable>

        {sessionMessage && (
          <ThemedView style={styles.sessionToast}>
            <ThemedText style={styles.sessionToastText}>
              {sessionMessage}
            </ThemedText>
          </ThemedView>
        )}

        <View style={styles.sessionsHeaderRow}>
          <ThemedText style={styles.sessionsTitle}>Recent sessions</ThemedText>
        </View>

        <ThemedView style={styles.sessionsCard}>
          {recentSessions.length === 0 ? (
            <ThemedText style={styles.emptySessionsText}>
              {"Your first session will appear here. Start reading when you're ready."}
            </ThemedText>
          ) : (
            visibleSessions.map((session, index) => {
              const sessionReflection = getSessionNote(session);

              return (
                <View
                  key={session.id}
                  style={[
                    styles.sessionRow,
                    index === visibleSessions.length - 1 && styles.lastSessionRow,
                  ]}
                >
                  <View style={styles.sessionIconCircle}>
                    <View style={styles.sessionRowDot} />
                  </View>

                  <View style={styles.sessionTextContainer}>
                    <ThemedText style={styles.sessionBookTitle}>
                      {session.title}
                    </ThemedText>
                    <ThemedText style={styles.sessionDate}>
                      {session.source === "logged" ? "Manually Logged" : "Timed"} • {formatSessionTimestamp(session.createdAt)}
                    </ThemedText>
                    {sessionReflection ? (
                      <ThemedText style={styles.sessionNote} numberOfLines={2}>
                        {sessionReflection}
                      </ThemedText>
                    ) : null}
                  </View>

                  <ThemedText style={styles.sessionMinutes}>
                    {formatDuration(Number(session.minutes))}
                  </ThemedText>
                </View>
              );
            })
          )}
        </ThemedView>

        <Pressable
          style={({ pressed }) => [
            styles.diaryOpenButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => setScreen("diary")}
        >
          <ThemedText style={styles.diaryOpenButtonText}>
            Open diary
          </ThemedText>
          <ThemedText style={styles.diaryOpenButtonSubtext}>
            Read the full private record.
          </ThemedText>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.finishedBooksHomeButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => setScreen("finishedBooks")}
        >
          <View style={styles.finishedBooksHomeCovers}>
            {completedBooks.length === 0 ? (
              <View
                style={[
                  styles.finishedBooksHomeCover,
                  styles.finishedBooksHomeCoverAlt,
                ]}
              />
            ) : (
              completedBooks.slice(0, 3).map((book, index) => (
                <View
                  key={book.id}
                  style={[
                    styles.finishedBooksHomeCover,
                    index % 2 === 1 && styles.finishedBooksHomeCoverAlt,
                  ]}
                />
              ))
            )}
          </View>
          <View style={styles.finishedBooksHomeCopy}>
            <ThemedText style={styles.finishedBooksHomeTitle}>
              Finished books
            </ThemedText>
            <ThemedText style={styles.finishedBooksHomeSubtext}>
              Revisit the books you have closed.
            </ThemedText>
          </View>
        </Pressable>

      </ThemedView>
    </ScrollView>
    );
  }
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
    paddingHorizontal: 26,
    paddingTop: 46,
    paddingBottom: 54,
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
  loadingWordmark: {
    color: colors.accentDark,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: "400",
    letterSpacing: 0,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  welcomeScreen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 42,
    justifyContent: "center",
    overflow: "hidden",
  },
  welcomeGlowTop: {
    position: "absolute",
    top: -90,
    left: -70,
    right: -70,
    height: 260,
    borderRadius: 150,
    backgroundColor: "rgba(255,255,255,0.48)",
  },
  welcomeGlowBottom: {
    position: "absolute",
    left: -100,
    right: -100,
    bottom: -80,
    height: 280,
    borderRadius: 170,
    backgroundColor: "rgba(224,204,166,0.18)",
  },
  welcomeCard: {
    backgroundColor: "rgba(255,255,255,0.72)",
    borderRadius: 34,
    padding: 22,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    ...cardShadow,
  },
  welcomeSanctuaryPreview: {
    height: 184,
    borderRadius: 28,
    backgroundColor: "#163D31",
    overflow: "hidden",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(23,56,38,0.10)",
  },
  welcomeWindowGlow: {
    position: "absolute",
    top: 24,
    left: 58,
    right: 58,
    height: 92,
    borderRadius: 54,
    backgroundColor: "rgba(247,195,107,0.56)",
  },
  welcomeWindowFrame: {
    position: "absolute",
    top: 32,
    left: 76,
    right: 76,
    height: 88,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: "rgba(255,248,237,0.36)",
  },
  welcomeWindowDivider: {
    position: "absolute",
    top: 40,
    alignSelf: "center",
    width: 2,
    height: 76,
    borderRadius: 1,
    backgroundColor: "rgba(255,248,237,0.32)",
  },
  welcomeFloor: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 60,
    backgroundColor: "rgba(184,144,104,0.58)",
  },
  welcomeChair: {
    position: "absolute",
    left: 54,
    bottom: 42,
    width: 70,
    height: 62,
    borderRadius: 22,
    backgroundColor: "rgba(106,70,59,0.74)",
  },
  welcomeBookStack: {
    position: "absolute",
    left: 128,
    bottom: 48,
    gap: 3,
  },
  welcomeBookOne: {
    width: 38,
    height: 7,
    borderRadius: 3,
    backgroundColor: "rgba(247,195,107,0.72)",
  },
  welcomeBookTwo: {
    width: 32,
    height: 7,
    borderRadius: 3,
    backgroundColor: "rgba(201,133,104,0.66)",
  },
  welcomeBookThree: {
    width: 42,
    height: 7,
    borderRadius: 3,
    backgroundColor: "rgba(255,248,237,0.70)",
  },
  welcomePlantPot: {
    position: "absolute",
    right: 72,
    bottom: 42,
    width: 34,
    height: 26,
    borderRadius: 10,
    backgroundColor: "rgba(201,133,104,0.68)",
  },
  welcomeLeaf: {
    position: "absolute",
    width: 28,
    height: 42,
    borderRadius: 20,
    backgroundColor: "rgba(116,138,93,0.62)",
  },
  welcomeLeafOne: {
    right: 84,
    bottom: 64,
    transform: [{ rotate: "-24deg" }],
  },
  welcomeLeafTwo: {
    right: 62,
    bottom: 68,
    backgroundColor: "rgba(95,117,77,0.58)",
    transform: [{ rotate: "24deg" }],
  },
  welcomeEyebrow: {
    color: "rgba(47,93,80,0.72)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  welcomeTitle: {
    color: "#173826",
    fontSize: 36,
    lineHeight: 42,
    fontWeight: "400",
    letterSpacing: -1.1,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  welcomeBody: {
    color: "rgba(31,41,51,0.68)",
    fontSize: 17,
    lineHeight: 25,
    fontWeight: "600",
    marginTop: 14,
  },
  welcomeStepsCard: {
    backgroundColor: "rgba(247,243,234,0.78)",
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 22,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.06)",
  },
  welcomeStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: "transparent",
  },
  welcomeStepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: "hidden",
    textAlign: "center",
    color: "#FFF8ED",
    backgroundColor: colors.accent,
    fontSize: 13,
    lineHeight: 26,
    fontWeight: "900",
  },
  welcomeStepText: {
    flex: 1,
    color: "rgba(31,41,51,0.72)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
  },
  welcomeButton: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: "#315F52",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.11,
    shadowRadius: 15,
    elevation: 4,
  },
  welcomeButtonText: {
    color: "#FFF8ED",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
  },
  headerRow: {
    backgroundColor: "transparent",
    marginBottom: 4,
    zIndex: 2,
  },
  appName: {
    fontSize: 48,
    lineHeight: 54,
    fontWeight: "400",
    color: "#1B2A22",
    letterSpacing: -1.9,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  headerSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.mutedText,
    fontWeight: "600",
    marginTop: 6,
  },  sanctuaryHeroScene: {
    height: 186,
    backgroundColor: "#1B4234",
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,248,237,0.08)",
  },  sanctuaryHeroMoonGlow: {
    position: "absolute",
    top: 30,
    left: 42,
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: "rgba(247,195,107,0.14)",
  },  sanctuaryHeroWindowFrame: {
    position: "absolute",
    top: 46,
    left: 96,
    right: 96,
    height: 110,
    borderRadius: 56,
    borderWidth: 2,
    borderColor: "rgba(255,248,237,0.34)",
  },  sanctuaryHeroBackWallShelf: {
    position: "absolute",
    top: 156,
    left: 34,
    width: 116,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(106,70,59,0.26)",
  },  sanctuaryHeroRug: {
    position: "absolute",
    left: 72,
    right: 72,
    bottom: 24,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(201,133,104,0.62)",
  },  sanctuaryHeroBlanket: {
    position: "absolute",
    right: 8,
    bottom: 7,
    width: 31,
    height: 39,
    borderRadius: 14,
    backgroundColor: "rgba(247,195,107,0.72)",
  },  sanctuaryHeroPlantPot: {
    position: "absolute",
    right: 72,
    bottom: 48,
    width: 36,
    height: 26,
    borderRadius: 12,
    backgroundColor: "rgba(201,133,104,0.78)",
  },  sanctuaryHeroLeafOne: {
    right: 82,
    bottom: 72,
    transform: [{ rotate: "-24deg" }],
  },  sanctuaryHeroQuietCorner: {
    position: "absolute",
    right: 40,
    bottom: 50,
    width: 74,
    height: 24,
    borderRadius: 999,
    backgroundColor: "rgba(23,56,38,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },  sanctuaryHeroStove: {
    position: "absolute",
    right: 42,
    bottom: 46,
    width: 72,
    height: 54,
    borderRadius: 15,
    backgroundColor: "#39413C",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.14)",
    shadowColor: "#EF8F3E",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 5,
  },  sanctuaryHeroStoveTop: {
    position: "absolute",
    top: -6,
    left: 13,
    right: 13,
    height: 8,
    borderRadius: 5,
    backgroundColor: "#48514B",
  },  sanctuaryHeroStoveWindow: {
    width: 42,
    height: 26,
    borderRadius: 8,
    backgroundColor: "#2A2925",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },  sanctuaryHeroFireGlow: {
    position: "absolute",
    width: 44,
    height: 28,
    borderRadius: 15,
    backgroundColor: "rgba(239,143,62,0.72)",
  },  sanctuaryHeroStoveLegLeft: {
    position: "absolute",
    left: 13,
    bottom: -8,
    width: 8,
    height: 13,
    borderRadius: 3,
    backgroundColor: "#39413C",
  },  sanctuaryHeroBookStack: {
    position: "absolute",
    left: 34,
    bottom: 44,
    width: 56,
    gap: 4,
  },  sanctuaryHeroBookTwo: {
    width: 42,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(201,133,104,0.78)",
  },  sanctuaryHeroMug: {
    position: "absolute",
    left: 156,
    bottom: 92,
    width: 25,
    height: 19,
    borderRadius: 10,
    backgroundColor: "#FFF8ED",
  },  sanctuaryHeroVine: {
    position: "absolute",
    top: 30,
    left: 38,
    right: 44,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(116,138,93,0.58)",
  },  sanctuaryHeroHangingLeafTwo: {
    position: "absolute",
    top: 42,
    left: 76,
    width: 22,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(95,117,77,0.62)",
    transform: [{ rotate: "18deg" }],
  },  sanctuaryHeroShelfBookOne: {
    width: 10,
    height: 24,
    borderRadius: 2,
    backgroundColor: "#F7C36B",
  },  sanctuaryHeroShelfBookThree: {
    width: 10,
    height: 30,
    borderRadius: 2,
    backgroundColor: "rgba(201,133,104,0.78)",
  },  sanctuaryHeroProgressPill: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "rgba(255,248,237,0.68)",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.28)",
    zIndex: 3,
  },  sanctuaryHeroCopy: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 17,
    backgroundColor: "#0B2A22",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,248,237,0.10)",
  },  sanctuaryHeroTitle: {
    color: "#FFF8ED",
    fontSize: 30,
    lineHeight: 35,
    fontWeight: "400",
    letterSpacing: -1.05,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },  sanctuaryHeroSubtitle: {
    color: "rgba(255,248,237,0.78)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },  sanctuaryMilestoneText: {
    color: "rgba(255,248,237,0.82)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },  sanctuaryHeroIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,248,237,0.13)",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.12)",
  },
  sanctuaryHeroIcon: {
    color: "#FFF8ED",
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "800",
  },  sanctuaryHeroStatNumber: {
    color: "#FFF8ED",
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "700",
    letterSpacing: -0.35,
  },  sanctuaryHeroStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,248,237,0.18)",
  },  sanctuaryHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: "transparent",
    marginBottom: 10,
  },  sanctuaryEyebrow: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 4,
  },  sanctuaryStagePill: {
    backgroundColor: "rgba(23,56,38,0.08)",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: "rgba(23,56,38,0.08)",
  },  sanctuaryScene: {
    height: 210,
    borderRadius: 26,
    backgroundColor: "#1F472F",
    overflow: "hidden",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(23,56,38,0.14)",
  },  sanctuaryHearthAura: {
    position: "absolute",
    right: 10,
    bottom: 18,
    width: 144,
    height: 112,
    borderRadius: 56,
    backgroundColor: "rgba(239,143,62,0.20)",
  },  sanctuaryWindowDivider: {
    position: "absolute",
    top: 35,
    alignSelf: "center",
    width: 2,
    height: 102,
    borderRadius: 1,
    backgroundColor: "rgba(255,248,237,0.44)",
  },  sanctuaryRug: {
    position: "absolute",
    left: 64,
    right: 64,
    bottom: 24,
    height: 30,
    borderRadius: 20,
    backgroundColor: "rgba(201,133,104,0.88)",
  },  sanctuaryBlanket: {
    position: "absolute",
    right: 10,
    bottom: 8,
    width: 32,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(247,195,107,0.78)",
  },  sanctuaryLeaf: {
    position: "absolute",
    right: 78,
    bottom: 78,
    width: 28,
    height: 42,
    borderRadius: 20,
    backgroundColor: "rgba(116,138,93,0.72)",
  },  sanctuaryLeafTwo: {
    right: 94,
    bottom: 82,
    backgroundColor: "rgba(95,117,77,0.70)",
    transform: [{ rotate: "24deg" }],
  },  unlitCorner: {
    position: "absolute",
    right: 38,
    bottom: 56,
    width: 64,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(23,56,38,0.20)",
    alignItems: "center",
    justifyContent: "center",
  },  ironStove: {
    position: "absolute",
    right: 32,
    bottom: 54,
    width: 72,
    height: 54,
    borderRadius: 13,
    backgroundColor: "#39413C",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.14)",
    shadowColor: "#EF8F3E",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 4,
  },  ironStoveTop: {
    position: "absolute",
    top: -5,
    left: 12,
    right: 12,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#48514B",
  },  ironStoveWindow: {
    position: "absolute",
    top: 13,
    left: 14,
    right: 14,
    height: 26,
    borderRadius: 7,
    backgroundColor: "#2A2925",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },  fireGlow: {
    position: "absolute",
    width: 44,
    height: 26,
    borderRadius: 15,
    backgroundColor: "rgba(239,143,62,0.88)",
  },  ironStoveLegLeft: {
    position: "absolute",
    left: 12,
    bottom: -8,
    width: 8,
    height: 12,
    borderRadius: 3,
    backgroundColor: "#39413C",
  },  sanctuaryBookStack: {
    position: "absolute",
    left: 28,
    bottom: 54,
    width: 48,
    height: 28,
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },  sanctuaryBookTwo: {
    width: 36,
    height: 7,
    borderRadius: 3,
    backgroundColor: "rgba(201,133,104,0.78)",
    marginBottom: 3,
  },  sanctuaryMug: {
    position: "absolute",
    left: 166,
    bottom: 56,
    width: 24,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FFF8ED",
  },  sanctuaryShelfBookOne: {
    width: 10,
    height: 24,
    borderRadius: 2,
    backgroundColor: "#F7C36B",
  },  sanctuaryShelfBookThree: {
    width: 10,
    height: 28,
    borderRadius: 2,
    backgroundColor: "rgba(201,133,104,0.78)",
  },  sanctuaryHangingLeaf: {
    position: "absolute",
    top: 48,
    right: 54,
    width: 30,
    height: 58,
    borderRadius: 18,
    backgroundColor: "rgba(116,138,93,0.66)",
    transform: [{ rotate: "-12deg" }],
  },  sanctuarySubCopy: {
    color: "rgba(31,41,51,0.64)",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
    marginTop: 5,
  },
  startHero: {
    minHeight: 64,
    marginTop: 2,
    backgroundColor: "#1F4F3B",
    borderRadius: 28,
    paddingHorizontal: 22,
    justifyContent: "center",
    shadowColor: "#315F52",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.10,
    shadowRadius: 15,
    elevation: 4,
    zIndex: 3,
  },
  startHeroContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "transparent",
  },
  startHeroIcon: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 25,
    lineHeight: 28,
    fontWeight: "700",
  },
  startHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  startHeroTitle: {
    color: "#FFFFFF",
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "700",
    letterSpacing: -0.25,
    flexShrink: 1,
  },
  startHeroArrowCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  startHeroArrow: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "600",
  },  manualLogButton: {
    backgroundColor: "rgba(255,255,255,0.46)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
    borderRadius: 24,
    minHeight: 56,
    paddingVertical: 13,
    paddingHorizontal: 18,
    zIndex: 3,
    ...softCardShadow,
  },
  manualLogButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "transparent",
  },
  manualLogButtonText: {
    flex: 1,
    color: "rgba(36,72,62,0.84)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
  },
  manualLogChevron: {
    color: "rgba(36,72,62,0.44)",
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "300",
  },  identityColumn: {
    flex: 1,
    backgroundColor: colors.card,
  },  identityTitle: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "900",
    color: colors.text,
  },  identityLabel: {
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
  },  currentBookIcon: {
    fontSize: 16,
    lineHeight: 20,
  },  mistLayerBack: {
    position: "absolute",
    left: -40,
    right: -40,
    bottom: 12,
    height: 92,
    borderRadius: 80,
    backgroundColor: "rgba(47,93,80,0.045)",
    transform: [{ scaleX: 1.15 }],
  },  treeLine: {
    position: "absolute",
    bottom: 22,
    flexDirection: "row",
    gap: 12,
    opacity: 0.28,
  },  treePeakSmall: {
    width: 0,
    height: 0,
    borderLeftWidth: 14,
    borderRightWidth: 14,
    borderBottomWidth: 34,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: colors.accent,
    marginTop: 9,
  },  ritualDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 15,
    zIndex: 2,
  },  ritualLeaf: {
    color: colors.accent,
    fontSize: 18,
    lineHeight: 22,
    opacity: 0.72,
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
  },  bookInputLabel: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "800",
    color: colors.text,
  },  bookButtonRow: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.card,
  },  secondaryButtonText: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },  saveBookButtonText: {
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
    fontWeight: "600",
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
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.softAccent,
    marginRight: 14,
  },
  sessionRowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(47,93,80,0.72)",
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
  sessionNote: {
    color: "rgba(107,114,128,0.78)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    marginTop: 5,
  },
  sessionMinutes: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    color: colors.accent,
  },
  diaryOpenButton: {
    backgroundColor: "rgba(255,248,237,0.70)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    ...softCardShadow,
  },
  diaryOpenButtonText: {
    color: colors.accentDark,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
  },
  diaryOpenButtonSubtext: {
    color: "rgba(31,41,51,0.54)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    marginTop: 3,
  },
  diaryScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  diaryScrollView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  diaryContent: {
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 48,
  },
  diaryBackButton: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,248,237,0.76)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 15,
    marginBottom: 24,
  },
  diaryBackButtonText: {
    color: colors.accentDark,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  diaryTitle: {
    color: "#1B2A22",
    fontSize: 42,
    lineHeight: 48,
    fontWeight: "400",
    letterSpacing: -0.7,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  diarySubtitle: {
    color: "rgba(47,93,80,0.54)",
    fontSize: 16,
    lineHeight: 23,
    fontStyle: "italic",
    fontWeight: "600",
    marginTop: 8,
  },
  diaryEmptyCard: {
    backgroundColor: "rgba(255,248,237,0.72)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    padding: 20,
    marginTop: 36,
    ...softCardShadow,
  },
  diaryEmptyText: {
    color: "rgba(47,93,80,0.58)",
    fontSize: 16,
    lineHeight: 24,
    fontStyle: "italic",
    fontWeight: "600",
  },
  diaryTimeline: {
    marginTop: 34,
    backgroundColor: "transparent",
  },
  diaryEntryGroup: {
    backgroundColor: "transparent",
    marginBottom: 20,
  },
  diaryDateHeader: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  diaryEntryCard: {
    backgroundColor: "rgba(255,248,237,0.82)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    padding: 18,
    ...softCardShadow,
  },
  diaryEntryTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: "transparent",
  },
  diaryEntryCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  diaryBookTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "900",
  },
  diaryMeta: {
    color: "rgba(31,41,51,0.50)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    marginTop: 5,
  },
  diaryDuration: {
    color: colors.accent,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "900",
  },
  diaryReflection: {
    color: "rgba(31,41,51,0.68)",
    fontSize: 16,
    lineHeight: 25,
    fontStyle: "italic",
    fontWeight: "600",
    marginTop: 15,
  },
  finishedBooksInlineButton: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,248,237,0.76)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 15,
    marginTop: 22,
  },
  finishedBooksInlineButtonText: {
    color: colors.accentDark,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  finishedBooksHomeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,248,237,0.70)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    borderRadius: 22,
    paddingVertical: 15,
    paddingHorizontal: 18,
    ...softCardShadow,
  },
  finishedBooksHomeCovers: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    backgroundColor: "transparent",
  },
  finishedBooksHomeCover: {
    width: 13,
    height: 42,
    borderRadius: 4,
    backgroundColor: colors.sessionBackground,
  },
  finishedBooksHomeCoverAlt: {
    height: 34,
    backgroundColor: colors.softAccent,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.16)",
  },
  finishedBooksHomeCopy: {
    flex: 1,
    backgroundColor: "transparent",
  },
  finishedBooksHomeTitle: {
    color: colors.accentDark,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
  },
  finishedBooksHomeSubtext: {
    color: "rgba(31,41,51,0.54)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    marginTop: 3,
  },
  finishedBooksTopReturnButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 2,
    marginBottom: 26,
  },
  finishedBooksTopReturnButtonText: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  finishedBooksScreen: {
    flex: 1,
    backgroundColor: "#F7F2E8",
  },
  finishedBooksScrollView: {
    flex: 1,
    backgroundColor: "#F7F2E8",
  },
  finishedBooksContent: {
    paddingHorizontal: 24,
  },
  finishedBooksEyebrow: {
    color: "#C4945A",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  finishedBooksTitle: {
    color: "#1A1A14",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "400",
    letterSpacing: -0.3,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  finishedBooksSubtitle: {
    color: "#8A8578",
    fontSize: 13,
    lineHeight: 19,
    fontStyle: "italic",
    marginTop: 5,
  },
  finishedBooksShelf: {
    marginTop: 28,
    backgroundColor: "transparent",
  },
  finishedBookCard: {
    flexDirection: "row",
    gap: 14,
    backgroundColor: "transparent",
    paddingVertical: 14,
  },
  finishedBookCover: {
    width: 48,
    height: 67,
    borderRadius: 6,
    backgroundColor: colors.sessionBackground,
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  finishedBookCoverAlt: {
    backgroundColor: "#1E3A2C",
  },
  finishedBookCoverTitle: {
    color: "#F0EBE0",
    fontSize: 8,
    lineHeight: 10,
    fontWeight: "700",
    textAlign: "center",
  },
  finishedBookCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  finishedBookTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "transparent",
  },
  finishedBookTitle: {
    flex: 1,
    color: "#1A1A14",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "500",
  },
  finishedBookMeta: {
    color: "#8A8578",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  finishedBookDate: {
    color: "#C4945A",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "right",
  },
  finishedBookReview: {
    color: "#6B6560",
    fontSize: 13,
    lineHeight: 19,
    fontStyle: "italic",
    marginTop: 8,
  },
  finishedBookSeparator: {
    height: 1,
    backgroundColor: "rgba(0,0,0,0.06)",
    marginLeft: 62,
  },
  finishedBooksNextCard: {
    backgroundColor: "rgba(196,148,90,0.08)",
    borderWidth: 1,
    borderColor: "rgba(196,148,90,0.15)",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 24,
  },
  finishedBooksNextEyebrow: {
    color: "#C4945A",
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  finishedBooksNextBody: {
    color: "#5A5448",
    fontSize: 13,
    lineHeight: 20,
  },
  finishedBooksReturnButton: {
    height: 52,
    backgroundColor: "#1E3A2C",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 28,
  },
  finishedBooksReturnButtonText: {
    color: "#E8E2D8",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
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
    paddingHorizontal: 10,
  },
  quietSessionEyebrow: {
    color: "rgba(255,248,237,0.54)",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    textAlign: "center",
    marginTop: 34,
  },
  quietSessionTitle: {
    color: "#FFF8ED",
    fontSize: 36,
    lineHeight: 44,
    fontWeight: "400",
    textAlign: "center",
    letterSpacing: -0.4,
    marginTop: 18,
    maxWidth: 320,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  quietSessionSubtitle: {
    color: "rgba(255,248,237,0.62)",
    fontSize: 17,
    lineHeight: 25,
    fontWeight: "600",
    marginTop: 14,
    textAlign: "center",
  },
  quietBottomArea: {
    alignItems: "center",
    backgroundColor: "transparent",
  },
  quietEndSessionButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.24)",
    backgroundColor: "rgba(255,248,237,0.08)",
  },
  quietEndSessionText: {
    color: "rgba(255,248,237,0.72)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  ritualTransitionScreen: {
    flex: 1,
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
    paddingBottom: 10,
  },
  sessionQuietDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(247,195,107,0.72)",
    shadowColor: "#F7C36B",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 2,
  },
  sessionTitle: {
    color: "#FFF8ED",
    fontSize: 25,
    lineHeight: 33,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.3,
    maxWidth: 310,
  },
  sessionSubtitle: {
    color: "rgba(255,248,237,0.66)",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 12,
  },
  ritualLineArea: {
    width: "100%",
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  ritualBreathRing: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(244,197,126,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.12)",
  },
  ritualLineWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  ritualLineText: {
    color: "#FFF8EE",
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "700",
    textAlign: "center",
    maxWidth: 320,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  closeTransitionScreen: {
    flex: 1,
    backgroundColor: colors.sessionBackground,
    paddingHorizontal: 30,
    paddingTop: 80,
    paddingBottom: 46,
    overflow: "hidden",
  },
  closeTransitionContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  closeTransitionEyebrow: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: 1.3,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 14,
  },
  closeTransitionTitle: {
    color: "#FFF8ED",
    fontSize: 36,
    lineHeight: 43,
    fontWeight: "900",
    letterSpacing: -0.85,
    textAlign: "center",
  },
  closeTransitionMinutes: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 18,
  },
  closeTransitionSubtext: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 18,
    maxWidth: 280,
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
    paddingVertical: 42,
  },
  closeEyebrow: {
    color: "rgba(255,248,237,0.62)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  closeTitle: {
    color: "#FFF8ED",
    fontSize: 32,
    lineHeight: 39,
    fontWeight: "800",
    letterSpacing: -0.8,
    maxWidth: 330,
  },
  closeMinutes: {
    color: "rgba(255,248,237,0.62)",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    marginTop: 14,
    marginBottom: 24,
  },
  closeBookInput: {
    backgroundColor: "rgba(255,248,237,0.11)",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.16)",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 18,
    lineHeight: 24,
    color: "#FFF8ED",
    fontWeight: "600",
  },
  manualBookInput: {
    marginTop: 14,
  },
  manualNoteInput: {
    minHeight: 104,
    fontSize: 16,
    lineHeight: 23,
  },
  manualPresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    backgroundColor: "transparent",
    marginTop: 26,
    marginBottom: 16,
  },
  manualPresetChip: {
    backgroundColor: "rgba(255,248,237,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.16)",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  manualPresetChipSelected: {
    backgroundColor: "rgba(255,248,237,0.92)",
    borderColor: "rgba(255,248,237,0.92)",
  },
  manualPresetChipText: {
    color: "rgba(255,248,237,0.72)",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  manualPresetChipTextSelected: {
    color: colors.sessionBackground,
  },
  manualLogError: {
    color: "#FFD9C7",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    marginTop: 13,
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

  revealScreen: {
    flex: 1,
    backgroundColor: colors.sessionBackground,
    paddingHorizontal: 24,
    paddingTop: 70,
    paddingBottom: 34,
    overflow: "hidden",
  },
  revealAnimatedShell: {
    flex: 1,
    backgroundColor: "transparent",
  },
  revealContent: {
    flexGrow: 1,
    justifyContent: "center",
    backgroundColor: "transparent",
    paddingVertical: 28,
  },
  revealEyebrow: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 12,
  },
  revealTitle: {
    color: "#FFF8ED",
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "900",
    letterSpacing: -0.8,
    textAlign: "center",
    marginBottom: 22,
  },
  revealSceneCard: {
    height: 260,
    borderRadius: 34,
    backgroundColor: "#1F472F",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    overflow: "hidden",
    marginBottom: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 6,
  },
  revealWindowGlow: {
    position: "absolute",
    top: 28,
    left: 50,
    right: 50,
    height: 112,
    borderRadius: 58,
    backgroundColor: "#F7C36B",
    opacity: 0.78,
  },
  revealHearthAura: {
    position: "absolute",
    right: 20,
    bottom: 22,
    width: 150,
    height: 116,
    borderRadius: 58,
    backgroundColor: "rgba(239,143,62,0.22)",
  },
  revealWindowFrame: {
    position: "absolute",
    top: 34,
    left: 68,
    right: 68,
    height: 114,
    borderRadius: 58,
    borderWidth: 2,
    borderColor: "rgba(255,248,237,0.46)",
  },
  revealWindowDivider: {
    position: "absolute",
    top: 40,
    alignSelf: "center",
    width: 2,
    height: 102,
    borderRadius: 1,
    backgroundColor: "rgba(255,248,237,0.42)",
  },
  revealFloor: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 82,
    backgroundColor: "rgba(184, 144, 104, 0.72)",
  },
  revealRug: {
    position: "absolute",
    left: 74,
    right: 74,
    bottom: 24,
    height: 28,
    borderRadius: 999,
    backgroundColor: "rgba(201,133,104,0.78)",
  },
  revealChair: {
    position: "absolute",
    left: 82,
    bottom: 54,
    width: 74,
    height: 76,
    borderRadius: 24,
    backgroundColor: "rgba(106,70,59,0.82)",
  },
  revealBlanket: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 34,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#F7C36B",
    opacity: 0.82,
  },
  revealPlantPot: {
    position: "absolute",
    right: 82,
    bottom: 54,
    width: 34,
    height: 26,
    borderRadius: 10,
    backgroundColor: "rgba(201,133,104,0.78)",
  },
  revealLeaf: {
    position: "absolute",
    width: 30,
    height: 42,
    borderRadius: 20,
    backgroundColor: "rgba(116,138,93,0.72)",
  },
  revealLeafOne: {
    right: 94,
    bottom: 78,
    transform: [{ rotate: "-24deg" }],
  },
  revealLeafTwo: {
    right: 70,
    bottom: 82,
    backgroundColor: "rgba(95,117,77,0.70)",
    transform: [{ rotate: "24deg" }],
  },
  revealIronStove: {
    position: "absolute",
    right: 42,
    bottom: 60,
    width: 72,
    height: 54,
    borderRadius: 13,
    backgroundColor: "#39413C",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.14)",
  },
  revealIronStovePipe: {
    position: "absolute",
    top: -58,
    width: 8,
    height: 64,
    borderRadius: 4,
    backgroundColor: "#39413C",
  },
  revealIronStoveTop: {
    position: "absolute",
    top: -5,
    left: 12,
    right: 12,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#48514B",
  },
  revealIronStoveHandle: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,248,237,0.22)",
  },
  revealIronStoveWindow: {
    width: 42,
    height: 26,
    borderRadius: 7,
    backgroundColor: "#2A2925",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  revealFireGlow: {
    position: "absolute",
    width: 38,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#EF8F3E",
    opacity: 0.78,
  },
  revealFireIcon: {
    color: "#F7C36B",
    fontSize: 20,
    lineHeight: 22,
  },
  revealIronStoveLegLeft: {
    position: "absolute",
    left: 12,
    bottom: -8,
    width: 8,
    height: 12,
    borderRadius: 3,
    backgroundColor: "#39413C",
  },
  revealIronStoveLegRight: {
    position: "absolute",
    right: 12,
    bottom: -8,
    width: 8,
    height: 12,
    borderRadius: 3,
    backgroundColor: "#39413C",
  },
  revealFaintEmber: {
    width: 14,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#EF8F3E",
    opacity: 0.62,
  },
  revealBookStack: {
    position: "absolute",
    left: 46,
    bottom: 54,
    gap: 3,
  },
  revealBookOne: {
    width: 44,
    height: 7,
    borderRadius: 3,
    backgroundColor: "#F7C36B",
  },
  revealBookTwo: {
    width: 36,
    height: 7,
    borderRadius: 3,
    backgroundColor: "rgba(201,133,104,0.78)",
  },
  revealBookThree: {
    width: 48,
    height: 7,
    borderRadius: 3,
    backgroundColor: "#FFF8ED",
  },
  revealMug: {
    position: "absolute",
    left: 166,
    bottom: 64,
    width: 24,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FFF8ED",
  },
  revealShelf: {
    position: "absolute",
    left: 56,
    top: 74,
    width: 82,
    height: 40,
    borderRadius: 8,
    backgroundColor: "rgba(106, 70, 59, 0.72)",
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 4,
  },
  revealShelfBookOne: {
    width: 10,
    height: 22,
    borderRadius: 2,
    backgroundColor: "#F7C36B",
  },
  revealShelfBookTwo: {
    width: 10,
    height: 17,
    borderRadius: 2,
    backgroundColor: "#FFF8ED",
  },
  revealShelfBookThree: {
    width: 10,
    height: 25,
    borderRadius: 2,
    backgroundColor: "rgba(201,133,104,0.78)",
  },
  revealCopyCard: {
    backgroundColor: "rgba(255,248,237,0.94)",
    borderRadius: 28,
    padding: 22,
    marginBottom: 16,
  },
  revealStageLabel: {
    color: colors.accentDark,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  revealMainCopy: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  revealSubCopy: {
    color: colors.mutedText,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  sessionReflectionWrap: {
    backgroundColor: "transparent",
    marginBottom: 18,
  },
  sessionReflectionLabel: {
    color: "rgba(47,93,80,0.58)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  sessionReflectionInput: {
    height: 86,
    backgroundColor: "rgba(255,248,237,0.76)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.10)",
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 12,
    color: "rgba(31,41,51,0.72)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
    fontStyle: "italic",
  },
  revealMinutesPill: {
    alignSelf: "flex-start",
    marginTop: 18,
    backgroundColor: colors.softAccent,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  revealMinutesText: {
    color: colors.accentDark,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  revealContinueButton: {
    backgroundColor: "#FFF8ED",
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
  },
  revealContinueButtonText: {
    color: colors.sessionBackground,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
  },

  bookShrineHero: {
    borderRadius: 36,
    overflow: "hidden",
    backgroundColor: "rgba(255,248,237,0.76)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.09)",
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: 20,
    zIndex: 2,
    ...softCardShadow,
  },
  bookShrineWarmGlow: {
    position: "absolute",
    top: 90,
    left: -40,
    right: -40,
    height: 240,
    borderRadius: 140,
    backgroundColor: "rgba(247,195,107,0.16)",
  },
  bookShrinePlantLeft: {
    position: "absolute",
    left: 14,
    bottom: 102,
    width: 54,
    height: 116,
    backgroundColor: "transparent",
  },
  bookShrineStem: {
    position: "absolute",
    left: 25,
    bottom: 0,
    width: 2,
    height: 84,
    borderRadius: 1,
    backgroundColor: "rgba(47,93,80,0.28)",
  },
  bookShrineLeaf: {
    position: "absolute",
    width: 28,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(47,93,80,0.18)",
  },
  bookShrineLeafOne: {
    left: 3,
    bottom: 36,
    transform: [{ rotate: "-28deg" }],
  },
  bookShrineLeafTwo: {
    right: 0,
    bottom: 58,
    transform: [{ rotate: "26deg" }],
  },
  bookShrineTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "transparent",
    marginBottom: 14,
  },
  bookShrineIconPill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.08)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
  },
  bookShrineIcon: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  bookShrineStage: {
    color: "rgba(47,93,80,0.58)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  bookShrineGreeting: {
    color: "#1B2A22",
    fontSize: 30,
    lineHeight: 36,
    textAlign: "center",
    fontWeight: "400",
    letterSpacing: -0.8,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  bookShrineSubcopy: {
    color: "rgba(31,41,51,0.62)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 5,
  },
  bookShrineShelf: {
    height: 176,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    marginTop: 20,
  },
  bookShrineCover: {
    width: 122,
    height: 164,
    borderRadius: 12,
    backgroundColor: "#1E3E32",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.36)",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 6,
  },
  bookShrineCoverTitle: {
    color: "#F7F3EA",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "400",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    textAlign: "center",
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  bookShrineLantern: {
    position: "absolute",
    right: 34,
    bottom: 10,
    width: 48,
    height: 76,
    alignItems: "center",
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  bookShrineLanternGlow: {
    position: "absolute",
    bottom: 5,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "rgba(247,195,107,0.36)",
  },
  bookShrineLanternTop: {
    width: 20,
    height: 10,
    borderRadius: 8,
    backgroundColor: "rgba(123,82,48,0.75)",
    marginBottom: 1,
  },
  bookShrineLanternBody: {
    width: 34,
    height: 42,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: "rgba(123,82,48,0.74)",
    backgroundColor: "rgba(247,195,107,0.28)",
  },
  bookShrineLanternBase: {
    width: 40,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(123,82,48,0.72)",
    marginTop: -2,
  },
  bookShrineInfoCard: {
    backgroundColor: "rgba(255,255,255,0.46)",
    borderRadius: 26,
    paddingVertical: 15,
    paddingHorizontal: 18,
  },
  bookShrineBookTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  bookShrineBookMeta: {
    color: "rgba(31,41,51,0.55)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 5,
  },
  bookShrineContinuityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "transparent",
    marginTop: 10,
  },
  bookShrineContinuityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(47,93,80,0.44)",
  },
  bookShrineContinuityText: {
    color: "rgba(47,93,80,0.66)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  beaconMark: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(247,195,107,0.08)",
    borderWidth: 1,
    borderColor: "rgba(247,195,107,0.18)",
    marginBottom: 22,
    overflow: "hidden",
  },
  beaconBeam: {
    position: "absolute",
    bottom: 0,
    width: 26,
    height: 110,
    backgroundColor: "rgba(247,195,107,0.22)",
    transform: [{ rotate: "0deg" }],
  },
  activeBeaconBadge: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,248,237,0.07)",
    borderWidth: 1,
    borderColor: "rgba(247,195,107,0.16)",
  },
  activeBeaconDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: "rgba(247,195,107,0.72)",
    shadowColor: "#F7C36B",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 2,
  },
  bookReturnScreen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 28,
    paddingTop: 76,
    paddingBottom: 40,
    overflow: "hidden",
  },
  bookReturnGlowTop: {
    position: "absolute",
    top: -90,
    left: -80,
    right: -80,
    height: 270,
    borderRadius: 160,
    backgroundColor: "rgba(255,255,255,0.56)",
  },
  bookReturnGlowBottom: {
    position: "absolute",
    left: -100,
    right: -100,
    bottom: -90,
    height: 280,
    borderRadius: 170,
    backgroundColor: "rgba(224,204,166,0.18)",
  },
  bookReturnContent: {
    flexGrow: 1,
    justifyContent: "center",
    backgroundColor: "transparent",
    paddingVertical: 36,
  },
  bookReturnEyebrow: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 10,
  },
  bookReturnTitle: {
    color: "#1B2A22",
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "400",
    letterSpacing: -0.9,
    textAlign: "center",
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  bookReturnMinutes: {
    color: "rgba(31,41,51,0.58)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 9,
    marginBottom: 26,
  },
  bookAttributionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderRadius: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    ...softCardShadow,
  },
  bookAttributionCover: {
    width: 68,
    height: 92,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E3E32",
  },
  bookAttributionCoverText: {
    color: "#F7F3EA",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "400",
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  bookAttributionCopy: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bookAttributionLabel: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 7,
  },
  bookAttributionInput: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    padding: 0,
  },
  recentBookPicker: {
    marginTop: 18,
    backgroundColor: "rgba(255,255,255,0.54)",
    borderRadius: 24,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
  },
  recentBookPickerTitle: {
    color: "rgba(31,41,51,0.58)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    marginBottom: 10,
  },
  recentBookChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "transparent",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.06)",
  },
  recentBookMiniCover: {
    width: 34,
    height: 46,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.12)",
  },
  recentBookMiniCoverText: {
    color: colors.accent,
    fontSize: 15,
    lineHeight: 20,
  },
  recentBookChoiceCopy: {
    flex: 1,
    backgroundColor: "transparent",
  },
  recentBookChoiceTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
  },
  recentBookChoiceMeta: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    marginTop: 2,
  },
  bookCompletedCard: {
    marginTop: 18,
    backgroundColor: "rgba(255,255,255,0.54)",
    borderRadius: 24,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
  },
  bookCompletedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "transparent",
  },
  bookCompletedToggleSelected: {
    opacity: 0.96,
  },
  bookCompletedToggleCopy: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bookCompletedLabel: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
  bookCompletedSubtext: {
    color: "rgba(31,41,51,0.56)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    marginTop: 3,
  },
  bookCompletedDisabledHelper: {
    color: "rgba(31,41,51,0.48)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    marginTop: 10,
  },
  bookCompletedSwitchTrack: {
    width: 32,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#C8C4BC",
    padding: 2,
    justifyContent: "center",
  },
  bookCompletedSwitchTrackSelected: {
    backgroundColor: "#C4945A",
  },
  bookCompletedSwitchKnob: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#FFFFFF",
  },
  bookCompletedSwitchKnobSelected: {
    transform: [{ translateX: 14 }],
  },
  bookReturnHelperText: {
    color: "rgba(31,41,51,0.56)",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 20,
    textAlign: "center",
  },
  bookReturnSecondaryButton: {
    flex: 1,
    backgroundColor: "rgba(47,93,80,0.08)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: "center",
  },
  bookReturnSecondaryButtonText: {
    color: "rgba(47,93,80,0.72)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "900",
  },
  bookReturnSaveButton: {
    flex: 1,
    backgroundColor: colors.accentDark,
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: "center",
  },
  bookReturnSaveButtonText: {
    color: "#FFF8ED",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "900",
  },
  bookRevealScreen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 70,
    paddingBottom: 34,
    overflow: "hidden",
  },
  bookRevealContent: {
    flexGrow: 1,
    justifyContent: "center",
    backgroundColor: "transparent",
    paddingVertical: 28,
  },
  bookRevealEyebrow: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 12,
  },
  bookRevealTitle: {
    color: "#1B2A22",
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "400",
    letterSpacing: -0.8,
    textAlign: "center",
    marginBottom: 22,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  bookRevealCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderRadius: 30,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    marginBottom: 18,
    ...cardShadow,
  },
  bookRevealCover: {
    width: 86,
    height: 118,
    borderRadius: 10,
    backgroundColor: "#1E3E32",
    alignItems: "center",
    justifyContent: "center",
    padding: 9,
  },
  bookRevealCoverTitle: {
    color: "#F7F3EA",
    fontSize: 13,
    lineHeight: 17,
    textTransform: "uppercase",
    textAlign: "center",
    letterSpacing: 0.7,
    fontWeight: "800",
  },
  bookRevealTextBlock: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bookRevealLabel: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  bookRevealBookTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
  },
  bookRevealMeta: {
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 10,
  },
  bookRevealContinueButton: {
    backgroundColor: colors.accentDark,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
  },
  bookRevealContinueButtonText: {
    color: "#FFF8ED",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
  },
  bookRevealSecondaryButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    paddingVertical: 13,
  },
  bookRevealSecondaryButtonText: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
  },
  completedBookScreen: {
    flex: 1,
    backgroundColor: "#1C2E25",
  },
  completedBookKeyboardView: {
    flex: 1,
  },
  completedBookRevealContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  completedBookEyebrow: {
    color: "#C4945A",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 16,
  },
  completedBookCoverStage: {
    width: 240,
    height: 182,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    marginBottom: 16,
  },
  completedBookAmbientGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(196,148,90,0.18)",
  },
  completedBookSpark: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#C4945A",
  },
  completedBookCover: {
    width: 110,
    height: 154,
    borderRadius: 12,
    backgroundColor: "#173826",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(240,235,224,0.12)",
  },
  completedBookCoverTitle: {
    color: "#F0EBE0",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "400",
    textAlign: "center",
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  completedBookTitle: {
    color: "#F0EBE0",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "400",
    letterSpacing: -0.3,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 4,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  completedBookStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginVertical: 16,
  },
  completedBookStat: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  completedBookStatValue: {
    color: "#F0EBE0",
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "400",
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  completedBookStatLabel: {
    color: "rgba(240,235,224,0.4)",
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    textAlign: "center",
  },
  completedBookStatDivider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(240,235,224,0.1)",
  },
  completedBookHeadline: {
    color: "#F0EBE0",
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "400",
    textAlign: "center",
    marginBottom: 4,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
  },
  completedBookSubline: {
    color: "rgba(240,235,224,0.5)",
    fontSize: 13,
    lineHeight: 20,
    fontStyle: "italic",
    textAlign: "center",
    marginBottom: 14,
  },
  completedBookReflectionWrap: {
    width: "100%",
  },
  completedBookReflectionLabel: {
    color: "rgba(240,235,224,0.55)",
    fontSize: 12,
    lineHeight: 17,
    fontStyle: "italic",
    textAlign: "center",
    marginBottom: 8,
  },
  completedBookReflectionInput: {
    minHeight: 54,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 12,
    color: "rgba(240,235,224,0.9)",
    fontSize: 13,
    lineHeight: 19,
    fontStyle: "italic",
  },
  completedBookReturnButton: {
    width: "100%",
    height: 48,
    backgroundColor: "#C4945A",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  completedBookReturnButtonText: {
    color: "#1A1208",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
  completedBookSkipButton: {
    paddingVertical: 6,
    alignItems: "center",
  },
  completedBookSkipButtonText: {
    color: "rgba(240,235,224,0.3)",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
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

