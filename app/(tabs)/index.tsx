import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  AppStateStatus,
  Platform,
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
const TOTAL_COMPLETED_SESSIONS_KEY = "totalCompletedSessions";
const CURRENT_BOOK_KEY = "currentBookTitle";
const HAS_SEEN_WELCOME_KEY = "hasSeenRousdWelcome";
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
  note?: string;
  createdAt?: string;
  date?: string;
  source?: "timed" | "logged";
};

type SanctuaryStage = {
  stage: number;
  title: string;
  subtitle: string;
  shortLabel: string;
};

type SanctuaryReveal = {
  stage: number;
  stageChanged: boolean;
  title: string;
  subtitle: string;
  sessionMinutes: string;
  ctaText: string;
};

const sanctuaryStages: SanctuaryStage[] = [
  {
    stage: 0,
    title: "Your place is here.",
    subtitle: "Start a session, then save the book you read.",
    shortLabel: "The Book Is Placed",
  },
  {
    stage: 1,
    title: "The light is on.",
    subtitle: "Your first saved session gave this book a place.",
    shortLabel: "The Light Is On",
  },
  {
    stage: 2,
    title: "This book is becoming familiar.",
    subtitle: "Your reading place is warming around it.",
    shortLabel: "The Shrine Warms",
  },
  {
    stage: 3,
    title: "Your reading rhythm is gathering.",
    subtitle: "Sessions, minutes, and memory are collecting here.",
    shortLabel: "The Place Remembers",
  },
  {
    stage: 4,
    title: "This place is yours now.",
    subtitle: "Your reading life has a steady light in it.",
    shortLabel: "A Reading Life",
  },
];

function getSanctuaryStage(totalSessions: number, totalMinutes: number) {
  if (totalSessions >= 10 || totalMinutes >= 360) return 4;
  if (totalSessions >= 6 || totalMinutes >= 180) return 3;
  if (totalSessions >= 3 || totalMinutes >= 60) return 2;
  if (totalSessions >= 1) return 1;
  return 0;
}

