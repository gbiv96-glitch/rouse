import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Pressable, ScrollView } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";

const SECONDS_KEY = "todaysReadingSeconds";
const DATE_KEY = "lastReadDate";
const STREAK_KEY = "currentStreak";
const LIFETIME_SECONDS_KEY = "lifetimeReadingSeconds";
const TOTAL_DAYS_READ_KEY = "totalDaysRead";
const DAILY_GOAL_MINUTES = 10;

function getTodayDateString() {
  return new Date().toISOString().split("T")[0];
}

function getYesterdayDateString() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split("T")[0];
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
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
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const loadSavedData = async () => {
      try {
        const savedSeconds = await AsyncStorage.getItem(SECONDS_KEY);
        const savedDate = await AsyncStorage.getItem(DATE_KEY);
        const savedStreak = await AsyncStorage.getItem(STREAK_KEY);
        const savedLifetimeSeconds = await AsyncStorage.getItem(
          LIFETIME_SECONDS_KEY
        );
        const savedTotalDaysRead = await AsyncStorage.getItem(
          TOTAL_DAYS_READ_KEY
        );

        const today = getTodayDateString();

        if (savedDate !== today) {
          setSeconds(0);
        } else if (savedSeconds !== null) {
          setSeconds(Number(savedSeconds));
        }

        if (savedDate !== null) {
          setLastReadDate(savedDate);
        }

        if (savedStreak !== null) {
          setCurrentStreak(Number(savedStreak));
        }

        if (savedLifetimeSeconds !== null) {
          setLifetimeSeconds(Number(savedLifetimeSeconds));
        }

        if (savedTotalDaysRead !== null) {
          setTotalDaysRead(Number(savedTotalDaysRead));
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
    let interval: ReturnType<typeof setInterval> | undefined;

    if (isReading) {
      interval = setInterval(() => {
        setSeconds((prev) => prev + 1);
        setLifetimeSeconds((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isReading]);

  const updateStreakIfNeeded = async () => {
    const today = getTodayDateString();
    const yesterday = getYesterdayDateString();

    if (lastReadDate === today) {
      return;
    }

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
    if (!isReading) {
      await updateStreakIfNeeded();
      setSessionStartSeconds(seconds);
      setSessionMessage(null);
      setIsReading(true);
    } else {
      setIsReading(false);

      const sessionSeconds = seconds - sessionStartSeconds;
      const sessionMinutes = (sessionSeconds / 60).toFixed(1);

      setSessionMessage(`+${sessionMinutes} minutes added`);

      setTimeout(() => {
        setSessionMessage(null);
      }, 3000);
    }
  };

  const formattedTime = formatTime(seconds);
  const goalProgress = seconds / 60;
  const lifetimeMinutes = lifetimeSeconds / 60;
  const goalReached = seconds >= DAILY_GOAL_MINUTES * 60;
  const hasReadToday = lastReadDate === getTodayDateString();

  if (!isLoaded) {
    return (
      <ThemedView
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ThemedText>Loading Rouse...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <ThemedView
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          paddingHorizontal: 24,
          paddingVertical: 40,
        }}
      >
        <ThemedText type="title">Today's Reading</ThemedText>

        <ThemedText type="subtitle">{formattedTime}</ThemedText>

        <ThemedText
          type="subtitle"
          style={{
            fontSize: goalReached ? 34 : 28,
          }}
        >
          🔥 {currentStreak} day streak
        </ThemedText>

        {hasReadToday && (
          <ThemedText
            style={{
              fontSize: 18,
              color: "#4CAF50",
              fontWeight: "bold",
              textAlign: "center",
            }}
          >
            You showed up today ✔️
          </ThemedText>
        )}

        <ThemedText>
          Goal: {goalProgress.toFixed(1)}/{DAILY_GOAL_MINUTES} min
        </ThemedText>

        <ThemedText
          style={{
            fontSize: goalReached ? 24 : 20,
            fontWeight: goalReached ? "bold" : "normal",
            color: goalReached ? "#4CAF50" : "white",
            textAlign: "center",
          }}
        >
          {goalReached ? "✅ Goal crushed. Reader mode activated." : "Keep going…"}
        </ThemedText>

        {sessionMessage && (
          <ThemedText
            style={{
              fontSize: 18,
              color: "#4CAF50",
              fontWeight: "bold",
              textAlign: "center",
            }}
          >
            {sessionMessage}
          </ThemedText>
        )}

        <ThemedView
          style={{
            alignItems: "center",
            gap: 6,
            paddingVertical: 12,
          }}
        >
          <ThemedText>
            Lifetime Reading: {lifetimeMinutes.toFixed(1)} min
          </ThemedText>
          <ThemedText>Total Days Read: {totalDaysRead}</ThemedText>
        </ThemedView>

        <Pressable
          style={{
            backgroundColor: goalReached
              ? "#2E7D32"
              : isReading
                ? "#d9534f"
                : "#4CAF50",
            paddingVertical: 14,
            paddingHorizontal: 28,
            borderRadius: 10,
            minWidth: 200,
            alignItems: "center",
          }}
          onPress={handlePress}
        >
          <ThemedText style={{ color: "white", fontWeight: "bold" }}>
            {isReading ? "End Session" : "Start Reading"}
          </ThemedText>
        </Pressable>

        <ThemedText>
          {isReading
            ? "Reading session in progress..."
            : "Tap start to begin a session."}
        </ThemedText>
      </ThemedView>
    </ScrollView>
  );
}