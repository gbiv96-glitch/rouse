import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  Image,
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
import { Fonts } from "@/constants/theme";
import { searchGoogleBooks } from "@/services/googleBooks";
import type { BookMetadata, BookMetadataFields } from "@/types/book";
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
const LEGACY_UNATTACHED_SESSION_TITLE = "Unassigned reading";
const UNATTACHED_SESSION_TITLE = "A reading moment";
const UNATTACHED_SESSION_DISPLAY_TITLE = "A reading moment";
const BOOK_LOOKUP_TIMEOUT_MS = 9500;
const serifFont = Fonts?.serif ?? "serif";
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
} & BookMetadataFields;

type CompletedBookReview = {
  id: string;
  title: string;
  review: string;
  completedAt: string;
  sessionMinutes: string;
  totalBookMinutes?: string;
  sessionCount?: number;
} & BookMetadataFields;

type CompletedBookMoment = {
  sessionId: string;
  title: string;
  sessionMinutes: string;
  totalBookMinutes: string;
  sessionCount: number;
} & BookMetadataFields;

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
  | "menu"
  | "diary"
  | "finishedBooks"
  | "finishedBookDetail";

type LibraryReturnTarget = "home" | "menu";

type BookAttributionStep = "choose" | "reflect";

type SavingAction =
  | "bookInput"
  | "bookInputSkip"
  | "manualLog"
  | "revealNote"
  | "completedBookSave"
  | "completedBookSkip"
  | null;

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
  noteSaved?: boolean;
} & BookMetadataFields;

const sanctuaryStages: SanctuaryStage[] = [
  {
    stage: 0,
    title: "Your place is here.",
    subtitle: "Start reading, then save the book you read.",
    shortLabel: "Reading Place",
  },
  {
    stage: 1,
    title: "The light is on.",
    subtitle: "Your first saved moment gave this book a place.",
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
    subtitle: "Reading moments and memory are collecting here.",
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
  "The rest can wait a little while.",
];

const completedBookReflectionPrompts = [
  "What did this book give you?",
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
      subtitle: "A little more of this book is kept here now.",
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
    return `Today - ${time}`;
  }

  if (sessionDate.toDateString() === yesterday.toDateString()) {
    return `Yesterday - ${time}`;
  }

  return `${sessionDate.toLocaleDateString()} - ${time}`;
}

function formatRecentReadingTimestamp(createdAt?: string) {
  return formatSessionTimestamp(createdAt)
    .replace(/^Today/, "today")
    .replace(/^Yesterday/, "yesterday");
}