function getNextSanctuaryMilestoneCopy(
  totalSessions: number,
  totalMinutes: number,
) {
  const currentStage = getSanctuaryStage(totalSessions, totalMinutes);

  if (currentStage >= 4) {
    return "Your reading place is fully lit.";
  }

  const nextMilestones = [
    { sessionTarget: 1, minuteTarget: null, label: "the light turns on" },
    { sessionTarget: 3, minuteTarget: 60, label: "the shrine warms" },
    { sessionTarget: 6, minuteTarget: 180, label: "the place remembers" },
    { sessionTarget: 10, minuteTarget: 360, label: "your reading life steadies" },
  ];

  const nextMilestone = nextMilestones[currentStage];
  const sessionsRemaining = Math.max(
    0,
    nextMilestone.sessionTarget - totalSessions,
  );
  const minutesRemaining =
    nextMilestone.minuteTarget === null
      ? null
      : Math.max(0, Math.ceil(nextMilestone.minuteTarget - totalMinutes));

  if (minutesRemaining !== null && minutesRemaining <= 30) {
    return `${minutesRemaining} ${minutesRemaining === 1 ? "minute" : "minutes"} until ${nextMilestone.label}.`;
  }

  return `${sessionsRemaining} ${sessionsRemaining === 1 ? "session" : "sessions"} until ${nextMilestone.label}.`;
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
      title: "The light is on.",
      subtitle: "Your first saved session gave this book a place.",
      ctaText: "See your place",
    };
  }

  if (stage === 2) {
    return {
      title: "The shrine feels warmer.",
      subtitle: "This book is becoming part of your rhythm.",
      ctaText: "Return to the light",
    };
  }

  if (stage === 3) {
    return {
      title: "Your place remembers.",
      subtitle: "Sessions, minutes, and memory are collecting here.",
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
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [currentBookTitle, setCurrentBookTitle] = useState("");
  const [showBookInput, setShowBookInput] = useState(false);
  const [showCloseSessionTransition, setShowCloseSessionTransition] =
    useState(false);
  const [showManualLogInput, setShowManualLogInput] = useState(false);
  const [manualLogMinutes, setManualLogMinutes] = useState("30");
  const [manualLogBookTitle, setManualLogBookTitle] = useState("");
  const [manualLogError, setManualLogError] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<ReadingSession[]>([]);
  const [totalCompletedSessions, setTotalCompletedSessions] = useState(0);
  const [sanctuaryReveal, setSanctuaryReveal] =
    useState<SanctuaryReveal | null>(null);
  const [showRitualScreen, setShowRitualScreen] = useState(false);
  const [ritualCountdownText, setRitualCountdownText] = useState("3");
  const [manualLogNote, setManualLogNote] = useState("");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ritualOpacity = useRef(new Animated.Value(0)).current;
  const ritualScale = useRef(new Animated.Value(0.98)).current;
  const ritualCountdownOpacity = useRef(new Animated.Value(0)).current;
  const ritualCountdownScale = useRef(new Animated.Value(0.92)).current;
  const ritualBreath = useRef(new Animated.Value(0)).current;
  const closeTransitionOpacity = useRef(new Animated.Value(0)).current;
  const closeTransitionScale = useRef(new Animated.Value(0.97)).current;
  const closeTransitionTranslateY = useRef(new Animated.Value(12)).current;
  const revealOpacity = useRef(new Animated.Value(0)).current;
  const revealScale = useRef(new Animated.Value(0.96)).current;
  const revealTranslateY = useRef(new Animated.Value(18)).current;
  const revealSceneScale = useRef(new Animated.Value(0.98)).current;

  useEffect(() => {
    if (!showRitualScreen) return;

    ritualOpacity.setValue(0);
    ritualScale.setValue(0.98);
    ritualCountdownOpacity.setValue(0);
    ritualCountdownScale.setValue(0.92);
    ritualBreath.setValue(0);
    setRitualCountdownText("3");

    const timers: ReturnType<typeof setTimeout>[] = [];

    const pulseCountdown = () => {
      ritualCountdownOpacity.setValue(0);
      ritualCountdownScale.setValue(0.92);

      Animated.parallel([
        Animated.timing(ritualCountdownOpacity, {
          toValue: 1,
          duration: 240,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(ritualCountdownScale, {
            toValue: 1.04,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.timing(ritualCountdownScale, {
            toValue: 1,
            duration: 360,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    };

    const scheduleCountdown = (
      label: string,
      delay: number,
      feedback: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light,
    ) => {
      timers.push(
        setTimeout(() => {
          setRitualCountdownText(label);
          pulseCountdown();
          Haptics.impactAsync(feedback);
        }, delay),
      );
    };

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
          duration: 620,
          useNativeDriver: true,
        }),
        Animated.timing(ritualScale, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(3150),
      Animated.timing(ritualOpacity, {
        toValue: 0,
        duration: 620,
        useNativeDriver: true,
      }),
    ]);

    breathAnimation.start();
    scheduleCountdown("3", 220);
    scheduleCountdown("2", 1040);
    scheduleCountdown("1", 1860);
    scheduleCountdown("Start", 2700, Haptics.ImpactFeedbackStyle.Medium);

    animation.start(({ finished }) => {
      if (finished) {
        setShowRitualScreen(false);
      }
    });

    return () => {
      animation.stop();
      breathAnimation.stop();
      timers.forEach(clearTimeout);
    };
  }, [
    ritualBreath,
    ritualCountdownOpacity,
    ritualCountdownScale,
    ritualOpacity,
    ritualScale,
    showRitualScreen,
  ]);

  useEffect(() => {
    if (!showCloseSessionTransition) return;

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
        setShowCloseSessionTransition(false);
        setShowBookInput(true);
      }
    });

    return () => {
      animation.stop();
    };
  }, [
    closeTransitionOpacity,
    closeTransitionScale,
    closeTransitionTranslateY,
    showCloseSessionTransition,
  ]);

  useEffect(() => {
    if (!sanctuaryReveal) return;

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
  ]);

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
        const savedTotalCompletedSessions = await AsyncStorage.getItem(
          TOTAL_COMPLETED_SESSIONS_KEY,
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
        if (savedStreak !== null) setCurrentStreak(Number(savedStreak));
        setLifetimeSeconds(savedLifetimeTotalSeconds);
        if (savedTotalDaysRead !== null)
          setTotalDaysRead(Number(savedTotalDaysRead));
        if (savedSessions !== null) {
          const parsedSessions = JSON.parse(savedSessions);
          setRecentSessions(parsedSessions);

          if (savedTotalCompletedSessions !== null) {
            setTotalCompletedSessions(Number(savedTotalCompletedSessions));
          } else {
            setTotalCompletedSessions(parsedSessions.length);
          }
        } else if (savedTotalCompletedSessions !== null) {
          setTotalCompletedSessions(Number(savedTotalCompletedSessions));
        }

        if (savedHasSeenWelcome !== "true" && savedActiveSessionStartTime === null) {
          setShowWelcomeScreen(true);
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
      setSanctuaryReveal(null);
      setBookTitle(currentBookTitle);
      setShowBookInput(false);
      setShowCloseSessionTransition(false);
      setShowManualLogInput(false);
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
      setShowCloseSessionTransition(true);
      setSessionMessage(`+${sessionMinutes} minutes added`);
    }
  };

  const saveSession = async (title: string) => {
    const sessionSeconds = pendingSessionSeconds;
    const sessionMinutes = (sessionSeconds / 60).toFixed(1);

    const newSession: ReadingSession = {
      id: Date.now().toString(),
      title,
      minutes: sessionMinutes,
      createdAt: new Date().toISOString(),
      source: "timed",
    };

    const updatedSessions = [newSession, ...recentSessions].slice(0, 5);

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
      stage: updatedSanctuaryStageNumber,
      stageChanged: didSanctuaryStageChange,
      title: revealCopy.title,
      subtitle: revealCopy.subtitle,
      sessionMinutes,
      ctaText: revealCopy.ctaText,
    });

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
    const sessionMinutes = await saveSession("Unassigned reading");

    setSessionMessage(`+${sessionMinutes} minutes added`);
    setShowBookInput(false);

    setTimeout(() => {
      setSessionMessage(null);
    }, 3000);
  };

  const openManualLog = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setManualLogMinutes("30");
    setManualLogBookTitle(currentBookTitle);
    setManualLogNote("");
    setManualLogError(null);
    setSanctuaryReveal(null);
    setSessionMessage(null);
    setShowBookInput(false);
    setShowCloseSessionTransition(false);
    setShowManualLogInput(true);
  };

  const cancelManualLog = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowManualLogInput(false);
    setManualLogNote("");
    setManualLogError(null);
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
    const trimmedTitle = manualLogBookTitle.trim();
    const trimmedNote = manualLogNote.trim();
    const titleToSave = trimmedTitle || "Logged reading";
    const previousLifetimeSeconds = lifetimeSeconds;
    const updatedTodaySeconds = seconds + manualSessionSeconds;
    const updatedLifetimeSeconds = lifetimeSeconds + manualSessionSeconds;

    await updateStreakIfNeeded();

    const newSession: ReadingSession = {
      id: Date.now().toString(),
      title: titleToSave,
      minutes: sessionMinutes,
      note: trimmedNote || undefined,
      createdAt: new Date().toISOString(),
      source: "logged",
    };

    const updatedSessions = [newSession, ...recentSessions].slice(0, 5);
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
    setShowManualLogInput(false);
    setManualLogNote("");
    setManualLogError(null);

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

    setSanctuaryReveal({
      stage: updatedSanctuaryStageNumber,
      stageChanged: didSanctuaryStageChange,
      title: revealCopy.title,
      subtitle: revealCopy.subtitle,
      sessionMinutes,
      ctaText: revealCopy.ctaText,
    });

    setSessionMessage(`+${sessionMinutes} min • logged`);

    setTimeout(() => {
      setSessionMessage(null);
    }, 3500);
  };

  const dismissSanctuaryReveal = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSanctuaryReveal(null);
  };

  const dismissWelcomeScreen = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowWelcomeScreen(false);
    await AsyncStorage.setItem(HAS_SEEN_WELCOME_KEY, "true");
  };

  const formattedTime = formatTime(seconds);
  const goalProgress = seconds / 60;
  const lifetimeMinutes = lifetimeSeconds / 60;
  const goalReached = seconds >= DAILY_GOAL_MINUTES * 60;
  const hasReadToday = lastReadDate === getTodayDateString();
  const visibleSessions = recentSessions.slice(0, 3);
  const latestSession = recentSessions[0];
  const currentBookDisplayTitle =
    currentBookTitle || latestSession?.title || "Your next book";
  const currentBookMeta = currentBookTitle
    ? latestSession?.title === currentBookTitle
      ? `Last read ${formatSessionTimestamp(latestSession.createdAt, latestSession.date)}`
      : "Saved as your current book"
    : "Save a session to place a book here";
  const revealBookTitle =
    bookTitle.trim() || manualLogBookTitle.trim() || currentBookTitle || latestSession?.title || "your book";
  const encouragement =
    encouragementMessages[totalDaysRead % encouragementMessages.length];

  const sanctuaryStageNumber = getSanctuaryStage(
    totalCompletedSessions,
    lifetimeMinutes,
  );
  const currentSanctuaryStage = sanctuaryStages[sanctuaryStageNumber];
  const sanctuaryStage = currentSanctuaryStage.stage;
  const nextSanctuaryMilestoneCopy = getNextSanctuaryMilestoneCopy(
    totalCompletedSessions,
    lifetimeMinutes,
  );
  const ritualBreathScale = ritualBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const ritualBreathOpacity = ritualBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.16, 0.34],
  });

  if (!isLoaded) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText style={styles.loadingText}>Loading Rousd...</ThemedText>
      </ThemedView>
    );
  }

  if (showWelcomeScreen) {
    return (
      <ThemedView style={styles.welcomeScreen}>
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
          <View style={styles.activeBeaconBadge}>
            <ThemedText style={styles.activeBeaconIcon}>♜</ThemedText>
          </View>
          <ThemedText style={styles.quietSessionSubtitle}>
            The story is yours.
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
            style={[
              styles.ritualOverlay,
              { opacity: ritualOpacity, transform: [{ scale: ritualScale }] },
            ]}
          >
            <View style={styles.sessionGlowOne} />
            <View style={styles.sessionGlowTwo} />

            <View style={styles.sessionContent}>
              <View style={styles.beaconMark}>
                <View style={styles.beaconBeam} />
                <ThemedText style={styles.sessionBookIcon}>♜</ThemedText>
              </View>
              <ThemedText style={styles.sessionTitle}>
                Your reading session has begun
              </ThemedText>
              <ThemedText style={styles.sessionSubtitle}>
                We will keep time.                   
              </ThemedText>

              <View style={styles.ritualCountdownArea}>
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
                    styles.ritualCountdownBubble,
                    {
                      opacity: ritualCountdownOpacity,
                      transform: [{ scale: ritualCountdownScale }],
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.ritualCountdownText,
                      ritualCountdownText.length > 1 &&
                        styles.ritualCountdownTextLong,
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {ritualCountdownText}
                  </ThemedText>
                </Animated.View>
              </View>

              <ThemedText style={styles.ritualInstruction}>
                Open your book or e-reader.{"\n"}Place your phone down.
              </ThemedText>

              <View style={styles.focusPill}>
                <ThemedText style={styles.focusPillText}>
                  Settle in.                 
                </ThemedText>
              </View>
            </View>
          </Animated.View>
        )}
      </ThemedView>
    );
  }

  if (showCloseSessionTransition) {
    const pendingMinutes = (pendingSessionSeconds / 60).toFixed(1);

    return (
      <ThemedView style={styles.closeTransitionScreen}>
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
            +{pendingMinutes} minutes read
          </ThemedText>
          <ThemedText style={styles.closeTransitionSubtext}>
            Take a breath. Then we’ll save this time to the book you read.
          </ThemedText>
        </Animated.View>
      </ThemedView>
    );
  }

  if (showBookInput) {
    const pendingMinutes = (pendingSessionSeconds / 60).toFixed(1);

    return (
      <ThemedView style={styles.bookReturnScreen}>
        <View pointerEvents="none" style={styles.bookReturnGlowTop} />
        <View pointerEvents="none" style={styles.bookReturnGlowBottom} />

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.bookReturnContent}
        >
          <ThemedText style={styles.bookReturnEyebrow}>Welcome back</ThemedText>
          <ThemedText style={styles.bookReturnTitle}>
            What did you read?
          </ThemedText>
          <ThemedText style={styles.bookReturnMinutes}>
            Your time was kept • {pendingMinutes} minutes
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
                    <ThemedText style={styles.recentBookMiniCoverText}>⌁</ThemedText>
                  </View>
                  <View style={styles.recentBookChoiceCopy}>
                    <ThemedText style={styles.recentBookChoiceTitle} numberOfLines={1}>
                      {session.title}
                    </ThemedText>
                    <ThemedText style={styles.recentBookChoiceMeta}>
                      Last saved • {session.minutes}m
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <ThemedText style={styles.bookReturnHelperText}>
            This is where Google Books search will live next. For now, type a title or choose a recent book.
          </ThemedText>

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
      </ThemedView>
    );
  }

  if (showManualLogInput) {
    const presetMinutes = ["10", "20", "30", "45", "60"];

    return (
      <ThemedView style={styles.closeSessionScreen}>
        <View style={styles.sessionGlowOne} />
        <View style={styles.sessionGlowTwo} />

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.closeSessionContent}
        >
          <ThemedText style={styles.closeEyebrow}>Manual log</ThemedText>
          <ThemedText style={styles.closeTitle}>Keep the record honest.</ThemedText>
          <ThemedText style={styles.closeMinutes}>
            Timed sessions are the ritual. Logged sessions keep your reading place in sync.
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
                    {minutes}m
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
            Manual logs count toward your reading time and reading-place progress, but they’ll be marked as logged sessions in your history.
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
      </ThemedView>
    );
  }

  if (sanctuaryReveal) {
    return (
      <ThemedView style={styles.bookRevealScreen}>
        <View pointerEvents="none" style={styles.bookReturnGlowTop} />
        <View pointerEvents="none" style={styles.bookReturnGlowBottom} />

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
          <ScrollView contentContainerStyle={styles.bookRevealContent}>
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
                  +{sanctuaryReveal.sessionMinutes} minutes added
                </ThemedText>
              </View>
            </Animated.View>

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
              onPress={dismissSanctuaryReveal}
            >
              <ThemedText style={styles.bookRevealContinueButtonText}>
                {sanctuaryReveal.ctaText}
              </ThemedText>
            </Pressable>
          </ScrollView>
        </Animated.View>
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
              Keep a light on for your reading life.
            </ThemedText>
          </View>

          <View style={styles.streakPill}>
            <ThemedText style={styles.streakPillText}>
              🔥 {currentStreak}
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
              {currentSanctuaryStage.shortLabel}
            </ThemedText>
          </View>

          <ThemedText style={styles.bookShrineGreeting}>
            Good evening
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
            <View style={styles.bookShrineProgressRow}>
              <View style={styles.bookShrineProgressDot} />
              <ThemedText style={styles.bookShrineProgressText}>
                {nextSanctuaryMilestoneCopy}
              </ThemedText>
            </View>
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
            <ThemedText style={styles.startHeroIcon}>⌁</ThemedText>
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
              <ThemedText style={styles.startHeroArrow}>→</ThemedText>
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
            <ThemedText style={styles.manualLogIcon}>＋</ThemedText>
            <ThemedText style={styles.manualLogButtonText}>
              Log reading manually
            </ThemedText>
            <ThemedText style={styles.manualLogChevron}>›</ThemedText>
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
            <ThemedText style={styles.coverPlaceholderText}>✦</ThemedText>
          </View>
          <View style={styles.currentBookCopy}>
            <ThemedText style={styles.premiumCurrentBookLabel}>
              Reading place
            </ThemedText>
            <ThemedText style={styles.currentBookTitleText} numberOfLines={2}>
              {currentSanctuaryStage.title}
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
              Start a session with any book or e-reader to begin your archive.
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
                    {session.source === "logged" ? "Manually Logged" : "Timed"} • {formatSessionTimestamp(session.createdAt, session.date)}
                  </ThemedText>
                  {session.note ? (
                    <ThemedText style={styles.sessionNote} numberOfLines={2}>
                      {session.note}
                    </ThemedText>
                  ) : null}
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
    paddingBottom: 120,
  },
  container: {
    flex: 1,
    position: "relative",
    paddingHorizontal: 24,
    paddingTop: 38,
    paddingBottom: 40,
    gap: 12,
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
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: "transparent",
    marginBottom: 8,
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
    lineHeight: 21,
    color: colors.mutedText,
    fontWeight: "600",
    marginTop: 2,
  },
  streakPill: {
    backgroundColor: "rgba(255,255,255,0.68)",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 8,
    ...cardShadow,
  },
  streakPillText: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    fontWeight: "800",
  },
  sanctuaryHero: {
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: "#0B2A22",
    borderWidth: 1,
    borderColor: "rgba(23,56,38,0.10)",
    ...cardShadow,
    zIndex: 2,
  },
  sanctuaryHeroScene: {
    height: 186,
    backgroundColor: "#1B4234",
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,248,237,0.08)",
  },
  sanctuaryHeroSkyGlow: {
    position: "absolute",
    top: -78,
    left: -40,
    right: -40,
    height: 210,
    borderRadius: 140,
    backgroundColor: "rgba(255,248,237,0.08)",
  },
  sanctuaryHeroMoonGlow: {
    position: "absolute",
    top: 30,
    left: 42,
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: "rgba(247,195,107,0.14)",
  },
  sanctuaryHeroWindowGlow: {
    position: "absolute",
    top: 38,
    left: 78,
    right: 78,
    height: 112,
    borderRadius: 58,
    backgroundColor: "rgba(247,195,107,0.48)",
  },
  sanctuaryHeroWindowFrame: {
    position: "absolute",
    top: 46,
    left: 96,
    right: 96,
    height: 110,
    borderRadius: 56,
    borderWidth: 2,
    borderColor: "rgba(255,248,237,0.34)",
  },
  sanctuaryHeroWindowDivider: {
    position: "absolute",
    top: 52,
    alignSelf: "center",
    width: 2,
    height: 98,
    borderRadius: 1,
    backgroundColor: "rgba(255,248,237,0.28)",
  },
  sanctuaryHeroBackWallShelf: {
    position: "absolute",
    top: 156,
    left: 34,
    width: 116,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(106,70,59,0.26)",
  },
  sanctuaryHeroFloor: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 68,
    backgroundColor: "rgba(184,144,104,0.64)",
  },
  sanctuaryHeroRug: {
    position: "absolute",
    left: 72,
    right: 72,
    bottom: 24,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(201,133,104,0.62)",
  },
  sanctuaryHeroChair: {
    position: "absolute",
    left: 52,
    bottom: 42,
    width: 82,
    height: 74,
    borderRadius: 30,
    backgroundColor: "rgba(106,70,59,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.08)",
  },
  sanctuaryHeroBlanket: {
    position: "absolute",
    right: 8,
    bottom: 7,
    width: 31,
    height: 39,
    borderRadius: 14,
    backgroundColor: "rgba(247,195,107,0.72)",
  },
  sanctuaryHeroSideTable: {
    position: "absolute",
    left: 148,
    bottom: 42,
    width: 38,
    height: 46,
    borderRadius: 12,
    backgroundColor: "rgba(106,70,59,0.58)",
  },
  sanctuaryHeroPlantPot: {
    position: "absolute",
    right: 72,
    bottom: 48,
    width: 36,
    height: 26,
    borderRadius: 12,
    backgroundColor: "rgba(201,133,104,0.78)",
  },
  sanctuaryHeroLeaf: {
    position: "absolute",
    width: 29,
    height: 42,
    borderRadius: 22,
    backgroundColor: "rgba(116,138,93,0.72)",
  },
  sanctuaryHeroLeafOne: {
    right: 82,
    bottom: 72,
    transform: [{ rotate: "-24deg" }],
  },
  sanctuaryHeroLeafTwo: {
    right: 62,
    bottom: 76,
    backgroundColor: "rgba(95,117,77,0.70)",
    transform: [{ rotate: "25deg" }],
  },
  sanctuaryHeroQuietCorner: {
    position: "absolute",
    right: 40,
    bottom: 50,
    width: 74,
    height: 24,
    borderRadius: 999,
    backgroundColor: "rgba(23,56,38,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  sanctuaryHeroQuietLine: {
    width: 44,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,248,237,0.20)",
  },
  sanctuaryHeroStove: {
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
  },
  sanctuaryHeroStovePipe: {
    position: "absolute",
    top: -58,
    width: 8,
    height: 64,
    borderRadius: 5,
    backgroundColor: "#39413C",
  },
  sanctuaryHeroStoveTop: {
    position: "absolute",
    top: -6,
    left: 13,
    right: 13,
    height: 8,
    borderRadius: 5,
    backgroundColor: "#48514B",
  },
  sanctuaryHeroStoveHandle: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,248,237,0.24)",
  },
  sanctuaryHeroStoveWindow: {
    width: 42,
    height: 26,
    borderRadius: 8,
    backgroundColor: "#2A2925",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  sanctuaryHeroFaintEmber: {
    width: 18,
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(239,143,62,0.55)",
  },
  sanctuaryHeroFireGlow: {
    position: "absolute",
    width: 44,
    height: 28,
    borderRadius: 15,
    backgroundColor: "rgba(239,143,62,0.72)",
  },
  sanctuaryHeroFireCore: {
    width: 16,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#F7C36B",
  },
  sanctuaryHeroStoveLegLeft: {
    position: "absolute",
    left: 13,
    bottom: -8,
    width: 8,
    height: 13,
    borderRadius: 3,
    backgroundColor: "#39413C",
  },
  sanctuaryHeroStoveLegRight: {
    position: "absolute",
    right: 13,
    bottom: -8,
    width: 8,
    height: 13,
    borderRadius: 3,
    backgroundColor: "#39413C",
  },
  sanctuaryHeroBookStack: {
    position: "absolute",
    left: 34,
    bottom: 44,
    width: 56,
    gap: 4,
  },
  sanctuaryHeroBookOne: {
    width: 50,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F7C36B",
  },
  sanctuaryHeroBookTwo: {
    width: 42,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(201,133,104,0.78)",
  },
  sanctuaryHeroBookThree: {
    width: 54,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFF8ED",
  },
  sanctuaryHeroMug: {
    position: "absolute",
    left: 156,
    bottom: 92,
    width: 25,
    height: 19,
    borderRadius: 10,
    backgroundColor: "#FFF8ED",
  },
  sanctuaryHeroMugHandle: {
    position: "absolute",
    left: 177,
    bottom: 96,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#FFF8ED",
  },
  sanctuaryHeroVine: {
    position: "absolute",
    top: 30,
    left: 38,
    right: 44,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(116,138,93,0.58)",
  },
  sanctuaryHeroHangingLeafOne: {
    position: "absolute",
    top: 36,
    right: 72,
    width: 26,
    height: 54,
    borderRadius: 18,
    backgroundColor: "rgba(116,138,93,0.66)",
    transform: [{ rotate: "-14deg" }],
  },
  sanctuaryHeroHangingLeafTwo: {
    position: "absolute",
    top: 42,
    left: 76,
    width: 22,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(95,117,77,0.62)",
    transform: [{ rotate: "18deg" }],
  },
  sanctuaryHeroShelf: {
    position: "absolute",
    left: 40,
    top: 100,
    width: 102,
    height: 42,
    borderRadius: 10,
    backgroundColor: "rgba(106,70,59,0.58)",
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingBottom: 9,
    gap: 5,
  },
  sanctuaryHeroShelfBookOne: {
    width: 10,
    height: 24,
    borderRadius: 2,
    backgroundColor: "#F7C36B",
  },
  sanctuaryHeroShelfBookTwo: {
    width: 10,
    height: 18,
    borderRadius: 2,
    backgroundColor: "#FFF8ED",
  },
  sanctuaryHeroShelfBookThree: {
    width: 10,
    height: 30,
    borderRadius: 2,
    backgroundColor: "rgba(201,133,104,0.78)",
  },
  sanctuaryHeroShelfBookFour: {
    width: 10,
    height: 21,
    borderRadius: 2,
    backgroundColor: "rgba(116,138,93,0.72)",
  },
  sanctuaryHeroProgressPill: {
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
  },
  sanctuaryHeroProgressText: {
    color: "#173826",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  sanctuaryHeroCopy: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 17,
    backgroundColor: "#0B2A22",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,248,237,0.10)",
  },
  sanctuaryHeroEyebrow: {
    color: "rgba(255,248,237,0.72)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  sanctuaryHeroTitle: {
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
  },
  sanctuaryHeroDivider: {
    width: 52,
    height: 1,
    backgroundColor: "rgba(255,248,237,0.48)",
    marginTop: 8,
    marginBottom: 8,
  },
  sanctuaryHeroSubtitle: {
    color: "rgba(255,248,237,0.78)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  sanctuaryMilestonePill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,248,237,0.075)",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.12)",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  sanctuaryMilestoneText: {
    color: "rgba(255,248,237,0.82)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  sanctuaryHeroStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "transparent",
    marginTop: 12,
  },
  sanctuaryHeroIconBadge: {
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
  },
  sanctuaryHeroStat: {
    backgroundColor: "transparent",
  },
  sanctuaryHeroStatNumber: {
    color: "#FFF8ED",
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "700",
    letterSpacing: -0.35,
  },
  sanctuaryHeroStatLabel: {
    color: "rgba(255,248,237,0.66)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 1,
  },
  sanctuaryHeroStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,248,237,0.18)",
  },
  sanctuaryCard: {
    backgroundColor: "rgba(255,248,237,0.86)",
    borderRadius: 30,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(23,56,38,0.10)",
    ...softCardShadow,
    zIndex: 2,
  },
  sanctuaryHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: "transparent",
    marginBottom: 10,
  },
  sanctuaryHeaderCopy: {
    flex: 1,
    backgroundColor: "transparent",
    paddingRight: 12,
  },
  sanctuaryEyebrow: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  sanctuaryTitle: {
    color: "#173826",
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "900",
    letterSpacing: -0.45,
  },
  sanctuaryStagePill: {
    backgroundColor: "rgba(23,56,38,0.08)",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: "rgba(23,56,38,0.08)",
  },
  sanctuaryStagePillText: {
    color: "rgba(23,56,38,0.72)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
  },
  sanctuaryScene: {
    height: 210,
    borderRadius: 26,
    backgroundColor: "#1F472F",
    overflow: "hidden",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(23,56,38,0.14)",
  },
  sanctuaryWindowGlow: {
    position: "absolute",
    top: 24,
    left: 48,
    right: 48,
    height: 112,
    borderRadius: 62,
    backgroundColor: "rgba(247,195,107,0.72)",
  },
  sanctuaryHearthAura: {
    position: "absolute",
    right: 10,
    bottom: 18,
    width: 144,
    height: 112,
    borderRadius: 56,
    backgroundColor: "rgba(239,143,62,0.20)",
  },
  sanctuaryWindowFrame: {
    position: "absolute",
    top: 31,
    left: 68,
    right: 68,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    borderColor: "rgba(255,248,237,0.5)",
  },
  sanctuaryWindowDivider: {
    position: "absolute",
    top: 35,
    alignSelf: "center",
    width: 2,
    height: 102,
    borderRadius: 1,
    backgroundColor: "rgba(255,248,237,0.44)",
  },
  sanctuaryFloor: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 82,
    backgroundColor: "rgba(184,144,104,0.82)",
  },
  sanctuaryRug: {
    position: "absolute",
    left: 64,
    right: 64,
    bottom: 24,
    height: 30,
    borderRadius: 20,
    backgroundColor: "rgba(201,133,104,0.88)",
  },
  sanctuaryChair: {
    position: "absolute",
    left: 74,
    bottom: 46,
    width: 84,
    height: 76,
    borderRadius: 24,
    backgroundColor: "rgba(106,70,59,0.82)",
  },
  sanctuaryBlanket: {
    position: "absolute",
    right: 10,
    bottom: 8,
    width: 32,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(247,195,107,0.78)",
  },
  sanctuaryPlantPot: {
    position: "absolute",
    right: 74,
    bottom: 54,
    width: 36,
    height: 28,
    borderRadius: 10,
    backgroundColor: "rgba(201,133,104,0.78)",
  },
  sanctuaryLeaf: {
    position: "absolute",
    right: 78,
    bottom: 78,
    width: 28,
    height: 42,
    borderRadius: 20,
    backgroundColor: "rgba(116,138,93,0.72)",
  },
  sanctuaryLeafOne: {
    transform: [{ rotate: "-22deg" }],
  },
  sanctuaryLeafTwo: {
    right: 94,
    bottom: 82,
    backgroundColor: "rgba(95,117,77,0.70)",
    transform: [{ rotate: "24deg" }],
  },
  sanctuaryLeafGrown: {
    height: 55,
    bottom: 82,
  },
  unlitCorner: {
    position: "absolute",
    right: 38,
    bottom: 56,
    width: 64,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(23,56,38,0.20)",
    alignItems: "center",
    justifyContent: "center",
  },
  unlitCornerLine: {
    width: 42,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,248,237,0.18)",
  },
  ironStove: {
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
  },
  ironStovePipe: {
    position: "absolute",
    top: -60,
    left: 32,
    width: 8,
    height: 64,
    borderRadius: 4,
    backgroundColor: "#39413C",
  },
  ironStoveTop: {
    position: "absolute",
    top: -5,
    left: 12,
    right: 12,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#48514B",
  },
  ironStoveHandle: {
    position: "absolute",
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,248,237,0.22)",
  },
  ironStoveWindow: {
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
  },
  faintEmber: {
    width: 18,
    height: 6,
    borderRadius: 6,
    backgroundColor: "rgba(239,143,62,0.5)",
  },
  fireGlow: {
    position: "absolute",
    width: 44,
    height: 26,
    borderRadius: 15,
    backgroundColor: "rgba(239,143,62,0.88)",
  },
  fireIcon: {
    color: "#F7C36B",
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
  },
  ironStoveLegLeft: {
    position: "absolute",
    left: 12,
    bottom: -8,
    width: 8,
    height: 12,
    borderRadius: 3,
    backgroundColor: "#39413C",
  },
  ironStoveLegRight: {
    position: "absolute",
    right: 12,
    bottom: -8,
    width: 8,
    height: 12,
    borderRadius: 3,
    backgroundColor: "#39413C",
  },
  sanctuaryBookStack: {
    position: "absolute",
    left: 28,
    bottom: 54,
    width: 48,
    height: 28,
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  sanctuaryBookOne: {
    width: 44,
    height: 7,
    borderRadius: 3,
    backgroundColor: "#F7C36B",
  },
  sanctuaryBookTwo: {
    width: 36,
    height: 7,
    borderRadius: 3,
    backgroundColor: "rgba(201,133,104,0.78)",
    marginBottom: 3,
  },
  sanctuaryBookThree: {
    width: 42,
    height: 7,
    borderRadius: 3,
    backgroundColor: "#FFF8ED",
    marginBottom: 3,
  },
  sanctuaryMug: {
    position: "absolute",
    left: 166,
    bottom: 56,
    width: 24,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FFF8ED",
  },
  sanctuaryShelf: {
    position: "absolute",
    left: 36,
    top: 74,
    width: 92,
    height: 42,
    borderRadius: 8,
    backgroundColor: "rgba(106,70,59,0.78)",
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 9,
    paddingBottom: 8,
    gap: 5,
  },
  sanctuaryShelfBookOne: {
    width: 10,
    height: 24,
    borderRadius: 2,
    backgroundColor: "#F7C36B",
  },
  sanctuaryShelfBookTwo: {
    width: 10,
    height: 18,
    borderRadius: 2,
    backgroundColor: "#FFF8ED",
  },
  sanctuaryShelfBookThree: {
    width: 10,
    height: 28,
    borderRadius: 2,
    backgroundColor: "rgba(201,133,104,0.78)",
  },
  sanctuaryVine: {
    position: "absolute",
    top: 42,
    left: 34,
    right: 44,
    height: 9,
    borderRadius: 999,
    backgroundColor: "rgba(116,138,93,0.72)",
  },
  sanctuaryHangingLeaf: {
    position: "absolute",
    top: 48,
    right: 54,
    width: 30,
    height: 58,
    borderRadius: 18,
    backgroundColor: "rgba(116,138,93,0.66)",
    transform: [{ rotate: "-12deg" }],
  },
  sanctuaryMainCopy: {
    color: "#173826",
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  sanctuarySubCopy: {
    color: "rgba(31,41,51,0.64)",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
    marginTop: 5,
  },
  startHero: {
    minHeight: 62,
    marginTop: 2,
    backgroundColor: "#1F4F3B",
    borderRadius: 25,
    paddingHorizontal: 20,
    justifyContent: "center",
    shadowColor: "#315F52",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.10,
    shadowRadius: 15,
    elevation: 4,
    zIndex: 3,
  },
  startHeroGoalReached: {
    backgroundColor: colors.accentDark,
  },
  startHeroContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
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
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "700",
    letterSpacing: -0.25,
    flexShrink: 1,
  },
  startHeroArrowCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  startHeroArrow: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "600",
  },
  startHeroSubtitle: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
    fontWeight: "600",
    flexShrink: 1,
  },
  manualLogButton: {
    backgroundColor: "rgba(255,255,255,0.46)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
    borderRadius: 22,
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
  manualLogIcon: {
    color: "rgba(36,72,62,0.58)",
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "500",
  },
  manualLogButtonText: {
    flex: 1,
    color: "rgba(36,72,62,0.84)",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  manualLogChevron: {
    color: "rgba(36,72,62,0.44)",
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "300",
  },
  manualLogButtonSubtext: {
    color: "rgba(107,114,128,0.72)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 2,
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
    fontWeight: "700",
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
    fontWeight: "700",
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
    marginTop: 9,
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
    fontWeight: "700",
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
    fontSize: 40,
    lineHeight: 48,
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
  ritualCountdownArea: {
    width: 176,
    height: 156,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 36,
  },
  ritualBreathRing: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "rgba(244,197,126,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  ritualCountdownBubble: {
    width: 136,
    height: 104,
    borderRadius: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  ritualCountdownText: {
    color: "#FFF8EE",
    fontSize: 38,
    lineHeight: 44,
    fontWeight: "900",
    letterSpacing: -0.8,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  ritualCountdownTextLong: {
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
  },
  ritualInstruction: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 20,
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
  manualBookInput: {
    marginTop: 13,
  },
  manualNoteInput: {
    minHeight: 92,
    fontSize: 16,
    lineHeight: 22,
  },
  manualPresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    backgroundColor: "transparent",
    marginTop: 24,
    marginBottom: 14,
  },
  manualPresetChip: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 15,
  },
  manualPresetChipSelected: {
    backgroundColor: "rgba(255,255,255,0.9)",
    borderColor: "rgba(255,255,255,0.9)",
  },
  manualPresetChipText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
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
    borderRadius: 34,
    overflow: "hidden",
    backgroundColor: "rgba(255,248,237,0.76)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.09)",
    paddingTop: 20,
    paddingHorizontal: 18,
    paddingBottom: 18,
    zIndex: 2,
    ...cardShadow,
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
    fontSize: 29,
    lineHeight: 35,
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
    marginTop: 4,
  },
  bookShrineShelf: {
    height: 176,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    marginTop: 18,
  },
  bookShrineCover: {
    width: 118,
    height: 158,
    borderRadius: 10,
    backgroundColor: "#1E3E32",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.36)",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
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
    right: 42,
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
    backgroundColor: "rgba(255,255,255,0.72)",
    borderRadius: 24,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
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
  bookShrineProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "transparent",
    marginTop: 10,
  },
  bookShrineProgressDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(47,93,80,0.44)",
  },
  bookShrineProgressText: {
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
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(247,195,107,0.08)",
    borderWidth: 1,
    borderColor: "rgba(247,195,107,0.18)",
    marginTop: 22,
  },
  activeBeaconIcon: {
    color: "rgba(247,195,107,0.86)",
    fontSize: 20,
    lineHeight: 24,
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