function formatCurrentBookTimestamp(createdAt?: string) {
  if (!createdAt) return "Recently";

  const sessionDate = new Date(createdAt);

  if (Number.isNaN(sessionDate.getTime())) {
    return "Recently";
  }

  const now = new Date();
  const includesYear = sessionDate.getFullYear() !== now.getFullYear();
  const date = sessionDate.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(includesYear ? { year: "numeric" as const } : {}),
  });
  const time = sessionDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${date} \u00B7 ${time}`;
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

function getValidBookTitle(title?: string | null) {
  const trimmedTitle = title?.trim() ?? "";
  return trimmedTitle.length > 0 ? trimmedTitle : null;
}

function isUnattachedSessionTitle(title?: string | null) {
  return (
    title === UNATTACHED_SESSION_TITLE ||
    title === LEGACY_UNATTACHED_SESSION_TITLE
  );
}

function getDisplaySessionTitle(title?: string | null) {
  return isUnattachedSessionTitle(title)
    ? UNATTACHED_SESSION_DISPLAY_TITLE
    : title || UNATTACHED_SESSION_DISPLAY_TITLE;
}

function getBookMetadataFields(
  metadata?: BookMetadata | null,
): BookMetadataFields {
  if (!metadata) {
    return {};
  }

  return {
    author: metadata.author ?? null,
    coverUrl: metadata.coverUrl ?? null,
    googleBooksId: metadata.googleBooksId ?? null,
    isbn10: metadata.isbn10 ?? null,
    isbn13: metadata.isbn13 ?? null,
    bookSource: metadata.source,
  };
}

function normalizeStoredCoverUrl(coverUrl?: string | null) {
  return coverUrl?.replace(/^http:\/\//i, "https://") ?? null;
}

function warnInDev(message: string, error?: unknown) {
  if (!__DEV__) return;

  if (error) {
    console.warn(message, error);
  } else {
    console.warn(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function coerceNullableString(value: unknown) {
  const stringValue = coerceString(value).trim();
  return stringValue ? stringValue : null;
}

function coerceAuthor(value: unknown) {
  if (Array.isArray(value)) {
    const author = value.map(coerceString).filter(Boolean).join(", ").trim();
    return author || null;
  }

  return coerceNullableString(value);
}

function coerceMinutesString(value: unknown) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(",", "."))
        : 0;

  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue.toFixed(1)
    : "0.0";
}

function getFiniteStoredNumber(value: string | null | undefined, fallback: number) {
  if (value === null || value === undefined) return fallback;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function coerceSessionCount(value: unknown) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 1;

  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.round(numericValue))
    : 1;
}

function coerceIsoDate(value: unknown, fallback = new Date().toISOString()) {
  const stringValue = coerceString(value);
  const timestamp = stringValue ? new Date(stringValue).getTime() : Number.NaN;

  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : fallback;
}

function coerceBookSource(value: unknown): BookMetadata["source"] | undefined {
  return value === "manual" || value === "googleBooks" ? value : undefined;
}

function getSanitizedBookMetadataFields(
  item: Record<string, unknown>,
): BookMetadataFields {
  const coverUrl = normalizeStoredCoverUrl(coerceNullableString(item.coverUrl));

  return {
    author: coerceAuthor(item.author ?? item.authors),
    coverUrl,
    googleBooksId: coerceNullableString(item.googleBooksId),
    isbn10: coerceNullableString(item.isbn10),
    isbn13: coerceNullableString(item.isbn13),
    bookSource: coerceBookSource(item.bookSource ?? item.source),
  };
}

function sanitizeReadingSession(
  value: unknown,
  index: number,
): ReadingSession | null {
  if (!isRecord(value)) return null;

  const rawTitle = coerceString(value.title).trim();
  const rawId = coerceString(value.id).trim();
  const rawReflection = coerceString(value.reflection || value.note);
  const rawNote = coerceString(value.note);
  const rawCreatedAt = coerceString(
    value.createdAt ?? value.date ?? value.timestamp,
  );
  const sessionMinutes = coerceMinutesString(value.minutes ?? value.duration);
  const hasPositiveDuration = Number(sessionMinutes) > 0;
  const hasHistorySignal = Boolean(
    rawId ||
      rawTitle ||
      rawCreatedAt ||
      rawReflection.trim() ||
      rawNote.trim() ||
      hasReusableBookMetadata(getSanitizedBookMetadataFields(value)),
  );

  if (!hasPositiveDuration || !hasHistorySignal) return null;

  const title =
    rawTitle === LEGACY_UNATTACHED_SESSION_TITLE
      ? UNATTACHED_SESSION_TITLE
      : rawTitle || UNATTACHED_SESSION_TITLE;
  const createdAt = coerceIsoDate(
    value.createdAt ?? value.date ?? value.timestamp,
  );
  const metadataFields = getSanitizedBookMetadataFields(value);
  const source = value.source === "logged" ? "logged" : "timed";

  return {
    id: rawId || `legacy-${index}-${new Date(createdAt).getTime()}`,
    title,
    minutes: sessionMinutes,
    reflection: rawReflection,
    note: rawNote,
    createdAt,
    source,
    ...metadataFields,
  };
}

function parseReadingSessions(rawValue: string) {
  try {
    const parsedValue: unknown = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      if (__DEV__) {
        warnInDev("Rousd ignored non-array readingSessions data.");
      }

      return { sessions: [], shouldPersist: true };
    }

    const sessions = parsedValue
      .map(sanitizeReadingSession)
      .filter((session): session is ReadingSession => session !== null);

    if (__DEV__ && sessions.length !== parsedValue.length) {
      warnInDev("Rousd skipped malformed readingSessions entries.");
    }

    return {
      sessions,
      shouldPersist: JSON.stringify(sessions) !== JSON.stringify(parsedValue),
    };
  } catch (error) {
    if (__DEV__) {
      warnInDev("Rousd ignored malformed readingSessions data.", error);
    }

    return { sessions: [], shouldPersist: true };
  }
}

function sanitizeCompletedBook(
  value: unknown,
  index: number,
): CompletedBookReview | null {
  if (!isRecord(value)) return null;

  const title = coerceString(value.title).trim();
  if (!title) return null;

  const rawId = coerceString(value.id).trim();
  const completedAt = coerceIsoDate(value.completedAt ?? value.date);
  const metadataFields = getSanitizedBookMetadataFields(value);
  const sessionMinutes = coerceMinutesString(
    value.sessionMinutes ?? value.minutes ?? value.duration,
  );

  return {
    id: rawId || `legacy-completed-${index}-${new Date(completedAt).getTime()}`,
    title,
    review: coerceString(value.review),
    completedAt,
    sessionMinutes,
    totalBookMinutes: coerceMinutesString(value.totalBookMinutes ?? sessionMinutes),
    sessionCount: coerceSessionCount(value.sessionCount),
    ...metadataFields,
  };
}

function parseCompletedBooks(rawValue: string) {
  try {
    const parsedValue: unknown = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      return { books: [], shouldPersist: true };
    }

    const books = parsedValue
      .map(sanitizeCompletedBook)
      .filter((book): book is CompletedBookReview => book !== null);

    return {
      books,
      shouldPersist: JSON.stringify(books) !== JSON.stringify(parsedValue),
    };
  } catch (error) {
    warnInDev("Rousd ignored malformed completedBooks data.", error);
    return { books: [], shouldPersist: true };
  }
}

function normalizeBookIdentityText(value?: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function normalizeBookIdentifier(value?: string | null) {
  return value?.trim().toUpperCase().replace(/[^0-9X]/g, "") ?? "";
}

function hasReusableBookMetadata(book: BookMetadataFields) {
  return Boolean(
    book.googleBooksId ||
      book.isbn13 ||
      book.isbn10 ||
      book.author ||
      book.coverUrl,
  );
}

function isValidCompletedBookMoment(
  value: CompletedBookMoment | null,
): value is CompletedBookMoment {
  if (!value) return false;

  return Boolean(
    getValidBookTitle(value.title) &&
      coerceString(value.sessionId).trim() &&
      Number.isFinite(Number(value.sessionMinutes)) &&
      Number(value.sessionMinutes) > 0 &&
      Number.isFinite(Number(value.totalBookMinutes)) &&
      Number(value.totalBookMinutes) > 0 &&
      Number.isFinite(value.sessionCount) &&
      value.sessionCount > 0,
  );
}

function isValidSanctuaryReveal(
  value: SanctuaryReveal | null,
): value is SanctuaryReveal {
  if (!value) return false;

  return Boolean(
    coerceString(value.sessionId).trim() &&
      Number.isInteger(value.stage) &&
      value.stage >= 0 &&
      value.stage < sanctuaryStages.length &&
      getValidBookTitle(value.bookTitle) &&
      coerceString(value.title).trim() &&
      coerceString(value.subtitle).trim() &&
      coerceString(value.sessionMinutes).trim() &&
      coerceString(value.ctaText).trim() &&
      (value.source === "timed" || value.source === "logged"),
  );
}

function isSameFinishedBook(
  first: { title: string } & BookMetadataFields,
  second: { title: string } & BookMetadataFields,
) {
  const firstGoogleBooksId = first.googleBooksId?.trim();
  const secondGoogleBooksId = second.googleBooksId?.trim();

  if (firstGoogleBooksId && secondGoogleBooksId) {
    return firstGoogleBooksId === secondGoogleBooksId;
  }

  const firstIsbns = [
    normalizeBookIdentifier(first.isbn13),
    normalizeBookIdentifier(first.isbn10),
  ].filter(Boolean);
  const secondIsbns = new Set(
    [
      normalizeBookIdentifier(second.isbn13),
      normalizeBookIdentifier(second.isbn10),
    ].filter(Boolean),
  );

  if (firstIsbns.some((isbn) => secondIsbns.has(isbn))) {
    return true;
  }

  const firstTitle = normalizeBookIdentityText(first.title);
  const secondTitle = normalizeBookIdentityText(second.title);
  const firstAuthor = normalizeBookIdentityText(first.author);
  const secondAuthor = normalizeBookIdentityText(second.author);

  return Boolean(
    firstTitle &&
      secondTitle &&
      firstAuthor &&
      secondAuthor &&
      firstTitle === secondTitle &&
      firstAuthor === secondAuthor,
  );
}

function mergeCompletedBookReview(
  existingBook: CompletedBookReview,
  incomingBook: CompletedBookReview,
): CompletedBookReview {
  return {
    ...existingBook,
    ...incomingBook,
    id: existingBook.id,
    review: incomingBook.review || existingBook.review,
    author: incomingBook.author ?? existingBook.author ?? null,
    coverUrl:
      normalizeStoredCoverUrl(incomingBook.coverUrl) ??
      normalizeStoredCoverUrl(existingBook.coverUrl),
    googleBooksId: incomingBook.googleBooksId ?? existingBook.googleBooksId ?? null,
    isbn10: incomingBook.isbn10 ?? existingBook.isbn10 ?? null,
    isbn13: incomingBook.isbn13 ?? existingBook.isbn13 ?? null,
    bookSource: incomingBook.bookSource ?? existingBook.bookSource,
  };
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
  const [libraryReturnTarget, setLibraryReturnTarget] =
    useState<LibraryReturnTarget>("home");
  const [isLoaded, setIsLoaded] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [bookAttributionStep, setBookAttributionStep] =
    useState<BookAttributionStep>("choose");
  const [currentBookTitle, setCurrentBookTitle] = useState("");
  const [showBookCompletedInput, setShowBookCompletedInput] = useState(false);
  const [completedBookReview, setCompletedBookReview] = useState("");
  const [completedBookMoment, setCompletedBookMoment] =
    useState<CompletedBookMoment | null>(null);
  const [completedBooks, setCompletedBooks] = useState<CompletedBookReview[]>(
    [],
  );
  const [selectedFinishedBook, setSelectedFinishedBook] =
    useState<CompletedBookReview | null>(null);
  const [manualLogMinutes, setManualLogMinutes] = useState("30");
  const [manualLogBookTitle, setManualLogBookTitle] = useState("");
  const [manualLogError, setManualLogError] = useState<string | null>(null);
  const [bookInputError, setBookInputError] = useState<string | null>(null);
  const [sessionReflectionError, setSessionReflectionError] = useState<
    string | null
  >(null);
  const [completedBookReviewError, setCompletedBookReviewError] = useState<
    string | null
  >(null);
  const [savingAction, setSavingAction] = useState<SavingAction>(null);
  const [selectedManualBookMetadata, setSelectedManualBookMetadata] =
    useState<BookMetadata | null>(null);
  const [isManualBookLookupRequested, setIsManualBookLookupRequested] =
    useState(false);
  const [manualBookLookupResults, setManualBookLookupResults] = useState<
    BookMetadata[]
  >([]);
  const [isManualBookLookupLoading, setIsManualBookLookupLoading] =
    useState(false);
  const [hasManualBookLookupSearched, setHasManualBookLookupSearched] =
    useState(false);
  const [manualBookLookupError, setManualBookLookupError] = useState(false);
  const [recentSessions, setRecentSessions] = useState<ReadingSession[]>([]);
  const [totalCompletedSessions, setTotalCompletedSessions] = useState(0);
  const [bookLookupResults, setBookLookupResults] = useState<BookMetadata[]>([]);
  const [selectedBookMetadata, setSelectedBookMetadata] =
    useState<BookMetadata | null>(null);
  const [isBookLookupLoading, setIsBookLookupLoading] = useState(false);
  const [isBookLookupRequested, setIsBookLookupRequested] = useState(false);
  const [hasBookLookupSearched, setHasBookLookupSearched] = useState(false);
  const [bookLookupError, setBookLookupError] = useState(false);
  const [sanctuaryReveal, setSanctuaryReveal] =
    useState<SanctuaryReveal | null>(null);
  const [sessionReflection, setSessionReflection] = useState("");
  const [ritualLineText, setRitualLineText] = useState(readingRitualLines[0]);
  const [manualLogNote, setManualLogNote] = useState("");
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [bookTitleFocused, setBookTitleFocused] = useState(false);
  const [hasUserEditedBookQuery, setHasUserEditedBookQuery] = useState(false);
  const [manualBookTitleFocused, setManualBookTitleFocused] = useState(false);
  const [manualLogNoteFocused, setManualLogNoteFocused] = useState(false);
  const [completedBookReviewFocused, setCompletedBookReviewFocused] =
    useState(false);

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
  const bookTitleInputRef = useRef<TextInput | null>(null);
  const bookInputScrollRef = useRef<ScrollView | null>(null);
  const manualLogScrollRef = useRef<ScrollView | null>(null);
  const completedBookScrollRef = useRef<ScrollView | null>(null);
  const completedBookScrollYRef = useRef(0);
  const completedBookReviewInputHeightRef = useRef(0);
  const manualBookTitleInputRef = useRef<TextInput | null>(null);
  const bookLookupRequestId = useRef(0);
  const lastAutoScrolledBookLookupQuery = useRef<string | null>(null);
  const manualBookLookupRequestId = useRef(0);
  const manualBookLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const savingActionRef = useRef<SavingAction>(null);
  const completedBookPromptIndex = useRef(
    Math.floor(Math.random() * completedBookReflectionPrompts.length),
  ).current;
  const completedBookSparkValues = useRef(
    completedBookSparkPositions.map(() => new Animated.Value(0)),
  ).current;

  const beginSavingAction = (action: Exclude<SavingAction, null>) => {
    if (savingActionRef.current) return false;

    savingActionRef.current = action;
    setSavingAction(action);
    return true;
  };

  const endSavingAction = () => {
    savingActionRef.current = null;
    setSavingAction(null);
  };

  useEffect(() => {
    const keyboardShowSubscription = Keyboard.addListener("keyboardDidShow", () => {
      setIsKeyboardVisible(true);
    });
    const keyboardHideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setIsKeyboardVisible(false);
      setManualBookTitleFocused(false);
      setManualLogNoteFocused(false);
      setCompletedBookReviewFocused(false);
    });

    return () => {
      keyboardShowSubscription.remove();
      keyboardHideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const hasPendingSessionDuration =
      Number.isFinite(pendingSessionSeconds) && pendingSessionSeconds > 0;

    if (
      (screen === "ritual" || screen === "active") &&
      (!isReading || !activeSessionStartTime)
    ) {
      warnInDev(
        "Rousd reading timer screen opened without an active session; returning home.",
      );
      setIsReading(false);
      setActiveSessionStartTime(null);
      setPendingSessionSeconds(0);
      setSessionMessage(null);
      void AsyncStorage.multiRemove([
        ACTIVE_SESSION_START_KEY,
        ACTIVE_SESSION_TODAY_START_SECONDS_KEY,
        ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY,
      ]);
      setScreen("home");
      return;
    }

    if (
      (screen === "closeTransition" || screen === "bookInput") &&
      !hasPendingSessionDuration
    ) {
      warnInDev(
        "Rousd post-session screen opened without pending session time; returning home.",
      );
      setPendingSessionSeconds(0);
      setShowBookCompletedInput(false);
      setCompletedBookReview("");
      setCompletedBookReviewError(null);
      setBookInputError(null);
      setSelectedBookMetadata(null);
      setBookLookupResults([]);
      setBookLookupError(false);
      setIsBookLookupRequested(false);
      setHasBookLookupSearched(false);
      setHasUserEditedBookQuery(false);
      setScreen("home");
      return;
    }

    if (screen === "completedBook" && !isValidCompletedBookMoment(completedBookMoment)) {
      warnInDev(
        "Rousd completed-book screen opened without completedBookMoment; returning home.",
      );
      setCompletedBookReview("");
      setCompletedBookReviewError(null);
      setCompletedBookMoment(null);
      setSanctuaryReveal(null);
      setCompletedBookReviewFocused(false);
      setScreen("home");
      return;
    }

    if (screen === "finishedBookDetail" && !selectedFinishedBook) {
      warnInDev(
        "Rousd finished-book detail opened without a selected book; returning to shelf.",
      );
      setScreen("finishedBooks");
      return;
    }

    if (screen === "reveal" && !isValidSanctuaryReveal(sanctuaryReveal)) {
      warnInDev(
        "Rousd reveal screen opened without a valid sanctuaryReveal; returning home.",
      );
      setSessionReflection("");
      setSessionReflectionError(null);
      setSanctuaryReveal(null);
      setCompletedBookMoment(null);
      setScreen("home");
    }
  }, [
    activeSessionStartTime,
    completedBookMoment,
    isReading,
    pendingSessionSeconds,
    sanctuaryReveal,
    screen,
    selectedFinishedBook,
  ]);

  useEffect(() => {
    if (showBookCompletedInput && !getValidBookTitle(bookTitle)) {
      setShowBookCompletedInput(false);
      setCompletedBookReview("");
    }
  }, [bookTitle, showBookCompletedInput]);

  useEffect(() => {
    if (screen !== "manualLog" || !manualBookTitleFocused) return;

    const hasQuery = manualLogBookTitle.trim().length >= 3;
    const scrollTarget = hasQuery ? 360 : 260;
    const scrollTimer = setTimeout(() => {
      manualLogScrollRef.current?.scrollTo({
        y: scrollTarget,
        animated: true,
      });
    }, isKeyboardVisible ? 80 : 180);

    return () => {
      clearTimeout(scrollTimer);
    };
  }, [
    hasManualBookLookupSearched,
    isKeyboardVisible,
    isManualBookLookupLoading,
    manualBookLookupResults.length,
    manualBookTitleFocused,
    manualLogBookTitle,
    screen,
  ]);

  useEffect(() => {
    if (screen !== "manualLog" || !manualLogNoteFocused) return;

    const scrollTimer = setTimeout(() => {
      manualLogScrollRef.current?.scrollTo({
        y: 560,
        animated: true,
      });
    }, isKeyboardVisible ? 80 : 180);

    return () => {
      clearTimeout(scrollTimer);
    };
  }, [isKeyboardVisible, manualLogNoteFocused, screen]);

  useEffect(() => {
    if (screen !== "bookInput") {
      bookLookupRequestId.current += 1;
      setBookLookupResults([]);
      setIsBookLookupLoading(false);
      setIsBookLookupRequested(false);
      setHasBookLookupSearched(false);
      setBookLookupError(false);
      setHasUserEditedBookQuery(false);
      return;
    }

    const trimmedQuery = bookTitle.trim();

    if (
      selectedBookMetadata &&
      trimmedQuery === selectedBookMetadata.title.trim()
    ) {
      bookLookupRequestId.current += 1;
      setBookLookupResults([]);
      setIsBookLookupLoading(false);
      setHasBookLookupSearched(false);
      setBookLookupError(false);
      return;
    }

    if (
      !hasUserEditedBookQuery ||
      !isBookLookupRequested ||
      trimmedQuery.length < 3
    ) {
      bookLookupRequestId.current += 1;
      setBookLookupResults([]);
      setIsBookLookupLoading(false);
      setHasBookLookupSearched(false);
      setBookLookupError(false);
      return;
    }

    const requestId = bookLookupRequestId.current + 1;
    bookLookupRequestId.current = requestId;
    setBookLookupResults([]);
    setIsBookLookupLoading(true);
    setHasBookLookupSearched(false);
    setBookLookupError(false);

    const lookupTimer = setTimeout(async () => {
      try {
        const results = await Promise.race<BookMetadata[]>([
          searchGoogleBooks(trimmedQuery),
          new Promise<BookMetadata[]>((_, reject) =>
            setTimeout(
              () => reject(new Error("Book lookup timed out")),
              BOOK_LOOKUP_TIMEOUT_MS,
            ),
          ),
        ]);

        if (bookLookupRequestId.current !== requestId) {
          return;
        }

        setBookLookupResults(results);
        setHasBookLookupSearched(true);
        setBookLookupError(false);
      } catch (error) {
        if (bookLookupRequestId.current !== requestId) {
          return;
        }

        console.warn("Rousd Google Books lookup could not finish", error);
        setBookLookupResults([]);
        setHasBookLookupSearched(true);
        setBookLookupError(true);
      } finally {
        if (bookLookupRequestId.current === requestId) {
          setIsBookLookupLoading(false);
        }
      }
    }, 450);

    return () => {
      clearTimeout(lookupTimer);
    };
  }, [
    bookTitle,
    hasUserEditedBookQuery,
    isBookLookupRequested,
    screen,
    selectedBookMetadata,
  ]);

  useEffect(() => {
    if (
      screen !== "bookInput" ||
      bookAttributionStep !== "choose" ||
      !bookTitleFocused ||
      !hasUserEditedBookQuery ||
      selectedBookMetadata ||
      bookLookupResults.length === 0
    ) {
      return;
    }

    const trimmedQuery = bookTitle.trim();
    if (
      trimmedQuery.length < 3 ||
      lastAutoScrolledBookLookupQuery.current === trimmedQuery
    ) {
      return;
    }

    lastAutoScrolledBookLookupQuery.current = trimmedQuery;

    const scrollTimer = setTimeout(() => {
      requestAnimationFrame(() => {
        bookInputScrollRef.current?.scrollTo({
          y: isKeyboardVisible ? 150 : 110,
          animated: true,
        });
      });
    }, isKeyboardVisible ? 90 : 140);

    return () => {
      clearTimeout(scrollTimer);
    };
  }, [
    bookLookupResults.length,
    bookAttributionStep,
    bookTitle,
    bookTitleFocused,
    hasUserEditedBookQuery,
    isKeyboardVisible,
    screen,
    selectedBookMetadata,
  ]);

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
        setBookAttributionStep("choose");
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
        const savedTodaySeconds = getFiniteStoredNumber(savedSeconds, 0);
        const savedLifetimeTotalSeconds = getFiniteStoredNumber(
          savedLifetimeSeconds,
          0,
        );
        const todaySecondsToLoad = savedDate === today ? savedTodaySeconds : 0;

        setSeconds(todaySecondsToLoad);

        if (savedDate !== null) setLastReadDate(savedDate);
        setLifetimeSeconds(savedLifetimeTotalSeconds);
        if (savedSessions !== null) {
          const {
            sessions: migratedSessions,
            shouldPersist: shouldPersistMigratedSessions,
          } = parseReadingSessions(savedSessions);

          setRecentSessions(migratedSessions);

          if (shouldPersistMigratedSessions) {
            await AsyncStorage.setItem(
              SESSIONS_KEY,
              JSON.stringify(migratedSessions),
            );
          }

          const savedTotalCompletedSessionsNumber = getFiniteStoredNumber(
            savedTotalCompletedSessions,
            Number.NaN,
          );

          if (
            shouldPersistMigratedSessions ||
            !Number.isFinite(savedTotalCompletedSessionsNumber)
          ) {
            setTotalCompletedSessions(migratedSessions.length);
          } else {
            setTotalCompletedSessions(savedTotalCompletedSessionsNumber);
          }
        } else if (savedTotalCompletedSessions !== null) {
          setTotalCompletedSessions(
            getFiniteStoredNumber(savedTotalCompletedSessions, 0),
          );
        }

        if (savedCompletedBooks !== null) {
          const {
            books: migratedCompletedBooks,
            shouldPersist: shouldPersistMigratedCompletedBooks,
          } = parseCompletedBooks(savedCompletedBooks);

          setCompletedBooks(
            [...migratedCompletedBooks].sort(
              (first, second) =>
                new Date(second.completedAt).getTime() -
                new Date(first.completedAt).getTime(),
            ),
          );

          if (shouldPersistMigratedCompletedBooks) {
            await AsyncStorage.setItem(
              COMPLETED_BOOKS_KEY,
              JSON.stringify(migratedCompletedBooks),
            );
          }
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

          if (
            Number.isFinite(restoredStartTime) &&
            Number.isFinite(restoredTodayStartSeconds) &&
            Number.isFinite(restoredLifetimeStartSeconds)
          ) {
            const elapsed = calculateElapsedSeconds(restoredStartTime);

            setSessionStartSeconds(restoredTodayStartSeconds);
            setLifetimeSessionStartSeconds(restoredLifetimeStartSeconds);
            setActiveSessionStartTime(restoredStartTime);
            setSeconds(restoredTodayStartSeconds + elapsed);
            setLifetimeSeconds(restoredLifetimeStartSeconds + elapsed);
            setIsReading(true);
            nextScreen = "active";
          } else {
            warnInDev(
              "Rousd ignored invalid active-session restore data; returning home.",
            );
            await AsyncStorage.multiRemove([
              ACTIVE_SESSION_START_KEY,
              ACTIVE_SESSION_TODAY_START_SECONDS_KEY,
              ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY,
            ]);
          }
        }

        if (
          savedCurrentBook !== null &&
          !isUnattachedSessionTitle(savedCurrentBook)
        ) {
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
      setHasUserEditedBookQuery(false);
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
      setSelectedBookMetadata(null);
      setHasUserEditedBookQuery(false);
      setIsBookLookupRequested(false);
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

  const handleBookTitleChange = (nextTitle: string) => {
    setBookInputError(null);
    setHasUserEditedBookQuery(true);
    setIsBookLookupRequested(true);
    setBookTitle(nextTitle);

    if (selectedBookMetadata && nextTitle.trim() !== selectedBookMetadata.title) {
      setSelectedBookMetadata(null);
      lastAutoScrolledBookLookupQuery.current = null;
    }
  };

  const clearBookTitleSelection = () => {
    bookLookupRequestId.current += 1;
    setBookInputError(null);
    setHasUserEditedBookQuery(true);
    setIsBookLookupRequested(true);
    setBookTitle("");
    setSelectedBookMetadata(null);
    lastAutoScrolledBookLookupQuery.current = null;
    setBookLookupResults([]);
    setIsBookLookupLoading(false);
    setHasBookLookupSearched(false);
    setBookLookupError(false);
    setBookAttributionStep("choose");
    setTimeout(() => bookTitleInputRef.current?.focus(), 0);
  };

  const selectGoogleBook = (book: BookMetadata) => {
    Keyboard.dismiss();
    bookLookupRequestId.current += 1;
    setBookInputError(null);
    setHasUserEditedBookQuery(false);
    setIsBookLookupRequested(false);
    setSelectedBookMetadata({
      ...book,
      coverUrl: normalizeStoredCoverUrl(book.coverUrl),
    });
    setBookTitle(book.title);
    setBookLookupResults([]);
    setIsBookLookupLoading(false);
    setHasBookLookupSearched(false);
    setBookLookupError(false);
    setBookAttributionStep("reflect");
    lastAutoScrolledBookLookupQuery.current = book.title.trim();

    setTimeout(() => {
      bookInputScrollRef.current?.scrollTo({
        y: 0,
        animated: true,
      });
    }, 80);
  };

  const resetManualBookLookup = () => {
    manualBookLookupRequestId.current += 1;

    if (manualBookLookupTimer.current) {
      clearTimeout(manualBookLookupTimer.current);
      manualBookLookupTimer.current = null;
    }

    setManualBookLookupResults([]);
    setIsManualBookLookupLoading(false);
    setHasManualBookLookupSearched(false);
    setManualBookLookupError(false);
  };

  const searchManualBookTitle = (query: string) => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 3) {
      resetManualBookLookup();
      return;
    }

    const requestId = manualBookLookupRequestId.current + 1;
    manualBookLookupRequestId.current = requestId;

    if (manualBookLookupTimer.current) {
      clearTimeout(manualBookLookupTimer.current);
    }

    setManualBookLookupResults([]);
    setIsManualBookLookupLoading(true);
    setHasManualBookLookupSearched(false);
    setManualBookLookupError(false);

    manualBookLookupTimer.current = setTimeout(async () => {
      try {
        const results = await Promise.race<BookMetadata[]>([
          searchGoogleBooks(trimmedQuery),
          new Promise<BookMetadata[]>((_, reject) =>
            setTimeout(
              () => reject(new Error("Book lookup timed out")),
              BOOK_LOOKUP_TIMEOUT_MS,
            ),
          ),
        ]);

        if (manualBookLookupRequestId.current !== requestId) {
          return;
        }

        setManualBookLookupResults(results);
        setHasManualBookLookupSearched(true);
        setManualBookLookupError(false);
      } catch (error) {
        if (manualBookLookupRequestId.current !== requestId) {
          return;
        }

        console.warn("Rousd Google Books lookup could not finish", error);
        setManualBookLookupResults([]);
        setHasManualBookLookupSearched(true);
        setManualBookLookupError(true);
      } finally {
        if (manualBookLookupRequestId.current === requestId) {
          setIsManualBookLookupLoading(false);
        }
      }
    }, 450);
  };

  const handleManualBookTitleChange = (nextTitle: string) => {
    const trimmedTitle = nextTitle.trim();
    setIsManualBookLookupRequested(true);
    setManualLogBookTitle(nextTitle);

    if (
      selectedManualBookMetadata &&
      trimmedTitle !== selectedManualBookMetadata.title
    ) {
      setSelectedManualBookMetadata(null);
    }

    const knownMetadata = trimmedTitle
      ? findKnownBookMetadataByTitle(trimmedTitle)
      : null;

    if (!knownMetadata || knownMetadata.title !== trimmedTitle) {
      setManualBookLookupResults([]);
      setHasManualBookLookupSearched(false);
      setManualBookLookupError(false);
    }

    searchManualBookTitle(nextTitle);
  };

  const clearManualBookTitleSelection = () => {
    setIsManualBookLookupRequested(true);
    setManualLogBookTitle("");
    setSelectedManualBookMetadata(null);
    resetManualBookLookup();
    setTimeout(() => manualBookTitleInputRef.current?.focus(), 0);
  };

  const selectManualGoogleBook = (book: BookMetadata) => {
    setIsManualBookLookupRequested(true);
    setSelectedManualBookMetadata({
      ...book,
      coverUrl: normalizeStoredCoverUrl(book.coverUrl),
    });
    setManualLogBookTitle(book.title);
  };

  const findKnownBookMetadataByTitle = (title: string): BookMetadata | null => {
    const normalizedTitle = title.trim().toLowerCase();
    const knownBook = [...recentSessions, ...completedBooks].find(
      (book) =>
        book.title.trim().toLowerCase() === normalizedTitle &&
        hasReusableBookMetadata(book),
    );

    if (!knownBook) {
      return null;
    }

    return {
      title: knownBook.title,
      author: knownBook.author ?? null,
      coverUrl: normalizeStoredCoverUrl(knownBook.coverUrl),
      googleBooksId: knownBook.googleBooksId ?? null,
      isbn10: knownBook.isbn10 ?? null,
      isbn13: knownBook.isbn13 ?? null,
      source: knownBook.bookSource ?? "googleBooks",
    };
  };

  const saveSession = async (
    title: string,
    bookMetadata?: BookMetadata | null,
    reflectionOverride = "",
  ) => {
    const sessionSeconds = pendingSessionSeconds;
    const sessionMinutes = (sessionSeconds / 60).toFixed(1);
    const sessionDuration = formatDuration(sessionSeconds / 60);
    const trimmedReflection = reflectionOverride.trim();
    const metadataFields = bookMetadata
      ? getBookMetadataFields(bookMetadata)
      : isUnattachedSessionTitle(title)
        ? {}
        : ({ bookSource: "manual" } satisfies BookMetadataFields);

    const newSession: ReadingSession = {
      id: Date.now().toString(),
      title,
      minutes: sessionMinutes,
      createdAt: new Date().toISOString(),
      source: "timed",
      ...(trimmedReflection ? { reflection: trimmedReflection } : {}),
      ...metadataFields,
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

    await AsyncStorage.multiSet([
      [SESSIONS_KEY, JSON.stringify(updatedSessions)],
      [
        TOTAL_COMPLETED_SESSIONS_KEY,
        String(updatedTotalCompletedSessions),
      ],
    ]);

    const isUnattachedSession = isUnattachedSessionTitle(title);

    setRecentSessions(updatedSessions);
    setTotalCompletedSessions(updatedTotalCompletedSessions);
    setSessionReflectionError(null);
    setSanctuaryReveal({
      sessionId: newSession.id,
      stage: updatedSanctuaryStageNumber,
      stageChanged: didSanctuaryStageChange,
      bookTitle: title,
      title: isUnattachedSession
        ? "A reading moment was saved."
        : revealCopy.title,
      subtitle: isUnattachedSession
        ? "You can simply continue."
        : revealCopy.subtitle,
      sessionMinutes: sessionDuration,
      ctaText: revealCopy.ctaText,
      source: "timed",
      noteSaved: Boolean(trimmedReflection),
      ...metadataFields,
    });

    return {
      sessionId: newSession.id,
      sessionMinutes,
      updatedSessions,
    };
  };

  const saveBookForSession = async () => {
    if (!beginSavingAction("bookInput")) return;

    setBookInputError(null);

    try {
      const validBookTitle = getValidBookTitle(bookTitle);
      const titleToSave = validBookTitle || UNATTACHED_SESSION_TITLE;
      const shouldCompleteBook = showBookCompletedInput && Boolean(validBookTitle);
      const selectedMetadata =
        validBookTitle &&
        selectedBookMetadata?.title.trim() === validBookTitle
          ? selectedBookMetadata
          : validBookTitle
            ? findKnownBookMetadataByTitle(validBookTitle)
            : null;
      const completedBookMetadataFields = getBookMetadataFields(selectedMetadata);

      const savedSession = await saveSession(
        titleToSave,
        selectedMetadata,
        completedBookReview,
      );

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
          ...completedBookMetadataFields,
        });
        setCompletedBookReviewError(null);
        setSanctuaryReveal(null);
      }

      if (validBookTitle) {
        setCurrentBookTitle(validBookTitle);
        await AsyncStorage.setItem(CURRENT_BOOK_KEY, validBookTitle);
      }

      if (validBookTitle) {
        setSessionMessage(`+${formatDuration(Number(savedSession.sessionMinutes))} - ${validBookTitle}`);
      } else {
        setSessionMessage(`+${formatDuration(Number(savedSession.sessionMinutes))} added`);
      }

      setShowBookCompletedInput(false);
      if (!shouldCompleteBook) {
        setCompletedBookReview("");
      }
      setBookAttributionStep("choose");
      setSelectedBookMetadata(null);
      setHasUserEditedBookQuery(false);
      setBookLookupResults([]);
      setBookLookupError(false);
      setScreen(shouldCompleteBook ? "completedBook" : "reveal");

      setTimeout(() => {
        setSessionMessage(null);
      }, 4000);
    } catch (error) {
      console.warn("Rousd failed to save timed reading session.", error);
      setBookInputError("That didn't save. Try once more.");
    } finally {
      endSavingAction();
    }
  };

  const skipBookForSession = async () => {
    if (!beginSavingAction("bookInputSkip")) return;

    setBookInputError(null);

    try {
      const savedSession = await saveSession(UNATTACHED_SESSION_TITLE);

      setSessionMessage(`+${formatDuration(Number(savedSession.sessionMinutes))} added`);
      setShowBookCompletedInput(false);
      setBookAttributionStep("choose");
      setCompletedBookReview("");
      setSelectedBookMetadata(null);
      setHasUserEditedBookQuery(false);
      setBookLookupResults([]);
      setBookLookupError(false);
      setScreen("reveal");

      setTimeout(() => {
        setSessionMessage(null);
      }, 3000);
    } catch (error) {
      console.warn("Rousd failed to save timed reading session.", error);
      setBookInputError("That didn't save. Try once more.");
    } finally {
      endSavingAction();
    }
  };

  const deleteReadingSession = async (sessionId: string) => {
    const sessionToDelete = recentSessions.find(
      (session) => session.id === sessionId,
    );

    if (!sessionToDelete) return;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const updatedSessions = recentSessions.filter(
      (session) => session.id !== sessionId,
    );
    const deletedSeconds = Math.max(
      0,
      Math.round(Number(sessionToDelete.minutes || 0) * 60),
    );
    const updatedLifetimeSeconds = Math.max(
      0,
      lifetimeSeconds - deletedSeconds,
    );
    const sessionTimestamp = getSessionDateValue(sessionToDelete);
    const sessionDate =
      sessionTimestamp > 0 ? new Date(sessionTimestamp) : null;
    const todayDateString = getTodayDateString();
    const deletedToday =
      sessionDate?.toISOString().split("T")[0] === todayDateString;
    const updatedTodaySeconds = deletedToday
      ? Math.max(0, seconds - deletedSeconds)
      : seconds;
    const updatedTotalCompletedSessions = updatedSessions.length;

    setRecentSessions(updatedSessions);
    setTotalCompletedSessions(updatedTotalCompletedSessions);
    setLifetimeSeconds(updatedLifetimeSeconds);

    if (deletedToday) {
      setSeconds(updatedTodaySeconds);
      setLastReadDate(todayDateString);
    }

    const storageUpdates: [string, string][] = [
      [SESSIONS_KEY, JSON.stringify(updatedSessions)],
      [
        TOTAL_COMPLETED_SESSIONS_KEY,
        String(updatedTotalCompletedSessions),
      ],
      [LIFETIME_SECONDS_KEY, String(updatedLifetimeSeconds)],
      [SECONDS_KEY, String(updatedTodaySeconds)],
    ];

    if (deletedToday) {
      storageUpdates.push([DATE_KEY, todayDateString]);
    }

    await AsyncStorage.multiSet(storageUpdates);

    setSessionMessage("Reading moment deleted");
    setTimeout(() => {
      setSessionMessage(null);
    }, 3000);
  };

  const confirmDeleteReadingSession = (sessionId: string) => {
    Alert.alert(
      "Delete this reading moment?",
      "This removes it from your diary. Anything on your finished shelf will stay.",
      [
        {
          text: "Keep it",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteReadingSession(sessionId);
          },
        },
      ],
    );
  };

  const saveCompletedBookReview = async (
    title: string,
    sessionMinutes: string,
    totalBookMinutes: string,
    sessionCount: number,
    sessionId: string,
    reviewOverride = completedBookReview,
    bookMetadataFields: BookMetadataFields = {},
  ) => {
    const trimmedReview = reviewOverride.trim();
    const savedCompletedBooks = await AsyncStorage.getItem(COMPLETED_BOOKS_KEY);
    const storedCompletedBooks: CompletedBookReview[] = savedCompletedBooks
      ? parseCompletedBooks(savedCompletedBooks).books
      : [];

    const completedBook: CompletedBookReview = {
      id: Date.now().toString(),
      title,
      review: trimmedReview,
      completedAt: new Date().toISOString(),
      sessionMinutes,
      totalBookMinutes,
      sessionCount,
      ...bookMetadataFields,
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

    const existingCompletedBookIndex = storedCompletedBooks.findIndex((book) =>
      isSameFinishedBook(book, completedBook),
    );
    const updatedCompletedBooks =
      existingCompletedBookIndex >= 0
        ? [
            mergeCompletedBookReview(
              storedCompletedBooks[existingCompletedBookIndex],
              completedBook,
            ),
            ...storedCompletedBooks.filter(
              (_, index) => index !== existingCompletedBookIndex,
            ),
          ]
        : [completedBook, ...storedCompletedBooks];

    await AsyncStorage.setItem(
      COMPLETED_BOOKS_KEY,
      JSON.stringify(updatedCompletedBooks),
    );
    setCompletedBooks(updatedCompletedBooks);
  };

  const finishCompletedBookMoment = async (
    reviewOverride?: string,
    action: "completedBookSave" | "completedBookSkip" = "completedBookSave",
  ) => {
    if (!completedBookMoment || !beginSavingAction(action)) {
      return false;
    }

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await saveCompletedBookReview(
        completedBookMoment.title,
        completedBookMoment.sessionMinutes,
        completedBookMoment.totalBookMinutes,
        completedBookMoment.sessionCount,
        completedBookMoment.sessionId,
        reviewOverride ?? completedBookReview,
        completedBookMoment,
      );
    } catch (error) {
      console.warn("Rousd failed to save finished book review.", error);
      setCompletedBookReviewError("That review didn't save. Try once more.");
      return false;
    } finally {
      endSavingAction();
    }

    setCompletedBookReviewError(null);
    setCompletedBookReview("");
    setCompletedBookMoment(null);
    setSanctuaryReveal(null);
    setCompletedBookReviewFocused(false);
    return true;
  };

  const openManualLog = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setManualLogMinutes("30");
    setManualLogBookTitle(currentBookTitle);
    setManualLogNote("");
    setManualLogError(null);
    setSessionReflectionError(null);
    setCompletedBookReviewError(null);
    setSelectedManualBookMetadata(null);
    setIsManualBookLookupRequested(false);
    setManualBookTitleFocused(false);
    setManualLogNoteFocused(false);
    resetManualBookLookup();
    setSanctuaryReveal(null);
    setCompletedBookMoment(null);
    setSessionMessage(null);
    setScreen("manualLog");
  };

  const openHomeDestination = async (destination: Screen) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (destination === "diary" || destination === "finishedBooks") {
      setLibraryReturnTarget(screen === "menu" ? "menu" : "home");
    }

    setScreen(destination);
  };

  const cancelManualLog = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setManualLogNote("");
    setManualLogError(null);
    setSelectedManualBookMetadata(null);
    setIsManualBookLookupRequested(false);
    setManualBookTitleFocused(false);
    setManualLogNoteFocused(false);
    resetManualBookLookup();
    setScreen("home");
  };

  const saveManualReadingLog = async () => {
    if (savingActionRef.current) return;

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
    const titleToSave = trimmedTitle || UNATTACHED_SESSION_TITLE;
    const selectedManualMetadata =
      trimmedTitle &&
      selectedManualBookMetadata?.title.trim() === trimmedTitle
        ? selectedManualBookMetadata
        : trimmedTitle
          ? findKnownBookMetadataByTitle(trimmedTitle)
          : null;
    const manualMetadataFields = getBookMetadataFields(selectedManualMetadata);
    const previousLifetimeSeconds = lifetimeSeconds;
    const updatedTodaySeconds = seconds + manualSessionSeconds;
    const updatedLifetimeSeconds = lifetimeSeconds + manualSessionSeconds;

    const newSession: ReadingSession = {
      id: Date.now().toString(),
      title: titleToSave,
      minutes: sessionMinutes,
      reflection: trimmedNote || null,
      createdAt: new Date().toISOString(),
      source: "logged",
      ...manualMetadataFields,
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

    const nextSanctuaryReveal: SanctuaryReveal = {
      sessionId: newSession.id,
      stage: updatedSanctuaryStageNumber,
      stageChanged: didSanctuaryStageChange,
      bookTitle: titleToSave,
      title: revealCopy.title,
      subtitle: revealCopy.subtitle,
      sessionMinutes: sessionDuration,
      ctaText: revealCopy.ctaText,
      source: "logged",
      noteSaved: Boolean(trimmedNote),
      ...manualMetadataFields,
    };

    const storageUpdates: [string, string][] = [
      [SECONDS_KEY, String(updatedTodaySeconds)],
      [LIFETIME_SECONDS_KEY, String(updatedLifetimeSeconds)],
      [SESSIONS_KEY, JSON.stringify(updatedSessions)],
      [
        TOTAL_COMPLETED_SESSIONS_KEY,
        String(updatedTotalCompletedSessions),
      ],
    ];

    if (trimmedTitle) {
      storageUpdates.push([CURRENT_BOOK_KEY, trimmedTitle]);
    }

    if (!beginSavingAction("manualLog")) return;

    try {
      await persistTodayDateIfNeeded();
      await AsyncStorage.multiSet(storageUpdates);
    } catch (error) {
      console.warn("Rousd failed to save manual reading log.", error);
      setManualLogError("This moment didn't save yet. Try once more.");
      return;
    } finally {
      endSavingAction();
    }

    setSeconds(updatedTodaySeconds);
    setLifetimeSeconds(updatedLifetimeSeconds);
    setRecentSessions(updatedSessions);
    setTotalCompletedSessions(updatedTotalCompletedSessions);
    setSanctuaryReveal(nextSanctuaryReveal);
    setManualLogNote("");
    setSelectedManualBookMetadata(null);
    setIsManualBookLookupRequested(false);
    setManualBookTitleFocused(false);
    resetManualBookLookup();
    setSessionReflection("");
    setSessionReflectionError(null);
    setManualLogError(null);

    if (trimmedTitle) {
      setCurrentBookTitle(trimmedTitle);
    }

    setScreen("reveal");

    setSessionMessage(`+${sessionDuration} saved`);

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

    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updatedSessions));
    setRecentSessions(updatedSessions);
  };

  const dismissSanctuaryReveal = async (options?: { saveReflection?: boolean }) => {
    const shouldSaveReflection = options?.saveReflection;
    if (shouldSaveReflection && !beginSavingAction("revealNote")) return;

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (shouldSaveReflection) {
        await saveSessionReflection();
      }
    } catch (error) {
      console.warn("Rousd failed to save reading note.", error);
      if (shouldSaveReflection) {
        setSessionReflectionError("That note didn't save. Try once more.");
      }
      return;
    } finally {
      if (shouldSaveReflection) {
        endSavingAction();
      }
    }

    setScreen("home");
    setSessionReflection("");
    setSessionReflectionError(null);
    setSanctuaryReveal(null);
  };

  const dismissWelcomeScreen = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await AsyncStorage.setItem(HAS_SEEN_WELCOME_KEY, "true");
    setScreen("home");
  };

  const visibleSessions = recentSessions.slice(0, 3);
  const visiblePickerSessions = recentSessions
    .filter((session) => !isUnattachedSessionTitle(session.title))
    .slice(0, 3);
  const latestSession = recentSessions[0];
  const hasReadingMoments = recentSessions.length > 0;
  const currentBookSession = currentBookTitle
    ? recentSessions.find(
        (session) =>
          session.title.trim().toLowerCase() ===
          currentBookTitle.trim().toLowerCase(),
      )
    : latestSession;
  const currentBookCoverUrl = normalizeStoredCoverUrl(
    currentBookSession?.coverUrl,
  );
  const currentBookDisplayTitle =
    currentBookTitle ||
    (latestSession
      ? getDisplaySessionTitle(latestSession.title)
      : "A quiet place to begin.");
  const currentBookSubcopy = hasReadingMoments
    ? "Pick up where you left off."
    : "Your first reading moment can begin whenever you're ready.";
  const currentBookMeta = currentBookTitle
    ? latestSession?.title === currentBookTitle
      ? `Last read ${formatCurrentBookTimestamp(latestSession.createdAt)}`
      : "Saved as your current book"
    : hasReadingMoments
      ? "Save a reading moment to place a book here"
      : "Start when you're ready, then save the book you read.";
  const shouldShowCurrentBookPlaceholderMark =
    !currentBookTitle &&
    (!latestSession || isUnattachedSessionTitle(latestSession.title));
  const currentBookLastSession = currentBookTitle ? currentBookSession : null;
  const currentBookLastSessionNote = currentBookLastSession
    ? getSessionNote(currentBookLastSession)
    : "";
  const currentBookLastSessionWithNote =
    currentBookLastSession && currentBookLastSessionNote.length > 0
      ? currentBookLastSession
      : null;
  const revealBookTitle = getDisplaySessionTitle(
    sanctuaryReveal?.bookTitle ||
      bookTitle.trim() ||
      manualLogBookTitle.trim() ||
      currentBookTitle ||
      latestSession?.title ||
      "your book",
  );
  const isUnattachedReveal =
    isUnattachedSessionTitle(sanctuaryReveal?.bookTitle);
  const diarySessions = [...recentSessions].sort(
    (first, second) => getSessionDateValue(second) - getSessionDateValue(first),
  );
  const libraryReturnScreen: Screen =
    libraryReturnTarget === "menu" ? "menu" : "home";
  const libraryReturnLabel =
    libraryReturnTarget === "menu" ? "Back to menu" : "Return home";

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
        <View style={styles.loadingMark} />
      </ThemedView>
    );

    case "welcome":
      return (
      <ThemedView
        style={[
          styles.welcomeScreen,
          {
            paddingTop: insets.top + 18,
            paddingBottom: Math.max(insets.bottom + 18, 28),
          },
        ]}
      >
        <View pointerEvents="none" style={styles.welcomeGlowTop} />
        <View pointerEvents="none" style={styles.welcomeGlowBottom} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.welcomeContent}
        >
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeSanctuaryPreview}>
            <View style={styles.welcomeLampGlow} />
            <View style={styles.welcomeReadingSurface} />
            <View style={styles.welcomeMug} />
            <View style={styles.welcomeMugHandle} />
            <View style={styles.welcomeStillLifeBook}>
              <View style={styles.welcomeBookCover} />
              <View style={styles.welcomeBookSpine} />
              <View style={styles.welcomeBookPageEdge} />
            </View>
          </View>

          <ThemedText style={styles.welcomeEyebrow}>WELCOME TO ROUSD</ThemedText>
          <ThemedText style={styles.welcomeTitle}>
            Keep a light on for your reading life.
          </ThemedText>
          <ThemedText style={styles.welcomeBody}>
            {"Start a quiet reading moment, put your phone down, then return when you're done. Rousd keeps the time and helps you save the book, note, or moment you want to remember."}
          </ThemedText>

          <View style={styles.welcomeStepsCard}>
            <View style={styles.welcomeStepRow}>
              <ThemedText style={styles.welcomeStepNumber}>1</ThemedText>
              <ThemedText style={styles.welcomeStepText}>Press the Start reading button</ThemedText>
            </View>
            <View style={styles.welcomeStepRow}>
              <ThemedText style={styles.welcomeStepNumber}>2</ThemedText>
              <ThemedText style={styles.welcomeStepText}>Read your book or e-reader</ThemedText>
            </View>
            <View style={styles.welcomeStepRow}>
              <ThemedText style={styles.welcomeStepNumber}>3</ThemedText>
              <ThemedText style={styles.welcomeStepText}>Return and save what you read</ThemedText>
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
        </ScrollView>
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
        <StatusBar style="light" />
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
            {"Take a breath. Then you can save this time to the book you read."}
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
        <StatusBar style="light" />
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
            <Ionicons
              name="radio-button-on-outline"
              size={18}
              color="rgba(247,195,107,0.74)"
            />
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
        <StatusBar style="light" />
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
            <Ionicons
              name="radio-button-on-outline"
              size={18}
              color="rgba(247,195,107,0.74)"
            />
          </View>
          <ThemedText style={styles.quietSessionEyebrow}>
            Reading moment
          </ThemedText>
          <ThemedText style={styles.quietSessionTitle}>
            Your time is being kept.
          </ThemedText>
          <ThemedText style={styles.quietSessionSubtitle}>
            {"Stop whenever you're ready."}
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
              {"I'm done reading"}
            </ThemedText>
          </Pressable>
        </Animated.View>
      </ThemedView>
    );
  

    case "bookInput": {
      const pendingDuration = formatDuration(pendingSessionSeconds / 60);
      const canCompleteBook = Boolean(getValidBookTitle(bookTitle));
      const isReflectingBookStep = bookAttributionStep === "reflect";
      const bookLookupQueryIsReady = bookTitle.trim().length >= 3;
      const knownBookMetadata = getValidBookTitle(bookTitle)
        ? findKnownBookMetadataByTitle(bookTitle)
        : null;
      const attributionPreviewMetadata =
        selectedBookMetadata ?? knownBookMetadata;
      const attributionPreviewCoverUrl = normalizeStoredCoverUrl(
        attributionPreviewMetadata?.coverUrl,
      );
      const attributionPreviewTitle =
        attributionPreviewMetadata?.title || getValidBookTitle(bookTitle) || "R";
      const attributionStatusText = selectedBookMetadata
        ? "Selected from Google Books"
        : knownBookMetadata
          ? "Saved book found"
          : "Manual title";
      const hasAttributionBook = Boolean(
        canCompleteBook || selectedBookMetadata || knownBookMetadata,
      );
      const isChoosingBook = !isReflectingBookStep || !hasAttributionBook;
      const isSearchingForBook =
        isChoosingBook &&
        bookTitleFocused &&
        hasUserEditedBookQuery &&
        bookTitle.trim().length > 0;
      const shouldShowBookLookup =
        isChoosingBook &&
        !selectedBookMetadata &&
        hasUserEditedBookQuery &&
        bookLookupQueryIsReady &&
        (isBookLookupLoading || hasBookLookupSearched || bookLookupResults.length > 0);
      const isSavingAttributionBook = savingAction === "bookInput";
      const isSavingAttributionSkip = savingAction === "bookInputSkip";
      const isSavingAttribution =
        isSavingAttributionBook || isSavingAttributionSkip;
      const shouldUseTallAttributionLayout =
        isKeyboardVisible ||
        shouldShowBookLookup ||
        visiblePickerSessions.length > 0;
      const shouldShowBookChoiceShortcuts =
        isChoosingBook && !isSearchingForBook;
      const continueToAttributionReflection = () => {
        if (!hasAttributionBook) return;

        Keyboard.dismiss();
        setBookInputError(null);
        setBookAttributionStep("reflect");
        setTimeout(() => {
          bookInputScrollRef.current?.scrollTo({ y: 0, animated: true });
        }, 80);
      };
      const attributionPrimaryLabel = isChoosingBook
        ? "Continue"
        : isSavingAttributionBook
          ? "Saving..."
          : "Save to this book";
      const handleAttributionPrimaryPress = isChoosingBook
        ? continueToAttributionReflection
        : saveBookForSession;

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
          ref={bookInputScrollRef}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentInset={{ bottom: isKeyboardVisible ? 180 : 0 }}
          scrollIndicatorInsets={{ bottom: isKeyboardVisible ? 180 : 0 }}
          contentContainerStyle={[
            styles.bookReturnContent,
            shouldUseTallAttributionLayout && styles.bookReturnContentTall,
            { paddingBottom: insets.bottom + (isKeyboardVisible ? 260 : 88) },
          ]}
        >
          {!isChoosingBook ? (
            <View style={styles.bookAttributionTopNav}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to choose book"
                hitSlop={10}
                style={({ pressed }) => [
                  styles.bookAttributionBackButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => setBookAttributionStep("choose")}
              >
                <Ionicons
                  name="chevron-back"
                  size={20}
                  color="rgba(47,93,80,0.72)"
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.bookEditButton,
                  styles.bookEditButtonHeader,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => {
                  setBookAttributionStep("choose");
                  setTimeout(() => {
                    bookTitleInputRef.current?.focus();
                  }, 120);
                }}
              >
                <ThemedText style={styles.bookEditButtonText}>
                  Edit book
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          <ThemedText style={styles.bookReturnEyebrow}>
            {isChoosingBook ? "STEP 1 OF 2" : "STEP 2 OF 2"}
          </ThemedText>
          <ThemedText
            style={[
              styles.bookReturnTitle,
              isSearchingForBook && styles.bookReturnTitleCompact,
            ]}
          >
            {isChoosingBook ? "What did you read?" : "What stayed with you?"}
          </ThemedText>
          <ThemedText
            style={[
              styles.bookReturnHelperLine,
              isSearchingForBook && styles.bookReturnHelperLineCompact,
            ]}
          >
            {isChoosingBook
              ? "Start by choosing the book you just read."
              : "Add a note if you'd like. Mark it finished if this was the last page."}
          </ThemedText>
          {isChoosingBook ? (
            <ThemedText
              style={[
                styles.bookReturnMinutes,
                isSearchingForBook && styles.bookReturnMinutesCompact,
              ]}
            >
              {pendingDuration} saved
            </ThemedText>
          ) : null}

          {isChoosingBook ? (
            <>
              <View style={styles.bookAttributionCard}>
                <View style={styles.bookAttributionInputRow}>
                  <TextInput
                    ref={bookTitleInputRef}
                    placeholder="Search for a book..."
                    placeholderTextColor="rgba(31,41,51,0.38)"
                    value={bookTitle}
                    onChangeText={handleBookTitleChange}
                    onFocus={() => {
                      setBookTitleFocused(true);
                      if (hasUserEditedBookQuery) {
                        setIsBookLookupRequested(true);
                      }
                    }}
                    onBlur={() => setBookTitleFocused(false)}
                    style={styles.bookAttributionInput}
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={Keyboard.dismiss}
                  />
                  {bookTitle.trim().length > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear book title"
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.bookAttributionClearButton,
                        pressed && styles.buttonPressed,
                      ]}
                      onPress={clearBookTitleSelection}
                    >
                      <Ionicons
                        name="close-circle-outline"
                        size={22}
                        color="rgba(47,93,80,0.48)"
                      />
                    </Pressable>
                  ) : null}
                </View>
                {selectedBookMetadata ? (
                  <ThemedText
                    style={styles.bookAttributionSelectedText}
                    numberOfLines={1}
                  >
                    Selected from Google Books
                  </ThemedText>
                ) : knownBookMetadata ? (
                  <ThemedText
                    style={styles.bookAttributionSelectedText}
                    numberOfLines={1}
                  >
                    Saved book found
                  </ThemedText>
                ) : isSearchingForBook && canCompleteBook ? (
                  <ThemedText
                    style={styles.bookAttributionSelectedText}
                    numberOfLines={1}
                  >
                    You can continue with this title.
                  </ThemedText>
                ) : null}
              </View>

              {bookInputError ? (
                <ThemedText style={styles.manualLogError}>
                  {bookInputError}
                </ThemedText>
              ) : null}

              {shouldShowBookLookup ? (
                <View style={styles.bookLookupPanel}>
                  <View style={styles.bookLookupHeaderRow}>
                    <ThemedText style={styles.bookLookupTitle}>
                      Possible editions
                    </ThemedText>
                    {isBookLookupLoading ? (
                      <ThemedText style={styles.bookLookupLoading}>
                        Looking softly...
                      </ThemedText>
                    ) : null}
                  </View>
                  {bookLookupResults.length > 0 ? (
                    <ThemedText style={styles.bookLookupHelperText}>
                      Choose the edition you read, or keep your typed title.
                    </ThemedText>
                  ) : null}

                  {bookLookupResults.map((book) => {
                    return (
                      <Pressable
                        key={book.googleBooksId ?? book.title}
                        style={({ pressed }) => [
                          styles.bookLookupChoice,
                          pressed && styles.buttonPressed,
                        ]}
                        onPress={() => selectGoogleBook(book)}
                      >
                        {book.coverUrl ? (
                          <Image
                            source={{ uri: book.coverUrl }}
                            style={styles.bookLookupCover}
                          />
                        ) : (
                          <View style={styles.bookLookupCoverPlaceholder}>
                            <ThemedText style={styles.bookLookupCoverText}>
                              R
                            </ThemedText>
                          </View>
                        )}
                        <View style={styles.bookLookupCopy}>
                          <View style={styles.bookLookupTitleRow}>
                            <ThemedText
                              style={styles.bookLookupBookTitle}
                              numberOfLines={1}
                            >
                              {book.title}
                            </ThemedText>
                          </View>
                          {book.author ? (
                            <ThemedText
                              style={styles.bookLookupBookAuthor}
                              numberOfLines={1}
                            >
                              {book.author}
                            </ThemedText>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}

                  {!isBookLookupLoading &&
                  hasBookLookupSearched &&
                  bookLookupResults.length === 0 ? (
                    <ThemedText style={styles.bookLookupEmptyText}>
                      {bookLookupError
                        ? "Couldn't check matches right now. You can still save this title."
                        : "No matches yet. You can still save this title."}
                    </ThemedText>
                  ) : null}

                  {bookLookupResults.length > 0 ? (
                    <ThemedText style={styles.bookLookupAttribution}>
                      Book data from Google Books
                    </ThemedText>
                  ) : null}
                </View>
              ) : null}

              {shouldShowBookChoiceShortcuts && visiblePickerSessions.length > 0 && (
                <View style={styles.recentBookPicker}>
                  <ThemedText style={styles.recentBookPickerTitle}>Recent books</ThemedText>
                  {visiblePickerSessions.map((session) => (
                    <Pressable
                      key={session.id}
                      style={({ pressed }) => [
                        styles.recentBookChoice,
                        pressed && styles.buttonPressed,
                      ]}
                      onPress={() => {
                        Keyboard.dismiss();
                        handleBookTitleChange(session.title);
                        setHasUserEditedBookQuery(false);
                        setIsBookLookupRequested(false);
                        setBookLookupResults([]);
                        setBookAttributionStep("reflect");
                        setTimeout(() => {
                          bookInputScrollRef.current?.scrollTo({
                            y: 0,
                            animated: true,
                          });
                        }, 80);
                      }}
                    >
                      <View style={styles.recentBookMiniCover}>
                        {session.coverUrl ? (
                          <Image
                            source={{
                              uri: normalizeStoredCoverUrl(session.coverUrl) ?? "",
                            }}
                            style={styles.recentBookMiniCoverImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <ThemedText style={styles.recentBookMiniCoverText}>R</ThemedText>
                        )}
                      </View>
                      <View style={styles.recentBookChoiceCopy}>
                        <ThemedText style={styles.recentBookChoiceTitle} numberOfLines={1}>
                          {getDisplaySessionTitle(session.title)}
                        </ThemedText>
                        <ThemedText style={styles.recentBookChoiceMeta}>
                          Last saved - {formatDuration(Number(session.minutes))}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}

              {shouldShowBookChoiceShortcuts ? (
                <View style={styles.bookManualEntryHint}>
                <ThemedText style={styles.bookManualEntryHintTitle}>
                  {"Don't see your book?"}
                </ThemedText>
                <ThemedText style={styles.bookManualEntryHintText}>
                  You can add it manually.
                </ThemedText>
              </View>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.bookAttributionReviewCard}>
                <View style={styles.bookAttributionReviewTopRow}>
                  <View style={styles.bookAttributionReviewCover}>
                    {attributionPreviewCoverUrl ? (
                      <Image
                        source={{ uri: attributionPreviewCoverUrl }}
                        style={styles.bookAttributionCoverImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <ThemedText
                        style={styles.bookAttributionCoverText}
                        numberOfLines={1}
                      >
                        {attributionPreviewTitle}
                      </ThemedText>
                    )}
                  </View>
                  <View style={styles.bookAttributionReviewCopy}>
                    <ThemedText
                      style={styles.bookAttributionReviewTitle}
                      numberOfLines={2}
                    >
                      {getValidBookTitle(bookTitle) || "Untitled book"}
                    </ThemedText>
                    {attributionPreviewMetadata?.author ? (
                      <ThemedText
                        style={styles.bookAttributionReviewAuthor}
                        numberOfLines={1}
                      >
                        {attributionPreviewMetadata.author}
                      </ThemedText>
                    ) : null}
                    <ThemedText style={styles.bookAttributionSelectedText}>
                      {attributionStatusText}
                    </ThemedText>
                  </View>
                </View>
              </View>

              {bookInputError ? (
                <ThemedText style={styles.manualLogError}>
                  {bookInputError}
                </ThemedText>
              ) : null}

              <View style={styles.bookReflectionCard}>
                <ThemedText style={styles.bookReflectionLabel}>
                  {"A note, if you'd like"}
                </ThemedText>
                <TextInput
                  placeholder="A thought, a line, a feeling..."
                  placeholderTextColor="rgba(47,93,80,0.38)"
                  value={completedBookReview}
                  onChangeText={(text) => {
                    setCompletedBookReview(text);
                    setBookInputError(null);
                  }}
                  onFocus={() => setCompletedBookReviewFocused(true)}
                  onBlur={() => setCompletedBookReviewFocused(false)}
                  style={styles.bookReflectionInput}
                  multiline
                  returnKeyType="done"
                  blurOnSubmit
                  onSubmitEditing={Keyboard.dismiss}
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.bookCompletedCard}>
                <Pressable
                  style={({ pressed }) => [
                    styles.bookCompletedToggle,
                    showBookCompletedInput && styles.bookCompletedToggleSelected,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => {
                    setShowBookCompletedInput((value) => !value);
                  }}
                >
                  <View style={styles.bookCompletedToggleCopy}>
                    <ThemedText style={styles.bookCompletedLabel}>
                      Finished this book?
                    </ThemedText>
                    <ThemedText style={styles.bookCompletedSubtext}>
                      If this was the last page, you can close it gently.
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
              </View>
            </>
          )}

          <View
            style={[
              styles.closeButtonRow,
              styles.bookAttributionBottomActions,
              !isChoosingBook && styles.bookAttributionBottomActionsFinal,
            ]}
          >
            <Pressable
              style={({ pressed }) => [
                styles.bookReturnSecondaryButton,
                !isChoosingBook && styles.bookReturnSecondaryButtonFinal,
                isSavingAttribution && { opacity: 0.72 },
                pressed && styles.buttonPressed,
              ]}
              disabled={isSavingAttribution}
              onPress={skipBookForSession}
            >
              <ThemedText style={styles.bookReturnSecondaryButtonText}>
                {isSavingAttributionSkip ? "Saving..." : "Not this time"}
              </ThemedText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.bookReturnSaveButton,
                !isChoosingBook && styles.bookReturnSaveButtonFinal,
                !hasAttributionBook && styles.bookReturnSaveButtonDisabled,
                isSavingAttribution && { opacity: 0.72 },
                pressed && hasAttributionBook && styles.buttonPressed,
              ]}
              disabled={!hasAttributionBook || isSavingAttribution}
              onPress={handleAttributionPrimaryPress}
            >
              <ThemedText
                style={[
                  styles.bookReturnSaveButtonText,
                  !hasAttributionBook &&
                    styles.bookReturnSaveButtonTextDisabled,
                ]}
              >
                {attributionPrimaryLabel}
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
      const manualKnownBookMetadata = getValidBookTitle(manualLogBookTitle)
        ? findKnownBookMetadataByTitle(manualLogBookTitle)
        : null;
      const shouldShowManualBookLookup =
        isManualBookLookupRequested &&
        manualLogBookTitle.trim().length >= 3 &&
        (isManualBookLookupLoading ||
          hasManualBookLookupSearched ||
          manualBookLookupResults.length > 0);
      const shouldInlineManualLogActions = isKeyboardVisible;
      const isSavingManualLog = savingAction === "manualLog";
      const manualLogActions = (
        <View style={styles.closeButtonRow}>
          <Pressable
            style={({ pressed }) => [
              styles.closeSecondaryButton,
              isSavingManualLog && { opacity: 0.62 },
              pressed && styles.buttonPressed,
            ]}
            disabled={isSavingManualLog}
            onPress={cancelManualLog}
          >
            <ThemedText style={styles.closeSecondaryButtonText}>
              Cancel
            </ThemedText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.closeSaveButton,
              isSavingManualLog && { opacity: 0.72 },
              pressed && styles.buttonPressed,
            ]}
            disabled={isSavingManualLog}
            onPress={saveManualReadingLog}
          >
            <ThemedText style={styles.closeSaveButtonText}>
              {isSavingManualLog ? "Saving..." : "Save reading"}
            </ThemedText>
          </Pressable>
        </View>
      );

      return (
      <ThemedView
        style={[styles.closeSessionScreen, { paddingTop: insets.top + 22 }]}
      >
        <StatusBar style="light" />
        <View style={styles.sessionGlowOne} />
        <View style={styles.sessionGlowTwo} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
        <ScrollView
          ref={manualLogScrollRef}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[
            styles.closeSessionContent,
            styles.manualLogContent,
            {
              paddingBottom:
                insets.bottom + (shouldInlineManualLogActions ? 120 : 132),
            },
          ]}
        >
          <Pressable
            style={({ pressed }) => [
              styles.diaryBackButton,
              styles.manualLogBackButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => openHomeDestination("menu")}
          >
            <ThemedText style={styles.diaryBackButtonText}>
              Back to menu
            </ThemedText>
          </Pressable>

          <ThemedText style={styles.closeEyebrow}>Reading moment</ThemedText>
          <ThemedText style={styles.closeTitle}>What did the time hold?</ThemedText>
          <ThemedText style={styles.closeMinutes}>
            For reading you did away from the timer.
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
            onFocus={() => setManualLogNoteFocused(false)}
          />

          <View
            style={[
              styles.closeBookInput,
              styles.manualBookInput,
              styles.manualBookInputRow,
            ]}
          >
            <TextInput
              ref={manualBookTitleInputRef}
              placeholder="Book title (optional)"
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={manualLogBookTitle}
              onChangeText={handleManualBookTitleChange}
              onFocus={() => {
                setManualLogNoteFocused(false);
                setManualBookTitleFocused(true);
                setIsManualBookLookupRequested(true);
                searchManualBookTitle(manualLogBookTitle);
              }}
              onBlur={() => setManualBookTitleFocused(false)}
              style={styles.manualBookTitleInput}
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={Keyboard.dismiss}
            />
            {manualLogBookTitle.trim().length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear book title"
                hitSlop={8}
                style={({ pressed }) => [
                  styles.manualBookClearButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={clearManualBookTitleSelection}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={22}
                  color="rgba(255,248,237,0.62)"
                />
              </Pressable>
            ) : null}
          </View>

          {selectedManualBookMetadata ? (
            <ThemedText style={styles.manualBookMetadataHint}>
              Selected from Google Books
            </ThemedText>
          ) : manualKnownBookMetadata ? (
            <ThemedText style={styles.manualBookMetadataHint}>
              Saved book found
            </ThemedText>
          ) : manualLogBookTitle.trim().length === 0 ? (
            <ThemedText style={styles.manualBookMetadataHint}>
              You can save this as a reading moment.
            </ThemedText>
          ) : null}

          {shouldShowManualBookLookup ? (
            <View style={styles.manualBookLookupPanel}>
              <View style={styles.bookLookupHeaderRow}>
                <ThemedText style={styles.manualBookLookupTitle}>
                  Book matches
                </ThemedText>
                {isManualBookLookupLoading ? (
                  <ThemedText style={styles.manualBookLookupLoading}>
                    Looking softly...
                  </ThemedText>
                ) : null}
              </View>

              {manualBookLookupResults.map((book) => {
                const isSelected =
                  selectedManualBookMetadata?.googleBooksId === book.googleBooksId;

                return (
                  <Pressable
                    key={book.googleBooksId ?? book.title}
                    style={({ pressed }) => [
                      styles.manualBookLookupChoice,
                      isSelected && styles.manualBookLookupChoiceSelected,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() => selectManualGoogleBook(book)}
                  >
                    {book.coverUrl ? (
                      <Image
                        source={{ uri: book.coverUrl }}
                        style={styles.manualBookLookupCover}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.manualBookLookupCoverPlaceholder}>
                        <ThemedText style={styles.manualBookLookupCoverText}>
                          R
                        </ThemedText>
                      </View>
                    )}
                    <View style={styles.bookLookupCopy}>
                      <View style={styles.bookLookupTitleRow}>
                        <ThemedText
                          style={styles.manualBookLookupBookTitle}
                          numberOfLines={2}
                        >
                          {book.title}
                        </ThemedText>
                        {isSelected ? (
                          <ThemedText style={styles.manualBookLookupSelectedLabel}>
                            Selected
                          </ThemedText>
                        ) : null}
                      </View>
                      {book.author ? (
                        <ThemedText
                          style={styles.manualBookLookupBookAuthor}
                          numberOfLines={1}
                        >
                          {book.author}
                        </ThemedText>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}

              {manualBookLookupResults.length > 0 ? (
                <ThemedText style={styles.manualBookLookupHelperText}>
                  Choose a book, or keep your typed title.
                </ThemedText>
              ) : null}

              {hasManualBookLookupSearched &&
              !isManualBookLookupLoading &&
              manualBookLookupResults.length === 0 ? (
                <ThemedText style={styles.manualBookLookupEmptyText}>
                  {manualBookLookupError
                    ? "Couldn't check matches right now. You can still save this title."
                    : "No matches yet. You can still save this title."}
                </ThemedText>
              ) : null}
            </View>
          ) : null}

          <TextInput
            placeholder="Optional note or reflection"
            placeholderTextColor="rgba(255,255,255,0.45)"
            value={manualLogNote}
            onChangeText={setManualLogNote}
            onFocus={() => setManualLogNoteFocused(true)}
            onBlur={() => setManualLogNoteFocused(false)}
            style={[styles.closeBookInput, styles.manualBookInput, styles.manualNoteInput]}
            multiline
            textAlignVertical="top"
          />

          {manualLogError && (
            <ThemedText style={styles.manualLogError}>
              {manualLogError}
            </ThemedText>
          )}

          {shouldInlineManualLogActions ? (
            <View style={styles.manualLogInlineActions}>
              {manualLogActions}
            </View>
          ) : null}

        </ScrollView>
        {!shouldInlineManualLogActions ? (
          <View
            style={[
              styles.manualLogFooter,
              { paddingBottom: Math.max(insets.bottom + 12, 24) },
            ]}
          >
            {manualLogActions}
          </View>
        ) : null}
        </KeyboardAvoidingView>
      </ThemedView>
    );
    }

    case "completedBook": {
      if (!isValidCompletedBookMoment(completedBookMoment)) {
        return (
          <ThemedView style={styles.loadingContainer}>
            <ThemedText style={styles.loadingWordmark}>Rousd</ThemedText>
            <View style={styles.loadingMark} />
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
        completedBookMoment.sessionCount === 1 ? "moment" : "moments";
      const completedBookBottomPadding = isKeyboardVisible
        ? Math.max(insets.bottom + 140, 180)
        : insets.bottom + 32;
      const shouldInlineCompletedBookActions =
        isKeyboardVisible || completedBookReviewFocused;
      const isSavingCompletedBookSave = savingAction === "completedBookSave";
      const isSavingCompletedBookSkip = savingAction === "completedBookSkip";
      const isSavingCompletedBook =
        isSavingCompletedBookSave || isSavingCompletedBookSkip;
      const completedBookActions = (
        <>
          {completedBookReviewError ? (
            <ThemedText style={styles.manualLogError}>
              {completedBookReviewError}
            </ThemedText>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.completedBookReturnButton,
              isSavingCompletedBook && { opacity: 0.72 },
              pressed && styles.buttonPressed,
            ]}
            disabled={isSavingCompletedBook}
            onPress={async () => {
              if (await finishCompletedBookMoment()) {
                setScreen("finishedBooks");
              }
            }}
          >
            <ThemedText style={styles.completedBookReturnButtonText}>
              {isSavingCompletedBookSave
                ? "Saving..."
                : "Save & remember this book"}
            </ThemedText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.completedBookSkipButton,
              isSavingCompletedBook && { opacity: 0.62 },
              pressed && styles.buttonPressed,
            ]}
            disabled={isSavingCompletedBook}
            onPress={async () => {
              if (await finishCompletedBookMoment("", "completedBookSkip")) {
                setScreen("finishedBooks");
              }
            }}
          >
            <ThemedText style={styles.completedBookSkipButtonText}>
              {isSavingCompletedBookSkip
                ? "Saving..."
                : "Return without saving note"}
            </ThemedText>
          </Pressable>
        </>
      );

      return (
      <ThemedView style={styles.completedBookScreen}>
        <KeyboardAvoidingView
          style={styles.completedBookKeyboardView}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <ScrollView
              ref={completedBookScrollRef}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets
              onScroll={(event) => {
                completedBookScrollYRef.current =
                  event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
              contentContainerStyle={[
                styles.completedBookRevealContent,
                isKeyboardVisible &&
                  styles.completedBookRevealContentWithKeyboard,
                {
                  paddingTop: insets.top + (isKeyboardVisible ? 10 : 18),
                  paddingBottom: completedBookBottomPadding,
                },
              ]}
            >
          <ThemedText style={styles.completedBookEyebrow}>FINISHED</ThemedText>

          <View
            style={[
              styles.completedBookCoverStage,
              isKeyboardVisible && styles.completedBookCoverStageCompact,
            ]}
          >
            <View
              style={[
                styles.completedBookCover,
                isKeyboardVisible && styles.completedBookCoverCompact,
              ]}
            >
              {completedBookMoment.coverUrl ? (
                <Image
                  source={{
                    uri: normalizeStoredCoverUrl(completedBookMoment.coverUrl) ?? "",
                  }}
                  style={[
                    styles.completedBookCoverImage,
                    isKeyboardVisible && styles.completedBookCoverImageCompact,
                  ]}
                  resizeMode="cover"
                />
              ) : (
                <ThemedText
                  style={styles.completedBookCoverTitle}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {completedBookMoment.title}
                </ThemedText>
              )}
            </View>
          </View>

          <ThemedText style={styles.completedBookHeadline}>
            You finished this book.
          </ThemedText>
          <ThemedText style={styles.completedBookTitle} numberOfLines={3}>
            {completedBookMoment.title}
          </ThemedText>
          {completedBookMoment.author ? (
            <ThemedText style={styles.completedBookAuthor}>
              {completedBookMoment.author}
            </ThemedText>
          ) : null}

          <View
            style={[
              styles.finishedBookDetailMetaCard,
              styles.completedBookMetaCard,
              isKeyboardVisible && styles.completedBookMetaCardCompact,
            ]}
          >
            <View
              style={[
                styles.finishedBookDetailMetaRow,
                styles.completedBookMetaRow,
              ]}
            >
              <ThemedText style={styles.finishedBookDetailMetaLabel}>
                Reading time
              </ThemedText>
              <ThemedText style={styles.finishedBookDetailMetaValue}>
                {formatDuration(Number(completedBookMoment.totalBookMinutes))}
              </ThemedText>
            </View>
            <View style={styles.finishedBookDetailMetaDivider} />
            <View
              style={[
                styles.finishedBookDetailMetaRow,
                styles.completedBookMetaRow,
              ]}
            >
              <ThemedText style={styles.finishedBookDetailMetaLabel}>
                Kept from
              </ThemedText>
              <ThemedText style={styles.finishedBookDetailMetaValue}>
                {completedBookMoment.sessionCount} {completedBookSessionLabel}
              </ThemedText>
            </View>
            <View style={styles.finishedBookDetailMetaDivider} />
            <View
              style={[
                styles.finishedBookDetailMetaRow,
                styles.completedBookMetaRow,
              ]}
            >
              <ThemedText style={styles.finishedBookDetailMetaLabel}>
                Time with this book
              </ThemedText>
              <ThemedText style={styles.finishedBookDetailMetaValue}>
                {daysCount === 1 ? "Today" : `${daysCount} days`}
              </ThemedText>
            </View>
          </View>

          <ThemedText style={styles.completedBookSubline}>
            {`${completedBookDaysLine}\nIt will stay in your reading life.`}
          </ThemedText>

          <View style={styles.completedBookReflectionWrap}>
            <ThemedText style={styles.completedBookReflectionLabel}>
              {reflectionPrompt}
            </ThemedText>
            <TextInput
              placeholder="A thought, a line, a feeling..."
              placeholderTextColor="rgba(47,93,80,0.38)"
              value={completedBookReview}
              onChangeText={(text) => {
                setCompletedBookReview(text);
                setCompletedBookReviewError(null);
              }}
              onFocus={() => setCompletedBookReviewFocused(true)}
              onBlur={() => setCompletedBookReviewFocused(false)}
              onContentSizeChange={(event) => {
                const nextHeight = event.nativeEvent.contentSize.height;
                const previousHeight =
                  completedBookReviewInputHeightRef.current || nextHeight;
                const heightDelta = nextHeight - previousHeight;

                completedBookReviewInputHeightRef.current = nextHeight;

                if (
                  !completedBookReviewFocused ||
                  !isKeyboardVisible ||
                  heightDelta <= 1
                ) {
                  return;
                }

                const scrollDelta = Math.min(heightDelta, 36);
                requestAnimationFrame(() => {
                  completedBookScrollRef.current?.scrollTo({
                    y: completedBookScrollYRef.current + scrollDelta,
                    animated: true,
                  });
                });
              }}
              style={styles.completedBookReflectionInput}
              multiline
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={Keyboard.dismiss}
              textAlignVertical="top"
            />
          </View>

          {shouldInlineCompletedBookActions ? (
            <View style={styles.completedBookInlineActions}>
              {completedBookActions}
            </View>
          ) : (
            completedBookActions
          )}
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </ThemedView>
    );
    }

    case "reveal": {
      if (!isValidSanctuaryReveal(sanctuaryReveal)) {
        return (
          <ThemedView style={styles.loadingContainer}>
            <ThemedText style={styles.loadingWordmark}>Rousd</ThemedText>
            <View style={styles.loadingMark} />
          </ThemedView>
        );
      }

      const isSavingRevealNote = savingAction === "revealNote";
      const revealActions = (
        <>
          {sessionReflectionError ? (
            <ThemedText style={styles.manualLogError}>
              {sessionReflectionError}
            </ThemedText>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.bookRevealContinueButton,
              isSavingRevealNote && { opacity: 0.72 },
              pressed && styles.buttonPressed,
            ]}
            disabled={isSavingRevealNote}
            onPress={() => dismissSanctuaryReveal()}
          >
            <ThemedText style={styles.bookRevealContinueButtonText}>
              {isSavingRevealNote ? "Saving..." : "Return home"}
            </ThemedText>
          </Pressable>
        </>
      );
      const revealFooterBottomPadding = isKeyboardVisible
        ? isUnattachedReveal
          ? 10
          : 12
        : isUnattachedReveal
          ? Math.max(insets.bottom + 4, 16)
          : Math.max(insets.bottom + 10, 22);
      const revealScrollBottomPadding = isKeyboardVisible
        ? isUnattachedReveal
          ? 200
          : 220
        : isUnattachedReveal
          ? 8
          : 24;
      const revealMainCopy = isUnattachedReveal
        ? "This moment has a place now."
        : "This book has a little more history now.";

      return (
      <ThemedView
        style={[styles.bookRevealScreen, { paddingTop: insets.top + 18 }]}
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
            style={styles.bookRevealScrollView}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={[
              styles.bookRevealContent,
              {
                paddingBottom: revealScrollBottomPadding,
              },
            ]}
          >
            <ThemedText
              style={[
                styles.bookRevealEyebrow,
                isUnattachedReveal && styles.bookRevealEyebrowCompact,
              ]}
            >
              Saved
            </ThemedText>
            <ThemedText
              style={[
                styles.bookRevealTitle,
                isUnattachedReveal && styles.bookRevealTitleCompact,
              ]}
            >
              {revealMainCopy}
            </ThemedText>

            <Animated.View
              style={[
                styles.bookRevealCard,
                isUnattachedReveal && styles.bookRevealCardCompact,
                { transform: [{ scale: revealSceneScale }] },
              ]}
            >
              <View
                style={[
                  styles.bookRevealCover,
                  isUnattachedReveal && styles.bookRevealCoverCompact,
                ]}
              >
                {sanctuaryReveal.coverUrl ? (
                  <Image
                    source={{
                      uri: normalizeStoredCoverUrl(sanctuaryReveal.coverUrl) ?? "",
                    }}
                    style={styles.bookRevealCoverImage}
                    resizeMode="cover"
                  />
                ) : (
                  isUnattachedReveal ? (
                    <ThemedText
                      style={[
                        styles.readingMomentCoverMarkLarge,
                        styles.readingMomentCoverMarkCompact,
                      ]}
                    >
                      R
                    </ThemedText>
                  ) : (
                    <ThemedText
                      style={styles.bookRevealCoverTitle}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {revealBookTitle}
                    </ThemedText>
                  )
                )}
              </View>
              <View style={styles.bookRevealTextBlock}>
                <ThemedText style={styles.bookRevealBookTitle} numberOfLines={2}>
                  {revealBookTitle}
                </ThemedText>
                {sanctuaryReveal.author ? (
                  <ThemedText
                    style={[
                      styles.bookRevealMeta,
                      isUnattachedReveal && styles.bookRevealMetaCompact,
                    ]}
                    numberOfLines={1}
                  >
                    {sanctuaryReveal.author}
                  </ThemedText>
                ) : null}
                <ThemedText
                  style={[
                    styles.bookRevealMeta,
                    isUnattachedReveal && styles.bookRevealMetaCompact,
                  ]}
                >
                  +{formatDuration(Number(sanctuaryReveal.sessionMinutes))} added
                </ThemedText>
                {isUnattachedReveal ? (
                  <ThemedText
                    style={[
                      styles.bookRevealMeta,
                      styles.bookRevealMetaCompact,
                    ]}
                  >
                    Saved as a reading moment.
                  </ThemedText>
                ) : null}
              </View>
            </Animated.View>

            {sanctuaryReveal.noteSaved ? (
              <ThemedText style={styles.bookRevealNoteSaved}>
                Your note was saved.
              </ThemedText>
            ) : null}
          </ScrollView>
          <View
            style={[
              styles.bookRevealFooter,
              { paddingBottom: revealFooterBottomPadding },
            ]}
          >
            {revealActions}
          </View>
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
              onPress={() => openHomeDestination(libraryReturnScreen)}
            >
              <ThemedText style={styles.diaryBackButtonText}>
                {libraryReturnLabel}
              </ThemedText>
            </Pressable>

            <ThemedText style={styles.diaryTitle}>Your reading life</ThemedText>
            <ThemedText style={styles.diarySubtitle}>
              Your private reading journal.
            </ThemedText>

            {diarySessions.length === 0 ? (
              <View style={styles.diaryEmptyCard}>
                <ThemedText style={styles.diaryEmptyText}>
                  No reading moments here yet.
                </ThemedText>
                <ThemedText style={styles.diaryEmptySubtext}>
                  {"Start reading, then come back here whenever you leave a note."}
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
                          <View style={styles.diaryEntryCover}>
                            {session.coverUrl ? (
                              <Image
                                source={{
                                  uri: normalizeStoredCoverUrl(session.coverUrl) ?? "",
                                }}
                                style={styles.diaryEntryCoverImage}
                                resizeMode="cover"
                              />
                            ) : (
                              isUnattachedSessionTitle(session.title) ? (
                                <ThemedText style={styles.readingMomentCoverMarkSmall}>
                                  R
                                </ThemedText>
                              ) : (
                                <ThemedText
                                  style={styles.diaryEntryCoverText}
                                  numberOfLines={1}
                                >
                                  {getDisplaySessionTitle(session.title)}
                                </ThemedText>
                              )
                            )}
                          </View>
                          <View style={styles.diaryEntryCopy}>
                            <ThemedText style={styles.diaryBookTitle}>
                              {getDisplaySessionTitle(session.title)}
                            </ThemedText>
                            <ThemedText style={styles.diaryMeta}>
                              {formatSessionTimestamp(
                                session.createdAt,
                                legacyDate,
                              )}
                            </ThemedText>
                          </View>

                          <ThemedText style={styles.diaryDuration}>
                            {formatDuration(Number(session.minutes))}
                          </ThemedText>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Delete this reading moment"
                            hitSlop={8}
                            style={({ pressed }) => [
                              styles.diaryDeleteButton,
                              pressed && styles.buttonPressed,
                            ]}
                            onPress={() => confirmDeleteReadingSession(session.id)}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={16}
                              color="rgba(180,83,58,0.62)"
                            />
                          </Pressable>
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
                styles.diaryBackButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => openHomeDestination(libraryReturnScreen)}
            >
              <ThemedText style={styles.diaryBackButtonText}>
                {libraryReturnLabel}
              </ThemedText>
            </Pressable>

            <ThemedText style={styles.finishedBooksEyebrow}>
              FINISHED BOOKS
            </ThemedText>
            <ThemedText style={styles.finishedBooksTitle}>
              Your quiet shelf.
            </ThemedText>
            <ThemedText style={styles.finishedBooksSubtitle}>
              {"The books you've finished, kept quietly here."}
            </ThemedText>

            {completedBooks.length === 0 ? (
              <View style={styles.diaryEmptyCard}>
                <ThemedText style={styles.diaryEmptyText}>
                  Your shelf is waiting.
                </ThemedText>
                <ThemedText style={styles.diaryEmptySubtext}>
                  Mark a book finished after reading, and it will rest here.
                </ThemedText>
              </View>
            ) : (
              <View style={styles.finishedBooksShelf}>
                {completedBooks.map((book, index) => (
                  <View key={book.id}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.finishedBookCard,
                        pressed && styles.buttonPressed,
                      ]}
                      onPress={() => {
                        setSelectedFinishedBook(book);
                        setScreen("finishedBookDetail");
                      }}
                    >
                      <View
                        style={[
                          styles.finishedBookCover,
                          index % 2 === 1 && styles.finishedBookCoverAlt,
                        ]}
                      >
                        {book.coverUrl ? (
                          <Image
                            source={{
                              uri: normalizeStoredCoverUrl(book.coverUrl) ?? "",
                            }}
                            style={styles.finishedBookCoverImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <ThemedText
                            style={styles.finishedBookCoverTitle}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {book.title}
                          </ThemedText>
                        )}
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
                          {formatDuration(Number(book.totalBookMinutes ?? book.sessionMinutes))}{" - "}
                          {book.sessionCount ?? 1}{" "}
                          {(book.sessionCount ?? 1) === 1 ? "moment" : "moments"}
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
                    </Pressable>
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
    case "finishedBookDetail": {
      const book = selectedFinishedBook;

      if (!book) {
        return (
          <ThemedView style={styles.loadingContainer}>
            <ThemedText style={styles.loadingWordmark}>Rousd</ThemedText>
            <View style={styles.loadingMark} />
          </ThemedView>
        );
      }

      const detailCoverUrl = normalizeStoredCoverUrl(book.coverUrl);
      const finishedDate = getCompletedBookShelfDate(book.completedAt);
      const totalReadingTime = formatDuration(
        Number(book.totalBookMinutes ?? book.sessionMinutes),
      );
      const sessionCount = book.sessionCount ?? 1;
      const sessionLabel = sessionCount === 1 ? "moment" : "moments";
      const review = book.review.trim();

      return (
        <ThemedView style={styles.finishedBooksScreen}>
          <ScrollView
            style={styles.finishedBooksScrollView}
            contentContainerStyle={[
              styles.finishedBookDetailContent,
              { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 36 },
            ]}
          >
            <Pressable
              style={({ pressed }) => [
                styles.diaryBackButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => setScreen("finishedBooks")}
            >
              <ThemedText style={styles.diaryBackButtonText}>
                Back to shelf
              </ThemedText>
            </Pressable>

            <View style={styles.finishedBookDetailHero}>
              <View style={styles.finishedBookDetailCover}>
                {detailCoverUrl ? (
                  <Image
                    source={{ uri: detailCoverUrl }}
                    style={styles.finishedBookDetailCoverImage}
                    resizeMode="cover"
                  />
                ) : (
                  <ThemedText
                    style={styles.finishedBookDetailCoverTitle}
                    numberOfLines={2}
                  >
                    {book.title}
                  </ThemedText>
                )}
              </View>

              <ThemedText style={styles.finishedBookDetailLabel}>
                Finished book
              </ThemedText>
              <ThemedText style={styles.finishedBookDetailTitle}>
                {book.title}
              </ThemedText>
              {book.author ? (
                <ThemedText style={styles.finishedBookDetailAuthor}>
                  {book.author}
                </ThemedText>
              ) : null}
            </View>

            <View style={styles.finishedBookDetailMetaCard}>
              <View style={styles.finishedBookDetailMetaRow}>
                <ThemedText style={styles.finishedBookDetailMetaLabel}>
                  Finished
                </ThemedText>
                <ThemedText style={styles.finishedBookDetailMetaValue}>
                  {finishedDate}
                </ThemedText>
              </View>
              <View style={styles.finishedBookDetailMetaDivider} />
              <View style={styles.finishedBookDetailMetaRow}>
                <ThemedText style={styles.finishedBookDetailMetaLabel}>
                  Reading time
                </ThemedText>
                <ThemedText style={styles.finishedBookDetailMetaValue}>
                  {totalReadingTime}
                </ThemedText>
              </View>
              <View style={styles.finishedBookDetailMetaDivider} />
              <View style={styles.finishedBookDetailMetaRow}>
                <ThemedText style={styles.finishedBookDetailMetaLabel}>
                  Kept from
                </ThemedText>
                <ThemedText style={styles.finishedBookDetailMetaValue}>
                  {sessionCount} {sessionLabel}
                </ThemedText>
              </View>
            </View>

            {review ? (
              <View style={styles.finishedBookDetailReviewCard}>
                <ThemedText style={styles.finishedBookDetailReviewLabel}>
                  Note
                </ThemedText>
                <ThemedText style={styles.finishedBookDetailReview}>
                  {review}
                </ThemedText>
              </View>
            ) : null}
          </ScrollView>
        </ThemedView>
      );
    }
    case "menu":
      return (
        <ThemedView style={styles.menuScreen}>
          <ScrollView
            style={styles.menuScrollView}
            contentContainerStyle={[
              styles.menuContent,
              { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 36 },
            ]}
          >
            <Pressable
              style={({ pressed }) => [
                styles.diaryBackButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => openHomeDestination("home")}
            >
              <ThemedText style={styles.diaryBackButtonText}>
                Return home
              </ThemedText>
            </Pressable>

            <ThemedText style={styles.menuEyebrow}>Menu</ThemedText>
            <ThemedText style={styles.menuTitle}>Nearby places.</ThemedText>
            <ThemedText style={styles.menuSubtitle}>
              The quieter corners of your reading life.
            </ThemedText>

            <View style={styles.menuCardStack}>
              <Pressable
                style={({ pressed }) => [
                  styles.menuNavCard,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => openHomeDestination("diary")}
              >
                <View style={styles.menuNavIconCircle}>
                  <Ionicons
                    name="book-outline"
                    size={19}
                    color="rgba(47,93,80,0.72)"
                  />
                </View>
                <View style={styles.menuNavCopy}>
                  <ThemedText style={styles.menuNavTitle}>Diary</ThemedText>
                  <ThemedText style={styles.menuNavSubtext}>
                    Your private reading journal
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color="rgba(47,93,80,0.34)"
                />
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.menuNavCard,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => openHomeDestination("finishedBooks")}
              >
                <View style={styles.menuNavIconCircle}>
                  <Ionicons
                    name="library-outline"
                    size={19}
                    color="rgba(47,93,80,0.72)"
                  />
                </View>
                <View style={styles.menuNavCopy}>
                  <ThemedText style={styles.menuNavTitle}>
                    Finished Books
                  </ThemedText>
                  <ThemedText style={styles.menuNavSubtext}>
                    Your quiet shelf
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color="rgba(47,93,80,0.34)"
                />
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.menuNavCard,
                  pressed && styles.buttonPressed,
                ]}
                onPress={openManualLog}
              >
                <View style={styles.menuNavIconCircle}>
                  <Ionicons
                    name="create-outline"
                    size={19}
                    color="rgba(47,93,80,0.72)"
                  />
                </View>
                <View style={styles.menuNavCopy}>
                  <ThemedText style={styles.menuNavTitle}>
                    Add a reading moment
                  </ThemedText>
                  <ThemedText style={styles.menuNavSubtext}>
                    For reading you did away from the timer.
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color="rgba(47,93,80,0.34)"
                />
              </Pressable>
            </View>
          </ScrollView>
        </ThemedView>
      );
    case "home":
      return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: Math.max(insets.bottom + 28, 44) },
      ]}
    >
      <ThemedView
        style={[styles.container, { paddingTop: insets.top + 22 }]}
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
          <View style={styles.headerCopy}>
            <ThemedText style={styles.appName}>Rousd</ThemedText>
            <ThemedText style={styles.headerSubtitle}>
              A quiet place to return.
            </ThemedText>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.menuButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => openHomeDestination("menu")}
          >
            <Ionicons
              name="ellipsis-vertical"
              size={18}
              color="rgba(47,93,80,0.62)"
            />
            <ThemedText style={styles.menuButtonText}>Menu</ThemedText>
          </Pressable>
        </ThemedView>

        <View style={styles.bookShrineHero}>
          <View pointerEvents="none" style={styles.bookShrineWarmGlow} />

          <View style={styles.bookShrineTopRow}>
            <View style={styles.bookShrineIconPill}>
              <Ionicons
                name="book-outline"
                size={13}
                color="rgba(47,93,80,0.62)"
              />
            </View>
            <ThemedText style={styles.bookShrineStage}>
              Currently reading
            </ThemedText>
          </View>

          <View style={styles.bookShrinePanel}>
            <View style={styles.bookShrineCoverWrap}>
              <View pointerEvents="none" style={styles.bookShrineCoverGlow} />
              <View style={styles.bookShrineCover}>
                {currentBookCoverUrl ? (
                  <Image
                    source={{ uri: currentBookCoverUrl }}
                    style={styles.bookShrineCoverImage}
                    resizeMode="cover"
                  />
                ) : (
                  shouldShowCurrentBookPlaceholderMark ? (
                    <ThemedText style={styles.readingMomentCoverMarkHero}>
                      R
                    </ThemedText>
                  ) : (
                    <ThemedText
                      style={styles.bookShrineCoverTitle}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {currentBookDisplayTitle}
                    </ThemedText>
                  )
                )}
              </View>
            </View>

            <View style={styles.bookShrineCopy}>
              <ThemedText style={styles.bookShrineBookTitle} numberOfLines={3}>
                {currentBookDisplayTitle}
              </ThemedText>
              <ThemedText style={styles.bookShrineSubcopy}>
                {currentBookSubcopy}
              </ThemedText>
              <ThemedText style={styles.bookShrineBookMeta}>
                {currentBookMeta}
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
            <Ionicons
              name="book-outline"
              size={22}
              color="rgba(255,255,255,0.88)"
            />
            <View style={styles.startHeroCopy}>
              <ThemedText
                style={styles.startHeroTitle}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.88}
              >
                Start reading
              </ThemedText>
            </View>
            <View style={styles.startHeroArrowCircle}>
              <Ionicons
                name="arrow-forward"
                size={19}
                color="rgba(255,255,255,0.9)"
              />
            </View>
          </View>
        </Pressable>

        {currentBookLastSessionWithNote ? (
          <View style={styles.lastBookMoment}>
            <View style={styles.lastBookMomentHeader}>
              <ThemedText style={styles.lastBookMomentTitle}>
                Last time with this book
              </ThemedText>
              <ThemedText style={styles.lastBookMomentDate}>
                {formatCurrentBookTimestamp(
                  currentBookLastSessionWithNote.createdAt,
                )}
              </ThemedText>
            </View>
            <ThemedText style={styles.lastBookMomentText} numberOfLines={2}>
              {currentBookLastSessionNote}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.homeShortcutStack}>
          <Pressable
            style={({ pressed }) => [
              styles.homeShortcutCard,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => openHomeDestination("diary")}
          >
            <View style={styles.homeShortcutTopRow}>
              <View style={styles.homeShortcutIconCircle}>
                <Ionicons
                  name="book-outline"
                  size={18}
                  color="rgba(47,93,80,0.72)"
                />
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color="rgba(47,93,80,0.34)"
              />
            </View>
            <View style={styles.homeShortcutCopy}>
              <ThemedText style={styles.homeShortcutTitle}>Diary</ThemedText>
              <ThemedText style={styles.homeShortcutSubtext}>
                Your private reading journal
              </ThemedText>
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.homeShortcutCard,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => openHomeDestination("finishedBooks")}
          >
            <View style={styles.homeShortcutTopRow}>
              <View style={styles.homeShortcutIconCircle}>
                <Ionicons
                  name="library-outline"
                  size={18}
                  color="rgba(47,93,80,0.72)"
                />
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color="rgba(47,93,80,0.34)"
              />
            </View>
            <View style={styles.homeShortcutCopy}>
              <ThemedText style={styles.homeShortcutTitle}>
                Finished Books
              </ThemedText>
              <ThemedText style={styles.homeShortcutSubtext}>
                Your quiet shelf
              </ThemedText>
            </View>
          </Pressable>
        </View>

        {sessionMessage && (
          <ThemedView style={styles.sessionToast}>
            <ThemedText style={styles.sessionToastText}>
              {sessionMessage}
            </ThemedText>
          </ThemedView>
        )}

        <View style={styles.sessionsHeaderRow}>
          <ThemedText style={styles.sessionsTitle}>Recent reading</ThemedText>
          {recentSessions.length > 0 ? (
            <Pressable
              style={({ pressed }) => [
                styles.sessionsViewAllButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => openHomeDestination("diary")}
            >
              <ThemedText style={styles.sessionsViewAllText}>
                View all
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <ThemedView style={styles.sessionsCard}>
          {recentSessions.length === 0 ? (
            <ThemedText style={styles.emptySessionsText}>
              Your reading moments will gather here.
            </ThemedText>
          ) : (
            visibleSessions.slice(0, 1).map((session, index) => {
              return (
                <View
                  key={session.id}
                  style={[
                    styles.sessionRow,
                    index === 0 && styles.lastSessionRow,
                  ]}
                >
                  <View style={styles.sessionIconCircle}>
                    <Ionicons
                      name="time-outline"
                      size={16}
                      color="rgba(47,93,80,0.58)"
                    />
                  </View>

                  <View style={styles.sessionTextContainer}>
                    <ThemedText style={styles.sessionBookTitle} numberOfLines={1}>
                      {getDisplaySessionTitle(session.title)}
                    </ThemedText>
                    <ThemedText style={styles.sessionDate} numberOfLines={1}>
                      Read {formatRecentReadingTimestamp(session.createdAt)}
                    </ThemedText>
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
            styles.manualLogButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={openManualLog}
        >
          <View style={styles.manualLogButtonContent}>
            <View style={styles.manualLogButtonIcon}>
              <Ionicons
                name="create-outline"
                size={18}
                color="rgba(47,93,80,0.72)"
              />
            </View>
            <View style={styles.manualLogButtonCopy}>
              <ThemedText style={styles.manualLogButtonText}>
                Add a reading moment
              </ThemedText>
              <ThemedText style={styles.manualLogButtonSubtext}>
                For reading you did away from the timer.
              </ThemedText>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color="rgba(47,93,80,0.34)"
            />
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
    minHeight: "100%",
    position: "relative",
    paddingHorizontal: 22,
    paddingTop: 46,
    paddingBottom: 54,
    gap: 10,
    backgroundColor: colors.background,
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
    opacity: 0.035,
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
    display: "none",
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
    fontFamily: serifFont,
  },
  loadingMark: {
    width: 34,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(47,93,80,0.22)",
    marginTop: 12,
  },
  welcomeScreen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 22,
    paddingTop: 72,
    paddingBottom: 42,
    justifyContent: "flex-start",
    overflow: "hidden",
  },
  welcomeContent: {
    flexGrow: 1,
    justifyContent: "center",
    backgroundColor: "transparent",
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
    borderRadius: 30,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    ...cardShadow,
  },
  welcomeSanctuaryPreview: {
    height: 126,
    borderRadius: 24,
    backgroundColor: "#163D31",
    overflow: "hidden",
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(23,56,38,0.10)",
  },
  welcomeLampGlow: {
    position: "absolute",
    top: -28,
    alignSelf: "center",
    width: 162,
    height: 118,
    borderRadius: 82,
    backgroundColor: "rgba(247,195,107,0.30)",
  },
  welcomeReadingSurface: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 38,
    backgroundColor: "rgba(184,144,104,0.52)",
  },
  welcomeMug: {
    position: "absolute",
    right: 66,
    bottom: 36,
    width: 27,
    height: 24,
    borderRadius: 9,
    backgroundColor: "rgba(255,248,237,0.34)",
  },
  welcomeMugHandle: {
    position: "absolute",
    right: 57,
    bottom: 41,
    width: 13,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "rgba(255,248,237,0.28)",
  },
  welcomeStillLifeBook: {
    position: "absolute",
    alignSelf: "center",
    bottom: 37,
    width: 126,
    height: 38,
    borderRadius: 7,
    backgroundColor: "transparent",
  },
  welcomeBookCover: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 5,
    borderRadius: 8,
    backgroundColor: "rgba(255,248,237,0.78)",
  },
  welcomeBookSpine: {
    position: "absolute",
    left: 13,
    top: 0,
    bottom: 5,
    width: 8,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    backgroundColor: "rgba(47,93,80,0.28)",
  },
  welcomeBookPageEdge: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 0,
    height: 8,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    backgroundColor: "rgba(247,243,234,0.54)",
  },
  welcomeEyebrow: {
    color: "rgba(47,93,80,0.72)",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  welcomeTitle: {
    color: "#173826",
    fontSize: 32,
    lineHeight: 37,
    fontWeight: "400",
    letterSpacing: 0,
    fontFamily: serifFont,
  },
  welcomeBody: {
    color: "rgba(31,41,51,0.68)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    marginTop: 10,
  },
  welcomeStepsCard: {
    backgroundColor: "rgba(247,243,234,0.78)",
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
    marginTop: 16,
    marginBottom: 16,
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
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  welcomeButton: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 15,
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
    gap: 14,
    backgroundColor: "transparent",
    marginBottom: 0,
    zIndex: 2,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  menuButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,248,237,0.62)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  menuButtonText: {
    color: "rgba(47,93,80,0.68)",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  appName: {
    fontSize: 44,
    lineHeight: 48,
    fontWeight: "400",
    color: "#1B2A22",
    letterSpacing: 0,
    fontFamily: serifFont,
  },
  headerSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.mutedText,
    fontWeight: "600",
    marginTop: 0,
  },
  sanctuaryHeroScene: {
    height: 186,
    backgroundColor: "#1B4234",
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,248,237,0.08)",
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
  sanctuaryHeroBackWallShelf: {
    position: "absolute",
    top: 156,
    left: 34,
    width: 116,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(106,70,59,0.26)",
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
  sanctuaryHeroBlanket: {
    position: "absolute",
    right: 8,
    bottom: 7,
    width: 31,
    height: 39,
    borderRadius: 14,
    backgroundColor: "rgba(247,195,107,0.72)",
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
  sanctuaryHeroLeafOne: {
    right: 82,
    bottom: 72,
    transform: [{ rotate: "-24deg" }],
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
  sanctuaryHeroStoveTop: {
    position: "absolute",
    top: -6,
    left: 13,
    right: 13,
    height: 8,
    borderRadius: 5,
    backgroundColor: "#48514B",
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
  sanctuaryHeroFireGlow: {
    position: "absolute",
    width: 44,
    height: 28,
    borderRadius: 15,
    backgroundColor: "rgba(239,143,62,0.72)",
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
  sanctuaryHeroBookStack: {
    position: "absolute",
    left: 34,
    bottom: 44,
    width: 56,
    gap: 4,
  },
  sanctuaryHeroBookTwo: {
    width: 42,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(201,133,104,0.78)",
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
  sanctuaryHeroVine: {
    position: "absolute",
    top: 30,
    left: 38,
    right: 44,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(116,138,93,0.58)",
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
  sanctuaryHeroShelfBookOne: {
    width: 10,
    height: 24,
    borderRadius: 2,
    backgroundColor: "#F7C36B",
  },
  sanctuaryHeroShelfBookThree: {
    width: 10,
    height: 30,
    borderRadius: 2,
    backgroundColor: "rgba(201,133,104,0.78)",
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
  sanctuaryHeroCopy: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 17,
    backgroundColor: "#0B2A22",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,248,237,0.10)",
  },
  sanctuaryHeroTitle: {
    color: "#FFF8ED",
    fontSize: 30,
    lineHeight: 35,
    fontWeight: "400",
    letterSpacing: -1.05,
    fontFamily: serifFont,
  },
  sanctuaryHeroSubtitle: {
    color: "rgba(255,248,237,0.78)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  sanctuaryMilestoneText: {
    color: "rgba(255,248,237,0.82)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
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
  sanctuaryHeroStatNumber: {
    color: "#FFF8ED",
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "700",
    letterSpacing: -0.35,
  },
  sanctuaryHeroStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,248,237,0.18)",
  },
  sanctuaryHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: "transparent",
    marginBottom: 10,
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
  sanctuaryStagePill: {
    backgroundColor: "rgba(23,56,38,0.08)",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: "rgba(23,56,38,0.08)",
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
  sanctuaryHearthAura: {
    position: "absolute",
    right: 10,
    bottom: 18,
    width: 144,
    height: 112,
    borderRadius: 56,
    backgroundColor: "rgba(239,143,62,0.20)",
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
  sanctuaryRug: {
    position: "absolute",
    left: 64,
    right: 64,
    bottom: 24,
    height: 30,
    borderRadius: 20,
    backgroundColor: "rgba(201,133,104,0.88)",
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
  sanctuaryLeaf: {
    position: "absolute",
    right: 78,
    bottom: 78,
    width: 28,
    height: 42,
    borderRadius: 20,
    backgroundColor: "rgba(116,138,93,0.72)",
  },
  sanctuaryLeafTwo: {
    right: 94,
    bottom: 82,
    backgroundColor: "rgba(95,117,77,0.70)",
    transform: [{ rotate: "24deg" }],
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
  ironStoveTop: {
    position: "absolute",
    top: -5,
    left: 12,
    right: 12,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#48514B",
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
  fireGlow: {
    position: "absolute",
    width: 44,
    height: 26,
    borderRadius: 15,
    backgroundColor: "rgba(239,143,62,0.88)",
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
  sanctuaryBookStack: {
    position: "absolute",
    left: 28,
    bottom: 54,
    width: 48,
    height: 28,
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  sanctuaryBookTwo: {
    width: 36,
    height: 7,
    borderRadius: 3,
    backgroundColor: "rgba(201,133,104,0.78)",
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
  sanctuaryShelfBookOne: {
    width: 10,
    height: 24,
    borderRadius: 2,
    backgroundColor: "#F7C36B",
  },
  sanctuaryShelfBookThree: {
    width: 10,
    height: 28,
    borderRadius: 2,
    backgroundColor: "rgba(201,133,104,0.78)",
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
  sanctuarySubCopy: {
    color: "rgba(31,41,51,0.64)",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
    marginTop: 5,
  },
  startHero: {
    minHeight: 82,
    marginTop: 2,
    backgroundColor: "#1F4F3B",
    borderRadius: 28,
    paddingHorizontal: 24,
    justifyContent: "center",
    shadowColor: "#315F52",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.09,
    shadowRadius: 14,
    elevation: 3,
    zIndex: 3,
  },
  startHeroContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "transparent",
  },
  startHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  startHeroTitle: {
    color: "#FFFFFF",
    fontSize: 23,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: 0,
    flexShrink: 1,
  },
  startHeroArrowCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  lastBookMoment: {
    backgroundColor: "rgba(255,248,237,0.58)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    zIndex: 3,
  },
  lastBookMomentHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: "transparent",
  },
  lastBookMomentTitle: {
    flex: 1,
    minWidth: 0,
    color: "rgba(31,41,51,0.74)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  lastBookMomentDate: {
    color: "rgba(47,93,80,0.52)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
  },
  lastBookMomentText: {
    color: "rgba(31,41,51,0.58)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "400",
    marginTop: 6,
  },
  manualLogButton: {
    backgroundColor: "rgba(255,248,237,0.52)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.06)",
    borderRadius: 18,
    minHeight: 76,
    paddingVertical: 12,
    paddingHorizontal: 13,
    zIndex: 3,
  },
  manualLogButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "transparent",
  },
  manualLogButtonIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.06)",
  },
  manualLogButtonCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  manualLogButtonText: {
    color: colors.accentDark,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  manualLogButtonSubtext: {
    color: "rgba(31,41,51,0.52)",
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "400",
    marginTop: 3,
  },
  manualLogChevron: {
    color: "rgba(36,72,62,0.44)",
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "300",
  },

  identityColumn: {
    flex: 1,
    backgroundColor: colors.card,
  },
  identityTitle: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "900",
    color: colors.text,
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
  currentBookIcon: {
    fontSize: 16,
    lineHeight: 20,
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
  treeLine: {
    position: "absolute",
    bottom: 22,
    flexDirection: "row",
    gap: 12,
    opacity: 0.28,
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
  ritualDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 15,
    zIndex: 2,
  },
  ritualLeaf: {
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
  },
  homeShortcutStack: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "transparent",
    zIndex: 3,
  },
  homeShortcutCard: {
    flex: 1,
    minHeight: 84,
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: "rgba(255,248,237,0.52)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.06)",
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
  homeShortcutTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "transparent",
  },
  homeShortcutIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.06)",
  },
  homeShortcutCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  homeShortcutTitle: {
    color: colors.accentDark,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  homeShortcutSubtext: {
    color: "rgba(31,41,51,0.52)",
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "400",
    marginTop: 3,
  },
  bookInputLabel: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "800",
    color: colors.text,
  },
  bookButtonRow: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.card,
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
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
    marginTop: 4,
    marginBottom: -2,
    zIndex: 2,
  },
  sessionsViewAllButton: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  sessionsViewAllText: {
    color: "rgba(47,93,80,0.58)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  sessionsTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "rgba(31,41,51,0.58)",
  },
  sessionsCard: {
    backgroundColor: "rgba(255,255,255,0.44)",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
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
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.06)",
    backgroundColor: "rgba(255,255,255,0.50)",
  },
  lastSessionRow: {
    borderBottomWidth: 0,
  },
  sessionIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.softAccent,
    marginRight: 10,
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
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "500",
    color: "rgba(31,41,51,0.82)",
  },
  sessionDate: {
    fontSize: 11,
    lineHeight: 16,
    color: "rgba(107,114,128,0.78)",
    marginTop: 2,
    fontWeight: "500",
  },
  sessionNote: {
    color: "rgba(107,114,128,0.78)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    marginTop: 5,
  },
  sessionMinutes: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: "rgba(47,93,80,0.66)",
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
  menuScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  menuScrollView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  menuContent: {
    paddingHorizontal: 24,
  },
  menuEyebrow: {
    color: "rgba(47,93,80,0.58)",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  menuTitle: {
    color: "#1B2A22",
    fontSize: 42,
    lineHeight: 48,
    fontWeight: "400",
    letterSpacing: -0.7,
    marginTop: 8,
    fontFamily: serifFont,
  },
  menuSubtitle: {
    color: "rgba(47,93,80,0.54)",
    fontSize: 16,
    lineHeight: 23,
    fontStyle: "italic",
    fontWeight: "600",
    marginTop: 8,
  },
  menuCardStack: {
    gap: 12,
    marginTop: 28,
    backgroundColor: "transparent",
  },
  menuNavCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "rgba(255,248,237,0.70)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    borderRadius: 22,
    paddingVertical: 15,
    paddingHorizontal: 15,
    ...softCardShadow,
  },
  menuNavIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.07)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
  },
  menuNavCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  menuNavTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  menuNavSubtext: {
    color: "rgba(31,41,51,0.54)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    marginTop: 2,
  },
  diaryTitle: {
    color: "#1B2A22",
    fontSize: 42,
    lineHeight: 48,
    fontWeight: "400",
    letterSpacing: -0.7,
    fontFamily: serifFont,
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
  diaryEmptySubtext: {
    color: "rgba(31,41,51,0.52)",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
    marginTop: 6,
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
    fontWeight: "700",
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
  diaryEntryCover: {
    width: 38,
    height: 54,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: colors.sessionBackground,
  },
  diaryEntryCoverImage: {
    width: "100%",
    height: "100%",
  },
  diaryEntryCoverText: {
    width: "100%",
    color: "#F7F3EA",
    fontSize: 7,
    lineHeight: 9,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 4,
  },
  readingMomentCoverMarkSmall: {
    color: "#FFF8ED",
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    textAlign: "center",
    fontFamily: serifFont,
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
  diaryDeleteButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(180,83,58,0.06)",
    marginTop: -4,
  },
  diaryReflection: {
    color: "rgba(31,41,51,0.68)",
    fontSize: 16,
    lineHeight: 25,
    fontStyle: "italic",
    fontWeight: "600",
    marginTop: 15,
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
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "400",
    letterSpacing: -0.3,
    fontFamily: serifFont,
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
    overflow: "hidden",
  },
  finishedBookCoverAlt: {
    backgroundColor: "#1E3A2C",
  },
  finishedBookCoverImage: {
    width: 48,
    height: 67,
    margin: -6,
  },
  finishedBookCoverTitle: {
    color: "#F0EBE0",
    width: "100%",
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
  finishedBookDetailContent: {
    paddingHorizontal: 24,
  },
  finishedBookDetailHero: {
    alignItems: "center",
    backgroundColor: "transparent",
    marginTop: 6,
  },
  finishedBookDetailCover: {
    width: 118,
    height: 166,
    borderRadius: 12,
    backgroundColor: colors.sessionBackground,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  finishedBookDetailCoverImage: {
    width: 118,
    height: 166,
    margin: -12,
  },
  finishedBookDetailCoverTitle: {
    color: "#F0EBE0",
    width: "100%",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "400",
    textAlign: "center",
    fontFamily: serifFont,
  },
  finishedBookDetailLabel: {
    color: "#C4945A",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginTop: 22,
    marginBottom: 8,
  },
  finishedBookDetailTitle: {
    color: "#1A1A14",
    fontSize: 28,
    lineHeight: 35,
    fontWeight: "400",
    letterSpacing: 0,
    textAlign: "center",
    fontFamily: serifFont,
  },
  finishedBookDetailAuthor: {
    color: "#8A8578",
    fontSize: 14,
    lineHeight: 20,
    fontStyle: "italic",
    marginTop: 8,
    textAlign: "center",
  },
  finishedBookDetailMetaCard: {
    backgroundColor: "rgba(255,248,237,0.58)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginTop: 26,
  },
  finishedBookDetailMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    backgroundColor: "transparent",
    paddingVertical: 12,
  },
  finishedBookDetailMetaLabel: {
    color: "#8A8578",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  finishedBookDetailMetaValue: {
    color: "#1A1A14",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "right",
  },
  finishedBookDetailMetaDivider: {
    height: 1,
    backgroundColor: "rgba(47,93,80,0.07)",
  },
  finishedBookDetailReviewCard: {
    backgroundColor: "rgba(196,148,90,0.08)",
    borderWidth: 1,
    borderColor: "rgba(196,148,90,0.14)",
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
  },
  finishedBookDetailReviewLabel: {
    color: "#C4945A",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  finishedBookDetailReview: {
    color: "#5A5448",
    fontSize: 15,
    lineHeight: 23,
    fontStyle: "italic",
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
    fontFamily: serifFont,
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
    fontFamily: serifFont,
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
    fontFamily: serifFont,
    fontSize: 36,
    lineHeight: 43,
    fontWeight: "400",
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
  manualLogContent: {
    justifyContent: "flex-start",
    paddingTop: 20,
    paddingBottom: 20,
  },
  manualLogBackButton: {
    marginBottom: 18,
  },
  closeEyebrow: {
    color: "rgba(255,248,237,0.62)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  closeTitle: {
    color: "#FFF8ED",
    fontSize: 32,
    lineHeight: 39,
    fontWeight: "400",
    letterSpacing: 0,
    maxWidth: 330,
    fontFamily: serifFont,
  },
  closeMinutes: {
    color: "rgba(255,248,237,0.62)",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500",
    marginTop: 10,
    marginBottom: 18,
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
  manualBookInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  manualBookTitleInput: {
    flex: 1,
    minWidth: 0,
    color: "#FFF8ED",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    padding: 0,
  },
  manualBookClearButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,248,237,0.08)",
  },
  manualBookMetadataHint: {
    color: "rgba(255,248,237,0.58)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    marginTop: 8,
  },
  manualBookLookupPanel: {
    marginTop: 12,
    backgroundColor: "rgba(255,248,237,0.10)",
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.14)",
  },
  manualBookLookupTitle: {
    color: "rgba(255,248,237,0.78)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  manualBookLookupLoading: {
    color: "rgba(255,248,237,0.50)",
    fontSize: 12,
    lineHeight: 17,
    fontStyle: "italic",
  },
  manualBookLookupHelperText: {
    color: "rgba(255,248,237,0.58)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
    marginTop: 4,
  },
  manualBookLookupChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "transparent",
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 8,
  },
  manualBookLookupChoiceSelected: {
    backgroundColor: "rgba(255,248,237,0.10)",
  },
  manualBookLookupCover: {
    width: 34,
    height: 46,
    borderRadius: 6,
    backgroundColor: "rgba(255,248,237,0.12)",
  },
  manualBookLookupCoverPlaceholder: {
    width: 34,
    height: 46,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,248,237,0.12)",
  },
  manualBookLookupCoverText: {
    color: "rgba(255,248,237,0.72)",
    fontSize: 14,
    lineHeight: 19,
    fontFamily: serifFont,
  },
  manualBookLookupBookTitle: {
    color: "#FFF8ED",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
  },
  manualBookLookupSelectedLabel: {
    color: "rgba(255,248,237,0.68)",
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  manualBookLookupBookAuthor: {
    color: "rgba(255,248,237,0.52)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
    marginTop: 2,
  },
  manualBookLookupEmptyText: {
    color: "rgba(255,248,237,0.58)",
    fontSize: 13,
    lineHeight: 18,
    fontStyle: "italic",
    paddingVertical: 8,
  },
  manualNoteInput: {
    minHeight: 82,
    fontSize: 16,
    lineHeight: 23,
  },
  manualPresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    backgroundColor: "transparent",
    marginTop: 20,
    marginBottom: 14,
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
    fontWeight: "500",
    marginTop: 14,
    marginBottom: 24,
  },
  closeButtonRow: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "transparent",
  },
  manualLogFooter: {
    backgroundColor: "rgba(27,66,52,0.96)",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,248,237,0.10)",
  },
  manualLogInlineActions: {
    backgroundColor: "transparent",
    marginTop: 18,
    marginBottom: 8,
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
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
    letterSpacing: 0,
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
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
    letterSpacing: 0,
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
    borderRadius: 26,
    padding: 16,
    marginBottom: 22,
  },
  revealCopyCardCompact: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  revealStageLabel: {
    color: colors.accentDark,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  revealMainCopy: {
    color: colors.text,
    fontSize: 25,
    lineHeight: 32,
    fontWeight: "400",
    letterSpacing: 0,
    marginBottom: 6,
    fontFamily: serifFont,
  },
  revealSubCopy: {
    color: colors.mutedText,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
  },
  sessionReflectionWrap: {
    backgroundColor: "transparent",
    marginBottom: 12,
  },
  sessionReflectionWrapCompact: {
    marginBottom: 6,
  },
  sessionReflectionLabel: {
    color: "rgba(47,93,80,0.58)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  sessionReflectionInput: {
    height: 76,
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
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: "rgba(255,248,237,0.82)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.09)",
    paddingTop: 14,
    paddingHorizontal: 18,
    paddingBottom: 18,
    zIndex: 2,
    ...softCardShadow,
  },
  bookShrineWarmGlow: {
    position: "absolute",
    top: 42,
    left: -56,
    right: -38,
    height: 196,
    borderRadius: 116,
    backgroundColor: "rgba(255,248,237,0.22)",
  },
  bookShrineTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "transparent",
    marginBottom: 10,
  },
  bookShrineIconPill: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.08)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
  },
  bookShrineStage: {
    color: "rgba(47,93,80,0.58)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    letterSpacing: 0,
  },
  bookShrineSubcopy: {
    color: "rgba(31,41,51,0.62)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
    marginTop: 8,
    textAlign: "center",
  },
  bookShrinePanel: {
    minHeight: 252,
    flexDirection: "column",
    alignItems: "center",
    gap: 13,
    backgroundColor: "transparent",
  },
  bookShrineCoverWrap: {
    width: 138,
    height: 187,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    shadowColor: "#C98568",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 26,
    elevation: 5,
  },
  bookShrineCoverGlow: {
    position: "absolute",
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
    borderRadius: 22,
    backgroundColor: "rgba(247,195,107,0.16)",
  },
  bookShrineCover: {
    width: 138,
    height: 187,
    borderRadius: 16,
    backgroundColor: "#1E3E32",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.36)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 9,
    paddingVertical: 12,
    overflow: "hidden",
  },
  bookShrineCoverImage: {
    width: 138,
    height: 187,
    marginHorizontal: -9,
    marginVertical: -12,
  },
  bookShrineCoverTitle: {
    color: "#F7F3EA",
    width: "100%",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "400",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    textAlign: "center",
    fontFamily: serifFont,
  },
  readingMomentCoverMarkHero: {
    color: "#FFF8ED",
    fontSize: 44,
    lineHeight: 53,
    fontWeight: "900",
    textAlign: "center",
    fontFamily: serifFont,
  },
  bookShrineCopy: {
    width: "100%",
    minWidth: 0,
    paddingRight: 0,
    backgroundColor: "transparent",
    alignItems: "center",
  },
  bookShrineBookTitle: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "400",
    letterSpacing: 0,
    fontFamily: serifFont,
    textAlign: "center",
  },
  bookShrineBookMeta: {
    color: "rgba(31,41,51,0.55)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    marginTop: 10,
    textAlign: "center",
  },
  beaconMark: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    marginBottom: 22,
  },
  beaconBeam: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(247,195,107,0.13)",
  },
  activeBeaconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(247,195,107,0.10)",
    shadowColor: "#F7C36B",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
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
  bookReturnContentTall: {
    justifyContent: "flex-start",
    paddingVertical: 22,
  },
  bookReturnTopSkipButton: {
    marginBottom: 18,
  },
  bookAttributionTopNav: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "transparent",
    marginBottom: 2,
  },
  bookAttributionBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.48)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
  },
  bookReturnEyebrow: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
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
    fontFamily: serifFont,
  },
  bookReturnTitleCompact: {
    fontSize: 28,
    lineHeight: 34,
  },
  bookReturnHelperLine: {
    color: "rgba(31,41,51,0.62)",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
  },
  bookReturnHelperLineCompact: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
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
  bookReturnMinutesCompact: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
    marginBottom: 14,
  },
  bookAttributionCard: {
    backgroundColor: "rgba(255,255,255,0.78)",
    borderRadius: 26,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "rgba(47,93,80,0.14)",
    ...softCardShadow,
  },
  bookAttributionStepHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: "transparent",
    marginBottom: 14,
  },
  bookAttributionStepCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  bookAttributionStepTitle: {
    color: "#1B2A22",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
  },
  bookAttributionStepSubtext: {
    color: "rgba(31,41,51,0.56)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    marginTop: 3,
  },
  bookAttributionCover: {
    width: 48,
    height: 66,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E3E32",
    overflow: "hidden",
  },
  bookAttributionCoverImage: {
    width: "100%",
    height: "100%",
  },
  bookAttributionCoverText: {
    color: "#F7F3EA",
    width: "100%",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400",
    textAlign: "center",
    paddingHorizontal: 6,
    fontFamily: serifFont,
  },
  bookAttributionCopy: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bookAttributionInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFDF8",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.16)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  bookAttributionInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "800",
    padding: 0,
  },
  bookAttributionClearButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.06)",
  },
  bookAttributionSelectedText: {
    color: "rgba(47,93,80,0.54)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    marginTop: 8,
  },
  bookAttributionReviewCard: {
    backgroundColor: "rgba(255,255,255,0.74)",
    borderRadius: 24,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.09)",
    ...softCardShadow,
  },
  bookAttributionReviewTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "transparent",
  },
  bookAttributionReviewCover: {
    width: 54,
    height: 74,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E3E32",
    overflow: "hidden",
  },
  bookAttributionReviewCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  bookAttributionReviewTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    fontFamily: serifFont,
  },
  bookAttributionReviewAuthor: {
    color: "rgba(31,41,51,0.56)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    marginTop: 3,
  },
  bookEditButton: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(47,93,80,0.07)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  bookEditButtonHeader: {
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.42)",
  },
  bookEditButtonText: {
    color: "rgba(47,93,80,0.72)",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },
  bookReflectionCard: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.58)",
    borderRadius: 22,
    padding: 13,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
  },
  bookReflectionLabel: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    marginBottom: 8,
  },
  bookReflectionInput: {
    minHeight: 82,
    backgroundColor: "#FFFDF8",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.12)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
  bookLookupPanel: {
    marginTop: 14,
    backgroundColor: "rgba(255,255,255,0.48)",
    borderRadius: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.06)",
  },
  bookLookupHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: "transparent",
    marginBottom: 6,
  },
  bookLookupTitle: {
    color: "rgba(31,41,51,0.58)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  bookLookupLoading: {
    color: "rgba(31,41,51,0.42)",
    fontSize: 12,
    lineHeight: 17,
    fontStyle: "italic",
  },
  bookLookupHelperText: {
    color: "rgba(31,41,51,0.46)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
    marginBottom: 4,
  },
  bookLookupChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "transparent",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.05)",
  },
  bookLookupChoiceSelected: {
    backgroundColor: "rgba(47,93,80,0.06)",
    borderBottomColor: "rgba(47,93,80,0.10)",
    borderRadius: 12,
    paddingHorizontal: 8,
  },
  bookLookupCover: {
    width: 34,
    height: 48,
    borderRadius: 5,
    backgroundColor: "rgba(47,93,80,0.12)",
  },
  bookLookupCoverPlaceholder: {
    width: 34,
    height: 48,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.12)",
  },
  bookLookupCoverText: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: serifFont,
  },
  bookLookupCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  bookLookupTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "transparent",
  },
  bookLookupBookTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
  },
  bookLookupSelectedLabel: {
    color: "rgba(47,93,80,0.66)",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  bookLookupBookAuthor: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
    marginTop: 2,
  },
  bookLookupEmptyText: {
    color: "rgba(31,41,51,0.48)",
    fontSize: 13,
    lineHeight: 18,
    fontStyle: "italic",
    paddingVertical: 8,
  },
  bookLookupAttribution: {
    color: "rgba(31,41,51,0.38)",
    fontSize: 10,
    lineHeight: 14,
    marginTop: 8,
    textAlign: "right",
  },
  recentBookPicker: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.46)",
    borderRadius: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.055)",
  },
  recentBookPickerTitle: {
    color: "rgba(31,41,51,0.58)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    marginBottom: 8,
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
    overflow: "hidden",
    backgroundColor: "rgba(47,93,80,0.12)",
  },
  recentBookMiniCoverImage: {
    width: "100%",
    height: "100%",
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
  bookManualEntryHint: {
    marginTop: 12,
    backgroundColor: "rgba(47,93,80,0.055)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.06)",
  },
  bookManualEntryHintTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    marginBottom: 2,
  },
  bookManualEntryHintText: {
    color: "rgba(31,41,51,0.58)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  bookCompletedCard: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.42)",
    borderRadius: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.055)",
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
  bookReturnSecondaryButtonFinal: {
    flex: 0,
    width: "100%",
    backgroundColor: "transparent",
    borderColor: "rgba(47,93,80,0.10)",
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
  bookReturnSaveButtonFinal: {
    flex: 0,
    width: "100%",
  },
  bookReturnSaveButtonDisabled: {
    backgroundColor: "rgba(47,93,80,0.12)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
  },
  bookReturnSaveButtonText: {
    color: "#FFF8ED",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "900",
  },
  bookReturnSaveButtonTextDisabled: {
    color: "rgba(47,93,80,0.42)",
  },
  bookAttributionBottomActions: {
    marginTop: 18,
  },
  bookAttributionBottomActionsFinal: {
    flexDirection: "column-reverse",
    gap: 10,
    marginTop: 20,
  },
  bookRevealScreen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 70,
    paddingBottom: 34,
    overflow: "hidden",
  },
  bookRevealScrollView: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bookRevealContent: {
    flexGrow: 1,
    justifyContent: "center",
    backgroundColor: "transparent",
    paddingVertical: 10,
  },
  bookRevealFooter: {
    backgroundColor: "transparent",
    paddingTop: 6,
    borderTopWidth: 0,
    borderTopColor: "transparent",
  },
  bookRevealInlineActions: {
    width: "100%",
    backgroundColor: "transparent",
    marginTop: 6,
    marginBottom: 12,
  },
  bookRevealEyebrow: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 9,
  },
  bookRevealEyebrowCompact: {
    marginBottom: 5,
  },
  bookRevealTitle: {
    color: "#1B2A22",
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "400",
    letterSpacing: -0.8,
    textAlign: "center",
    marginBottom: 10,
    fontFamily: serifFont,
  },
  bookRevealTitleCompact: {
    fontSize: 28,
    lineHeight: 34,
    marginBottom: 7,
  },
  bookRevealCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderRadius: 30,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    marginBottom: 12,
    ...cardShadow,
  },
  bookRevealCardCompact: {
    gap: 12,
    padding: 12,
    borderRadius: 24,
    marginBottom: 8,
  },
  bookRevealCover: {
    width: 86,
    height: 118,
    borderRadius: 10,
    backgroundColor: "#1E3E32",
    alignItems: "center",
    justifyContent: "center",
    padding: 9,
    overflow: "hidden",
  },
  bookRevealCoverCompact: {
    width: 68,
    height: 92,
    borderRadius: 9,
    padding: 7,
  },
  bookRevealCoverImage: {
    width: 86,
    height: 118,
    margin: -9,
  },
  bookRevealCoverTitle: {
    color: "#F7F3EA",
    width: "100%",
    fontSize: 13,
    lineHeight: 17,
    textTransform: "uppercase",
    textAlign: "center",
    letterSpacing: 0.7,
    fontWeight: "800",
  },
  readingMomentCoverMarkLarge: {
    color: "#FFF8ED",
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "900",
    textAlign: "center",
    fontFamily: serifFont,
  },
  readingMomentCoverMarkCompact: {
    fontSize: 27,
    lineHeight: 32,
  },
  bookRevealTextBlock: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bookRevealLabel: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  bookRevealBookTitle: {
    color: colors.text,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "400",
    fontFamily: serifFont,
  },
  bookRevealMeta: {
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    marginTop: 10,
  },
  bookRevealMetaCompact: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 5,
  },
  bookRevealNoteSaved: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
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
    fontWeight: "700",
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
    fontWeight: "600",
  },
  sessionReflectionInputCompact: {
    height: 58,
    paddingVertical: 9,
  },
  completedBookScreen: {
    flex: 1,
    backgroundColor: "#F7F2E8",
  },
  completedBookKeyboardView: {
    flex: 1,
  },
  completedBookRevealContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: 24,
  },
  completedBookRevealContentWithKeyboard: {
    justifyContent: "flex-start",
  },
  completedBookEyebrow: {
    color: "#C4945A",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  completedBookCoverStage: {
    width: 108,
    height: 146,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    marginBottom: 10,
  },
  completedBookCoverStageCompact: {
    width: 92,
    height: 118,
    marginBottom: 6,
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
    width: 102,
    height: 144,
    borderRadius: 11,
    backgroundColor: colors.sessionBackground,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  completedBookCoverCompact: {
    width: 84,
    height: 118,
    borderRadius: 10,
    padding: 10,
  },
  completedBookCoverImage: {
    width: 102,
    height: 144,
    margin: -12,
  },
  completedBookCoverImageCompact: {
    width: 84,
    height: 118,
    margin: -10,
  },
  completedBookCoverTitle: {
    color: "#F0EBE0",
    width: "100%",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400",
    textAlign: "center",
    fontFamily: serifFont,
  },
  completedBookTitle: {
    color: "#1A1A14",
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "400",
    letterSpacing: 0,
    textAlign: "center",
    fontFamily: serifFont,
  },
  completedBookAuthor: {
    color: "#8A8578",
    fontSize: 14,
    lineHeight: 20,
    fontStyle: "italic",
    marginTop: 4,
    textAlign: "center",
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
    fontFamily: serifFont,
  },
  completedBookStatLabel: {
    color: "rgba(240,235,224,0.4)",
    fontSize: 8,
    lineHeight: 13,
    fontWeight: "800",
    marginTop: 4,
    textAlign: "center",
  },
  completedBookStatDivider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(240,235,224,0.1)",
  },
  completedBookMetaCard: {
    width: "100%",
    paddingVertical: 2,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  completedBookMetaCardCompact: {
    marginTop: 8,
  },
  completedBookMetaRow: {
    paddingVertical: 8,
  },
  completedBookHeadline: {
    color: "#1A1A14",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "400",
    textAlign: "center",
    marginBottom: 5,
    fontFamily: serifFont,
  },
  completedBookSubline: {
    color: "#8A8578",
    fontSize: 13,
    lineHeight: 18,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 10,
    marginBottom: 10,
  },
  completedBookReflectionWrap: {
    width: "100%",
  },
  completedBookInlineActions: {
    width: "100%",
    backgroundColor: "transparent",
    marginTop: 2,
  },
  completedBookReflectionLabel: {
    color: "#C4945A",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  completedBookReflectionInput: {
    minHeight: 64,
    backgroundColor: "rgba(255,248,237,0.58)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    borderRadius: 18,
    padding: 10,
    color: "#5A5448",
    fontSize: 15,
    lineHeight: 20,
    fontStyle: "italic",
  },
  completedBookReturnButton: {
    width: "100%",
    minHeight: 48,
    backgroundColor: colors.accentDark,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  completedBookReturnButtonText: {
    color: "#FFF8ED",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
  },
  completedBookSkipButton: {
    paddingVertical: 8,
    alignItems: "center",
  },
  completedBookSkipButtonText: {
    color: "rgba(47,93,80,0.62)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
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


