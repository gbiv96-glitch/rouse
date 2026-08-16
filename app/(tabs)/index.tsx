import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { usePostHog } from "posthog-react-native";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  Alert,
  AccessibilityInfo,
  ActionSheetIOS,
  Animated,
  AppState,
  AppStateStatus,
  BackHandler,
  Image,
  findNodeHandle,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  UIManager,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Fonts, RousdPalette, RousdRadii } from "@/constants/theme";
import { typography } from "@/constants/typography";
import {
  getBookMetadataFromSearchGroup,
  searchGoogleBooks,
  type BookSearchGroup,
  type GoogleBookCoverCandidate,
} from "@/services/googleBooks";
import type { BookMetadata, BookMetadataFields } from "@/types/book";
import {
  areBookWorkIdentitiesCompatible,
  areBooksWorkCompatible,
  getBookWorkIdentity,
  getCanonicalBookTitle,
  normalizeBookIdentityText as normalizeWorkIdentityText,
} from "@/utils/bookIdentity";
import { formatDuration } from "@/utils/formatDuration";

const SECONDS_KEY = "todaysReadingSeconds";
const DATE_KEY = "lastReadDate";
const LIFETIME_SECONDS_KEY = "lifetimeReadingSeconds";
const SESSIONS_KEY = "readingSessions";
const TOTAL_COMPLETED_SESSIONS_KEY = "totalCompletedSessions";
const CURRENT_BOOK_KEY = "currentBookTitle";
const COMPLETED_BOOKS_KEY = "completedBooks";
const HAS_SEEN_WELCOME_KEY = "hasSeenRousdWelcome";
const PRIVACY_POLICY_URL = "https://www.rousd.app/privacy";
const ACTIVE_SESSION_START_KEY = "activeReadingSessionStartTime";
const ACTIVE_SESSION_TODAY_START_SECONDS_KEY =
  "activeReadingSessionTodayStartSeconds";
const ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY =
  "activeReadingSessionLifetimeStartSeconds";
const ACTIVE_SESSION_SELECTED_BOOK_KEY = "activeReadingSessionSelectedBook";
const PENDING_POST_SESSION_DRAFT_KEY = "pendingPostSessionDraft";
const READING_DATA_KEYS = [
  SECONDS_KEY,
  DATE_KEY,
  LIFETIME_SECONDS_KEY,
  SESSIONS_KEY,
  TOTAL_COMPLETED_SESSIONS_KEY,
  CURRENT_BOOK_KEY,
  COMPLETED_BOOKS_KEY,
  ACTIVE_SESSION_START_KEY,
  ACTIVE_SESSION_TODAY_START_SECONDS_KEY,
  ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY,
  ACTIVE_SESSION_SELECTED_BOOK_KEY,
  PENDING_POST_SESSION_DRAFT_KEY,
] as const;
const LEGACY_UNATTACHED_SESSION_TITLE = "Unassigned reading";
const UNATTACHED_SESSION_TITLE = "A reading moment";
const UNATTACHED_SESSION_DISPLAY_TITLE = "A reading moment";
const BOOK_LOOKUP_TIMEOUT_MS = 9500;
const MANUAL_LOG_NOTE_ACCESSORY_ID = "manual-log-note-accessory";
const serifFont = Fonts?.serif ?? "serif";
const colors = {
  background: RousdPalette.parchment,
  card: RousdPalette.paper,
  text: RousdPalette.text,
  mutedText: RousdPalette.warmMuted,
  accent: RousdPalette.green,
  accentDark: RousdPalette.greenDark,
  danger: RousdPalette.danger,
  success: RousdPalette.green,
  softAccent: RousdPalette.sage,
  sessionBackground: "#123F34",
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
  | "privacy"
  | "diary"
  | "finishedBooks"
  | "finishedBookDetail";

type LibraryReturnTarget = "home" | "menu";

type BookAttributionStep = "choose" | "reflect";

type PendingPostSessionDraft = {
  version: 1;
  sessionId: string;
  sessionSeconds: number;
  endedAt: string;
  bookTitle?: string;
  bookAttributionStep?: BookAttributionStep;
  startedWithSelectedBook?: boolean;
  completedBookReview?: string;
  showBookCompletedInput?: boolean;
  selectedBookMetadata?: BookMetadata | null;
};

type SavingAction =
  | "bookInput"
  | "bookInputSkip"
  | "manualLog"
  | "completedBookSave"
  | "completedBookSkip"
  | null;

type AnalyticsProperties = Record<string, string | number | boolean>;

type DeletedSessionSnapshot = {
  session: ReadingSession;
  index: number;
};

type SanctuaryReveal = {
  sessionId: string;
  bookTitle: string;
  sessionMinutes: string;
  source: "timed" | "logged";
  noteSaved?: boolean;
} & BookMetadataFields;

type CoverChooserTarget = "preSession" | "postSession" | "manualLog";

type CoverChooserState = {
  target: CoverChooserTarget;
  bookTitle: string;
  selectedCoverUrl: string | null;
  coverCandidates: GoogleBookCoverCandidate[];
};

const readingThresholdTitle = "You may set your phone down now.";
const readingThresholdBody = "Return when you’re ready.";

const completedBookReflectionPrompts = [
  "What did this book give you?",
];


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

function formatDiaryEntryTime(session: ReadingSession) {
  if (!session.createdAt) return "Earlier";

  const timestamp = new Date(session.createdAt).getTime();
  if (!Number.isFinite(timestamp)) return "Earlier";

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getSessionNote(session: ReadingSession): string {
  return (session.reflection ?? session.note ?? "").trim();
}

function getBookReadingStats(
  book: { title: string } & BookMetadataFields,
  sessions: ReadingSession[],
  options: {
    allowTitleOnlyFallback?: boolean;
    alwaysIncludeSessionId?: string;
  } = {},
) {
  const bookSessions = sessions.filter(
    (session) =>
      session.id === options.alwaysIncludeSessionId ||
      doesReadingSessionMatchBook(session, book, {
        allowTitleOnlyFallback: options.allowTitleOnlyFallback,
      }),
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

function getCompletedBookShelfDate(completedAt: string) {
  const timestamp = new Date(completedAt).getTime();

  if (!Number.isFinite(timestamp)) return "recently";

  if (Date.now() - timestamp <= 5 * 60 * 1000) return "just now";

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

function getHomeBookplateDisplayTitle(title?: string | null) {
  const trimmedTitle = title?.trim().replace(/\s+/g, " ") ?? "";
  if (!trimmedTitle) return "A book, if you’d like";
  if (trimmedTitle.length <= 52) return trimmedTitle;

  const appendEllipsis = (value: string) => {
    const cleanedValue = value.trim().replace(/[.…]+$/u, "");
    return cleanedValue ? `${cleanedValue}…` : "A book, if you’d like";
  };

  const [beforeColon] = trimmedTitle.split(":");
  if (beforeColon && beforeColon.length >= 12 && beforeColon.length <= 52) {
    return appendEllipsis(beforeColon);
  }

  const clampLimit = 38;
  const truncatedTitle = trimmedTitle.slice(0, clampLimit).trimEnd();
  const lastSpaceIndex = truncatedTitle.lastIndexOf(" ");
  const readableTitle =
    lastSpaceIndex >= 24 ? truncatedTitle.slice(0, lastSpaceIndex) : truncatedTitle;

  return appendEllipsis(readableTitle);
}

function getReadingDurationBucket(seconds: number) {
  const minutes = seconds / 60;

  if (minutes < 5) return "under_5_minutes";
  if (minutes < 15) return "5_to_14_minutes";
  if (minutes < 30) return "15_to_29_minutes";
  if (minutes < 60) return "30_to_59_minutes";
  if (minutes < 120) return "1_to_2_hours";
  return "over_2_hours";
}

function getSessionCountBucket(sessionCount: number) {
  if (sessionCount <= 1) return "1";
  if (sessionCount <= 3) return "2_to_3";
  if (sessionCount <= 10) return "4_to_10";
  return "over_10";
}

function getReadingTimeDescription(
  sessionMinutesText: string,
  sessionMinutesValue?: number,
) {
  if (
    typeof sessionMinutesValue === "number" &&
    Number.isFinite(sessionMinutesValue)
  ) {
    if (sessionMinutesValue > 0 && sessionMinutesValue < 1) {
      return "Reading time · less than a minute";
    }

    if (sessionMinutesValue <= 0) {
      return "A brief reading moment";
    }

    return `Reading time · ${formatDuration(sessionMinutesValue)}`;
  }

  const numericMinutes = Number(sessionMinutesText);
  if (Number.isFinite(numericMinutes)) {
    return getReadingTimeDescription(sessionMinutesText, numericMinutes);
  }

  const trimmedDuration = sessionMinutesText.trim();
  if (!trimmedDuration || trimmedDuration === "0 min") {
    return "A brief reading moment";
  }

  return `Reading time · ${trimmedDuration}`;
}

function getCompletedBookDetailDate(completedAt: string) {
  const timestamp = new Date(completedAt).getTime();

  if (!Number.isFinite(timestamp)) return "Recently";

  return new Date(timestamp).toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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

function getUniqueUsableCoverCandidates(
  candidates: GoogleBookCoverCandidate[],
) {
  const seenCoverUrls = new Set<string>();

  return candidates.flatMap((candidate) => {
    const normalizedUrl = normalizeStoredCoverUrl(candidate.url)?.trim();

    if (!normalizedUrl || seenCoverUrls.has(normalizedUrl)) {
      return [];
    }

    seenCoverUrls.add(normalizedUrl);
    return [{ ...candidate, url: normalizedUrl }];
  });
}

function selectBookMetadataCover(metadata: BookMetadata, coverUrl: string) {
  return {
    ...metadata,
    coverUrl,
  } satisfies BookMetadata;
}

function getGoogleBookSelection(group: BookSearchGroup) {
  const metadata = getBookMetadataFromSearchGroup(group);

  return {
    metadata: {
      ...metadata,
      coverUrl: normalizeStoredCoverUrl(metadata.coverUrl),
    } satisfies BookMetadata,
    searchGroup: group,
  };
}

function getKnownBookCoverDiscoveryDescriptor(metadata: BookMetadata) {
  const title = getValidBookTitle(metadata.title);
  const author = metadata.author?.trim() ?? "";
  const hasTrustedMetadata = Boolean(
    metadata.source === "googleBooks" ||
      metadata.googleBooksId?.trim() ||
      normalizeBookIdentifier(metadata.isbn10) ||
      normalizeBookIdentifier(metadata.isbn13),
  );
  const workIdentity = getBookWorkIdentity({ title: title ?? "", author });

  if (!title || !author || !hasTrustedMetadata || !workIdentity.key) {
    return null;
  }

  const queryTitle = title.replace(/"/g, " ").replace(/\s+/g, " ").trim();
  const queryAuthor = author.replace(/"/g, " ").replace(/\s+/g, " ").trim();

  return {
    query: `intitle:"${queryTitle}" inauthor:"${queryAuthor}"`,
    selectionKey: [
      workIdentity.key,
      metadata.googleBooksId?.trim() ?? "",
      normalizeBookIdentifier(metadata.isbn10),
      normalizeBookIdentifier(metadata.isbn13),
    ].join("|"),
    workIdentity,
  };
}

function findKnownBookCoverSearchGroup(
  metadata: BookMetadata,
  groups: BookSearchGroup[],
) {
  const descriptor = getKnownBookCoverDiscoveryDescriptor(metadata);

  if (!descriptor) return null;

  const compatibleGroups = groups.filter((group) =>
    areBookWorkIdentitiesCompatible(
      descriptor.workIdentity,
      group.representative.workIdentity,
    ),
  );

  if (compatibleGroups.length === 0) return null;

  const googleBooksId = metadata.googleBooksId?.trim() ?? "";
  const knownIsbns = getComparableBookIsbns(metadata);
  const identifierMatches = compatibleGroups.filter((group) =>
    group.candidates.some((candidate) => {
      if (googleBooksId && candidate.volumeId === googleBooksId) {
        return true;
      }

      const candidateIsbns = getComparableBookIsbns(candidate);
      return [...knownIsbns].some((isbn) => candidateIsbns.has(isbn));
    }),
  );
  const unambiguousGroup =
    identifierMatches.length === 1
      ? identifierMatches[0]
      : identifierMatches.length > 1 || compatibleGroups.length !== 1
        ? null
        : compatibleGroups[0];

  if (
    !unambiguousGroup ||
    getUniqueUsableCoverCandidates(unambiguousGroup.coverCandidates).length <= 1
  ) {
    return null;
  }

  return unambiguousGroup;
}

function isKnownBookCoverDiscoveryCurrent(
  currentRequestId: number,
  currentSelectionKey: string | null,
  requestId: number,
  selectionKey: string,
) {
  return (
    currentRequestId === requestId && currentSelectionKey === selectionKey
  );
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

function sanitizeStoredBookMetadata(
  value: unknown,
  fallbackSource: BookMetadata["source"] = "manual",
): BookMetadata | null {
  if (!isRecord(value)) return null;

  const title = coerceString(value.title).trim();
  if (!title) return null;

  return {
    title,
    author: coerceAuthor(value.author),
    coverUrl: normalizeStoredCoverUrl(coerceNullableString(value.coverUrl)),
    googleBooksId: coerceNullableString(value.googleBooksId),
    isbn10: coerceNullableString(value.isbn10),
    isbn13: coerceNullableString(value.isbn13),
    source: coerceBookSource(value.source ?? value.bookSource) ?? fallbackSource,
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

function sanitizePendingPostSessionDraft(
  value: unknown,
): PendingPostSessionDraft | null {
  if (!isRecord(value)) return null;

  const sessionSeconds =
    typeof value.sessionSeconds === "number"
      ? value.sessionSeconds
      : Number(value.sessionSeconds);
  const sessionId = coerceString(value.sessionId).trim();
  const endedAt = coerceIsoDate(value.endedAt, "");

  if (
    !sessionId ||
    !Number.isFinite(sessionSeconds) ||
    sessionSeconds <= 0 ||
    !endedAt
  ) {
    return null;
  }

  const rawAttributionStep = coerceString(value.bookAttributionStep);
  const bookAttributionStep: BookAttributionStep =
    rawAttributionStep === "reflect" ? "reflect" : "choose";
  const selectedBookMetadata = sanitizeStoredBookMetadata(
    value.selectedBookMetadata,
    "googleBooks",
  );

  return {
    version: 1,
    sessionId,
    sessionSeconds,
    endedAt,
    bookTitle: coerceString(value.bookTitle),
    bookAttributionStep,
    startedWithSelectedBook: value.startedWithSelectedBook === true,
    completedBookReview: coerceString(value.completedBookReview),
    showBookCompletedInput: value.showBookCompletedInput === true,
    selectedBookMetadata,
  };
}

function parsePendingPostSessionDraft(rawValue: string) {
  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    return sanitizePendingPostSessionDraft(parsedValue);
  } catch (error) {
    warnInDev("Rousd ignored malformed pending post-session draft.", error);
    return null;
  }
}

async function persistPendingPostSessionDraft(
  draft: PendingPostSessionDraft,
) {
  await AsyncStorage.setItem(
    PENDING_POST_SESSION_DRAFT_KEY,
    JSON.stringify(draft),
  );
}

async function clearPendingPostSessionDraft() {
  await AsyncStorage.removeItem(PENDING_POST_SESSION_DRAFT_KEY);
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

function normalizeBookIdentityText(value?: unknown) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
}

function getDisplayableAuthor(value?: string | null) {
  const author = value?.trim();
  const normalizedAuthor = author?.toLowerCase();
  if (
    !author ||
    normalizedAuthor === "unknown author" ||
    normalizedAuthor === "unknown"
  ) {
    return "";
  }
  return author;
}

function normalizeBookIdentifier(value?: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[^0-9X]/g, "")
    : "";
}

function isValidIsbn10(value: string) {
  if (!/^\d{9}[\dX]$/.test(value)) return false;

  const checksum = value.split("").reduce((sum, character, index) => {
    const digit = character === "X" ? 10 : Number(character);
    return sum + digit * (10 - index);
  }, 0);

  return checksum % 11 === 0;
}

function isValidIsbn13(value: string) {
  if (!/^\d{13}$/.test(value)) return false;

  const checksum = value
    .slice(0, 12)
    .split("")
    .reduce(
      (sum, character, index) =>
        sum + Number(character) * (index % 2 === 0 ? 1 : 3),
      0,
    );
  const expectedCheckDigit = (10 - (checksum % 10)) % 10;

  return Number(value[12]) === expectedCheckDigit;
}

function convertIsbn10ToIsbn13(value: string) {
  if (!isValidIsbn10(value)) return "";

  const isbn13Body = `978${value.slice(0, 9)}`;
  const checksum = isbn13Body.split("").reduce(
    (sum, character, index) =>
      sum + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );

  return `${isbn13Body}${(10 - (checksum % 10)) % 10}`;
}

function getComparableBookIsbns(book: BookMetadataFields) {
  const isbn10 = normalizeBookIdentifier(book.isbn10);
  const isbn13 = normalizeBookIdentifier(book.isbn13);
  const identifiers = new Set<string>();

  if (isValidIsbn10(isbn10)) {
    identifiers.add(isbn10);
    identifiers.add(convertIsbn10ToIsbn13(isbn10));
  }

  if (isValidIsbn13(isbn13)) {
    identifiers.add(isbn13);
  }

  return identifiers;
}

function doesReadingSessionMatchBook(
  session: ReadingSession,
  book: { title: string } & BookMetadataFields,
  options: { allowTitleOnlyFallback?: boolean } = {},
) {
  const sessionGoogleBooksId = session.googleBooksId?.trim();
  const bookGoogleBooksId = book.googleBooksId?.trim();

  if (
    sessionGoogleBooksId &&
    bookGoogleBooksId &&
    sessionGoogleBooksId === bookGoogleBooksId
  ) {
    return true;
  }

  const sessionIsbns = getComparableBookIsbns(session);
  const bookIsbns = getComparableBookIsbns(book);

  if ([...sessionIsbns].some((isbn) => bookIsbns.has(isbn))) {
    return true;
  }

  if (areBooksWorkCompatible(session, book)) {
    return true;
  }

  if (sessionGoogleBooksId && bookGoogleBooksId) {
    return false;
  }

  if (sessionIsbns.size > 0 && bookIsbns.size > 0) {
    return false;
  }

  const sessionTitle = normalizeBookIdentityText(session.title);
  const bookTitle = normalizeBookIdentityText(book.title);

  if (!sessionTitle || sessionTitle !== bookTitle) return false;

  const sessionAuthor = normalizeBookIdentityText(session.author);
  const bookAuthor = normalizeBookIdentityText(book.author);

  if (sessionAuthor && bookAuthor) {
    return sessionAuthor === bookAuthor;
  }

  return options.allowTitleOnlyFallback !== false;
}

function getBookDeduplicationKey(book: {
  id?: unknown;
  title?: unknown;
  author?: unknown;
  authors?: unknown;
  googleBooksId?: unknown;
}) {
  const title = typeof book.title === "string" ? book.title : "";
  const author = typeof book.author === "string" ? book.author : "";
  const authors = Array.isArray(book.authors)
    ? book.authors.filter((value): value is string => typeof value === "string")
    : undefined;
  const workIdentity = getBookWorkIdentity({ title, author, authors });

  if (workIdentity.key) return `work:${workIdentity.key}`;

  const googleBooksId =
    typeof book.googleBooksId === "string" ? book.googleBooksId.trim() : "";
  if (googleBooksId) return `google:${googleBooksId}`;

  const normalizedTitle = normalizeBookIdentityText(book.title);
  const normalizedAuthor =
    normalizeBookIdentityText(book.author) ||
    (Array.isArray(book.authors)
      ? normalizeBookIdentityText(
          book.authors
            .filter((author) => typeof author === "string")
            .join(", "),
        )
      : "");

  if (normalizedTitle && normalizedAuthor) {
    return `title-author:${normalizedTitle}:${normalizedAuthor}`;
  }
  if (normalizedTitle) return `title:${normalizedTitle}`;
  const id = typeof book.id === "string" ? book.id.trim() : "";
  if (id) return `id:${id}`;
  return "";
}

function dedupeBooksByIdentity<T extends {
  id?: unknown;
  title?: unknown;
  author?: unknown;
  authors?: unknown;
  googleBooksId?: unknown;
}>(books: T[]) {
  const seenKeys = new Set<string>();

  return books.filter((book) => {
    const key = getBookDeduplicationKey(book);
    if (!key) return false;
    if (seenKeys.has(key)) return false;

    seenKeys.add(key);
    return true;
  });
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
      getValidBookTitle(value.bookTitle) &&
      coerceString(value.sessionMinutes).trim() &&
      (value.source === "timed" || value.source === "logged"),
  );
}

function performHaptic(action: () => Promise<void>) {
  try {
    void action().catch((error) => {
      warnInDev("Rousd haptic feedback was unavailable.", error);
    });
  } catch (error) {
    warnInDev("Rousd haptic feedback was unavailable.", error);
  }
}

function isSameFinishedBook(
  first: { title: string } & BookMetadataFields,
  second: { title: string } & BookMetadataFields,
) {
  const firstGoogleBooksId = first.googleBooksId?.trim();
  const secondGoogleBooksId = second.googleBooksId?.trim();

  if (
    firstGoogleBooksId &&
    secondGoogleBooksId &&
    firstGoogleBooksId === secondGoogleBooksId
  ) {
    return true;
  }

  const firstIsbns = getComparableBookIsbns(first);
  const secondIsbns = getComparableBookIsbns(second);

  if ([...firstIsbns].some((isbn) => secondIsbns.has(isbn))) {
    return true;
  }

  if (areBooksWorkCompatible(first, second)) {
    return true;
  }

  return false;
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
  const posthog = usePostHog();
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
  const [pendingPostSessionId, setPendingPostSessionId] = useState<string | null>(
    null,
  );
  const [pendingSessionSeconds, setPendingSessionSeconds] = useState(0);
  const [
    pendingSessionStartedWithSelectedBook,
    setPendingSessionStartedWithSelectedBook,
  ] = useState(false);
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
  const [isEditingFinishedBookNote, setIsEditingFinishedBookNote] =
    useState(false);
  const [finishedBookNoteDraft, setFinishedBookNoteDraft] = useState("");
  const [lastDeletedSession, setLastDeletedSession] =
    useState<DeletedSessionSnapshot | null>(null);
  const [manualLogMinutes, setManualLogMinutes] = useState("");
  const [manualLogBookTitle, setManualLogBookTitle] = useState("");
  const [manualLogError, setManualLogError] = useState<string | null>(null);
  const [activeSessionError, setActiveSessionError] = useState<string | null>(
    null,
  );
  const [bookInputError, setBookInputError] = useState<string | null>(null);
  const [completedBookReviewError, setCompletedBookReviewError] = useState<
    string | null
  >(null);
  const [savingAction, setSavingAction] = useState<SavingAction>(null);
  const [selectedManualBookMetadata, setSelectedManualBookMetadata] =
    useState<BookMetadata | null>(null);
  const [manualBookSearchGroup, setManualBookSearchGroup] =
    useState<BookSearchGroup | null>(null);
  const manualBookCoverCandidates = getUniqueUsableCoverCandidates(
    manualBookSearchGroup?.coverCandidates ?? [],
  );
  const [isManualBookLookupRequested, setIsManualBookLookupRequested] =
    useState(false);
  const [manualBookLookupResults, setManualBookLookupResults] = useState<
    BookSearchGroup[]
  >([]);
  const [isManualBookLookupLoading, setIsManualBookLookupLoading] =
    useState(false);
  const [hasManualBookLookupSearched, setHasManualBookLookupSearched] =
    useState(false);
  const [manualBookLookupError, setManualBookLookupError] = useState(false);
  const [recentSessions, setRecentSessions] = useState<ReadingSession[]>([]);
  const [totalCompletedSessions, setTotalCompletedSessions] = useState(0);
  const [preSessionBook, setPreSessionBook] = useState<BookMetadata | null>(
    null,
  );
  const [preSessionBookSearchGroup, setPreSessionBookSearchGroup] =
    useState<BookSearchGroup | null>(null);
  const preSessionBookCoverCandidates = getUniqueUsableCoverCandidates(
    preSessionBookSearchGroup?.coverCandidates ?? [],
  );
  const [activeSessionSelectedBook, setActiveSessionSelectedBook] =
    useState<BookMetadata | null>(null);
  const [isPreSessionBookChooserVisible, setIsPreSessionBookChooserVisible] =
    useState(false);
  const [preSessionBookQuery, setPreSessionBookQuery] = useState("");
  const [preSessionBookSearchResults, setPreSessionBookSearchResults] =
    useState<BookSearchGroup[]>([]);
  const [isPreSessionBookSearchLoading, setIsPreSessionBookSearchLoading] =
    useState(false);
  const [hasPreSessionBookSearchSearched, setHasPreSessionBookSearchSearched] =
    useState(false);
  const [preSessionBookSearchError, setPreSessionBookSearchError] =
    useState(false);
  const [bookLookupResults, setBookLookupResults] = useState<BookSearchGroup[]>(
    [],
  );
  const [selectedBookMetadata, setSelectedBookMetadata] =
    useState<BookMetadata | null>(null);
  const [postSessionBookSearchGroup, setPostSessionBookSearchGroup] =
    useState<BookSearchGroup | null>(null);
  const postSessionBookCoverCandidates = getUniqueUsableCoverCandidates(
    postSessionBookSearchGroup?.coverCandidates ?? [],
  );
  const [coverChooser, setCoverChooser] = useState<CoverChooserState | null>(
    null,
  );
  const [failedCoverUrls, setFailedCoverUrls] = useState<string[]>([]);
  const [isBookLookupLoading, setIsBookLookupLoading] = useState(false);
  const [isBookLookupRequested, setIsBookLookupRequested] = useState(false);
  const [hasBookLookupSearched, setHasBookLookupSearched] = useState(false);
  const [bookLookupError, setBookLookupError] = useState(false);
  const [sanctuaryReveal, setSanctuaryReveal] =
    useState<SanctuaryReveal | null>(null);
  const [manualLogNote, setManualLogNote] = useState("");
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [bookTitleFocused, setBookTitleFocused] = useState(false);
  const [manualBookTitleFocused, setManualBookTitleFocused] = useState(false);
  const [manualLogNoteFocused, setManualLogNoteFocused] = useState(false);
  const [manualLogNoteSpacerHeight, setManualLogNoteSpacerHeight] = useState(0);
  const [hasUserEditedBookQuery, setHasUserEditedBookQuery] = useState(false);
  const [completedBookReviewFocused, setCompletedBookReviewFocused] =
    useState(false);
  const [isEnteringReading, setIsEnteringReading] = useState(false);
  const [isExitingReading, setIsExitingReading] = useState(false);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const knownBookCoverDiscoveryRequestIds = useRef<
    Record<CoverChooserTarget, number>
  >({ preSession: 0, postSession: 0, manualLog: 0 });
  const knownBookCoverDiscoverySelectionKeys = useRef<
    Record<CoverChooserTarget, string | null>
  >({ preSession: null, postSession: null, manualLog: null });
  const isStartingSessionRef = useRef(false);
  const isEndingSessionRef = useRef(false);
  const homeEntryOpacity = useRef(new Animated.Value(1)).current;
  const ritualOpacity = useRef(new Animated.Value(0)).current;
  const ritualScale = useRef(new Animated.Value(0.98)).current;
  const ritualLineOpacity = useRef(new Animated.Value(0)).current;
  const ritualLineTranslateY = useRef(new Animated.Value(8)).current;
  const activeSessionOpacity = useRef(new Animated.Value(0)).current;
  const activeSessionTranslateY = useRef(new Animated.Value(8)).current;
  const closeTransitionOpacity = useRef(new Animated.Value(0)).current;
  const closeTransitionScale = useRef(new Animated.Value(0.97)).current;
  const closeTransitionTranslateY = useRef(new Animated.Value(12)).current;
  const bookInputOpacity = useRef(new Animated.Value(1)).current;
  const revealOpacity = useRef(new Animated.Value(0)).current;
  const revealScale = useRef(new Animated.Value(0.96)).current;
  const revealTranslateY = useRef(new Animated.Value(18)).current;
  const revealSceneScale = useRef(new Animated.Value(0.98)).current;
  const bookTitleInputRef = useRef<TextInput | null>(null);
  const bookInputScrollRef = useRef<ScrollView | null>(null);
  const bookInputScrollYRef = useRef(0);
  const bookReflectionInputHeightRef = useRef(0);
  const manualLogScrollRef = useRef<ScrollView | null>(null);
  const manualBookLookupPanelLayoutRef = useRef({ y: 0, height: 0 });
  const hasAutoScrolledManualBookResultsRef = useRef(false);
  const manualLogNoteInputHeightRef = useRef(0);
  const manualLogNoteLayoutRef = useRef({ y: 0, height: 0 });
  const manualLogScrollOffsetRef = useRef(0);
  const manualLogViewportHeightRef = useRef(0);
  const manualLogNaturalContentHeightRef = useRef(0);
  const manualLogNoteSpacerHeightRef = useRef(0);
  const manualLogNoteFocusedRef = useRef(false);
  const shouldRecoverManualLogAfterKeyboardRef = useRef(false);
  const keyboardFrameRef = useRef({ height: 0, screenY: 0 });
  const completedBookScrollRef = useRef<ScrollView | null>(null);
  const completedBookScrollYRef = useRef(0);
  const completedBookReviewInputHeightRef = useRef(0);
  const manualBookTitleInputRef = useRef<TextInput | null>(null);
  const manualLogNoteInputRef = useRef<TextInput | null>(null);
  const bookLookupRequestId = useRef(0);
  const preSessionBookLookupRequestId = useRef(0);
  const lastAutoScrolledBookLookupQuery = useRef<string | null>(null);
  const manualBookLookupRequestId = useRef(0);
  const manualBookLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const savingActionRef = useRef<SavingAction>(null);
  const completedBookPromptIndex = useRef(
    Math.floor(Math.random() * completedBookReflectionPrompts.length),
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

  const captureAnalyticsEvent = (
    eventName: string,
    properties?: AnalyticsProperties,
  ) => {
    try {
      posthog.capture(eventName, properties);
    } catch (error) {
      warnInDev("Rousd analytics capture failed.", error);
    }
  };

  useEffect(() => {
    let isMounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((isEnabled) => {
        if (isMounted) setReduceMotionEnabled(isEnabled);
      })
      .catch((error) => {
        warnInDev("Rousd could not read the reduced-motion preference.", error);
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotionEnabled,
    );

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const keyboardShowSubscription = Keyboard.addListener("keyboardDidShow", (event) => {
      keyboardFrameRef.current = {
        height: event.endCoordinates.height,
        screenY: event.endCoordinates.screenY,
      };
      setIsKeyboardVisible(true);
    });
    const keyboardHideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      shouldRecoverManualLogAfterKeyboardRef.current =
        shouldRecoverManualLogAfterKeyboardRef.current ||
        manualLogNoteFocusedRef.current;
      keyboardFrameRef.current = { height: 0, screenY: 0 };
      manualLogNoteFocusedRef.current = false;
      manualLogNoteSpacerHeightRef.current = 0;
      setIsKeyboardVisible(false);
      setManualLogNoteFocused(false);
      setManualLogNoteSpacerHeight(0);
      setCompletedBookReviewFocused(false);
    });

    return () => {
      keyboardShowSubscription.remove();
      keyboardHideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (isPreSessionBookChooserVisible) {
          Keyboard.dismiss();
          setIsPreSessionBookChooserVisible(false);
          setPreSessionBookQuery("");
          setPreSessionBookSearchResults([]);
          return true;
        }

        if (screen === "finishedBookDetail") {
          setIsEditingFinishedBookNote(false);
          setScreen("finishedBooks");
          return true;
        }

        if (screen === "privacy") {
          setScreen("menu");
          return true;
        }

        if (screen === "menu") {
          setScreen("home");
          return true;
        }

        if (
          screen === "diary" ||
          screen === "finishedBooks" ||
          screen === "manualLog"
        ) {
          if (screen === "manualLog") {
            knownBookCoverDiscoveryRequestIds.current.manualLog += 1;
            knownBookCoverDiscoverySelectionKeys.current.manualLog = null;
            setManualBookSearchGroup(null);
          }
          setScreen(libraryReturnTarget === "menu" ? "menu" : "home");
          return true;
        }

        if (
          screen === "ritual" ||
          screen === "active" ||
          screen === "closeTransition"
        ) {
          return true;
        }

        if (screen === "bookInput") {
          knownBookCoverDiscoveryRequestIds.current.postSession += 1;
          knownBookCoverDiscoverySelectionKeys.current.postSession = null;
          Keyboard.dismiss();
          void clearPendingPostSessionDraft();
          setPendingPostSessionId(null);
          setPendingSessionSeconds(0);
          setPendingSessionStartedWithSelectedBook(false);
          setBookInputError(null);
          setCompletedBookReview("");
          setShowBookCompletedInput(false);
          setSelectedBookMetadata(null);
          setPostSessionBookSearchGroup(null);
          setCoverChooser(null);
          setScreen("home");
          return true;
        }

        if (screen === "completedBook" || screen === "reveal") {
          Keyboard.dismiss();
          setCompletedBookMoment(null);
          setSanctuaryReveal(null);
          setCompletedBookReview("");
          setScreen("home");
          return true;
        }

        return false;
      },
    );

    return () => subscription.remove();
  }, [isPreSessionBookChooserVisible, libraryReturnTarget, screen]);

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
      setPendingPostSessionId(null);
      setPendingSessionSeconds(0);
      setPendingSessionStartedWithSelectedBook(false);
      setActiveSessionSelectedBook(null);
      setSessionMessage(null);
      void AsyncStorage.multiRemove([
        ACTIVE_SESSION_START_KEY,
        ACTIVE_SESSION_TODAY_START_SECONDS_KEY,
        ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY,
        ACTIVE_SESSION_SELECTED_BOOK_KEY,
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
      setPendingPostSessionId(null);
      setPendingSessionStartedWithSelectedBook(false);
      setShowBookCompletedInput(false);
      setCompletedBookReview("");
      setCompletedBookReviewError(null);
      setBookInputError(null);
      setSelectedBookMetadata(null);
      knownBookCoverDiscoveryRequestIds.current.postSession += 1;
      knownBookCoverDiscoverySelectionKeys.current.postSession = null;
      setPostSessionBookSearchGroup(null);
      setCoverChooser(null);
      setBookLookupResults([]);
      setBookLookupError(false);
      setIsBookLookupRequested(false);
      setHasBookLookupSearched(false);
      setHasUserEditedBookQuery(false);
      void clearPendingPostSessionDraft();
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
    const hasPendingSessionDuration =
      Number.isFinite(pendingSessionSeconds) && pendingSessionSeconds > 0;

    if (
      !isLoaded ||
      !hasPendingSessionDuration ||
      !pendingPostSessionId ||
      (screen !== "closeTransition" && screen !== "bookInput")
    ) {
      return;
    }

    void persistPendingPostSessionDraft({
      version: 1,
      sessionId: pendingPostSessionId,
      sessionSeconds: pendingSessionSeconds,
      endedAt: new Date().toISOString(),
      bookTitle,
      bookAttributionStep,
      startedWithSelectedBook: pendingSessionStartedWithSelectedBook,
      completedBookReview,
      showBookCompletedInput,
      selectedBookMetadata,
    });
  }, [
    bookAttributionStep,
    bookTitle,
    completedBookReview,
    isLoaded,
    pendingPostSessionId,
    pendingSessionSeconds,
    pendingSessionStartedWithSelectedBook,
    screen,
    selectedBookMetadata,
    showBookCompletedInput,
  ]);

  useEffect(() => {
    if (showBookCompletedInput && !getValidBookTitle(bookTitle)) {
      setShowBookCompletedInput(false);
      setCompletedBookReview("");
    }
  }, [bookTitle, showBookCompletedInput]);

  useEffect(() => {
    const trimmedQuery = preSessionBookQuery.trim();

    if (!isPreSessionBookChooserVisible || trimmedQuery.length < 3) {
      preSessionBookLookupRequestId.current += 1;
      setPreSessionBookSearchResults([]);
      setIsPreSessionBookSearchLoading(false);
      setHasPreSessionBookSearchSearched(false);
      setPreSessionBookSearchError(false);
      return;
    }

    const requestId = preSessionBookLookupRequestId.current + 1;
    preSessionBookLookupRequestId.current = requestId;
    setPreSessionBookSearchResults([]);
    setIsPreSessionBookSearchLoading(true);
    setHasPreSessionBookSearchSearched(false);
    setPreSessionBookSearchError(false);

    const lookupTimer = setTimeout(async () => {
      try {
        const results = await Promise.race<BookSearchGroup[]>([
          searchGoogleBooks(trimmedQuery),
          new Promise<BookSearchGroup[]>((_, reject) =>
            setTimeout(
              () => reject(new Error("Book lookup timed out")),
              BOOK_LOOKUP_TIMEOUT_MS,
            ),
          ),
        ]);

        if (preSessionBookLookupRequestId.current !== requestId) {
          return;
        }

        setPreSessionBookSearchResults(results);
        setHasPreSessionBookSearchSearched(true);
        setPreSessionBookSearchError(false);
      } catch (error) {
        if (preSessionBookLookupRequestId.current !== requestId) {
          return;
        }

        warnInDev("Rousd pre-session Google Books lookup could not finish", error);
        setPreSessionBookSearchResults([]);
        setHasPreSessionBookSearchSearched(true);
        setPreSessionBookSearchError(true);
      } finally {
        if (preSessionBookLookupRequestId.current === requestId) {
          setIsPreSessionBookSearchLoading(false);
        }
      }
    }, 450);

    return () => {
      clearTimeout(lookupTimer);
    };
  }, [isPreSessionBookChooserVisible, preSessionBookQuery]);

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
        const results = await Promise.race<BookSearchGroup[]>([
          searchGoogleBooks(trimmedQuery),
          new Promise<BookSearchGroup[]>((_, reject) =>
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

        warnInDev("Rousd Google Books lookup could not finish", error);
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

    if (reduceMotionEnabled) {
      ritualOpacity.setValue(1);
      ritualScale.setValue(1);
      ritualLineOpacity.setValue(1);
      ritualLineTranslateY.setValue(0);

      const transitionTimer = setTimeout(() => {
        setScreen("active");
      }, 3000);

      return () => clearTimeout(transitionTimer);
    }

    ritualOpacity.setValue(0);
    ritualScale.setValue(0.98);
    ritualLineOpacity.setValue(0);
    ritualLineTranslateY.setValue(8);
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
      Animated.delay(3000),
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

    animation.start(({ finished }) => {
      if (finished) {
        setScreen("active");
      }
    });

    return () => {
      animation.stop();
    };
  }, [
    ritualLineOpacity,
    ritualLineTranslateY,
    ritualOpacity,
    ritualScale,
    reduceMotionEnabled,
    screen,
  ]);

  useEffect(() => {
    if (screen !== "home") return;

    isStartingSessionRef.current = false;
    setIsEnteringReading(false);

    if (reduceMotionEnabled) {
      homeEntryOpacity.setValue(1);
      return;
    }

    homeEntryOpacity.setValue(0);
    const animation = Animated.timing(homeEntryOpacity, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    });
    animation.start();

    return () => animation.stop();
  }, [homeEntryOpacity, reduceMotionEnabled, screen]);

  useEffect(() => {
    if (screen !== "active") return;

    if (reduceMotionEnabled) {
      activeSessionOpacity.setValue(1);
      activeSessionTranslateY.setValue(0);
      return;
    }

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
    reduceMotionEnabled,
    screen,
  ]);

  useEffect(() => {
    if (screen !== "closeTransition") return;

    closeTransitionOpacity.setValue(0);
    closeTransitionScale.setValue(0.97);
    closeTransitionTranslateY.setValue(12);

    const finishTransition = () => {
      setBookAttributionStep("choose");
      setScreen("bookInput");
    };

    if (reduceMotionEnabled) {
      closeTransitionOpacity.setValue(1);
      closeTransitionScale.setValue(1);
      closeTransitionTranslateY.setValue(0);
      const transitionTimer = setTimeout(finishTransition, 1550);
      return () => clearTimeout(transitionTimer);
    }

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
        duration: 360,
        useNativeDriver: true,
      }),
    ]);

    animation.start(({ finished }) => {
      if (finished) {
        finishTransition();
      }
    });

    return () => {
      animation.stop();
    };
  }, [
    closeTransitionOpacity,
    closeTransitionScale,
    closeTransitionTranslateY,
    reduceMotionEnabled,
    screen,
  ]);

  useEffect(() => {
    if (screen !== "bookInput") return;

    bookInputOpacity.setValue(reduceMotionEnabled ? 1 : 0);

    if (reduceMotionEnabled) return;

    const animation = Animated.timing(bookInputOpacity, {
      toValue: 1,
      duration: 360,
      useNativeDriver: true,
    });

    animation.start();

    return () => {
      animation.stop();
    };
  }, [bookInputOpacity, reduceMotionEnabled, screen]);

  useEffect(() => {
    if (screen !== "reveal" || !sanctuaryReveal) return;

    performHaptic(() =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );

    if (reduceMotionEnabled) {
      revealOpacity.setValue(1);
      revealScale.setValue(1);
      revealTranslateY.setValue(0);
      revealSceneScale.setValue(1);
      return;
    }

    revealOpacity.setValue(0);
    revealScale.setValue(0.98);
    revealTranslateY.setValue(10);
    revealSceneScale.setValue(0.99);

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
          toValue: 1,
          duration: 620,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [
    revealOpacity,
    reduceMotionEnabled,
    revealScale,
    revealSceneScale,
    revealTranslateY,
    sanctuaryReveal,
    screen,
  ]);

  useEffect(() => {
    const loadSavedData = async () => {
      let nextScreen: Screen = "home";
      let loadedRecentSessions: ReadingSession[] = [];
      let loadedCompletedBooks: CompletedBookReview[] = [];

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
        const savedActiveSessionSelectedBook = await AsyncStorage.getItem(
          ACTIVE_SESSION_SELECTED_BOOK_KEY,
        );
        const savedPendingPostSessionDraft = await AsyncStorage.getItem(
          PENDING_POST_SESSION_DRAFT_KEY,
        );

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
          loadedRecentSessions = migratedSessions;

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
          loadedCompletedBooks = migratedCompletedBooks;

          if (shouldPersistMigratedCompletedBooks) {
            await AsyncStorage.setItem(
              COMPLETED_BOOKS_KEY,
              JSON.stringify(migratedCompletedBooks),
            );
          }
        }

        const hasExistingReadingData =
          loadedRecentSessions.length > 0 ||
          loadedCompletedBooks.length > 0 ||
          savedLifetimeTotalSeconds > 0 ||
          getFiniteStoredNumber(savedTotalCompletedSessions, 0) > 0 ||
          Boolean(
            savedCurrentBook &&
              !isUnattachedSessionTitle(savedCurrentBook) &&
              savedCurrentBook.trim(),
          );

        if (
          savedHasSeenWelcome !== "true" &&
          savedActiveSessionStartTime === null &&
          !hasExistingReadingData
        ) {
          nextScreen = "welcome";
        }

        const pendingDraftToRestore = savedPendingPostSessionDraft
          ? parsePendingPostSessionDraft(savedPendingPostSessionDraft)
          : null;
        const hasActiveSessionRestore =
          savedActiveSessionStartTime !== null && !pendingDraftToRestore;
        let didRestoreActiveSession = false;

        if (hasActiveSessionRestore) {
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
            if (savedActiveSessionSelectedBook) {
              try {
                const restoredActiveSessionBook = sanitizeStoredBookMetadata(
                  JSON.parse(savedActiveSessionSelectedBook),
                );
                setActiveSessionSelectedBook(restoredActiveSessionBook);
                if (restoredActiveSessionBook) {
                  setPreSessionBook(restoredActiveSessionBook);
                  setPreSessionBookSearchGroup(null);
                }
              } catch (error) {
                warnInDev(
                  "Rousd ignored malformed active-session book data.",
                  error,
                );
                await AsyncStorage.removeItem(ACTIVE_SESSION_SELECTED_BOOK_KEY);
              }
            }
            setSeconds(restoredTodayStartSeconds + elapsed);
            setLifetimeSeconds(restoredLifetimeStartSeconds + elapsed);
            setIsReading(true);
            didRestoreActiveSession = true;
            nextScreen = "active";
          } else {
            warnInDev(
              "Rousd ignored invalid active-session restore data; returning home.",
            );
            await AsyncStorage.multiRemove([
              ACTIVE_SESSION_START_KEY,
              ACTIVE_SESSION_TODAY_START_SECONDS_KEY,
              ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY,
              ACTIVE_SESSION_SELECTED_BOOK_KEY,
            ]);
          }
        }

        if (!didRestoreActiveSession && pendingDraftToRestore) {
          setPendingPostSessionId(pendingDraftToRestore.sessionId);
          setPendingSessionSeconds(pendingDraftToRestore.sessionSeconds);
          setPendingSessionStartedWithSelectedBook(
            pendingDraftToRestore.startedWithSelectedBook === true,
          );
          setBookTitle(
            pendingDraftToRestore.bookTitle ?? savedCurrentBook ?? "",
          );
          setBookAttributionStep(
            pendingDraftToRestore.bookAttributionStep ?? "choose",
          );
          setCompletedBookReview(
            pendingDraftToRestore.completedBookReview ?? "",
          );
          setShowBookCompletedInput(
            pendingDraftToRestore.showBookCompletedInput === true,
          );
          setSelectedBookMetadata(
            pendingDraftToRestore.selectedBookMetadata ?? null,
          );
          setPostSessionBookSearchGroup(null);
          setBookInputError(null);
          setCompletedBookReviewError(null);
          setHasUserEditedBookQuery(false);
          setIsBookLookupRequested(false);
          setBookLookupResults([]);
          setBookLookupError(false);
          await AsyncStorage.multiRemove([
            ACTIVE_SESSION_START_KEY,
            ACTIVE_SESSION_TODAY_START_SECONDS_KEY,
            ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY,
            ACTIVE_SESSION_SELECTED_BOOK_KEY,
          ]);
          nextScreen = "bookInput";
        } else if (
          !didRestoreActiveSession &&
          savedPendingPostSessionDraft !== null
        ) {
          await AsyncStorage.removeItem(PENDING_POST_SESSION_DRAFT_KEY);
          if (savedActiveSessionStartTime !== null) {
            nextScreen = "active";
          } else {
            nextScreen = "home";
          }
        }

        if (
          savedCurrentBook !== null &&
          !didRestoreActiveSession &&
          !isUnattachedSessionTitle(savedCurrentBook)
        ) {
          setCurrentBookTitle(savedCurrentBook);
          const savedCurrentBookSession = loadedRecentSessions.find(
            (session) =>
              session.title.trim().toLowerCase() ===
              savedCurrentBook.trim().toLowerCase(),
          );
          setPreSessionBook({
            title: savedCurrentBook,
            author: savedCurrentBookSession?.author ?? null,
            coverUrl: normalizeStoredCoverUrl(savedCurrentBookSession?.coverUrl),
            googleBooksId: savedCurrentBookSession?.googleBooksId ?? null,
            isbn10: savedCurrentBookSession?.isbn10 ?? null,
            isbn13: savedCurrentBookSession?.isbn13 ?? null,
            source: savedCurrentBookSession?.bookSource ?? "manual",
          });
          if (nextScreen !== "bookInput") {
            setBookTitle(savedCurrentBook);
          }
        }
      } catch (error) {
        warnInDev("Failed to load Rousd data:", error);
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

    await AsyncStorage.setItem(DATE_KEY, today);
    setLastReadDate(today);
  };

  const handlePress = async () => {
    if (!isReading && isStartingSessionRef.current) return;
    if (isReading && isEndingSessionRef.current) return;

    performHaptic(() =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );

    if (!isReading) {
      invalidateKnownBookCoverDiscovery("preSession");
      isStartingSessionRef.current = true;
      setIsEnteringReading(true);

      const now = Date.now();
      const validPreSessionBookTitle = getValidBookTitle(preSessionBook?.title);
      const selectedBookAtStart = validPreSessionBookTitle && preSessionBook
        ? {
            ...preSessionBook,
            title: validPreSessionBookTitle,
            coverUrl: normalizeStoredCoverUrl(preSessionBook.coverUrl),
            source: preSessionBook.source ?? "manual",
          }
        : null;

      try {
        await persistTodayDateIfNeeded();
        await AsyncStorage.multiSet([
          [ACTIVE_SESSION_START_KEY, String(now)],
          [ACTIVE_SESSION_TODAY_START_SECONDS_KEY, String(seconds)],
          [ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY, String(lifetimeSeconds)],
          [
            ACTIVE_SESSION_SELECTED_BOOK_KEY,
            selectedBookAtStart ? JSON.stringify(selectedBookAtStart) : "",
          ],
        ]);
      } catch (error) {
        warnInDev("Rousd could not begin the reading session.", error);
        isStartingSessionRef.current = false;
        setIsEnteringReading(false);
        setSessionMessage("Reading couldn't begin yet. Try once more.");
        setTimeout(() => setSessionMessage(null), 3500);
        return;
      }

      setSessionStartSeconds(seconds);
      setLifetimeSessionStartSeconds(lifetimeSeconds);
      setActiveSessionStartTime(now);
      setPendingPostSessionId(null);
      setPendingSessionSeconds(0);
      setPendingSessionStartedWithSelectedBook(false);
      setActiveSessionSelectedBook(selectedBookAtStart);
      setSessionMessage(null);
      setSanctuaryReveal(null);
      setCompletedBookMoment(null);
      setBookTitle(selectedBookAtStart?.title ?? "");
      setSelectedBookMetadata(selectedBookAtStart);
      setPostSessionBookSearchGroup(
        selectedBookAtStart ? preSessionBookSearchGroup : null,
      );
      setHasUserEditedBookQuery(false);
      setShowBookCompletedInput(false);
      setCompletedBookReview("");
      setActiveSessionError(null);
      setIsReading(true);

      const enterRitual = () => {
        isStartingSessionRef.current = false;
        setIsEnteringReading(false);
        setScreen("ritual");
      };

      homeEntryOpacity.stopAnimation();
      if (reduceMotionEnabled) {
        homeEntryOpacity.setValue(0);
        enterRitual();
      } else {
        homeEntryOpacity.setValue(1);
        Animated.timing(homeEntryOpacity, {
          toValue: 0,
          duration: 360,
          useNativeDriver: true,
        }).start(enterRitual);
      }

      captureAnalyticsEvent("reading_session_started", {
        has_current_book: Boolean(selectedBookAtStart),
      });
    } else if (activeSessionStartTime) {
      isEndingSessionRef.current = true;
      setIsExitingReading(true);
      setActiveSessionError(null);

      const sessionSeconds = Math.max(
        1,
        calculateElapsedSeconds(activeSessionStartTime),
      );
      const updatedTodaySeconds = sessionStartSeconds + sessionSeconds;
      const updatedLifetimeSeconds =
        lifetimeSessionStartSeconds + sessionSeconds;
      const sessionId = Date.now().toString();
      const selectedBookFromStart = getValidBookTitle(
        activeSessionSelectedBook?.title,
      )
        ? activeSessionSelectedBook
        : null;
      const startedWithSelectedBook = Boolean(selectedBookFromStart);
      const endedAt = new Date().toISOString();
      const initialSessionMetadata = selectedBookFromStart
        ? getBookMetadataFields(selectedBookFromStart)
        : {};
      const initialSession: ReadingSession = {
        id: sessionId,
        title: selectedBookFromStart?.title ?? UNATTACHED_SESSION_TITLE,
        minutes: (sessionSeconds / 60).toFixed(1),
        createdAt: endedAt,
        source: "timed",
        ...initialSessionMetadata,
      };
      const updatedSessions = [
        initialSession,
        ...recentSessions.filter((session) => session.id !== sessionId),
      ];
      const updatedTotalCompletedSessions = updatedSessions.length;
      const pendingDraft: PendingPostSessionDraft = {
        version: 1,
        sessionId,
        sessionSeconds,
        endedAt,
        bookTitle: selectedBookFromStart?.title ?? "",
        bookAttributionStep: startedWithSelectedBook ? "reflect" : "choose",
        startedWithSelectedBook,
        completedBookReview: "",
        showBookCompletedInput: false,
        selectedBookMetadata: selectedBookFromStart,
      };

      try {
        await AsyncStorage.multiSet([
          [SECONDS_KEY, String(updatedTodaySeconds)],
          [LIFETIME_SECONDS_KEY, String(updatedLifetimeSeconds)],
          [SESSIONS_KEY, JSON.stringify(updatedSessions)],
          [
            TOTAL_COMPLETED_SESSIONS_KEY,
            String(updatedTotalCompletedSessions),
          ],
          [PENDING_POST_SESSION_DRAFT_KEY, JSON.stringify(pendingDraft)],
        ]);
      } catch (error) {
        warnInDev("Rousd failed to preserve pending timed session.", error);
        isEndingSessionRef.current = false;
        setIsExitingReading(false);
        setActiveSessionError(
          "Your reading is still here. Try ending once more.",
        );
        return;
      }

      try {
        await AsyncStorage.multiRemove([
          ACTIVE_SESSION_START_KEY,
          ACTIVE_SESSION_TODAY_START_SECONDS_KEY,
          ACTIVE_SESSION_LIFETIME_START_SECONDS_KEY,
          ACTIVE_SESSION_SELECTED_BOOK_KEY,
        ]);
      } catch (error) {
        warnInDev(
          "Rousd could not clear active-session recovery keys after saving.",
          error,
        );
      }

      captureAnalyticsEvent("reading_session_ended", {
        duration_bucket: getReadingDurationBucket(sessionSeconds),
      });

      const finishActiveSessionExit = () => {
        setSeconds(updatedTodaySeconds);
        setLifetimeSeconds(updatedLifetimeSeconds);
        setRecentSessions(updatedSessions);
        setTotalCompletedSessions(updatedTotalCompletedSessions);
        setPendingPostSessionId(sessionId);
        setPendingSessionSeconds(sessionSeconds);
        setPendingSessionStartedWithSelectedBook(startedWithSelectedBook);
        setBookTitle(selectedBookFromStart?.title ?? "");
        setSelectedBookMetadata(selectedBookFromStart);
        setPostSessionBookSearchGroup(
          selectedBookFromStart ? preSessionBookSearchGroup : null,
        );
        setHasUserEditedBookQuery(false);
        setIsBookLookupRequested(false);
        setSessionMessage(null);
        setActiveSessionError(null);
        setIsReading(false);
        setActiveSessionStartTime(null);
        setActiveSessionSelectedBook(null);
        isEndingSessionRef.current = false;
        setIsExitingReading(false);
        setScreen("closeTransition");
      };

      activeSessionOpacity.stopAnimation();
      if (reduceMotionEnabled) {
        activeSessionOpacity.setValue(0);
        finishActiveSessionExit();
      } else {
        Animated.timing(activeSessionOpacity, {
          toValue: 0,
          duration: 360,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished) {
            isEndingSessionRef.current = false;
            setIsExitingReading(false);
            return;
          }

          finishActiveSessionExit();
        });
      }
    }
  };

  const invalidateKnownBookCoverDiscovery = (
    target: CoverChooserTarget,
  ) => {
    knownBookCoverDiscoveryRequestIds.current[target] += 1;
    knownBookCoverDiscoverySelectionKeys.current[target] = null;
  };

  const discoverKnownBookCovers = (
    target: CoverChooserTarget,
    metadata: BookMetadata | null,
  ) => {
    invalidateKnownBookCoverDiscovery(target);
    setFailedCoverUrls([]);

    if (target === "preSession") {
      setPreSessionBookSearchGroup(null);
    } else if (target === "postSession") {
      setPostSessionBookSearchGroup(null);
    } else {
      setManualBookSearchGroup(null);
    }

    if (!metadata) return;

    const descriptor = getKnownBookCoverDiscoveryDescriptor(metadata);

    if (!descriptor) return;

    const requestId = knownBookCoverDiscoveryRequestIds.current[target];
    knownBookCoverDiscoverySelectionKeys.current[target] =
      descriptor.selectionKey;

    void (async () => {
      const groups = await searchGoogleBooks(descriptor.query);

      if (
        !isKnownBookCoverDiscoveryCurrent(
          knownBookCoverDiscoveryRequestIds.current[target],
          knownBookCoverDiscoverySelectionKeys.current[target],
          requestId,
          descriptor.selectionKey,
        )
      ) {
        return;
      }

      const matchedGroup = findKnownBookCoverSearchGroup(metadata, groups);

      if (!matchedGroup) return;

      if (target === "preSession") {
        setPreSessionBookSearchGroup(matchedGroup);
      } else if (target === "postSession") {
        setPostSessionBookSearchGroup(matchedGroup);
      } else {
        setManualBookSearchGroup(matchedGroup);
      }
    })();
  };

  const handleBookTitleChange = (nextTitle: string) => {
    setBookInputError(null);
    setHasUserEditedBookQuery(true);
    setIsBookLookupRequested(true);
    setBookTitle(nextTitle);

    if (selectedBookMetadata && nextTitle.trim() !== selectedBookMetadata.title) {
      invalidateKnownBookCoverDiscovery("postSession");
      setSelectedBookMetadata(null);
      setPostSessionBookSearchGroup(null);
      setCoverChooser(null);
      lastAutoScrolledBookLookupQuery.current = null;
    }
  };

  const clearBookTitleSelection = () => {
    invalidateKnownBookCoverDiscovery("postSession");
    bookLookupRequestId.current += 1;
    setBookInputError(null);
    setHasUserEditedBookQuery(true);
    setIsBookLookupRequested(true);
    setBookTitle("");
    setSelectedBookMetadata(null);
    setPostSessionBookSearchGroup(null);
    setCoverChooser(null);
    lastAutoScrolledBookLookupQuery.current = null;
    setBookLookupResults([]);
    setIsBookLookupLoading(false);
    setHasBookLookupSearched(false);
    setBookLookupError(false);
    setBookAttributionStep("choose");
    setTimeout(() => bookTitleInputRef.current?.focus(), 0);
  };

  const selectGoogleBook = (group: BookSearchGroup) => {
    const selection = getGoogleBookSelection(group);

    invalidateKnownBookCoverDiscovery("postSession");
    Keyboard.dismiss();
    bookLookupRequestId.current += 1;
    setBookInputError(null);
    setHasUserEditedBookQuery(false);
    setIsBookLookupRequested(false);
    setSelectedBookMetadata(selection.metadata);
    setPostSessionBookSearchGroup(selection.searchGroup);
    setFailedCoverUrls([]);
    setBookTitle(selection.metadata.title);
    setBookLookupResults([]);
    setIsBookLookupLoading(false);
    setHasBookLookupSearched(false);
    setBookLookupError(false);
    lastAutoScrolledBookLookupQuery.current = selection.metadata.title.trim();
  };

  const selectKnownPostSessionBook = (metadata: BookMetadata) => {
    Keyboard.dismiss();
    handleBookTitleChange(metadata.title);
    setHasUserEditedBookQuery(false);
    setIsBookLookupRequested(false);
    setBookLookupResults([]);
    setSelectedBookMetadata(metadata);
    setCoverChooser(null);
    discoverKnownBookCovers("postSession", metadata);
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
        const results = await Promise.race<BookSearchGroup[]>([
          searchGoogleBooks(trimmedQuery),
          new Promise<BookSearchGroup[]>((_, reject) =>
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

        warnInDev("Rousd Google Books lookup could not finish", error);
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

  const scrollManualLogInputAboveKeyboard = useCallback(
    (
      inputRef: RefObject<TextInput | null>,
      extraScrollHeight = 48,
      delay = isKeyboardVisible ? 80 : 280,
    ) => {
      if (Platform.OS === "web") return;

      setTimeout(() => {
        const inputNode = inputRef.current;
        const scrollResponder =
          manualLogScrollRef.current?.getScrollResponder();
        const inputHandle = inputNode ? findNodeHandle(inputNode) : null;

        if (!scrollResponder || inputHandle == null) return;

        scrollResponder.scrollResponderScrollNativeHandleToKeyboard(
          inputHandle,
          extraScrollHeight,
          true,
        );
      }, delay);
    },
    [isKeyboardVisible],
  );

  useEffect(() => {
    if (
      !isKeyboardVisible ||
      !manualBookTitleFocused ||
      manualBookLookupResults.length === 0 ||
      hasAutoScrolledManualBookResultsRef.current
    ) {
      return;
    }

    const scrollTimeout = setTimeout(() => {
      const scrollView = manualLogScrollRef.current;
      const scrollViewHandle = scrollView ? findNodeHandle(scrollView) : null;
      const panelLayout = manualBookLookupPanelLayoutRef.current;

      if (!scrollView || scrollViewHandle == null || panelLayout.height <= 0) {
        return;
      }

      UIManager.measureInWindow(
        scrollViewHandle,
        (_x, scrollViewY, _width, viewportHeight) => {
          const keyboardTop = keyboardFrameRef.current.screenY;
          const visibleViewportHeight = Math.max(
            0,
            Math.min(
              viewportHeight,
              keyboardTop > 0 ? keyboardTop - scrollViewY : viewportHeight,
            ),
          );
          const resultPreviewHeight = Math.min(panelLayout.height, 112);
          const minimumOffset = Math.max(
            0,
            panelLayout.y + resultPreviewHeight - visibleViewportHeight + 20,
          );
          const maximumContextOffset = Math.max(0, panelLayout.y - 20);
          const targetOffset = Math.min(
            Math.max(manualLogScrollOffsetRef.current, minimumOffset),
            maximumContextOffset,
          );
          const maximumScrollOffset = Math.max(
            0,
            manualLogNaturalContentHeightRef.current - viewportHeight,
          );

          hasAutoScrolledManualBookResultsRef.current = true;
          scrollView.scrollTo({
            y: Math.min(targetOffset, maximumScrollOffset),
            animated: true,
          });
        },
      );
    }, 80);

    return () => clearTimeout(scrollTimeout);
  }, [
    isKeyboardVisible,
    manualBookLookupResults.length,
    manualBookTitleFocused,
  ]);

  useEffect(() => {
    if (isKeyboardVisible && manualLogNoteFocused) return;

    manualLogNoteSpacerHeightRef.current = 0;
    setManualLogNoteSpacerHeight(0);
  }, [isKeyboardVisible, manualLogNoteFocused]);

  const positionManualLogNoteAboveKeyboard = useCallback(() => {
    if (Platform.OS === "web") return;

    requestAnimationFrame(() => {
      const scrollView = manualLogScrollRef.current;
      const keyboardFrame = keyboardFrameRef.current;
      const noteLayout = manualLogNoteLayoutRef.current;
      const naturalContentHeight = manualLogNaturalContentHeightRef.current;

      if (
        !scrollView ||
        !manualLogNoteFocusedRef.current ||
        keyboardFrame.height <= 0 ||
        noteLayout.height <= 0 ||
        naturalContentHeight <= 0
      ) {
        return;
      }

      const scrollViewHandle = findNodeHandle(scrollView);

      if (scrollViewHandle == null) return;

      UIManager.measureInWindow(
        scrollViewHandle,
        (_x, scrollViewY, _width, measuredHeight) => {
          if (
            !manualLogNoteFocusedRef.current ||
            keyboardFrameRef.current.height <= 0
          ) {
            return;
          }

          manualLogViewportHeightRef.current = measuredHeight;
          const viewportHeight = measuredHeight;
          const keyboardTop = keyboardFrameRef.current.screenY;
          const visibleViewportHeight = Math.max(
            0,
            Math.min(
              viewportHeight,
              keyboardTop > 0 ? keyboardTop - scrollViewY : viewportHeight,
            ),
          );
          const bottomBreathingRoom = 24;
          const minimumOffset = Math.max(
            0,
            noteLayout.y +
              noteLayout.height -
              visibleViewportHeight +
              bottomBreathingRoom,
          );
          const maximumLabelPreservingOffset = Math.max(
            0,
            noteLayout.y - 20,
          );
          const requestedOffset = Math.min(
            Math.max(manualLogScrollOffsetRef.current, minimumOffset),
            maximumLabelPreservingOffset,
          );
          const naturalMaximumOffset = Math.max(
            0,
            naturalContentHeight - viewportHeight,
          );
          const requiredSpacerHeight = Math.max(
            0,
            Math.ceil(requestedOffset - naturalMaximumOffset),
          );
          const currentSpacerHeight = manualLogNoteSpacerHeightRef.current;

          if (Math.abs(currentSpacerHeight - requiredSpacerHeight) > 1) {
            manualLogNoteSpacerHeightRef.current = requiredSpacerHeight;
            setManualLogNoteSpacerHeight(requiredSpacerHeight);
            return;
          }

          const maximumOffset = Math.max(
            0,
            naturalContentHeight + currentSpacerHeight - viewportHeight,
          );

          const clampedOffset = Math.min(requestedOffset, maximumOffset);

          if (Math.abs(clampedOffset - manualLogScrollOffsetRef.current) > 1) {
            scrollView.scrollTo({ y: clampedOffset, animated: true });
          }
        },
      );
    });
  }, []);

  useEffect(() => {
    if (!isKeyboardVisible || !manualLogNoteFocused) return;

    positionManualLogNoteAboveKeyboard();
  }, [
    isKeyboardVisible,
    manualLogNoteFocused,
    positionManualLogNoteAboveKeyboard,
  ]);

  useEffect(() => {
    if (
      isKeyboardVisible ||
      !shouldRecoverManualLogAfterKeyboardRef.current
    ) {
      return;
    }

    shouldRecoverManualLogAfterKeyboardRef.current = false;
    requestAnimationFrame(() => {
      manualLogScrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [isKeyboardVisible]);

  const handleManualBookTitleChange = (nextTitle: string) => {
    const trimmedTitle = nextTitle.trim();
    setIsManualBookLookupRequested(true);
    setManualLogBookTitle(nextTitle);

    if (
      selectedManualBookMetadata &&
      trimmedTitle !== selectedManualBookMetadata.title
    ) {
      invalidateKnownBookCoverDiscovery("manualLog");
      setSelectedManualBookMetadata(null);
      setManualBookSearchGroup(null);
      setCoverChooser(null);
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
    invalidateKnownBookCoverDiscovery("manualLog");
    setIsManualBookLookupRequested(true);
    setManualLogBookTitle("");
    setSelectedManualBookMetadata(null);
    setManualBookSearchGroup(null);
    setCoverChooser(null);
    resetManualBookLookup();
    setTimeout(() => manualBookTitleInputRef.current?.focus(), 0);
  };

  const selectManualGoogleBook = (group: BookSearchGroup) => {
    const selection = getGoogleBookSelection(group);

    invalidateKnownBookCoverDiscovery("manualLog");
    setSelectedManualBookMetadata(selection.metadata);
    setManualBookSearchGroup(selection.searchGroup);
    setFailedCoverUrls([]);
    setManualLogBookTitle(selection.metadata.title);
    setIsManualBookLookupRequested(false);
    resetManualBookLookup();
    Keyboard.dismiss();
  };

  const findKnownBookMetadataByTitle = (title: string): BookMetadata | null => {
    const normalizedTitle = normalizeWorkIdentityText(
      getCanonicalBookTitle({ title }),
    );
    const matchingKnownBooks = [...recentSessions, ...completedBooks].filter(
      (book) => {
        if (!hasReusableBookMetadata(book)) return false;

        return (
          getBookWorkIdentity({ title: book.title, author: book.author })
            .normalizedTitle === normalizedTitle
        );
      },
    );
    const matchingWorkKeys = new Set(
      matchingKnownBooks
        .map(
          (book) =>
            getBookWorkIdentity({ title: book.title, author: book.author }).key,
        )
        .filter(Boolean),
    );
    const hasUnidentifiedMatch = matchingKnownBooks.some(
      (book) =>
        !getBookWorkIdentity({ title: book.title, author: book.author }).key,
    );
    const isAmbiguous =
      matchingWorkKeys.size > 1 ||
      (hasUnidentifiedMatch && matchingKnownBooks.length > 1);
    const knownBook = isAmbiguous ? null : matchingKnownBooks[0];

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

  const resetPreSessionBookSearch = () => {
    preSessionBookLookupRequestId.current += 1;
    setPreSessionBookQuery("");
    setPreSessionBookSearchResults([]);
    setIsPreSessionBookSearchLoading(false);
    setHasPreSessionBookSearchSearched(false);
    setPreSessionBookSearchError(false);
  };

  const closePreSessionBookChooser = () => {
    Keyboard.dismiss();
    setIsPreSessionBookChooserVisible(false);
    resetPreSessionBookSearch();
  };

  const applyPreSessionBookSelection = (
    book: BookMetadata,
    searchGroup: BookSearchGroup | null,
  ) => {
    invalidateKnownBookCoverDiscovery("preSession");
    performHaptic(() => Haptics.selectionAsync());
    Keyboard.dismiss();
    setPreSessionBook({
      ...book,
      coverUrl: normalizeStoredCoverUrl(book.coverUrl),
    });
    setPreSessionBookSearchGroup(searchGroup);
    setFailedCoverUrls([]);
    setCoverChooser(null);
    setIsPreSessionBookChooserVisible(false);
    resetPreSessionBookSearch();
  };

  const selectPreSessionGoogleBook = (group: BookSearchGroup) => {
    const selection = getGoogleBookSelection(group);
    applyPreSessionBookSelection(selection.metadata, selection.searchGroup);
  };

  const selectKnownPreSessionBook = (book: BookMetadata) => {
    applyPreSessionBookSelection(book, null);
    discoverKnownBookCovers("preSession", book);
  };

  const clearPreSessionBook = () => {
    invalidateKnownBookCoverDiscovery("preSession");
    performHaptic(() => Haptics.selectionAsync());
    Keyboard.dismiss();
    setPreSessionBook(null);
    setPreSessionBookSearchGroup(null);
    setCoverChooser(null);
    setCurrentBookTitle("");
    setIsPreSessionBookChooserVisible(false);
    resetPreSessionBookSearch();
    void AsyncStorage.removeItem(CURRENT_BOOK_KEY);
  };

  const openCoverChooser = (
    target: CoverChooserTarget,
    metadata: BookMetadata | null,
    candidates: GoogleBookCoverCandidate[],
  ) => {
    const coverCandidates = getUniqueUsableCoverCandidates(candidates);

    if (!metadata || coverCandidates.length <= 1) {
      return;
    }

    performHaptic(() => Haptics.selectionAsync());
    Keyboard.dismiss();
    setFailedCoverUrls([]);
    setCoverChooser({
      target,
      bookTitle: metadata.title,
      selectedCoverUrl: normalizeStoredCoverUrl(metadata.coverUrl),
      coverCandidates,
    });
  };

  const closeCoverChooser = () => {
    setCoverChooser(null);
  };

  const chooseCover = (candidate: GoogleBookCoverCandidate) => {
    if (!coverChooser) return;

    const candidateUrl = normalizeStoredCoverUrl(candidate.url)?.trim();
    const isAvailableCandidate = coverChooser.coverCandidates.some(
      (availableCandidate) => availableCandidate.url === candidateUrl,
    );

    if (!candidateUrl || !isAvailableCandidate) return;

    if (coverChooser.target === "preSession") {
      setPreSessionBook((metadata) =>
        metadata ? selectBookMetadataCover(metadata, candidateUrl) : metadata,
      );
    } else if (coverChooser.target === "postSession") {
      setSelectedBookMetadata((metadata) =>
        metadata ? selectBookMetadataCover(metadata, candidateUrl) : metadata,
      );
    } else {
      setSelectedManualBookMetadata((metadata) =>
        metadata ? selectBookMetadataCover(metadata, candidateUrl) : metadata,
      );
    }

    performHaptic(() => Haptics.selectionAsync());
    closeCoverChooser();
  };

  const markCoverAsFailed = (coverUrl: string) => {
    setFailedCoverUrls((failedUrls) =>
      failedUrls.includes(coverUrl)
        ? failedUrls
        : [...failedUrls, coverUrl],
    );
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

    const sessionId = pendingPostSessionId ?? Date.now().toString();
    const existingSession = recentSessions.find(
      (session) => session.id === sessionId,
    );
    const newSession: ReadingSession = {
      id: sessionId,
      title,
      minutes: sessionMinutes,
      createdAt: existingSession?.createdAt ?? new Date().toISOString(),
      source: "timed",
      ...(trimmedReflection ? { reflection: trimmedReflection } : {}),
      ...metadataFields,
    };

    const updatedSessions = existingSession
      ? recentSessions.map((session) =>
          session.id === sessionId ? newSession : session,
        )
      : [newSession, ...recentSessions];

    const updatedTotalCompletedSessions = updatedSessions.length;

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
    setSanctuaryReveal({
      sessionId: newSession.id,
      bookTitle: title,
      sessionMinutes: sessionDuration,
      source: "timed",
      noteSaved: Boolean(trimmedReflection),
      ...metadataFields,
    });

    captureAnalyticsEvent("reading_session_saved", {
      source: "timed",
      attribution: isUnattachedSession ? "unattributed" : "book",
      attribution_source: isUnattachedSession
        ? "unattributed"
        : bookMetadata?.source ?? "manual",
      duration_bucket: getReadingDurationBucket(sessionSeconds),
      reflection_added: Boolean(trimmedReflection),
    });

    return {
      sessionId: newSession.id,
      sessionMinutes,
      updatedSessions,
    };
  };

  const saveBookForSession = async (
    options: {
      reflectionOverride?: string;
      savingAction?: Exclude<SavingAction, null>;
    } = {},
  ) => {
    const savingAction = options.savingAction ?? "bookInput";

    if (!beginSavingAction(savingAction)) return;

    invalidateKnownBookCoverDiscovery("postSession");
    setBookInputError(null);

    try {
      const selectedBookTitle = getValidBookTitle(selectedBookMetadata?.title);
      const validBookTitle = getValidBookTitle(bookTitle) ?? selectedBookTitle;
      const titleToSave = validBookTitle || UNATTACHED_SESSION_TITLE;
      const shouldCompleteBook = showBookCompletedInput && Boolean(validBookTitle);
      const reflectionToSave =
        options.reflectionOverride ?? completedBookReview;
      const selectedMetadata =
        validBookTitle &&
        selectedBookMetadata &&
        selectedBookTitle === validBookTitle
          ? selectedBookMetadata
          : validBookTitle
            ? findKnownBookMetadataByTitle(validBookTitle)
            : null;
      const completedBookMetadataFields = getBookMetadataFields(selectedMetadata);

      const savedSession = await saveSession(
        titleToSave,
        selectedMetadata,
        reflectionToSave,
      );

      if (showBookCompletedInput && !validBookTitle) {
        warnInDev(
          "Rousd skipped completed-book save because no valid book title was entered.",
        );
        setCompletedBookReview("");
      }

      if (shouldCompleteBook) {
        const hasSameTitleCompletedBook = completedBooks.some(
          (completedBook) =>
            normalizeBookIdentityText(completedBook.title) ===
            normalizeBookIdentityText(titleToSave),
        );
        const bookStats = getBookReadingStats(
          { title: titleToSave, ...completedBookMetadataFields },
          savedSession.updatedSessions,
          {
            allowTitleOnlyFallback: !hasSameTitleCompletedBook,
            alwaysIncludeSessionId: savedSession.sessionId,
          },
        );

        const completedMoment: CompletedBookMoment = {
          sessionId: savedSession.sessionId,
          title: titleToSave,
          sessionMinutes: savedSession.sessionMinutes,
          totalBookMinutes: bookStats.totalMinutes.toFixed(1),
          sessionCount: bookStats.sessionCount,
          ...completedBookMetadataFields,
        };
        setCompletedBookMoment(completedMoment);
        await saveCompletedBookReview(
          completedMoment.title,
          completedMoment.sessionMinutes,
          completedMoment.totalBookMinutes,
          completedMoment.sessionCount,
          completedMoment.sessionId,
          reflectionToSave,
          completedBookMetadataFields,
          savedSession.updatedSessions,
        );
        captureAnalyticsEvent("completed_book_saved", {
          review_added: Boolean(reflectionToSave.trim()),
          session_count_bucket: getSessionCountBucket(
            completedMoment.sessionCount,
          ),
        });
        setCompletedBookReviewError(null);
      }

      if (shouldCompleteBook) {
        setCurrentBookTitle("");
        setPreSessionBook(null);
        setPreSessionBookSearchGroup(null);
        await AsyncStorage.removeItem(CURRENT_BOOK_KEY);
      } else if (validBookTitle) {
        setCurrentBookTitle(validBookTitle);
        setPreSessionBook(
          selectedMetadata ?? {
            title: validBookTitle,
            source: "manual",
          },
        );
        setPreSessionBookSearchGroup(
          selectedMetadata ? postSessionBookSearchGroup : null,
        );
        await AsyncStorage.setItem(CURRENT_BOOK_KEY, validBookTitle);
      }

      await clearPendingPostSessionDraft();
      setPendingPostSessionId(null);

      setSessionMessage(
        shouldCompleteBook ? "Saved to your Shelf" : "Reading details saved",
      );

      setShowBookCompletedInput(false);
      setCompletedBookReview("");
      setBookAttributionStep("choose");
      setPendingSessionSeconds(0);
      setPendingSessionStartedWithSelectedBook(false);
      setSelectedBookMetadata(null);
      setPostSessionBookSearchGroup(null);
      setCoverChooser(null);
      setHasUserEditedBookQuery(false);
      setBookLookupResults([]);
      setBookLookupError(false);
      setSanctuaryReveal(null);
      setCompletedBookMoment(null);
      setScreen("home");

      setTimeout(() => {
        setSessionMessage(null);
      }, 4000);
    } catch (error) {
      warnInDev("Rousd failed to save timed reading session.", error);
      setBookInputError(
        "Your reading is saved. These details didn't save yet. Try once more.",
      );
    } finally {
      endSavingAction();
    }
  };

  const skipBookForSession = async () => {
    if (!beginSavingAction("bookInputSkip")) return;

    invalidateKnownBookCoverDiscovery("postSession");
    setBookInputError(null);

    try {
      await clearPendingPostSessionDraft();

      captureAnalyticsEvent("book_attribution_skipped", {
        source: "timed",
        duration_bucket: getReadingDurationBucket(pendingSessionSeconds),
      });

      setSessionMessage("Reading saved");
      setShowBookCompletedInput(false);
      setBookAttributionStep("choose");
      setPendingPostSessionId(null);
      setPendingSessionSeconds(0);
      setPendingSessionStartedWithSelectedBook(false);
      setCompletedBookReview("");
      setSelectedBookMetadata(null);
      setPostSessionBookSearchGroup(null);
      setCoverChooser(null);
      setHasUserEditedBookQuery(false);
      setBookLookupResults([]);
      setBookLookupError(false);
      setSanctuaryReveal(null);
      setScreen("home");

      setTimeout(() => {
        setSessionMessage(null);
      }, 3000);
    } catch (error) {
      warnInDev("Rousd could not finish the post-session return.", error);
      setBookInputError(
        "Your reading is saved. Try returning home once more.",
      );
    } finally {
      endSavingAction();
    }
  };

  const deleteReadingSession = async (sessionId: string) => {
    const sessionToDelete = recentSessions.find(
      (session) => session.id === sessionId,
    );

    if (!sessionToDelete) return;

    performHaptic(() =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );

    setLastDeletedSession({
      session: sessionToDelete,
      index: recentSessions.findIndex((session) => session.id === sessionId),
    });

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

  const undoDeleteReadingSession = async () => {
    if (!lastDeletedSession) return;

    performHaptic(() => Haptics.selectionAsync());

    const restoredSessions = [...recentSessions];
    restoredSessions.splice(
      Math.max(0, Math.min(lastDeletedSession.index, restoredSessions.length)),
      0,
      lastDeletedSession.session,
    );
    const restoredSeconds = Math.max(
      0,
      Math.round(Number(lastDeletedSession.session.minutes || 0) * 60),
    );
    const restoredLifetimeSeconds = lifetimeSeconds + restoredSeconds;
    const restoredTimestamp = getSessionDateValue(lastDeletedSession.session);
    const restoredDate = restoredTimestamp > 0 ? new Date(restoredTimestamp) : null;
    const todayDateString = getTodayDateString();
    const restoredToday =
      restoredDate?.toISOString().split("T")[0] === todayDateString;
    const restoredTodaySeconds = restoredToday ? seconds + restoredSeconds : seconds;

    setRecentSessions(restoredSessions);
    setTotalCompletedSessions(restoredSessions.length);
    setLifetimeSeconds(restoredLifetimeSeconds);
    if (restoredToday) setSeconds(restoredTodaySeconds);
    setLastDeletedSession(null);

    await AsyncStorage.multiSet([
      [SESSIONS_KEY, JSON.stringify(restoredSessions)],
      [TOTAL_COMPLETED_SESSIONS_KEY, String(restoredSessions.length)],
      [LIFETIME_SECONDS_KEY, String(restoredLifetimeSeconds)],
      [SECONDS_KEY, String(restoredTodaySeconds)],
    ]);

    setSessionMessage("Reading moment restored");
    setTimeout(() => setSessionMessage(null), 3000);
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
    sessionsOverride?: ReadingSession[],
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

    const sessionsToUpdate = sessionsOverride ?? recentSessions;
    const updatedSessions = sessionsToUpdate.map((session) =>
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
      performHaptic(() =>
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      );
      await saveCompletedBookReview(
        completedBookMoment.title,
        completedBookMoment.sessionMinutes,
        completedBookMoment.totalBookMinutes,
        completedBookMoment.sessionCount,
        completedBookMoment.sessionId,
        reviewOverride ?? completedBookReview,
        completedBookMoment,
      );

      captureAnalyticsEvent("completed_book_saved", {
        review_added: Boolean((reviewOverride ?? completedBookReview).trim()),
        session_count_bucket: getSessionCountBucket(
          completedBookMoment.sessionCount,
        ),
      });
    } catch (error) {
      warnInDev("Rousd failed to save finished book review.", error);
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

  const beginEditingFinishedBookNote = () => {
    if (!selectedFinishedBook) return;
    setFinishedBookNoteDraft(selectedFinishedBook.review ?? "");
    setIsEditingFinishedBookNote(true);
  };

  const saveFinishedBookNote = async () => {
    if (!selectedFinishedBook) return;

    const updatedBook = {
      ...selectedFinishedBook,
      review: finishedBookNoteDraft.trim(),
    };
    const updatedBooks = completedBooks.map((book) =>
      book.id === selectedFinishedBook.id ? updatedBook : book,
    );

    await AsyncStorage.setItem(COMPLETED_BOOKS_KEY, JSON.stringify(updatedBooks));
    setCompletedBooks(updatedBooks);
    setSelectedFinishedBook(updatedBook);
    setIsEditingFinishedBookNote(false);
    setSessionMessage("Shelf note saved");
    setTimeout(() => setSessionMessage(null), 3000);
  };

  const deleteFinishedBook = async () => {
    if (!selectedFinishedBook) return;

    const updatedBooks = completedBooks.filter(
      (book) => book.id !== selectedFinishedBook.id,
    );
    await AsyncStorage.setItem(COMPLETED_BOOKS_KEY, JSON.stringify(updatedBooks));
    setCompletedBooks(updatedBooks);
    setSelectedFinishedBook(null);
    setIsEditingFinishedBookNote(false);
    setScreen("finishedBooks");
    setSessionMessage("Book removed from the Shelf");
    setTimeout(() => setSessionMessage(null), 3000);
  };

  const confirmDeleteFinishedBook = () => {
    if (!selectedFinishedBook) return;

    Alert.alert(
      "Remove this book from the Shelf?",
      "Its Diary moments will remain. Only the finished-book entry and Shelf note will be removed.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void deleteFinishedBook(),
        },
      ],
    );
  };

  const openReadingSessionOptions = (sessionId: string) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Remove reading moment", "Cancel"],
          destructiveButtonIndex: 0,
          cancelButtonIndex: 1,
          title: "Reading entry options",
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            confirmDeleteReadingSession(sessionId);
          }
        },
      );
      return;
    }

    Alert.alert("Reading entry options", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove reading moment",
        style: "destructive",
        onPress: () => confirmDeleteReadingSession(sessionId),
      },
    ]);
  };

  const eraseAllReadingData = async () => {
    invalidateKnownBookCoverDiscovery("preSession");
    invalidateKnownBookCoverDiscovery("postSession");
    invalidateKnownBookCoverDiscovery("manualLog");
    await AsyncStorage.multiRemove([...READING_DATA_KEYS]);

    setIsReading(false);
    setSeconds(0);
    setLifetimeSeconds(0);
    setLastReadDate(null);
    setSessionStartSeconds(0);
    setLifetimeSessionStartSeconds(0);
    setActiveSessionStartTime(null);
    setPendingPostSessionId(null);
    setPendingSessionSeconds(0);
    setPendingSessionStartedWithSelectedBook(false);
    setCurrentBookTitle("");
    setPreSessionBook(null);
    setPreSessionBookSearchGroup(null);
    setActiveSessionSelectedBook(null);
    setRecentSessions([]);
    setTotalCompletedSessions(0);
    setCompletedBooks([]);
    setSelectedFinishedBook(null);
    setLastDeletedSession(null);
    setSanctuaryReveal(null);
    setCompletedBookMoment(null);
    setCompletedBookReview("");
    setBookTitle("");
    setSelectedBookMetadata(null);
    setPostSessionBookSearchGroup(null);
    setManualBookSearchGroup(null);
    setCoverChooser(null);
    setScreen("home");
    setSessionMessage("Your reading data was erased");
    setTimeout(() => setSessionMessage(null), 3500);
  };

  const confirmEraseAllReadingData = () => {
    Alert.alert(
      "Erase all reading data?",
      "This removes your books, notes, Diary, Shelf, and private timing history from this device. It cannot be undone.",
      [
        { text: "Keep my data", style: "cancel" },
        {
          text: "Erase all",
          style: "destructive",
          onPress: () => void eraseAllReadingData(),
        },
      ],
    );
  };

  const openManualLog = async () => {
    const knownCurrentBook = currentBookTitle
      ? findKnownBookMetadataByTitle(currentBookTitle)
      : null;

    performHaptic(() =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );
    setLibraryReturnTarget(screen === "menu" ? "menu" : "home");
    setManualLogMinutes("");
    setManualLogBookTitle(currentBookTitle);
    setManualLogNote("");
    setManualLogError(null);
    setCompletedBookReviewError(null);
    setSelectedManualBookMetadata(knownCurrentBook);
    setCoverChooser(null);
    setIsManualBookLookupRequested(false);
    resetManualBookLookup();
    setSanctuaryReveal(null);
    setCompletedBookMoment(null);
    setSessionMessage(null);
    setScreen("manualLog");
    discoverKnownBookCovers("manualLog", knownCurrentBook);
  };

  const openFeedbackEmail = async () => {
    performHaptic(() =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );

    const subject = encodeURIComponent("Rousd Feedback");
    const body = encodeURIComponent(
      "What felt good?\n\nWhat felt confusing?\n\nWhat would you want Rousd to help with?",
    );

    try {
      await Linking.openURL(
        `mailto:support@rousd.app?subject=${subject}&body=${body}`,
      );
    } catch (error) {
      warnInDev("Rousd could not open the email client.", error);
      Alert.alert(
        "Feedback can be sent manually",
        "Your email app didn't open. You can still send your thoughts from your usual mail app when you're ready.",
      );
    }
  };

  const openPrivacyPolicy = async () => {
    try {
      performHaptic(() =>
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      );

      const canOpenPrivacyPolicy = await Linking.canOpenURL(PRIVACY_POLICY_URL);
      if (!canOpenPrivacyPolicy) {
        warnInDev("Rousd could not open the Privacy Policy URL.");
        return;
      }

      await Linking.openURL(PRIVACY_POLICY_URL);
    } catch (error) {
      warnInDev("Rousd could not open the Privacy Policy URL.", error);
    }
  };

  const openHomeDestination = async (destination: Screen) => {
    performHaptic(() =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );

    if (destination === "diary" || destination === "finishedBooks") {
      setLibraryReturnTarget(screen === "menu" ? "menu" : "home");
    }

    setScreen(destination);
  };

  const cancelManualLog = async () => {
    invalidateKnownBookCoverDiscovery("manualLog");
    performHaptic(() =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );
    Keyboard.dismiss();
    setManualLogMinutes("");
    setManualLogBookTitle("");
    setManualLogNote("");
    setManualLogError(null);
    setSelectedManualBookMetadata(null);
    setManualBookSearchGroup(null);
    setCoverChooser(null);
    setIsManualBookLookupRequested(false);
    setManualBookTitleFocused(false);
    manualLogNoteFocusedRef.current = false;
    setManualLogNoteFocused(false);
    manualLogNoteInputHeightRef.current = 0;
    manualLogNoteSpacerHeightRef.current = 0;
    setManualLogNoteSpacerHeight(0);
    manualLogScrollOffsetRef.current = 0;
    shouldRecoverManualLogAfterKeyboardRef.current = false;
    hasAutoScrolledManualBookResultsRef.current = false;
    resetManualBookLookup();
    setScreen(libraryReturnTarget === "menu" ? "menu" : "home");
  };

  const saveManualReadingLog = async () => {
    if (savingActionRef.current) return;

    const normalizedMinutes = manualLogMinutes.replace(",", ".").trim();
    const minutesNumber = Number(normalizedMinutes);

    if (!Number.isFinite(minutesNumber) || minutesNumber <= 0) {
      setManualLogError("Enter roughly how long you read.");
      performHaptic(() =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
      );
      return;
    }

    if (minutesNumber > 720) {
      setManualLogError("Enter a reading time of 12 hours or less.");
      performHaptic(() =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
      );
      return;
    }

    const manualSessionSeconds = Math.max(1, Math.round(minutesNumber * 60));
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

    const nextSanctuaryReveal: SanctuaryReveal = {
      sessionId: newSession.id,
      bookTitle: titleToSave,
      sessionMinutes: sessionDuration,
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

    invalidateKnownBookCoverDiscovery("manualLog");

    try {
      await persistTodayDateIfNeeded();
      await AsyncStorage.multiSet(storageUpdates);
    } catch (error) {
      warnInDev("Rousd failed to save manual reading log.", error);
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
    resetManualBookLookup();
    setManualLogError(null);

    if (trimmedTitle) {
      setCurrentBookTitle(trimmedTitle);
      setPreSessionBook(
        selectedManualMetadata ?? {
          title: trimmedTitle,
          source: "manual",
        },
      );
      setPreSessionBookSearchGroup(
        selectedManualMetadata ? manualBookSearchGroup : null,
      );
    }

    setManualBookSearchGroup(null);
    setCoverChooser(null);

    setScreen("reveal");

    setSessionMessage("Reading moment saved");

    captureAnalyticsEvent("reading_session_saved", {
      source: "manual_log",
      attribution: isUnattachedSessionTitle(titleToSave) ? "unattributed" : "book",
      attribution_source: isUnattachedSessionTitle(titleToSave)
        ? "unattributed"
        : selectedManualMetadata?.source ?? "manual",
      duration_bucket: getReadingDurationBucket(manualSessionSeconds),
      reflection_added: Boolean(trimmedNote),
    });

    setTimeout(() => {
      setSessionMessage(null);
    }, 3500);
  };

  const dismissSanctuaryReveal = async () => {
    performHaptic(() =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );

    setScreen("home");
    setPendingSessionSeconds(0);
    setPendingSessionStartedWithSelectedBook(false);
    setSanctuaryReveal(null);
  };

  const dismissWelcomeScreen = async () => {
    performHaptic(() =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );
    await AsyncStorage.setItem(HAS_SEEN_WELCOME_KEY, "true");
    setScreen("home");
  };

  const visiblePickerSessions = dedupeBooksByIdentity(
    recentSessions.filter((session) => !isUnattachedSessionTitle(session.title)),
  )
    .slice(0, 3);
  const latestSession = recentSessions[0];
  const currentBookSession = currentBookTitle
    ? recentSessions.find(
        (session) =>
          session.title.trim().toLowerCase() ===
          currentBookTitle.trim().toLowerCase(),
      )
    : latestSession;
  const currentBookLastSession = currentBookTitle ? currentBookSession : null;
  const currentBookLastSessionNote = currentBookLastSession
    ? getSessionNote(currentBookLastSession)
    : "";
  const currentBookLastSessionWithNote =
    currentBookLastSession && currentBookLastSessionNote.length > 0
      ? currentBookLastSession
      : null;
  const preSessionBookChoicesByIdentity = new Map<string, BookMetadata>();
  const addPreSessionBookChoice = (book?: BookMetadata | null) => {
    const title = getValidBookTitle(book?.title);
    if (!title) return;

    const identityKey = getBookDeduplicationKey({ ...book, title });
    if (!identityKey || preSessionBookChoicesByIdentity.has(identityKey)) return;

    preSessionBookChoicesByIdentity.set(identityKey, {
      ...book,
      title,
      coverUrl: normalizeStoredCoverUrl(book?.coverUrl),
      source: book?.source ?? "manual",
    });
  };

  addPreSessionBookChoice(preSessionBook);
  if (currentBookTitle) {
    addPreSessionBookChoice(
      findKnownBookMetadataByTitle(currentBookTitle) ?? {
        title: currentBookTitle,
        source: "manual",
      },
    );
  }
  recentSessions
    .filter((session) => !isUnattachedSessionTitle(session.title))
    .forEach((session) => {
      addPreSessionBookChoice({
        title: session.title,
        author: session.author ?? null,
        coverUrl: normalizeStoredCoverUrl(session.coverUrl),
        googleBooksId: session.googleBooksId ?? null,
        isbn10: session.isbn10 ?? null,
        isbn13: session.isbn13 ?? null,
        source: session.bookSource ?? "manual",
      });
    });

  const preSessionBookChoices = Array.from(
    preSessionBookChoicesByIdentity.values(),
  ).slice(0, 5);
  const preSessionBookTitle = getValidBookTitle(preSessionBook?.title);
  const preSessionBookAuthor = getDisplayableAuthor(preSessionBook?.author);
  const preSessionBookCoverUrl = normalizeStoredCoverUrl(
    preSessionBook?.coverUrl,
  );
  const preSessionReadingTitle =
    getHomeBookplateDisplayTitle(preSessionBookTitle);
  const shouldUseCompactPreSessionTitle =
    preSessionReadingTitle.length > 44;
  const preSessionReadingHelper = preSessionBookTitle
    ? preSessionBookAuthor
      ? `by ${preSessionBookAuthor}`
      : "Tap to change before you begin."
    : "Optional—you can choose after reading.";
  const trimmedPreSessionBookQuery = preSessionBookQuery.trim();
  const isSearchingPreSessionBooks = trimmedPreSessionBookQuery.length > 0;
  const shouldShowPreSessionBookSearchResults =
    trimmedPreSessionBookQuery.length >= 3 &&
    (isPreSessionBookSearchLoading ||
      hasPreSessionBookSearchSearched ||
      preSessionBookSearchResults.length > 0);
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
  const coverChooserModal = coverChooser ? (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={closeCoverChooser}
    >
      <Pressable
        style={styles.coverChooserBackdrop}
        onPress={closeCoverChooser}
      >
        <Pressable
          accessibilityViewIsModal
          accessibilityLabel={`Choose a cover for ${coverChooser.bookTitle}`}
          style={styles.coverChooserSheet}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.coverChooserHandle} />
          <View style={styles.coverChooserHeader}>
            <View style={styles.coverChooserHeaderCopy}>
              <ThemedText style={styles.coverChooserTitle}>
                Choose a cover
              </ThemedText>
              <ThemedText
                style={styles.coverChooserBookTitle}
                numberOfLines={2}
              >
                {coverChooser.bookTitle}
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close cover chooser"
              hitSlop={8}
              style={({ pressed }) => [
                styles.coverChooserCloseButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={closeCoverChooser}
            >
              <Ionicons
                name="close"
                size={19}
                color="rgba(47,93,80,0.68)"
              />
            </Pressable>
          </View>
          <ThemedText style={styles.coverChooserHelper}>
            Your book and reading history stay the same.
          </ThemedText>
          <ScrollView
            style={styles.coverChooserScroll}
            contentContainerStyle={styles.coverChooserGrid}
            showsVerticalScrollIndicator={false}
          >
            {coverChooser.coverCandidates.map((candidate, index) => {
              const isSelected =
                candidate.url === coverChooser.selectedCoverUrl;
              const hasFailed = failedCoverUrls.includes(candidate.url);

              return (
                <Pressable
                  key={candidate.url}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${
                    isSelected ? "Selected cover" : "Cover"
                  }, option ${index + 1} of ${coverChooser.coverCandidates.length}`}
                  accessibilityHint={
                    isSelected
                      ? "This is the current cover"
                      : "Select this cover without changing the book"
                  }
                  style={({ pressed }) => [
                    styles.coverChooserOption,
                    isSelected && styles.coverChooserOptionSelected,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => chooseCover(candidate)}
                >
                  <View style={styles.coverChooserImageFrame}>
                    {hasFailed ? (
                      <ThemedText style={styles.coverChooserFallback}>
                        R
                      </ThemedText>
                    ) : (
                      <Image
                        source={{ uri: candidate.url }}
                        style={styles.coverChooserImage}
                        resizeMode="cover"
                        onError={() => markCoverAsFailed(candidate.url)}
                      />
                    )}
                    {isSelected ? (
                      <View style={styles.coverChooserSelectedBadge}>
                        <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  ) : null;

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
          <ThemedText style={styles.welcomeEyebrow}>Rousd</ThemedText>
          <View style={styles.welcomeTitleBlock}>
            <ThemedText style={styles.welcomeSubtitle}>
              A quiet place to return to books.
            </ThemedText>
            <View style={styles.welcomeAssuranceList}>
              <View style={styles.welcomeAssuranceRow}>
                <Ionicons name="moon-outline" size={18} color={colors.accent} />
                <ThemedText style={styles.welcomeBody}>
                  The timer stays hidden while you read.
                </ThemedText>
              </View>
              <View style={styles.welcomeAssuranceRow}>
                <Ionicons name="pencil-outline" size={18} color={colors.accent} />
                <ThemedText style={styles.welcomeBody}>
                  Books and notes are always optional.
                </ThemedText>
              </View>
              <View style={styles.welcomeAssuranceRow}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.accent} />
                <ThemedText style={styles.welcomeBody}>
                  Your books, notes, and history are stored on this device.
                </ThemedText>
              </View>
            </View>
            <ThemedText style={styles.welcomeFootnote}>
              Book search uses Google Books only when you choose to search.
            </ThemedText>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.welcomeButton,
              pressed && styles.buttonPressed,
            ]}
            accessibilityRole="button"
            onPress={dismissWelcomeScreen}
          >
            <ThemedText style={styles.welcomeButtonText}>Enter Rousd</ThemedText>
          </Pressable>
        </View>
        </ScrollView>
      </ThemedView>
    );
  

    case "closeTransition": {
      return (
      <ThemedView
        style={[
          styles.closeTransitionScreen,
          {
            marginTop: -insets.top,
            paddingTop: insets.top * 2 + 36,
          },
        ]}
      >
        <StatusBar style="light" />

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
            Your reading is saved.
          </ThemedText>
          <ThemedText style={styles.closeTransitionSubtext}>
            {"Add a book or note if you’d like."}
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
          {
            marginTop: -insets.top,
            paddingTop: insets.top * 2 + 36,
          },
        ]}
      >
        <StatusBar style="light" />

        <Animated.View
          style={[
            styles.sessionContent,
            { opacity: ritualOpacity, transform: [{ scale: ritualScale }] },
          ]}
        >
          <View style={styles.beaconMark}>
            <View style={styles.beaconBeam} />
            <Ionicons
              name="bookmark-outline"
              size={18}
              color="rgba(247,195,107,0.74)"
            />
          </View>
          <View style={styles.ritualLineArea}>
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
                {readingThresholdTitle}
              </ThemedText>
              <ThemedText style={styles.ritualLineBody}>
                {readingThresholdBody}
              </ThemedText>
            </Animated.View>
          </View>
        </Animated.View>
      </ThemedView>
    );

    case "active":
      return (
      <ThemedView
        style={[
          styles.sessionScreen,
          {
            marginTop: -insets.top,
            paddingTop: insets.top * 2 + 36,
          },
        ]}
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
              name="bookmark-outline"
              size={18}
              color="rgba(247,195,107,0.74)"
            />
          </View>
          <ThemedText style={styles.quietSessionEyebrow}>
            Reading
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
            accessibilityRole="button"
            accessibilityHint="Ends this reading session and saves it"
            style={({ pressed }) => [
              styles.quietEndSessionButton,
              isExitingReading && { opacity: 0.72 },
              pressed && styles.buttonPressed,
            ]}
            disabled={isExitingReading}
            hitSlop={12}
            onPress={handlePress}
          >
            <ThemedText style={styles.quietEndSessionText}>
              {"I'm done reading"}
            </ThemedText>
          </Pressable>
          {activeSessionError ? (
            <ThemedText
              accessibilityLiveRegion="polite"
              style={styles.activeSessionError}
            >
              {activeSessionError}
            </ThemedText>
          ) : null}
        </Animated.View>
      </ThemedView>
    );
  

    case "bookInput": {
      const pendingSessionMinutes = pendingSessionSeconds / 60;
      const pendingDuration =
        pendingSessionMinutes < 1
          ? "Reading saved · less than a minute"
          : `Reading saved · ${formatDuration(pendingSessionMinutes)}`;
      const canCompleteBook = Boolean(getValidBookTitle(bookTitle));
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
          : "Your title";
      const hasAttributionBook = Boolean(
        canCompleteBook || selectedBookMetadata || knownBookMetadata,
      );
      const isChoosingBook = true;
      const hasSettledAttributionMetadata = Boolean(
        attributionPreviewMetadata && !hasUserEditedBookQuery,
      );
      const hasPostSessionDetails = Boolean(
        hasAttributionBook || completedBookReview.trim(),
      );
      const shouldShowBypassedBookChange =
        !isChoosingBook && pendingSessionStartedWithSelectedBook;
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
      const shouldShowBookLookupEmptyState =
        shouldShowBookLookup &&
        !isBookLookupLoading &&
        hasBookLookupSearched &&
        bookLookupResults.length === 0 &&
        bookLookupQueryIsReady &&
        bookTitle.trim().length > 0;
      const isSavingAttributionBook = savingAction === "bookInput";
      const isSavingAttributionSkip = savingAction === "bookInputSkip";
      const isSavingAttribution =
        isSavingAttributionBook || isSavingAttributionSkip;
      const shouldUseTallAttributionLayout =
        isKeyboardVisible ||
        shouldShowBookLookup ||
        visiblePickerSessions.length > 0;
      const attributionKeyboardBottomPadding =
        insets.bottom + (isKeyboardVisible ? 320 : 112);
      const shouldShowBookChoiceShortcuts =
        isChoosingBook &&
        !isSearchingForBook &&
        !selectedBookMetadata &&
        bookTitle.trim().length === 0;
      const beginBookAttributionSearch = () => {
        invalidateKnownBookCoverDiscovery("postSession");
        Keyboard.dismiss();
        bookLookupRequestId.current += 1;
        setBookInputError(null);
        setSelectedBookMetadata(null);
        setPostSessionBookSearchGroup(null);
        setCoverChooser(null);
        setBookTitle("");
        setHasUserEditedBookQuery(true);
        setIsBookLookupRequested(true);
        setBookLookupResults([]);
        setIsBookLookupLoading(false);
        setHasBookLookupSearched(false);
        setBookLookupError(false);
        setTimeout(() => bookTitleInputRef.current?.focus(), 80);
      };
      const changePreselectedBook = beginBookAttributionSearch;
      const changeBookFromReflection = () => {
        setBookAttributionStep("choose");
        beginBookAttributionSearch();
        setTimeout(() => {
          bookInputScrollRef.current?.scrollTo({ y: 0, animated: true });
        }, 80);
      };
      const keepReflectionInputVisible = (scrollDelta = 96) => {
        setTimeout(() => {
          requestAnimationFrame(() => {
            bookInputScrollRef.current?.scrollTo({
              y: bookInputScrollYRef.current + scrollDelta,
              animated: true,
            });
          });
        }, isKeyboardVisible ? 80 : 260);
      };
      const attributionPrimaryLabel = isSavingAttributionBook
        ? "Saving..."
        : showBookCompletedInput
          ? "Save to Shelf"
          : "Save and return";
      const handleAttributionPrimaryPress = () => {
        void saveBookForSession();
      };
      const handleAttributionSecondaryPress = skipBookForSession;
      const attributionSecondaryLabel =
        isSavingAttributionSkip
          ? "Saving..."
          : "Return home";
      const attributionActions = (
        <View
          style={[
            styles.closeButtonRow,
            styles.bookAttributionBottomActions,
            isChoosingBook && styles.bookAttributionBottomActionsStepOne,
            isChoosingBook && isKeyboardVisible &&
              styles.bookAttributionBottomActionsKeyboard,
            isChoosingBook && !isKeyboardVisible && {
              paddingBottom: Math.max(insets.bottom, 16) + 16,
            },
            !isChoosingBook && styles.bookAttributionBottomActionsFinal,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.bookReturnSecondaryButton,
              !isChoosingBook && styles.bookReturnSecondaryButtonFinal,
              isSavingAttribution && { opacity: 0.72 },
              pressed && styles.buttonPressed,
            ]}
            disabled={isSavingAttribution}
            onPress={handleAttributionSecondaryPress}
          >
            <ThemedText style={styles.bookReturnSecondaryButtonText}>
              {attributionSecondaryLabel}
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.bookReturnSaveButton,
              !isChoosingBook && styles.bookReturnSaveButtonFinal,
              !hasPostSessionDetails && styles.bookReturnSaveButtonDisabled,
              isSavingAttribution && { opacity: 0.72 },
              pressed && hasPostSessionDetails && styles.buttonPressed,
            ]}
            disabled={!hasPostSessionDetails || isSavingAttribution}
            onPress={handleAttributionPrimaryPress}
          >
            <ThemedText
              style={[
                styles.bookReturnSaveButtonText,
                !hasPostSessionDetails &&
                  styles.bookReturnSaveButtonTextDisabled,
              ]}
            >
              {attributionPrimaryLabel}
            </ThemedText>
          </Pressable>
        </View>
      );

      return (
      <>
      <ThemedView
        style={[styles.bookReturnScreen, { paddingTop: insets.top + 32 }]}
      >

        <Animated.View style={[styles.bookInputFadeShell, { opacity: bookInputOpacity }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
        <View style={styles.bookInputLayout}>
        <ScrollView
          ref={bookInputScrollRef}
          style={styles.bookInputScroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          onScroll={(event) => {
            bookInputScrollYRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          contentInset={{ bottom: isChoosingBook && isKeyboardVisible ? 220 : 0 }}
          scrollIndicatorInsets={{
            bottom: isChoosingBook && isKeyboardVisible ? 220 : 0,
          }}
          contentContainerStyle={[
            styles.bookReturnContent,
            shouldUseTallAttributionLayout && styles.bookReturnContentTall,
            isChoosingBook && shouldUseTallAttributionLayout &&
              styles.bookReturnContentStepOneTall,
            isChoosingBook
              ? { paddingBottom: attributionKeyboardBottomPadding }
              : styles.bookReturnContentReflection,
          ]}
        >
          {!isChoosingBook ? (
            <View style={styles.bookAttributionTopNav}>
              {!shouldShowBypassedBookChange ? (
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
              ) : (
                <View style={styles.bookAttributionBackButtonSpacer} />
              )}
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.bookEditButton,
                  styles.bookEditButtonHeader,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => {
                  changeBookFromReflection();
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
            Optional
          </ThemedText>
          <ThemedText
            style={[
              styles.bookReturnTitle,
              isSearchingForBook && styles.bookReturnTitleCompact,
            ]}
          >
            Add to this reading
          </ThemedText>
          {shouldShowBypassedBookChange ? (
            <ThemedText style={styles.bookReturnHelperLine}>
              You spent a quiet moment with {attributionPreviewTitle}.
            </ThemedText>
          ) : null}
          {isChoosingBook ? (
            <ThemedText
              style={[
                styles.bookReturnMinutes,
                isSearchingForBook && styles.bookReturnMinutesCompact,
              ]}
            >
              {pendingDuration}
            </ThemedText>
          ) : null}

          {isChoosingBook ? (
            <>
              {hasSettledAttributionMetadata ? (
                <View style={styles.bookAttributionReviewCard}>
                  <View style={styles.bookAttributionReviewTopRow}>
                    <View style={styles.bookAttributionReviewCover}>
                      {attributionPreviewCoverUrl &&
                      !failedCoverUrls.includes(attributionPreviewCoverUrl) ? (
                        <Image
                          source={{ uri: attributionPreviewCoverUrl }}
                          style={styles.bookAttributionCoverImage}
                          resizeMode="cover"
                          onError={() =>
                            markCoverAsFailed(attributionPreviewCoverUrl)
                          }
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
                        {attributionPreviewTitle}
                      </ThemedText>
                      {attributionPreviewMetadata?.author ? (
                        <ThemedText
                          style={styles.bookAttributionReviewAuthor}
                          numberOfLines={1}
                        >
                          {attributionPreviewMetadata.author}
                        </ThemedText>
                      ) : null}
                      {selectedBookMetadata &&
                      postSessionBookCoverCandidates.length > 1 ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Change cover"
                          accessibilityHint="Choose another cover for this book"
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.bookCoverChangeButton,
                            pressed && styles.buttonPressed,
                          ]}
                          onPress={() =>
                            openCoverChooser(
                              "postSession",
                              selectedBookMetadata,
                              postSessionBookCoverCandidates,
                            )
                          }
                        >
                          <ThemedText style={styles.bookCoverChangeButtonText}>
                            Change cover
                          </ThemedText>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Change book"
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.bookChangeButton,
                          pressed && styles.buttonPressed,
                        ]}
                        onPress={changePreselectedBook}
                      >
                        <ThemedText style={styles.bookChangeButtonText}>
                          Change
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ) : (
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
                  {isSearchingForBook && canCompleteBook ? (
                    <ThemedText
                      style={styles.bookAttributionSelectedText}
                      numberOfLines={1}
                    >
                      You can save this title.
                    </ThemedText>
                  ) : null}
                </View>
              )}

              {bookInputError ? (
                <ThemedText
                  accessibilityLiveRegion="polite"
                  style={styles.manualLogError}
                >
                  {bookInputError}
                </ThemedText>
              ) : null}

              {shouldShowBookLookup ? (
                <View style={styles.bookLookupPanel}>
                  <View style={styles.bookLookupHeaderRow}>
                    <ThemedText
                      style={[
                        styles.bookLookupTitle,
                        styles.bookLookupTitleAttribution,
                      ]}
                    >
                      Possible books
                    </ThemedText>
                    {isBookLookupLoading ? (
                      <ThemedText
                        style={[
                          styles.bookLookupLoading,
                          styles.bookLookupLoadingAttribution,
                        ]}
                      >
                        Searching...
                      </ThemedText>
                    ) : null}
                  </View>
                  {bookLookupResults.length > 0 ? (
                    <ThemedText
                      style={[
                        styles.bookLookupHelperText,
                        styles.bookLookupHelperTextAttribution,
                      ]}
                    >
                      Choose a book, or keep your typed title.
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
                            <ThemedText
                              style={[
                                styles.bookLookupCoverText,
                                styles.bookLookupCoverTextAttribution,
                              ]}
                            >
                              R
                            </ThemedText>
                          </View>
                        )}
                        <View style={styles.bookLookupCopy}>
                          <View style={styles.bookLookupTitleRow}>
                            <ThemedText
                              style={[
                                styles.bookLookupBookTitle,
                                styles.bookLookupBookTitleAttribution,
                              ]}
                              numberOfLines={1}
                            >
                              {book.title}
                            </ThemedText>
                          </View>
                          {book.author ? (
                            <ThemedText
                              style={[
                                styles.bookLookupBookAuthor,
                                styles.bookLookupBookAuthorAttribution,
                              ]}
                              numberOfLines={1}
                            >
                              {book.author}
                            </ThemedText>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}

                  {shouldShowBookLookupEmptyState ? (
                    <ThemedText
                      style={[
                        styles.bookLookupEmptyText,
                        styles.bookLookupEmptyTextAttribution,
                      ]}
                    >
                      {bookLookupError
                        ? "Couldn't check matches right now. You can still save this title."
                      : "No matches found. You can still save this title."}
                    </ThemedText>
                  ) : null}

                  {bookLookupResults.length > 0 ? (
                    <ThemedText
                      style={[
                        styles.bookLookupAttribution,
                        styles.bookLookupAttributionTextAttribution,
                      ]}
                    >
                      Book data from Google Books
                    </ThemedText>
                  ) : null}
                </View>
              ) : null}

              {shouldShowBookChoiceShortcuts && visiblePickerSessions.length > 0 && (
                <View style={styles.recentBookPicker}>
                  <ThemedText style={styles.recentBookPickerTitle}>Recent books</ThemedText>
                  <ScrollView
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                    style={styles.recentBookChoiceScroll}
                    keyboardShouldPersistTaps="handled"
                  >
                    {visiblePickerSessions.map((session) => (
                      <Pressable
                        key={session.id}
                        style={({ pressed }) => [
                          styles.recentBookChoice,
                          pressed && styles.buttonPressed,
                        ]}
                        onPress={() => {
                          const metadata =
                            findKnownBookMetadataByTitle(session.title);

                          if (metadata) {
                            selectKnownPostSessionBook(metadata);
                          }
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
                            From your Diary
                          </ThemedText>
                        </View>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={styles.bookReflectionCard}>
                <ThemedText style={styles.bookReflectionLabel}>
                  A note
                </ThemedText>
                <TextInput
                  accessibilityLabel="A note"
                  placeholder="A thought, a line, a feeling..."
                  placeholderTextColor="rgba(47,93,80,0.38)"
                  value={completedBookReview}
                  onChangeText={(text) => {
                    setCompletedBookReview(text);
                    setBookInputError(null);
                  }}
                  onFocus={() => {
                    setCompletedBookReviewFocused(true);
                    keepReflectionInputVisible(180);
                  }}
                  onBlur={() => setCompletedBookReviewFocused(false)}
                  style={styles.bookReflectionInput}
                  multiline
                  returnKeyType="done"
                  blurOnSubmit
                  onSubmitEditing={Keyboard.dismiss}
                  textAlignVertical="top"
                />
              </View>

              {hasAttributionBook ? (
                <View style={styles.bookCompletedCard}>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: showBookCompletedInput }}
                    style={({ pressed }) => [
                      styles.bookCompletedToggle,
                      showBookCompletedInput &&
                        styles.bookCompletedToggleSelected,
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
              ) : null}

            </>
          ) : (
            <>
              <View
                style={[
                  styles.bookAttributionReviewCard,
                  styles.bookAttributionReviewCardStepTwo,
                ]}
              >
                <View style={styles.bookAttributionReviewTopRow}>
                  <View style={styles.bookAttributionReviewCover}>
                    {attributionPreviewCoverUrl &&
                    !failedCoverUrls.includes(attributionPreviewCoverUrl) ? (
                      <Image
                        source={{ uri: attributionPreviewCoverUrl }}
                        style={styles.bookAttributionCoverImage}
                        resizeMode="cover"
                        onError={() =>
                          markCoverAsFailed(attributionPreviewCoverUrl)
                        }
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
                    {getValidBookTitle(bookTitle) || "An unnamed book"}
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
                    {selectedBookMetadata &&
                    postSessionBookCoverCandidates.length > 1 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Change cover"
                        accessibilityHint="Choose another cover for this book"
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.bookCoverChangeButton,
                          pressed && styles.buttonPressed,
                        ]}
                        onPress={() =>
                          openCoverChooser(
                            "postSession",
                            selectedBookMetadata,
                            postSessionBookCoverCandidates,
                          )
                        }
                      >
                        <ThemedText style={styles.bookCoverChangeButtonText}>
                          Change cover
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {shouldShowBypassedBookChange ? (
                      <Pressable
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.bookChangeButton,
                          pressed && styles.buttonPressed,
                        ]}
                        onPress={changeBookFromReflection}
                      >
                        <ThemedText style={styles.bookChangeButtonText}>
                          Change book
                        </ThemedText>
                      </Pressable>
                    ) : null}
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
                  A note
                </ThemedText>
                <TextInput
                  placeholder="A thought, a line, a feeling..."
                  placeholderTextColor="rgba(47,93,80,0.38)"
                  value={completedBookReview}
                  onChangeText={(text) => {
                    setCompletedBookReview(text);
                    setBookInputError(null);
                  }}
                  onFocus={() => {
                    setCompletedBookReviewFocused(true);
                    keepReflectionInputVisible();
                  }}
                  onBlur={() => setCompletedBookReviewFocused(false)}
                  onContentSizeChange={(event) => {
                    const nextHeight = event.nativeEvent.contentSize.height;
                    const previousHeight =
                      bookReflectionInputHeightRef.current || nextHeight;
                    const heightDelta = nextHeight - previousHeight;

                    bookReflectionInputHeightRef.current = nextHeight;

                    if (
                      !completedBookReviewFocused ||
                      !isKeyboardVisible ||
                      heightDelta <= 1
                    ) {
                      return;
                    }

                    const scrollDelta = Math.min(heightDelta, 36);
                    requestAnimationFrame(() => {
                      bookInputScrollRef.current?.scrollTo({
                        y: bookInputScrollYRef.current + scrollDelta,
                        animated: true,
                      });
                    });
                  }}
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
                  accessibilityRole="switch"
                  accessibilityState={{ checked: showBookCompletedInput }}
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

          {isChoosingBook ? attributionActions : null}
        </ScrollView>
        {!isChoosingBook ? (
          <View
            style={[
              styles.bookReflectionFooter,
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            {attributionActions}
          </View>
        ) : null}
        </View>
        </KeyboardAvoidingView>
        </Animated.View>
      </ThemedView>
      {coverChooserModal}
      </>
    );
    }

    case "manualLog": {
      const presetMinutes = ["5", "10", "20", "30", "45", "60"];
      const manualKnownBookMetadata = getValidBookTitle(manualLogBookTitle)
        ? findKnownBookMetadataByTitle(manualLogBookTitle)
        : null;
      const manualSettledBookMetadata =
        selectedManualBookMetadata ??
        (!isManualBookLookupRequested ? manualKnownBookMetadata : null);
      const manualSettledBookCoverUrl = normalizeStoredCoverUrl(
        manualSettledBookMetadata?.coverUrl,
      );
      const shouldShowManualBookLookup =
        isManualBookLookupRequested &&
        manualLogBookTitle.trim().length >= 3 &&
        (isManualBookLookupLoading ||
          hasManualBookLookupSearched ||
          manualBookLookupResults.length > 0);
      const isSavingManualLog = savingAction === "manualLog";
      const manualLogActions = (
        <View style={styles.manualLogActionStack}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.closeSaveButton,
              styles.manualLogPrimaryAction,
              isSavingManualLog && { opacity: 0.72 },
              pressed && styles.buttonPressed,
            ]}
            disabled={isSavingManualLog}
            onPress={saveManualReadingLog}
          >
            <ThemedText
              style={styles.closeSaveButtonText}
              numberOfLines={1}
            >
              {isSavingManualLog ? "Saving..." : "Save this moment"}
            </ThemedText>
          </Pressable>

        </View>
      );

      return (
      <>
      <ThemedView
        style={[
          styles.closeSessionScreen,
          {
            marginTop: -insets.top,
            paddingTop: insets.top * 2 + 22,
          },
        ]}
      >
        <StatusBar style="light" />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
        <ScrollView
          ref={manualLogScrollRef}
          style={styles.manualLogScroll}
          onLayout={({ nativeEvent }) => {
            manualLogViewportHeightRef.current = nativeEvent.layout.height;

            if (manualLogNoteFocusedRef.current && isKeyboardVisible) {
              positionManualLogNoteAboveKeyboard();
            }
          }}
          onContentSizeChange={(_width, height) => {
            manualLogNaturalContentHeightRef.current = Math.max(
              0,
              height - manualLogNoteSpacerHeightRef.current,
            );

            if (manualLogNoteFocusedRef.current && isKeyboardVisible) {
              positionManualLogNoteAboveKeyboard();
            }
          }}
          onScroll={({ nativeEvent }) => {
            manualLogScrollOffsetRef.current = nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          contentContainerStyle={[
            styles.closeSessionContent,
            styles.manualLogContent,
            { paddingBottom: Math.max(insets.bottom, 20) },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.diaryBackButton,
              styles.manualLogBackButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={cancelManualLog}
          >
            <ThemedText
              style={[
                styles.diaryBackButtonText,
                styles.manualLogBackButtonText,
              ]}
            >
              {libraryReturnLabel}
            </ThemedText>
          </Pressable>

          <Pressable accessible={false} onPress={Keyboard.dismiss}>
            <ThemedText style={styles.closeEyebrow}>Earlier reading</ThemedText>
            <ThemedText style={styles.closeTitle}>Save a moment</ThemedText>
          </Pressable>

          <ThemedText style={styles.manualTimeLabel}>
            Time read
          </ThemedText>

          <View style={styles.manualPresetRow}>
            {presetMinutes.map((minutes) => {
              const isSelected = manualLogMinutes === minutes;

              return (
                <Pressable
                  key={minutes}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${formatDuration(Number(minutes))} read`}
                  style={({ pressed }) => [
                    styles.manualPresetChip,
                    isSelected && styles.manualPresetChipSelected,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => {
                    Keyboard.dismiss();
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

          <View style={styles.manualTimeInputRow}>
            <ThemedText style={styles.manualTimeOtherLabel}>Other</ThemedText>
            <TextInput
              accessibilityLabel="Time read in minutes"
              placeholder="12"
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={manualLogMinutes}
              onChangeText={(value) => {
                setManualLogMinutes(value);
                setManualLogError(null);
              }}
              style={styles.manualTimeInput}
              keyboardType="decimal-pad"
              returnKeyType="next"
              onFocus={() => {
                shouldRecoverManualLogAfterKeyboardRef.current = false;
              }}
            />
            <ThemedText style={styles.manualTimeSuffix}>min</ThemedText>
          </View>

          <ThemedText style={styles.manualOptionalDividerLabel}>
            Optional
          </ThemedText>

          <ThemedText style={styles.manualOptionalLabel}>
            Book
          </ThemedText>
          {manualSettledBookMetadata ? (
            <View style={styles.manualBookIdentityCard}>
              <View style={styles.manualBookIdentityCover}>
                {manualSettledBookCoverUrl &&
                !failedCoverUrls.includes(manualSettledBookCoverUrl) ? (
                  <Image
                    source={{ uri: manualSettledBookCoverUrl }}
                    style={styles.manualBookIdentityCoverImage}
                    resizeMode="cover"
                    onError={() =>
                      markCoverAsFailed(manualSettledBookCoverUrl)
                    }
                  />
                ) : (
                  <ThemedText style={styles.manualBookIdentityCoverFallback}>
                    R
                  </ThemedText>
                )}
              </View>
              <View style={styles.manualBookIdentityCopy}>
                <ThemedText
                  style={styles.manualBookIdentityTitle}
                  numberOfLines={2}
                >
                  {manualSettledBookMetadata.title}
                </ThemedText>
                {manualSettledBookMetadata.author ? (
                  <ThemedText
                    style={styles.manualBookIdentityAuthor}
                    numberOfLines={1}
                  >
                    {manualSettledBookMetadata.author}
                  </ThemedText>
                ) : null}
              </View>
              <View style={styles.manualBookIdentityActions}>
                {selectedManualBookMetadata &&
                manualBookCoverCandidates.length > 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Change cover"
                    accessibilityHint="Choose another cover for this book"
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.manualBookIdentityChange,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() =>
                      openCoverChooser(
                        "manualLog",
                        selectedManualBookMetadata,
                        manualBookCoverCandidates,
                      )
                    }
                  >
                    <ThemedText style={styles.manualBookIdentityChangeText}>
                      Change cover
                    </ThemedText>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change book"
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.manualBookIdentityChange,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={clearManualBookTitleSelection}
                >
                  <ThemedText style={styles.manualBookIdentityChangeText}>
                    Change
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ) : (
            <View
              style={[
                styles.closeBookInput,
                styles.manualJournalInput,
                styles.manualBookInput,
                styles.manualBookInputRow,
              ]}
            >
              <TextInput
                ref={manualBookTitleInputRef}
                accessibilityLabel="Book"
                placeholder="Search or type a title"
                placeholderTextColor="rgba(255,255,255,0.45)"
                value={manualLogBookTitle}
                onChangeText={handleManualBookTitleChange}
                onFocus={() => {
                  shouldRecoverManualLogAfterKeyboardRef.current = false;
                  setManualBookTitleFocused(true);
                  hasAutoScrolledManualBookResultsRef.current = false;
                  setIsManualBookLookupRequested(true);
                  searchManualBookTitle(manualLogBookTitle);
                  scrollManualLogInputAboveKeyboard(manualBookTitleInputRef);
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
          )}

          {shouldShowManualBookLookup ? (
            <View
              style={styles.manualBookLookupPanel}
              onLayout={({ nativeEvent }) => {
                const { y, height } = nativeEvent.layout;
                manualBookLookupPanelLayoutRef.current = { y, height };
              }}
            >
              <View style={styles.bookLookupHeaderRow}>
                <ThemedText style={styles.manualBookLookupTitle}>
                  Possible books
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
                    : "No matches yet. You can still keep this title."}
                </ThemedText>
              ) : null}
            </View>
          ) : null}

          <Pressable
            accessible={false}
            style={styles.manualNoteWrapper}
            onPress={() => manualLogNoteInputRef.current?.focus()}
            onLayout={({ nativeEvent }) => {
              const { y, height } = nativeEvent.layout;
              const previousLayout = manualLogNoteLayoutRef.current;
              manualLogNoteLayoutRef.current = { y, height };

              if (
                manualLogNoteFocusedRef.current &&
                isKeyboardVisible &&
                (Math.abs(previousLayout.y - y) > 1 ||
                  Math.abs(previousLayout.height - height) > 1)
              ) {
                positionManualLogNoteAboveKeyboard();
              }
            }}
          >
            <ThemedText style={styles.manualNoteLabel}>
              A note
            </ThemedText>
            <TextInput
              ref={manualLogNoteInputRef}
              accessibilityLabel="A note"
              value={manualLogNote}
              onChangeText={setManualLogNote}
              onFocus={() => {
                manualLogNoteFocusedRef.current = true;
                setManualLogNoteFocused(true);
              }}
              onBlur={() => {
                shouldRecoverManualLogAfterKeyboardRef.current = true;
                manualLogNoteFocusedRef.current = false;
                setManualLogNoteFocused(false);
              }}
              onContentSizeChange={({ nativeEvent }) => {
                const nextHeight = nativeEvent.contentSize.height;
                const previousHeight = manualLogNoteInputHeightRef.current;
                manualLogNoteInputHeightRef.current = nextHeight;

                if (
                  !manualLogNoteFocusedRef.current ||
                  !isKeyboardVisible ||
                  nextHeight <= previousHeight + 1
                ) {
                  return;
                }

                positionManualLogNoteAboveKeyboard();
              }}
              inputAccessoryViewID={
                Platform.OS === "ios"
                  ? MANUAL_LOG_NOTE_ACCESSORY_ID
                  : undefined
              }
              style={styles.manualNoteInput}
              multiline
              textAlignVertical="top"
            />
          </Pressable>

          {manualLogError && (
            <ThemedText
              accessibilityLiveRegion="polite"
              style={styles.manualLogError}
            >
              {manualLogError}
            </ThemedText>
          )}

          <View
            style={[
              styles.manualLogInlineActions,
              isKeyboardVisible && styles.manualLogInlineActionsKeyboard,
            ]}
          >
            {manualLogActions}
          </View>

          <View
            pointerEvents="none"
            style={{ height: manualLogNoteSpacerHeight }}
            onLayout={() => {
              if (manualLogNoteFocusedRef.current && isKeyboardVisible) {
                positionManualLogNoteAboveKeyboard();
              }
            }}
          />

        </ScrollView>
        </KeyboardAvoidingView>
        {Platform.OS === "ios" ? (
          <InputAccessoryView
            nativeID={MANUAL_LOG_NOTE_ACCESSORY_ID}
            backgroundColor="transparent"
          >
            <View style={styles.manualLogNoteAccessory}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Done editing note"
                hitSlop={8}
                style={({ pressed }) => [
                  styles.manualLogNoteAccessoryButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={Keyboard.dismiss}
              >
                <ThemedText style={styles.manualLogNoteAccessoryButtonText}>
                  Done
                </ThemedText>
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}
      </ThemedView>
      {coverChooserModal}
      </>
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

      const reflectionPrompt =
        completedBookReflectionPrompts[completedBookPromptIndex];
      const completedBookSessionLabel =
        completedBookMoment.sessionCount === 1 ? "moment" : "moments";
      const completedBookBottomPadding = isKeyboardVisible
        ? Math.max(insets.bottom + 140, 180)
        : insets.bottom + 32;
      const shouldInlineCompletedBookActions = isKeyboardVisible;
      const isSavingCompletedBookSave = savingAction === "completedBookSave";
      const isSavingCompletedBookSkip = savingAction === "completedBookSkip";
      const isSavingCompletedBook =
        isSavingCompletedBookSave || isSavingCompletedBookSkip;
      const completedBookActions = (
        <>
          {completedBookReviewError ? (
            <ThemedText
              accessibilityLiveRegion="polite"
              style={styles.manualLogError}
            >
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
                : "Keep on the Shelf"}
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
                : "Keep without a note"}
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
          <ThemedText style={styles.completedBookEyebrow}>FINISHED BOOK</ThemedText>

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
            Keep this book on your Shelf.
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
              <ThemedText
                style={[
                  styles.finishedBookDetailMetaLabel,
                  styles.completedBookMetaLabel,
                ]}
              >
                Time with this book
              </ThemedText>
              <ThemedText
                style={[
                  styles.finishedBookDetailMetaValue,
                  styles.completedBookMetaValue,
                ]}
              >
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
              <ThemedText
                style={[
                  styles.finishedBookDetailMetaLabel,
                  styles.completedBookMetaLabel,
                ]}
              >
                Reading moments
              </ThemedText>
              <ThemedText
                style={[
                  styles.finishedBookDetailMetaValue,
                  styles.completedBookMetaValue,
                ]}
              >
                {completedBookMoment.sessionCount} {completedBookSessionLabel}
              </ThemedText>
            </View>
          </View>

          <ThemedText style={styles.completedBookSubline}>
            It will stay in your private reading life. The note is optional.
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

      const revealActions = (
        <>
          <Pressable
            style={({ pressed }) => [
              styles.bookRevealContinueButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => dismissSanctuaryReveal()}
          >
            <ThemedText style={styles.bookRevealContinueButtonText}>
              Return home
            </ThemedText>
          </Pressable>
        </>
      );
      const revealFooterBottomPadding = isKeyboardVisible
        ? isUnattachedReveal
          ? 8
          : 10
        : isUnattachedReveal
          ? Math.max(insets.bottom + 2, 12)
          : Math.max(insets.bottom + 4, 16);
      const revealScrollBottomPadding = isKeyboardVisible
        ? isUnattachedReveal
          ? 176
          : 190
        : isUnattachedReveal
          ? 0
          : 8;
      const revealMainCopy = isUnattachedReveal
        ? "Your reading moment is saved."
        : "This book has another reading moment.";
      const revealSavedSession = recentSessions.find(
        (session) => session.id === sanctuaryReveal.sessionId,
      );
      const revealSavedSessionMinutes = Number(revealSavedSession?.minutes);
      const revealDurationCopy = getReadingTimeDescription(
        sanctuaryReveal.sessionMinutes,
        revealSavedSession && Number.isFinite(revealSavedSessionMinutes)
          ? revealSavedSessionMinutes
          : undefined,
      );

      return (
      <ThemedView
        style={[styles.bookRevealScreen, { paddingTop: insets.top + 10 }]}
      >

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
                <ThemedText
                  style={styles.bookRevealBookTitle}
                  numberOfLines={3}
                  ellipsizeMode="tail"
                >
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
                  {revealDurationCopy}
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
            contentContainerStyle={[
              styles.diaryContent,
              { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 },
            ]}
          >
            <Pressable
              accessibilityRole="button"
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

            <ThemedText style={styles.diaryTitle}>Diary</ThemedText>
            <ThemedText style={styles.diarySubtitle}>
              Your private reading journal.
            </ThemedText>

            {lastDeletedSession ? (
              <View style={styles.diaryUndoCard}>
                <ThemedText style={styles.diaryUndoText}>
                  Reading moment removed.
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void undoDeleteReadingSession()}
                >
                  <ThemedText style={styles.diaryUndoButtonText}>Undo</ThemedText>
                </Pressable>
              </View>
            ) : null}

            {diarySessions.length === 0 ? (
              <View style={styles.diaryEmptyCard}>
                <ThemedText style={styles.diaryEmptyText}>
                  No reading moments yet.
                </ThemedText>
                <ThemedText style={styles.diaryEmptySubtext}>
                  Saved sessions will appear here in order.
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
                              <ThemedText style={styles.readingMomentCoverMarkSmall}>
                                R
                              </ThemedText>
                            )}
                          </View>
                          <View style={styles.diaryEntryCopy}>
                            <ThemedText style={styles.diaryBookTitle}>
                              {getDisplaySessionTitle(session.title)}
                            </ThemedText>
                            {sessionReflection ? (
                              <ThemedText style={styles.diaryReflection}>
                                {sessionReflection}
                              </ThemedText>
                            ) : null}
                            <View style={styles.diaryMetaRow}>
                              <ThemedText style={styles.diaryMeta}>
                                {formatDiaryEntryTime(session)}
                              </ThemedText>
                              <ThemedText style={styles.diaryMetaSeparator}>
                                {"\u00b7"}
                              </ThemedText>
                              <ThemedText style={styles.diaryDuration}>
                                {formatDuration(Number(session.minutes))}
                              </ThemedText>
                            </View>
                          </View>

                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Reading entry options for ${getDisplaySessionTitle(session.title)}`}
                            accessibilityHint="Shows options for this reading entry"
                            style={({ pressed }) => [
                              styles.diaryOptionsButton,
                              pressed && styles.buttonPressed,
                            ]}
                            onPress={() => openReadingSessionOptions(session.id)}
                          >
                            <Ionicons
                              name="ellipsis-horizontal"
                              size={18}
                              color="rgba(47,93,80,0.48)"
                            />
                          </Pressable>
                        </View>
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
              accessibilityRole="button"
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

            <ThemedText style={styles.finishedBooksTitle}>
              Shelf
            </ThemedText>
            <ThemedText style={styles.finishedBooksSubtitle}>
              Books you’ve finished.
            </ThemedText>

            {completedBooks.length === 0 ? (
              <View style={styles.finishedBooksEmptyState}>
                <ThemedText style={styles.finishedBooksEmptyText}>
                  No finished books yet.
                </ThemedText>
                <ThemedText style={styles.finishedBooksEmptySubtext}>
                  When you finish a book, it will appear here.
                </ThemedText>
              </View>
            ) : (
              <View style={styles.finishedBooksShelf}>
                {completedBooks.map((book, index) => (
                  <View key={book.id}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${book.title}`}
                      style={({ pressed }) => [
                        styles.finishedBookCard,
                        pressed && styles.buttonPressed,
                      ]}
                      onPress={() => {
                        setSelectedFinishedBook(book);
                        setFinishedBookNoteDraft(book.review ?? "");
                        setIsEditingFinishedBookNote(false);
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
                          >
                            R
                          </ThemedText>
                        )}
                      </View>

                      <View style={styles.finishedBookCopy}>
                        <ThemedText
                          style={styles.finishedBookTitle}
                          numberOfLines={3}
                        >
                          {book.title}
                        </ThemedText>
                        {book.review.trim() ? (
                          <ThemedText
                            style={styles.finishedBookReview}
                            numberOfLines={2}
                          >
                            {book.review.trim()}
                          </ThemedText>
                        ) : null}
                        <ThemedText style={styles.finishedBookDate}>
                          Finished {getCompletedBookShelfDate(book.completedAt)}
                        </ThemedText>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color="rgba(47,93,80,0.36)"
                        style={styles.finishedBookOpenIcon}
                      />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

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
      const finishedDate = getCompletedBookDetailDate(book.completedAt);
      const totalReadingTime = formatDuration(
        Number(book.totalBookMinutes ?? book.sessionMinutes),
      );
      const sessionCount = book.sessionCount ?? 1;
      const sessionLabel = sessionCount === 1 ? "moment" : "moments";
      const review = book.review.trim();
      const normalizedFinishedTitle = normalizeBookIdentityText(book.title);
      const hasSameTitleShelfSibling = completedBooks.some(
        (otherBook) =>
          otherBook.id !== book.id &&
          normalizeBookIdentityText(otherBook.title) === normalizedFinishedTitle,
      );
      const bookHistorySessions = diarySessions.filter((session) =>
        doesReadingSessionMatchBook(session, book, {
          allowTitleOnlyFallback: !hasSameTitleShelfSibling,
        }),
      );

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
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.diaryBackButton,
                styles.finishedBookDetailBackButton,
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

              <ThemedText style={styles.finishedBookDetailTitle}>
                {book.title}
              </ThemedText>
              {book.author ? (
                <ThemedText style={styles.finishedBookDetailAuthor}>
                  {book.author}
                </ThemedText>
              ) : null}
              <ThemedText style={styles.finishedBookDetailFinishedDate}>
                Finished {finishedDate}
              </ThemedText>
            </View>

            {isEditingFinishedBookNote ? (
              <View style={styles.finishedBookDetailReviewCard}>
                <View style={styles.finishedBookDetailReviewHeader}>
                  <ThemedText style={styles.finishedBookDetailReviewLabel}>
                    Shelf note
                  </ThemedText>
                </View>
                <TextInput
                  accessibilityLabel="Shelf note"
                  value={finishedBookNoteDraft}
                  onChangeText={setFinishedBookNoteDraft}
                  placeholder="A thought, a line, a feeling..."
                  placeholderTextColor="rgba(47,93,80,0.38)"
                  multiline
                  textAlignVertical="top"
                  style={styles.finishedBookNoteInput}
                />
                <View style={styles.finishedBookDetailActionRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setIsEditingFinishedBookNote(false)}
                    style={styles.finishedBookDetailSecondaryAction}
                  >
                    <ThemedText style={styles.finishedBookDetailSecondaryText}>Cancel</ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void saveFinishedBookNote()}
                    style={styles.finishedBookDetailPrimaryAction}
                  >
                    <ThemedText style={styles.finishedBookDetailPrimaryText}>Save note</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : review ? (
              <View style={styles.finishedBookDetailReviewCard}>
                <View style={styles.finishedBookDetailReviewHeader}>
                  <ThemedText style={styles.finishedBookDetailReviewLabel}>
                    Shelf note
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Edit Shelf note"
                    hitSlop={10}
                    onPress={beginEditingFinishedBookNote}
                    style={({ pressed }) => [
                      styles.finishedBookNoteEditButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText style={styles.finishedBookNoteEditText}>
                      Edit
                    </ThemedText>
                  </Pressable>
                </View>
                <ThemedText style={styles.finishedBookDetailReview}>
                  {review}
                </ThemedText>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                style={styles.finishedBookAddNoteButton}
                onPress={beginEditingFinishedBookNote}
              >
                <ThemedText style={styles.finishedBookAddNoteText}>Add a shelf note</ThemedText>
              </Pressable>
            )}

            <View style={styles.finishedBookHistory}>
              <View style={styles.finishedBookHistoryIntro}>
                <ThemedText style={styles.finishedBookHistoryTitle}>
                  Reading history
                </ThemedText>
                <ThemedText style={styles.finishedBookDetailMemoryLine}>
                  {sessionCount} {sessionLabel}
                  {" \u00b7 "}
                  {totalReadingTime}
                </ThemedText>
              </View>
              {bookHistorySessions.map((session) => {
                const sessionNote = getSessionNote(session);

                return (
                  <View key={session.id} style={styles.finishedBookHistoryRow}>
                    <View style={styles.finishedBookHistoryCopy}>
                      <ThemedText style={styles.finishedBookHistoryDate}>
                        {formatSessionTimestamp(session.createdAt)}
                      </ThemedText>
                      {sessionNote ? (
                        <ThemedText style={styles.finishedBookHistoryNote}>
                          {sessionNote}
                        </ThemedText>
                      ) : null}
                    </View>
                    <ThemedText style={styles.finishedBookHistoryDuration}>
                      {formatDuration(Number(session.minutes))}
                    </ThemedText>
                  </View>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              style={styles.finishedBookRemoveButton}
              onPress={confirmDeleteFinishedBook}
            >
              <ThemedText style={styles.finishedBookRemoveText}>Remove from Shelf</ThemedText>
            </Pressable>
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
              accessibilityRole="button"
              accessibilityLabel="Return home"
              style={({ pressed }) => [
                styles.diaryBackButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => openHomeDestination("home")}
            >
              <ThemedText
                style={[
                  styles.diaryBackButtonText,
                  styles.menuBackButtonText,
                ]}
              >
                Home
              </ThemedText>
            </Pressable>

            <ThemedText style={styles.menuTitle}>Library</ThemedText>

            <View style={styles.menuCardStack}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.menuNavCard,
                  styles.menuPrimaryNavCard,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => openHomeDestination("diary")}
              >
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
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.menuNavCard,
                  styles.menuPrimaryNavCard,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => openHomeDestination("finishedBooks")}
              >
                <View style={styles.menuNavCopy}>
                  <ThemedText style={styles.menuNavTitle}>
                    Shelf
                  </ThemedText>
                  <ThemedText style={styles.menuNavSubtext}>
                    Finished books and the notes you kept
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color="rgba(47,93,80,0.34)"
                />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.menuNavCard,
                  styles.menuSecondaryNavCard,
                  pressed && styles.buttonPressed,
                ]}
                onPress={openManualLog}
              >
                <View style={styles.menuNavCopy}>
                  <ThemedText style={styles.menuEarlierReadingTitle}>
                    Save an earlier reading
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color="rgba(47,93,80,0.34)"
                />
              </Pressable>
            </View>

            <View style={styles.menuUtilityGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Privacy and data"
                style={({ pressed }) => [
                  styles.menuFeedbackCard,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => openHomeDestination("privacy")}
              >
                <ThemedText style={styles.menuFeedbackTitle}>
                  Privacy & data
                </ThemedText>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send feedback"
                style={({ pressed }) => [
                  styles.menuFeedbackCard,
                  pressed && styles.buttonPressed,
                ]}
                onPress={openFeedbackEmail}
              >
                <ThemedText style={styles.menuFeedbackTitle}>
                  Send feedback
                </ThemedText>
              </Pressable>
            </View>
          </ScrollView>
      </ThemedView>
      );
    case "privacy":
      return (
        <ThemedView style={styles.menuScreen}>
          <ScrollView
            style={styles.menuScrollView}
            contentContainerStyle={[
              styles.privacyContent,
              { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.diaryBackButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => setScreen("menu")}
            >
              <ThemedText style={styles.diaryBackButtonText}>Back to Library</ThemedText>
            </Pressable>

            <ThemedText style={styles.menuEyebrow}>Private by design</ThemedText>
            <ThemedText style={styles.menuTitle}>Privacy & data</ThemedText>
            <ThemedText style={styles.menuSubtitle}>
              Plain language about your reading life.
            </ThemedText>

            <View style={styles.privacyCard}>
              <View style={styles.privacySection}>
                <ThemedText style={styles.privacySectionTitle}>Stored on this device</ThemedText>
                <ThemedText style={styles.privacySectionBody}>
                  Your books, notes, Diary, Shelf, and private reading-time history are stored locally.
                </ThemedText>
              </View>
              <View style={styles.privacyDivider} />
              <View style={styles.privacySection}>
                <ThemedText style={styles.privacySectionTitle}>Book search</ThemedText>
                <ThemedText style={styles.privacySectionBody}>
                  When you search for a book, your search words are sent to Google Books so Rousd can show possible matches.
                </ThemedText>
              </View>
              <View style={styles.privacyDivider} />
              <View style={styles.privacySection}>
                <ThemedText style={styles.privacySectionTitle}>Diagnostics</ThemedText>
                <ThemedText style={styles.privacySectionBody}>
                  Rousd may send privacy-conscious crash reports and anonymous event categories. Book titles and note text are excluded.
                </ThemedText>
              </View>
            </View>

            <Pressable
              accessibilityRole="link"
              style={({ pressed }) => [
                styles.privacyPolicyButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={openPrivacyPolicy}
            >
              <ThemedText style={styles.privacyPolicyButtonText}>Read the full Privacy Policy</ThemedText>
              <Ionicons name="open-outline" size={17} color={colors.accent} />
            </Pressable>

            <View style={styles.privacyEraseSection}>
              <ThemedText style={styles.privacyEraseTitle}>Your data, your choice</ThemedText>
              <ThemedText style={styles.privacyEraseBody}>
                Erasing removes all reading data from this device and cannot be undone.
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.privacyEraseButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={confirmEraseAllReadingData}
              >
                <ThemedText style={styles.privacyEraseButtonText}>Erase all reading data</ThemedText>
              </Pressable>
            </View>
          </ScrollView>
        </ThemedView>
      );
    case "home":
      return (
    <>
    <Animated.ScrollView
      style={[styles.screen, { opacity: homeEntryOpacity }]}
      contentContainerStyle={styles.scrollContent}
    >
      <ThemedView
        style={[
          styles.container,
          {
            paddingTop: insets.top + 32,
            paddingBottom: 54 + Math.max(insets.bottom + 28, 44),
          },
        ]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={["#F7F3EA", "#F1E9DC"]}
          style={styles.homeCanvasGradient}
        />
        <View pointerEvents="none" style={styles.warmVignetteTop} />
        <ThemedView style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <ThemedText style={styles.appName}>Rousd</ThemedText>
            <ThemedText style={styles.headerSubtitle}>
              A quiet place to return.
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Library menu"
            style={({ pressed }) => [
              styles.menuButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => openHomeDestination("menu")}
          >
            <Ionicons
              name="library-outline"
              size={16}
              color="rgba(47,93,80,0.62)"
            />
            <ThemedText style={styles.menuButtonText}>Library</ThemedText>
          </Pressable>
        </ThemedView>

        <View
          style={[
            styles.homeReadingSelectorWrap,
            !preSessionBookTitle && styles.homeReadingSelectorWrapEmpty,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={preSessionBookTitle ? "Change book" : "Choose a book, optional"}
            style={({ pressed }) => [
              styles.preSessionReadingSelector,
              !preSessionBookTitle && styles.preSessionReadingSelectorEmpty,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => setIsPreSessionBookChooserVisible(true)}
          >
            <ThemedText style={styles.preSessionReadingEyebrow}>
              READING
            </ThemedText>
            <View
              style={[
                styles.preSessionReadingCameoFrame,
                !preSessionBookTitle && styles.preSessionReadingCameoFrameEmpty,
              ]}
            >
              <View style={styles.preSessionReadingCameo}>
                {preSessionBookCoverUrl &&
                !failedCoverUrls.includes(preSessionBookCoverUrl) ? (
                  <Image
                    source={{ uri: preSessionBookCoverUrl }}
                    style={styles.preSessionReadingCameoImage}
                    resizeMode="cover"
                    onError={() => markCoverAsFailed(preSessionBookCoverUrl)}
                  />
                ) : (
                  <ThemedText style={styles.preSessionReadingCameoMark}>
                    R
                  </ThemedText>
                )}
              </View>
            </View>
            <ThemedText
              style={[
                styles.preSessionReadingTitle,
                !preSessionBookTitle && styles.preSessionReadingTitleEmpty,
                shouldUseCompactPreSessionTitle &&
                  styles.preSessionReadingTitleLong,
              ]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              ellipsizeMode="tail"
            >
              {preSessionReadingTitle}
            </ThemedText>
            {preSessionBookTitle ? (
              <>
                <ThemedText
                  style={styles.preSessionReadingHelper}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {preSessionReadingHelper}
                </ThemedText>
                <View style={styles.preSessionReadingTapLine}>
                  <ThemedText style={styles.preSessionReadingTapText}>
                    Tap to change
                  </ThemedText>
                  <Ionicons
                    name="chevron-down"
                    size={13}
                    color="rgba(47,93,80,0.46)"
                  />
                </View>
              </>
            ) : (
              <View style={styles.preSessionReadingHelperRowEmpty}>
                <ThemedText
                  style={[
                    styles.preSessionReadingHelper,
                    styles.preSessionReadingHelperEmpty,
                  ]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {preSessionReadingHelper}
                </ThemedText>
                <Ionicons
                  name="chevron-down"
                  size={13}
                  color="rgba(47,93,80,0.42)"
                />
              </View>
            )}
          </Pressable>
          {preSessionBook && preSessionBookCoverCandidates.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change cover"
              accessibilityHint="Choose another cover for this book"
              hitSlop={8}
              style={({ pressed }) => [
                styles.preSessionCoverChangeButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() =>
                openCoverChooser(
                  "preSession",
                  preSessionBook,
                  preSessionBookCoverCandidates,
                )
              }
            >
              <Ionicons
                name="images-outline"
                size={14}
                color="rgba(47,93,80,0.62)"
              />
              <ThemedText style={styles.preSessionCoverChangeButtonText}>
                Change cover
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.startHero,
            isEnteringReading && { opacity: 0.82 },
            pressed && styles.buttonPressed,
          ]}
          onPress={handlePress}
          disabled={isEnteringReading}
        >
          <View style={styles.startHeroContent}>
            <View style={styles.startHeroCopy}>
              <ThemedText
                style={styles.startHeroTitle}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.88}
              >
                Begin reading
              </ThemedText>
            </View>
          </View>
        </Pressable>

        {currentBookLastSessionWithNote ? (
          <View style={styles.lastBookMoment}>
            <ThemedText style={styles.lastBookMomentTitle}>
              Last note with this book
            </ThemedText>
            <ThemedText style={styles.lastBookMomentText} numberOfLines={2}>
              {currentBookLastSessionNote}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.homeShortcutStack}>
          <ThemedText style={styles.homeLibraryLabel}>Library</ThemedText>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.homeShortcutCard,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => openHomeDestination("diary")}
          >
            <View style={styles.homeShortcutDestinationRow}>
              <View style={styles.homeShortcutLabelGroup}>
                <ThemedText style={styles.homeShortcutTitle}>Diary</ThemedText>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color="rgba(47,93,80,0.22)"
                style={styles.homeShortcutChevron}
              />
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.homeShortcutCard,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => openHomeDestination("finishedBooks")}
          >
            <View style={styles.homeShortcutDestinationRow}>
              <View style={styles.homeShortcutLabelGroup}>
                <ThemedText style={styles.homeShortcutTitle}>
                  Shelf
                </ThemedText>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color="rgba(47,93,80,0.22)"
                style={styles.homeShortcutChevron}
              />
            </View>
          </Pressable>
        </View>

        {sessionMessage && (
          <ThemedView style={styles.sessionToast}>
            <ThemedText
              accessibilityLiveRegion="polite"
              style={styles.sessionToastText}
            >
              {sessionMessage}
            </ThemedText>
          </ThemedView>
        )}

        <Pressable
          accessibilityRole="button"
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
                size={16}
                color="rgba(47,93,80,0.72)"
              />
            </View>
            <View style={styles.manualLogButtonCopy}>
              <ThemedText style={styles.manualLogButtonText}>
                Already read? Save a moment
              </ThemedText>
              <ThemedText style={styles.manualLogButtonSubtext}>
                For reading without the timer.
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
    </Animated.ScrollView>
    <Modal
      visible={isPreSessionBookChooserVisible}
      transparent
      animationType="fade"
      onRequestClose={closePreSessionBookChooser}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.preSessionSheetKeyboardView}
      >
        <Pressable
          style={styles.preSessionSheetBackdrop}
          onPress={closePreSessionBookChooser}
        >
          <Pressable
            accessibilityViewIsModal
            accessibilityLabel="Choose a book"
            style={styles.preSessionSheet}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.preSessionSheetHandle} />
            <View style={styles.preSessionSheetHeader}>
              <View style={styles.preSessionSheetCopy}>
                <ThemedText style={styles.preSessionSheetTitle}>
                  What are you reading?
                </ThemedText>
                <ThemedText style={styles.preSessionSheetSubcopy}>
                  Choose now, or add it after your session.
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close book chooser"
                style={({ pressed }) => [
                  styles.preSessionSheetCloseButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={closePreSessionBookChooser}
              >
                <Ionicons
                  name="close"
                  size={18}
                  color="rgba(47,93,80,0.62)"
                />
              </Pressable>
            </View>

            <View style={styles.preSessionSearchBox}>
              <Ionicons
                name="search-outline"
                size={16}
                color="rgba(47,93,80,0.46)"
              />
              <TextInput
                value={preSessionBookQuery}
                onChangeText={setPreSessionBookQuery}
                placeholder="Search for a book"
                placeholderTextColor="rgba(31,41,51,0.36)"
                autoCorrect={false}
                returnKeyType="search"
                style={styles.preSessionSearchInput}
              />
              {preSessionBookQuery.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear book search"
                  style={({ pressed }) => [
                    styles.preSessionSearchClearButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={resetPreSessionBookSearch}
                >
                  <Ionicons
                    name="close-circle"
                    size={16}
                    color="rgba(47,93,80,0.42)"
                  />
                </Pressable>
              ) : null}
            </View>

            <ScrollView
              style={styles.preSessionSheetResultsScroll}
              contentContainerStyle={styles.preSessionSheetResultsContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.preSessionBookList}>
                {shouldShowPreSessionBookSearchResults ? (
                  <>
                    {isPreSessionBookSearchLoading ? (
                      <ThemedText style={styles.preSessionSheetEmpty}>
                        Looking through the shelves...
                      </ThemedText>
                    ) : null}
                    {preSessionBookSearchResults.map((book) => {
                      const bookAuthor = getDisplayableAuthor(book.author);
                      const coverUrl = normalizeStoredCoverUrl(book.coverUrl);

                      return (
                        <Pressable
                          accessibilityRole="button"
                          key={
                            book.googleBooksId ??
                            `${book.title.trim().toLowerCase()}-${bookAuthor ?? ""}`
                          }
                          style={({ pressed }) => [
                            styles.preSessionBookChoice,
                            pressed && styles.buttonPressed,
                          ]}
                          onPress={() => selectPreSessionGoogleBook(book)}
                        >
                          <View style={styles.preSessionBookCover}>
                            {coverUrl ? (
                              <Image
                                source={{ uri: coverUrl }}
                                style={styles.preSessionBookCoverImage}
                                resizeMode="cover"
                              />
                            ) : (
                              <ThemedText style={styles.preSessionBookCoverText}>
                                R
                              </ThemedText>
                            )}
                          </View>
                          <View style={styles.preSessionBookCopy}>
                            <ThemedText
                              style={styles.preSessionBookTitle}
                              numberOfLines={1}
                            >
                              {book.title}
                            </ThemedText>
                            {bookAuthor ? (
                              <ThemedText
                                style={styles.preSessionBookAuthor}
                                numberOfLines={1}
                              >
                                {bookAuthor}
                              </ThemedText>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })}
                    {!isPreSessionBookSearchLoading &&
                    hasPreSessionBookSearchSearched &&
                    preSessionBookSearchResults.length === 0 ? (
                      <ThemedText style={styles.preSessionSheetEmpty}>
                        {preSessionBookSearchError
                          ? "Search is resting for a moment. Try again soon."
                          : "No books found yet. Try the title and author together."}
                      </ThemedText>
                    ) : null}
                  </>
                ) : !isSearchingPreSessionBooks &&
                  preSessionBookChoices.length > 0 ? (
                  preSessionBookChoices.map((book) => {
                    const isSelected =
                      preSessionBookTitle?.toLowerCase() ===
                      book.title.trim().toLowerCase();
                    const bookAuthor = getDisplayableAuthor(book.author);
                    const coverUrl = normalizeStoredCoverUrl(book.coverUrl);

                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={book.title.trim().toLowerCase()}
                        style={({ pressed }) => [
                          styles.preSessionBookChoice,
                          isSelected && styles.preSessionBookChoiceSelected,
                          pressed && styles.buttonPressed,
                        ]}
                        onPress={() => selectKnownPreSessionBook(book)}
                      >
                        <View style={styles.preSessionBookCover}>
                          {coverUrl ? (
                            <Image
                              source={{ uri: coverUrl }}
                              style={styles.preSessionBookCoverImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <ThemedText style={styles.preSessionBookCoverText}>
                              R
                            </ThemedText>
                          )}
                        </View>
                        <View style={styles.preSessionBookCopy}>
                          <ThemedText
                            style={styles.preSessionBookTitle}
                            numberOfLines={1}
                          >
                            {book.title}
                          </ThemedText>
                          {bookAuthor ? (
                            <ThemedText
                              style={styles.preSessionBookAuthor}
                              numberOfLines={1}
                            >
                              {bookAuthor}
                            </ThemedText>
                          ) : null}
                        </View>
                        {isSelected ? (
                          <Ionicons
                            name="checkmark"
                            size={18}
                            color="rgba(47,93,80,0.76)"
                          />
                        ) : null}
                      </Pressable>
                    );
                  })
                ) : !isSearchingPreSessionBooks ? (
                  <ThemedText style={styles.preSessionSheetEmpty}>
                    Recent books will appear here after you save a reading moment.
                  </ThemedText>
                ) : (
                  <ThemedText style={styles.preSessionSheetEmpty}>
                    Type a little more to search.
                  </ThemedText>
                )}
              </View>

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.preSessionContinueButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={clearPreSessionBook}
              >
                <ThemedText style={styles.preSessionContinueButtonText}>
                  Continue without choosing
                </ThemedText>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
    {coverChooserModal}
    </>
      );
  }
}

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
    gap: 12,
    backgroundColor: colors.background,
  },
  homeCanvasGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  warmVignetteTop: {
    position: "absolute",
    top: -150,
    left: -80,
    right: -80,
    height: 340,
    borderRadius: 190,
    backgroundColor: "rgba(255,255,255,0.22)",
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
    paddingHorizontal: 30,
    paddingTop: 72,
    paddingBottom: 42,
    justifyContent: "flex-start",
    overflow: "hidden",
  },
  welcomeContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    backgroundColor: "transparent",
    paddingVertical: 54,
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
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "transparent",
    paddingVertical: 18,
    borderWidth: 0,
    borderColor: "transparent",
    minHeight: 488,
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
    ...typography.role.wordmark,
    color: "#173826",
    fontSize: 56,
    lineHeight: 62,
    textAlign: "center",
    marginTop: 18,
  },
  welcomeTitleBlock: {
    alignItems: "center",
    backgroundColor: "transparent",
    gap: 12,
    marginVertical: 28,
    maxWidth: 292,
    paddingHorizontal: 4,
  },
  welcomeTitle: {
    ...typography.role.helper,
    color: "rgba(31,41,51,0.66)",
    fontSize: 17,
    lineHeight: 25,
    textAlign: "center",
    marginTop: 0,
    maxWidth: 286,
  },
  welcomeSubtitle: {
    ...typography.role.helper,
    color: "rgba(31,41,51,0.72)",
    fontSize: 18,
    lineHeight: 27,
    textAlign: "center",
    fontStyle: "italic",
    marginTop: 0,
    marginBottom: 12,
    maxWidth: 286,
  },
  welcomeBody: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.50)",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "left",
    maxWidth: 274,
    flex: 1,
  },
  welcomeAssuranceList: {
    width: "100%",
    gap: 13,
    marginTop: 8,
  },
  welcomeAssuranceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },
  welcomeFootnote: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.44)",
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 6,
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
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.14)",
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 30,
    minHeight: 52,
    minWidth: 148,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  welcomeButtonText: {
    ...typography.role.button,
    color: "#FFF8ED",
    fontSize: 15,
    lineHeight: 20,
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
    ...typography.role.button,
    color: "rgba(47,93,80,0.68)",
    fontSize: 12,
    lineHeight: 16,
  },
  appName: {
    ...typography.role.wordmark,
    fontSize: 44,
    lineHeight: 48,
    color: "#1B2A22",
  },
  headerSubtitle: {
    ...typography.role.metadata,
    fontSize: 14,
    lineHeight: 20,
    color: colors.mutedText,
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
    minHeight: 72,
    marginTop: 8,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: "rgba(23,56,38,0.18)",
    borderRadius: RousdRadii.control,
    paddingVertical: 13,
    paddingHorizontal: 24,
    justifyContent: "center",
    shadowColor: "#315F52",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
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
    alignItems: "center",
  },
  startHeroTitle: {
    ...typography.role.button,
    color: "#FFF8ED",
    fontSize: 20,
    lineHeight: 27,
    flexShrink: 1,
    textAlign: "center",
  },
  startHeroHelper: {
    ...typography.role.helper,
    color: "rgba(47,93,80,0.52)",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
    textAlign: "center",
    flexShrink: 1,
  },
  preSessionReadingSelector: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 0,
    width: "100%",
    maxWidth: 342,
    paddingHorizontal: 24,
    paddingVertical: 10,
    shadowOpacity: 0,
    elevation: 0,
    zIndex: 3,
  },
  preSessionReadingSelectorEmpty: {
    paddingVertical: 10,
  },
  homeReadingSelectorWrap: {
    backgroundColor: "transparent",
    marginTop: 30,
    marginBottom: 16,
    alignItems: "center",
    zIndex: 3,
  },
  homeReadingSelectorWrapEmpty: {
    marginBottom: 4,
  },
  preSessionCoverChangeButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    marginTop: -4,
    borderRadius: 999,
    backgroundColor: "rgba(47,93,80,0.055)",
  },
  preSessionCoverChangeButtonText: {
    ...typography.role.button,
    color: "rgba(47,93,80,0.68)",
    fontSize: 12,
    lineHeight: 17,
  },
  preSessionReadingEyebrow: {
    ...typography.role.metadata,
    color: "rgba(47,93,80,0.52)",
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.45,
    textAlign: "center",
    marginBottom: 10,
  },
  preSessionReadingCameoFrame: {
    width: 54,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#EFECE6",
    borderWidth: 1,
    borderColor: "rgba(58,46,43,0.08)",
    shadowColor: "#3A2E2B",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 1,
    marginBottom: 12,
  },
  preSessionReadingCameoFrameEmpty: {
    marginBottom: 10,
  },
  preSessionReadingCameo: {
    width: 48,
    height: 70,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(47,93,80,0.12)",
    borderWidth: 1,
    borderColor: "rgba(58,46,43,0.075)",
  },
  preSessionReadingCameoImage: {
    width: 48,
    height: 70,
  },
  preSessionReadingCameoMark: {
    ...typography.role.bookTitle,
    color: "rgba(47,93,80,0.58)",
    fontSize: 18,
    lineHeight: 24,
  },
  preSessionReadingTitle: {
    ...typography.role.bookTitle,
    color: colors.text,
    fontSize: 25,
    lineHeight: 31,
    textAlign: "center",
    maxWidth: 294,
  },
  preSessionReadingTitleEmpty: {
    color: "rgba(31,41,51,0.74)",
    fontSize: 23,
    lineHeight: 29,
  },
  preSessionReadingTitleLong: {
    fontSize: 21,
    lineHeight: 27,
    maxWidth: 282,
  },
  preSessionReadingHelper: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.50)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    textAlign: "center",
    maxWidth: 276,
  },
  preSessionReadingHelperEmpty: {
    ...typography.role.helper,
    color: "rgba(31,41,51,0.50)",
    fontSize: 12,
    lineHeight: 18,
  },
  preSessionReadingHelperRowEmpty: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "transparent",
    marginTop: 6,
    maxWidth: 282,
  },
  preSessionReadingTapLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "transparent",
    marginTop: 10,
  },
  preSessionReadingTapText: {
    ...typography.role.metadata,
    color: "rgba(47,93,80,0.58)",
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.3,
    textAlign: "center",
  },
  lastBookMoment: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderLeftWidth: 2,
    borderLeftColor: "rgba(196,148,90,0.55)",
    borderRadius: 0,
    paddingVertical: 6,
    paddingLeft: 16,
    paddingRight: 4,
    marginTop: 18,
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
    ...typography.role.label,
    flex: 1,
    minWidth: 0,
    color: "rgba(31,41,51,0.74)",
    fontSize: 14,
    lineHeight: 20,
  },
  lastBookMomentDate: {
    ...typography.role.metadata,
    color: "rgba(47,93,80,0.52)",
    fontSize: 11,
    lineHeight: 16,
  },
  lastBookMomentText: {
    ...typography.role.body,
    color: "rgba(31,41,51,0.58)",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  manualLogButton: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 0,
    minHeight: 62,
    paddingVertical: 16,
    paddingHorizontal: 2,
    zIndex: 3,
  },
  manualLogButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "transparent",
  },
  manualLogButtonIcon: {
    width: 24,
    height: 24,
    borderRadius: 0,
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
    ...typography.role.button,
    color: colors.accentDark,
    fontSize: 13,
    lineHeight: 19,
  },
  manualLogButtonSubtext: {
    ...typography.role.helper,
    color: "rgba(31,41,51,0.52)",
    fontSize: 10,
    lineHeight: 15,
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
    ...typography.role.label,
    fontSize: 15,
    lineHeight: 21,
    color: colors.success,
    textAlign: "center",
  },
  preSessionSheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(25,38,32,0.30)",
  },
  preSessionSheetKeyboardView: {
    flex: 1,
  },
  preSessionSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 24,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.09)",
  },
  preSessionSheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(47,93,80,0.18)",
    marginBottom: 16,
  },
  preSessionSheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: "transparent",
    marginBottom: 12,
  },
  preSessionSheetCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  preSessionSheetTitle: {
    ...typography.role.pageTitle,
    color: colors.text,
    fontSize: 24,
    lineHeight: 31,
  },
  preSessionSheetSubcopy: {
    ...typography.role.body,
    color: "rgba(31,41,51,0.58)",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
  },
  preSessionSheetCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginTop: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,248,237,0.62)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
  },
  preSessionSearchBox: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "transparent",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.12)",
    paddingHorizontal: 2,
    marginTop: 4,
    marginBottom: 10,
  },
  preSessionSearchInput: {
    ...typography.role.metadata,
    flex: 1,
    minWidth: 0,
    color: "rgba(31,41,51,0.72)",
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 9,
  },
  preSessionSearchClearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  preSessionBookList: {
    backgroundColor: "transparent",
    marginTop: 6,
  },
  preSessionSheetResultsScroll: {
    maxHeight: 296,
    backgroundColor: "transparent",
  },
  preSessionSheetResultsContent: {
    paddingBottom: 12,
    backgroundColor: "transparent",
  },
  preSessionBookChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "transparent",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.055)",
    paddingVertical: 13,
  },
  preSessionBookChoiceSelected: {
    backgroundColor: "rgba(47,93,80,0.045)",
    borderRadius: 14,
    borderBottomColor: "transparent",
    paddingHorizontal: 9,
  },
  preSessionBookCover: {
    width: 36,
    height: 50,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(47,93,80,0.12)",
  },
  preSessionBookCoverImage: {
    width: "100%",
    height: "100%",
  },
  preSessionBookCoverText: {
    ...typography.role.bookTitle,
    color: colors.accent,
    fontSize: 15,
    lineHeight: 20,
  },
  preSessionBookCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  preSessionBookTitle: {
    ...typography.role.metadata,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  preSessionBookAuthor: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.52)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  preSessionSheetEmpty: {
    ...typography.role.body,
    color: "rgba(31,41,51,0.50)",
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 14,
  },
  preSessionContinueButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    paddingVertical: 14,
    marginTop: 9,
  },
  preSessionContinueButtonText: {
    ...typography.role.button,
    color: "rgba(47,93,80,0.66)",
    fontSize: 14,
    lineHeight: 20,
  },
  coverChooserBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(25,38,32,0.34)",
  },
  coverChooserSheet: {
    maxHeight: "82%",
    backgroundColor: colors.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 22,
    paddingBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.09)",
  },
  coverChooserHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(47,93,80,0.18)",
    marginBottom: 16,
  },
  coverChooserHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: "transparent",
  },
  coverChooserHeaderCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  coverChooserTitle: {
    ...typography.role.pageTitle,
    color: colors.text,
    fontSize: 24,
    lineHeight: 31,
  },
  coverChooserBookTitle: {
    ...typography.role.bookTitle,
    color: "rgba(31,41,51,0.68)",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  coverChooserCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,248,237,0.62)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
  },
  coverChooserHelper: {
    ...typography.role.body,
    color: "rgba(31,41,51,0.52)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
    marginBottom: 14,
  },
  coverChooserScroll: {
    maxHeight: 430,
    backgroundColor: "transparent",
  },
  coverChooserGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 4,
    paddingBottom: 14,
    backgroundColor: "transparent",
  },
  coverChooserOption: {
    width: 88,
    minHeight: 132,
    padding: 5,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: "transparent",
  },
  coverChooserOptionSelected: {
    borderColor: "rgba(47,93,80,0.62)",
    backgroundColor: "rgba(47,93,80,0.055)",
  },
  coverChooserImageFrame: {
    width: 72,
    height: 108,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.12)",
    borderWidth: 1,
    borderColor: "rgba(58,46,43,0.08)",
  },
  coverChooserImage: {
    width: "100%",
    height: "100%",
  },
  coverChooserFallback: {
    ...typography.role.bookTitle,
    color: "rgba(47,93,80,0.58)",
    fontSize: 20,
    lineHeight: 26,
  },
  coverChooserSelectedBadge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.background,
  },
  homeShortcutStack: {
    flexDirection: "column",
    gap: 0,
    backgroundColor: "transparent",
    marginTop: 24,
    zIndex: 3,
  },
  homeLibraryLabel: {
    ...typography.role.label,
    width: "100%",
    color: "rgba(47,93,80,0.55)",
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  homeShortcutCard: {
    width: "100%",
    minHeight: 58,
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.09)",
    borderRadius: 0,
    paddingVertical: 16,
    paddingHorizontal: 2,
    shadowOpacity: 0,
    elevation: 0,
  },
  homeShortcutDestinationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
    backgroundColor: "transparent",
  },
  homeShortcutLabelGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
    backgroundColor: "transparent",
  },
  homeShortcutTitle: {
    ...typography.role.bookTitle,
    flex: 1,
    minWidth: 0,
    color: colors.accentDark,
    fontSize: 13,
    lineHeight: 18,
  },
  homeShortcutChevron: {
    marginLeft: 0,
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
    marginTop: 34,
    marginBottom: -2,
    zIndex: 2,
  },
  sessionsViewAllButton: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  sessionsViewAllText: {
    ...typography.role.button,
    color: "rgba(47,93,80,0.58)",
    fontSize: 12,
    lineHeight: 17,
  },
  sessionsTitle: {
    ...typography.role.label,
    fontSize: 12,
    lineHeight: 17,
    color: "rgba(31,41,51,0.46)",
  },
  sessionsCard: {
    backgroundColor: "transparent",
    borderRadius: 0,
    overflow: "visible",
    borderWidth: 0,
    borderColor: "transparent",
  },
  emptySessionsText: {
    ...typography.role.helper,
    color: "rgba(107,114,128,0.68)",
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 14,
    paddingHorizontal: 2,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    paddingHorizontal: 2,
    borderBottomWidth: 0,
    borderBottomColor: "transparent",
    backgroundColor: "transparent",
  },
  lastSessionRow: {
    borderBottomWidth: 0,
  },
  sessionIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(221,235,228,0.62)",
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
    backgroundColor: "transparent",
  },
  sessionBookTitle: {
    ...typography.role.metadata,
    fontSize: 14,
    lineHeight: 19,
    color: "rgba(31,41,51,0.82)",
  },
  sessionDate: {
    ...typography.role.metadata,
    fontSize: 11,
    lineHeight: 16,
    color: "rgba(107,114,128,0.78)",
    marginTop: 2,
  },
  sessionNote: {
    ...typography.role.body,
    color: "rgba(107,114,128,0.78)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 5,
  },
  sessionMinutes: {
    ...typography.role.label,
    fontSize: 13,
    lineHeight: 18,
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
  },
  diaryUndoCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,248,237,0.72)",
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.08)",
    borderRadius: RousdRadii.control,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 18,
  },
  diaryUndoText: {
    ...typography.role.helper,
    color: "rgba(31,41,51,0.62)",
    fontSize: 18,
    lineHeight: 24,
  },
  diaryUndoButtonText: {
    ...typography.role.button,
    color: colors.accent,
    fontSize: 14,
    lineHeight: 19,
  },
  diaryBackButton: {
    alignSelf: "flex-start",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 0,
    paddingVertical: 6,
    paddingHorizontal: 0,
    marginBottom: 30,
  },
  diaryBackButtonText: {
    color: "rgba(47,93,80,0.68)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
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
  privacyContent: {
    paddingHorizontal: 24,
  },
  privacyCard: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 0,
    paddingVertical: 6,
    paddingHorizontal: 0,
    marginTop: 28,
  },
  privacySection: {
    paddingVertical: 16,
  },
  privacySectionTitle: {
    ...typography.role.button,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  privacySectionBody: {
    ...typography.role.body,
    color: "rgba(31,41,51,0.62)",
    fontSize: 14,
    lineHeight: 22,
    marginTop: 5,
  },
  privacyDivider: {
    height: 1,
    backgroundColor: "transparent",
  },
  privacyPolicyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.12)",
    paddingVertical: 16,
    marginTop: 12,
  },
  privacyPolicyButtonText: {
    ...typography.role.button,
    color: colors.accent,
    fontSize: 14,
    lineHeight: 20,
  },
  privacyEraseSection: {
    marginTop: 34,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: "rgba(180,83,58,0.12)",
  },
  privacyEraseTitle: {
    ...typography.role.button,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  privacyEraseBody: {
    ...typography.role.body,
    color: "rgba(31,41,51,0.58)",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
  },
  privacyEraseButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(180,83,58,0.28)",
    borderRadius: RousdRadii.control,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  privacyEraseButtonText: {
    ...typography.role.button,
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  menuBackButtonText: {
    ...typography.role.button,
  },
  menuEyebrow: {
    ...typography.role.label,
    color: "rgba(47,93,80,0.58)",
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  menuTitle: {
    ...typography.role.pageTitle,
    color: "#1B2A22",
    fontSize: 42,
    lineHeight: 48,
    letterSpacing: -0.7,
    marginTop: 8,
  },
  menuSubtitle: {
    ...typography.role.helper,
    color: "rgba(47,93,80,0.54)",
    fontSize: 16,
    lineHeight: 23,
    marginTop: 8,
  },
  menuCardStack: {
    gap: 8,
    marginTop: 30,
    backgroundColor: "transparent",
  },
  menuNavCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: 0,
    paddingVertical: 14,
    paddingHorizontal: 0,
  },
  menuPrimaryNavCard: {
    minHeight: 76,
  },
  menuSecondaryNavCard: {
    minHeight: 52,
    marginTop: 12,
  },
  menuNavCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  menuNavTitle: {
    ...typography.role.bookTitle,
    color: colors.text,
    fontSize: 19,
    lineHeight: 25,
  },
  menuNavSubtext: {
    ...typography.role.helper,
    color: "rgba(31,41,51,0.54)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  menuEarlierReadingTitle: {
    ...typography.role.button,
    color: "rgba(31,41,51,0.76)",
    fontSize: 15,
    lineHeight: 21,
  },
  menuUtilityGroup: {
    marginTop: 30,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(47,93,80,0.08)",
  },
  menuFeedbackCard: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: 0,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 11,
    paddingHorizontal: 0,
  },
  menuFeedbackTitle: {
    ...typography.role.button,
    color: "rgba(31,41,51,0.62)",
    fontSize: 14,
    lineHeight: 20,
  },
  diaryTitle: {
    ...typography.role.pageTitle,
    color: "#1B2A22",
    fontSize: 40,
    lineHeight: 47,
    letterSpacing: -0.7,
  },
  diarySubtitle: {
    ...typography.role.helper,
    color: "rgba(47,93,80,0.54)",
    fontSize: 16,
    lineHeight: 23,
    marginTop: 8,
  },
  diaryEmptyCard: {
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    borderColor: "transparent",
    paddingVertical: 22,
    paddingHorizontal: 0,
    marginTop: 36,
  },
  diaryEmptyText: {
    ...typography.role.bookTitle,
    color: "rgba(47,93,80,0.58)",
    fontSize: 16,
    lineHeight: 24,
  },
  diaryEmptySubtext: {
    ...typography.role.helper,
    color: "rgba(31,41,51,0.52)",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  diaryTimeline: {
    marginTop: 34,
    backgroundColor: "transparent",
  },
  diaryEntryGroup: {
    backgroundColor: "transparent",
    marginBottom: 26,
  },
  diaryDateHeader: {
    ...typography.role.label,
    color: "rgba(47,93,80,0.54)",
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  diaryEntryCard: {
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    paddingTop: 6,
    paddingBottom: 2,
    paddingHorizontal: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  diaryEntryTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: "transparent",
  },
  diaryEntryCover: {
    width: 42,
    height: 60,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: colors.sessionBackground,
  },
  diaryEntryCoverImage: {
    width: "100%",
    height: "100%",
  },
  readingMomentCoverMarkSmall: {
    ...typography.role.bookTitle,
    color: "#FFF8ED",
    fontSize: 17,
    lineHeight: 22,
    textAlign: "center",
  },
  diaryEntryCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  diaryBookTitle: {
    ...typography.role.bookTitle,
    color: colors.text,
    fontSize: 18,
    lineHeight: 25,
  },
  diaryMeta: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.44)",
    fontSize: 12,
    lineHeight: 18,
  },
  diaryMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "transparent",
    marginTop: 10,
  },
  diaryMetaSeparator: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.22)",
    fontSize: 12,
    lineHeight: 18,
  },
  diaryDuration: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.44)",
    fontSize: 12,
    lineHeight: 18,
  },
  diaryOptionsButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    marginTop: -9,
    marginRight: -10,
  },
  diaryReflection: {
    fontFamily: typography.fontFamily.serifRegular,
    fontWeight: "400",
    fontStyle: "italic",
    color: "rgba(31,42,46,0.76)",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
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
  finishedBooksTitle: {
    ...typography.role.pageTitle,
    color: "#1A1A14",
    fontSize: 40,
    lineHeight: 47,
    letterSpacing: -0.7,
  },
  finishedBooksSubtitle: {
    ...typography.role.helper,
    color: "#8A8578",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 7,
  },
  finishedBooksEmptyState: {
    marginTop: 48,
    paddingVertical: 18,
    backgroundColor: "transparent",
  },
  finishedBooksEmptyText: {
    ...typography.role.bookTitle,
    color: "rgba(47,93,80,0.62)",
    fontSize: 18,
    lineHeight: 26,
  },
  finishedBooksEmptySubtext: {
    ...typography.role.helper,
    color: "rgba(31,41,51,0.50)",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 7,
  },
  finishedBooksShelf: {
    marginTop: 36,
    backgroundColor: "transparent",
  },
  finishedBookCard: {
    flexDirection: "row",
    gap: 16,
    backgroundColor: "transparent",
    paddingVertical: 17,
  },
  finishedBookCover: {
    width: 60,
    height: 84,
    borderRadius: 5,
    backgroundColor: colors.sessionBackground,
    alignItems: "center",
    justifyContent: "center",
    padding: 7,
    overflow: "hidden",
  },
  finishedBookCoverAlt: {
    backgroundColor: "#1E3A2C",
  },
  finishedBookCoverImage: {
    width: "100%",
    height: "100%",
    borderRadius: 5,
  },
  finishedBookCoverTitle: {
    ...typography.role.bookTitle,
    color: "#F0EBE0",
    width: "100%",
    fontSize: 18,
    lineHeight: 24,
    textAlign: "center",
  },
  finishedBookCopy: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent",
  },
  finishedBookOpenIcon: {
    alignSelf: "center",
    marginLeft: -6,
  },
  finishedBookTitle: {
    ...typography.role.bookTitle,
    color: "#1A1A14",
    fontSize: 17,
    lineHeight: 23,
  },
  finishedBookDate: {
    ...typography.role.metadata,
    color: "rgba(90,84,72,0.54)",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 9,
  },
  finishedBookReview: {
    ...typography.role.prose,
    fontFamily: typography.fontFamily.serifRegular,
    fontStyle: "normal",
    color: "rgba(31,41,51,0.66)",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  finishedBookDetailContent: {
    paddingHorizontal: 24,
  },
  finishedBookDetailBackButton: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    paddingHorizontal: 2,
    paddingVertical: 8,
    marginBottom: 18,
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
    ...typography.role.bookTitle,
    color: "#F0EBE0",
    width: "100%",
    fontSize: 14,
    lineHeight: 18,
    textAlign: "center",
  },
  finishedBookDetailTitle: {
    ...typography.role.pageTitle,
    color: "#1A1A14",
    fontSize: 28,
    lineHeight: 35,
    letterSpacing: 0,
    textAlign: "center",
    marginTop: 24,
  },
  finishedBookDetailAuthor: {
    ...typography.role.metadata,
    color: "#8A8578",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  finishedBookDetailFinishedDate: {
    ...typography.role.metadata,
    color: "rgba(90,84,72,0.46)",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 8,
    textAlign: "center",
  },
  finishedBookDetailMemoryLine: {
    ...typography.role.metadata,
    color: "rgba(90,84,72,0.48)",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  finishedBookDetailMetaCard: {
    backgroundColor: "rgba(255,248,237,0.30)",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 28,
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
    ...typography.role.metadata,
    color: "rgba(90,84,72,0.58)",
    fontSize: 12,
    lineHeight: 17,
  },
  finishedBookDetailMetaValue: {
    ...typography.role.metadata,
    color: "rgba(26,26,20,0.72)",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "right",
  },
  finishedBookDetailMetaDivider: {
    height: 1,
    backgroundColor: "rgba(47,93,80,0.035)",
  },
  finishedBookDetailReviewCard: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 0,
    paddingVertical: 2,
    paddingHorizontal: 2,
    marginTop: 30,
  },
  finishedBookDetailReviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 10,
  },
  finishedBookDetailReviewLabel: {
    ...typography.role.metadata,
    color: "rgba(47,93,80,0.58)",
    fontSize: 12,
    lineHeight: 18,
  },
  finishedBookDetailReview: {
    ...typography.role.prose,
    fontFamily: typography.fontFamily.serifRegular,
    fontStyle: "normal",
    color: "rgba(62,58,50,0.84)",
    fontSize: 17,
    lineHeight: 28,
  },
  finishedBookNoteInput: {
    ...typography.role.prose,
    fontFamily: typography.fontFamily.serifRegular,
    fontStyle: "normal",
    minHeight: 112,
    color: colors.text,
    fontSize: 16,
    lineHeight: 25,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.12)",
    borderRadius: RousdRadii.control,
    backgroundColor: "rgba(255,248,237,0.54)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  finishedBookDetailActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 12,
  },
  finishedBookDetailSecondaryAction: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  finishedBookDetailSecondaryText: {
    ...typography.role.button,
    color: "rgba(47,93,80,0.65)",
    fontSize: 14,
    lineHeight: 20,
  },
  finishedBookDetailPrimaryAction: {
    backgroundColor: colors.accent,
    borderRadius: RousdRadii.control,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  finishedBookDetailPrimaryText: {
    ...typography.role.button,
    color: "#FFF8ED",
    fontSize: 14,
    lineHeight: 20,
  },
  finishedBookNoteEditText: {
    ...typography.role.button,
    color: "rgba(47,93,80,0.66)",
    fontSize: 12,
    lineHeight: 18,
  },
  finishedBookNoteEditButton: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  finishedBookAddNoteButton: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 2,
    marginTop: 26,
  },
  finishedBookAddNoteText: {
    ...typography.role.button,
    color: "rgba(47,93,80,0.68)",
    fontSize: 13,
    lineHeight: 19,
  },
  finishedBookHistory: {
    marginTop: 38,
    borderTopWidth: 1,
    borderTopColor: "rgba(47,93,80,0.06)",
  },
  finishedBookHistoryIntro: {
    paddingTop: 20,
    paddingBottom: 10,
  },
  finishedBookHistoryTitle: {
    ...typography.role.bookTitle,
    color: "rgba(31,41,51,0.76)",
    fontSize: 18,
    lineHeight: 25,
  },
  finishedBookHistoryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.04)",
    paddingVertical: 14,
  },
  finishedBookHistoryCopy: {
    flex: 1,
    minWidth: 0,
  },
  finishedBookHistoryDate: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.50)",
    fontSize: 13,
    lineHeight: 18,
  },
  finishedBookHistoryNote: {
    ...typography.role.prose,
    color: "rgba(31,41,51,0.68)",
    fontSize: 14,
    lineHeight: 22,
    marginTop: 6,
  },
  finishedBookHistoryDuration: {
    ...typography.role.metadata,
    color: "rgba(47,93,80,0.46)",
    fontSize: 13,
    lineHeight: 18,
  },
  finishedBookRemoveButton: {
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 30,
  },
  finishedBookRemoveText: {
    ...typography.role.button,
    color: "rgba(180,83,58,0.72)",
    fontSize: 13,
    lineHeight: 19,
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
    ...typography.role.label,
    color: "#C4945A",
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  finishedBooksNextBody: {
    ...typography.role.helper,
    color: "#5A5448",
    fontSize: 13,
    lineHeight: 20,
  },
  sessionScreen: {
    flex: 1,
    backgroundColor: "#06130F",
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
    ...typography.role.label,
    color: "rgba(255,248,237,0.54)",
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    textAlign: "center",
    marginTop: 34,
  },
  quietSessionTitle: {
    ...typography.role.pageTitle,
    color: "#FFF8ED",
    fontSize: 36,
    lineHeight: 44,
    textAlign: "center",
    letterSpacing: -0.4,
    marginTop: 18,
    maxWidth: 320,
  },
  quietSessionSubtitle: {
    ...typography.role.helper,
    color: "rgba(255,248,237,0.62)",
    fontSize: 17,
    lineHeight: 25,
    marginTop: 10,
    textAlign: "center",
  },
  quietBottomArea: {
    alignItems: "center",
    backgroundColor: "transparent",
  },
  quietEndSessionButton: {
    minWidth: 176,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.14)",
    backgroundColor: "rgba(255,248,237,0.025)",
  },
  quietEndSessionText: {
    ...typography.role.button,
    color: "rgba(255,248,237,0.66)",
    fontSize: 14,
    lineHeight: 20,
  },
  ritualTransitionScreen: {
    flex: 1,
    backgroundColor: colors.sessionBackground,
    paddingHorizontal: 30,
    paddingTop: 80,
    paddingBottom: 46,
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
    fontWeight: "400",
    textAlign: "center",
    letterSpacing: 0,
    maxWidth: 310,
    fontFamily: serifFont,
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
    ...typography.role.pageTitle,
    color: "#FFF8EE",
    fontSize: 28,
    lineHeight: 36,
    textAlign: "center",
    maxWidth: 320,
  },
  ritualLineBody: {
    ...typography.role.body,
    color: "rgba(255,248,237,0.68)",
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    marginTop: 12,
    maxWidth: 300,
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
    ...typography.role.metadata,
    color: "rgba(255,248,237,0.54)",
    fontSize: 11,
    lineHeight: 17,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 12,
  },
  closeTransitionTitle: {
    ...typography.role.pageTitle,
    color: "#FFF8ED",
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: -0.45,
    textAlign: "center",
  },
  closeTransitionMinutes: {
    ...typography.role.metadata,
    color: "rgba(255,248,237,0.58)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 16,
  },
  closeTransitionSubtext: {
    ...typography.role.body,
    color: "rgba(255,248,237,0.58)",
    fontSize: 15,
    lineHeight: 24,
    textAlign: "center",
    marginTop: 20,
    maxWidth: 292,
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
    paddingTop: 14,
    paddingBottom: 20,
  },
  manualLogScroll: {
    flex: 1,
  },
  manualLogBackButton: {
    marginBottom: 14,
  },
  manualLogBackButtonText: {
    color: "rgba(255,248,237,0.70)",
  },
  closeEyebrow: {
    ...typography.role.label,
    color: "rgba(255,248,237,0.62)",
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  closeTitle: {
    ...typography.role.pageTitle,
    color: "#FFF8ED",
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: 0,
    maxWidth: 330,
  },
  closeMinutes: {
    ...typography.role.helper,
    color: "rgba(255,248,237,0.62)",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 10,
    marginBottom: 18,
  },
  closeBookInput: {
    ...typography.role.body,
    backgroundColor: "rgba(255,248,237,0.11)",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.16)",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 18,
    lineHeight: 24,
    color: "#FFF8ED",
  },
  manualJournalInput: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,248,237,0.22)",
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 12,
  },
  manualTimeLabel: {
    ...typography.role.label,
    color: "rgba(255,248,237,0.58)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 22,
  },
  manualTimeInputRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 46,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,248,237,0.22)",
  },
  manualTimeOtherLabel: {
    ...typography.role.label,
    color: "rgba(255,248,237,0.58)",
    fontSize: 13,
    lineHeight: 18,
  },
  manualOptionalDividerLabel: {
    ...typography.role.metadata,
    color: "rgba(255,248,237,0.42)",
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginTop: 22,
    marginBottom: 8,
  },
  manualOptionalLabel: {
    ...typography.role.label,
    color: "rgba(255,248,237,0.58)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 0,
    marginBottom: 2,
  },
  manualTimeInput: {
    ...typography.role.body,
    flex: 1,
    minWidth: 72,
    color: "#FFF8ED",
    fontSize: 20,
    lineHeight: 26,
    paddingVertical: 10,
    textAlign: "right",
  },
  manualTimeSuffix: {
    ...typography.role.metadata,
    color: "rgba(255,248,237,0.54)",
    fontSize: 14,
    lineHeight: 20,
  },
  activeSessionError: {
    ...typography.role.helper,
    color: "rgba(255,217,199,0.86)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
    textAlign: "center",
    maxWidth: 280,
  },
  manualBookInput: {
    marginTop: 0,
  },
  manualBookInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  manualBookTitleInput: {
    ...typography.role.body,
    flex: 1,
    minWidth: 0,
    color: "#FFF8ED",
    fontSize: 18,
    lineHeight: 24,
    padding: 0,
  },
  manualBookClearButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,248,237,0.05)",
  },
  manualBookIdentityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.12)",
    borderRadius: 18,
    backgroundColor: "rgba(255,248,237,0.07)",
  },
  manualBookIdentityCover: {
    width: 48,
    height: 66,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,248,237,0.10)",
  },
  manualBookIdentityCoverImage: {
    width: "100%",
    height: "100%",
  },
  manualBookIdentityCoverFallback: {
    ...typography.role.bookTitle,
    color: "rgba(255,248,237,0.72)",
    fontSize: 18,
    lineHeight: 24,
  },
  manualBookIdentityCopy: {
    flex: 1,
    minWidth: 0,
  },
  manualBookIdentityActions: {
    alignItems: "flex-end",
    justifyContent: "center",
  },
  manualBookIdentityTitle: {
    ...typography.role.bookTitle,
    color: "#FFF8ED",
    fontSize: 16,
    lineHeight: 22,
  },
  manualBookIdentityAuthor: {
    ...typography.role.metadata,
    color: "rgba(255,248,237,0.54)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  manualBookIdentityChange: {
    minWidth: 52,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  manualBookIdentityChangeText: {
    ...typography.role.button,
    color: "rgba(255,248,237,0.68)",
    fontSize: 12,
    lineHeight: 17,
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
    ...typography.role.label,
    color: "rgba(255,248,237,0.78)",
    fontSize: 13,
    lineHeight: 18,
  },
  manualBookLookupLoading: {
    ...typography.role.prose,
    color: "rgba(255,248,237,0.50)",
    fontSize: 12,
    lineHeight: 17,
  },
  manualBookLookupHelperText: {
    ...typography.role.helper,
    color: "rgba(255,248,237,0.58)",
    fontSize: 12,
    lineHeight: 17,
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
    ...typography.role.bookTitle,
    color: "rgba(255,248,237,0.72)",
    fontSize: 14,
    lineHeight: 19,
  },
  manualBookLookupBookTitle: {
    ...typography.role.metadata,
    color: "#FFF8ED",
    fontSize: 14,
    lineHeight: 19,
  },
  manualBookLookupSelectedLabel: {
    ...typography.role.label,
    color: "rgba(255,248,237,0.68)",
    fontSize: 9,
    lineHeight: 13,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  manualBookLookupBookAuthor: {
    ...typography.role.metadata,
    color: "rgba(255,248,237,0.52)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  manualBookLookupEmptyText: {
    ...typography.role.prose,
    color: "rgba(255,248,237,0.58)",
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 8,
  },
  manualNoteWrapper: {
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,248,237,0.22)",
    paddingTop: 10,
  },
  manualNoteLabel: {
    ...typography.role.label,
    color: "rgba(255,248,237,0.58)",
    fontSize: 12,
    lineHeight: 17,
  },
  manualNoteInput: {
    ...typography.role.body,
    minHeight: 56,
    color: "#FFF8ED",
    fontSize: 16,
    lineHeight: 24,
    paddingHorizontal: 0,
    paddingTop: 6,
    paddingBottom: 10,
  },
  manualPresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    backgroundColor: "transparent",
    marginTop: 14,
    marginBottom: 12,
  },
  manualPresetChip: {
    backgroundColor: "rgba(255,248,237,0.02)",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 999,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  manualPresetChipSelected: {
    backgroundColor: "rgba(255,248,237,0.76)",
    borderWidth: 1,
    borderColor: "rgba(255,248,237,0.34)",
  },
  manualPresetChipText: {
    ...typography.role.button,
    color: "rgba(255,248,237,0.66)",
    fontSize: 14,
    lineHeight: 19,
  },
  manualPresetChipTextSelected: {
    color: colors.sessionBackground,
  },
  manualLogError: {
    ...typography.role.label,
    color: "#FFD9C7",
    fontSize: 14,
    lineHeight: 20,
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
  manualLogActionStack: {
    width: "100%",
    gap: 10,
    backgroundColor: "transparent",
  },
  manualLogInlineActions: {
    backgroundColor: "transparent",
    marginTop: 22,
    marginBottom: 12,
  },
  manualLogInlineActionsKeyboard: {
    marginTop: 30,
    marginBottom: 24,
  },
  manualLogNoteAccessory: {
    height: 38,
    alignItems: "flex-end",
    justifyContent: "center",
    backgroundColor: "transparent",
    paddingHorizontal: 10,
  },
  manualLogNoteAccessoryButton: {
    width: 54,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "rgba(18,63,52,0.94)",
  },
  manualLogNoteAccessoryButtonText: {
    ...typography.role.button,
    color: "#FFF8ED",
    fontSize: 14,
    lineHeight: 18,
  },
  manualLogPrimaryAction: {
    flex: 0,
    width: "100%",
    minHeight: 54,
    justifyContent: "center",
  },
  closeSecondaryButton: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: "center",
  },
  closeSecondaryButtonText: {
    ...typography.role.button,
    color: "rgba(255,255,255,0.64)",
    fontSize: 17,
    lineHeight: 23,
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
    ...typography.role.button,
    color: colors.sessionBackground,
    fontSize: 17,
    lineHeight: 23,
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
    fontWeight: "400",
    letterSpacing: 0,
    textAlign: "center",
    marginBottom: 22,
    fontFamily: serifFont,
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
  bookInputFadeShell: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bookInputLayout: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bookInputScroll: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bookReturnContent: {
    flexGrow: 1,
    justifyContent: "center",
    backgroundColor: "transparent",
    paddingVertical: 42,
  },
  bookReturnContentReflection: {
    flexGrow: 1,
    justifyContent: "flex-start",
    paddingTop: 18,
    paddingBottom: 18,
  },
  bookReturnContentTall: {
    justifyContent: "flex-start",
    paddingVertical: 30,
  },
  bookReturnContentStepOneTall: {
    paddingVertical: 20,
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
  bookAttributionBackButtonSpacer: {
    width: 36,
    height: 36,
    backgroundColor: "transparent",
  },
  bookReturnEyebrow: {
    ...typography.role.metadata,
    color: "rgba(47,93,80,0.34)",
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 0.9,
    textAlign: "center",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  bookReturnTitle: {
    ...typography.role.pageTitle,
    color: "#1B2A22",
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: -0.55,
    textAlign: "center",
  },
  bookReturnTitleCompact: {
    fontSize: 28,
    lineHeight: 34,
  },
  bookReturnHelperLine: {
    ...typography.role.helper,
    color: "rgba(31,41,51,0.56)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 8,
  },
  bookReturnMinutes: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.46)",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 10,
    marginBottom: 26,
  },
  bookReturnMinutesCompact: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
    marginBottom: 14,
  },
  bookAttributionCard: {
    backgroundColor: "transparent",
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 4,
    borderWidth: 0,
    borderColor: "transparent",
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
    ...typography.role.label,
    color: "#1B2A22",
    fontSize: 18,
    lineHeight: 24,
  },
  bookAttributionStepSubtext: {
    ...typography.role.helper,
    color: "rgba(31,41,51,0.56)",
    fontSize: 13,
    lineHeight: 19,
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
    ...typography.role.bookTitle,
    color: "#F7F3EA",
    width: "100%",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
    paddingHorizontal: 6,
  },
  bookAttributionCopy: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bookAttributionInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,248,237,0.34)",
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.09)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bookAttributionInput: {
    ...typography.role.body,
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    padding: 0,
  },
  bookAttributionClearButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.045)",
  },
  bookAttributionSelectedText: {
    ...typography.role.metadata,
    color: "rgba(47,93,80,0.46)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 9,
  },
  bookAttributionReviewCard: {
    backgroundColor: "rgba(255,248,237,0.24)",
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 2,
    borderWidth: 0,
    borderColor: "transparent",
  },
  bookAttributionReviewCardStepTwo: {
    marginTop: 18,
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
    ...typography.role.bookTitle,
    color: colors.text,
    fontSize: 17,
    lineHeight: 23,
  },
  bookAttributionReviewAuthor: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.56)",
    fontSize: 13,
    lineHeight: 18,
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
    ...typography.role.button,
    color: "rgba(47,93,80,0.72)",
    fontSize: 12,
    lineHeight: 16,
  },
  bookChangeButton: {
    alignSelf: "flex-start",
    backgroundColor: "transparent",
    paddingVertical: 6,
    paddingHorizontal: 0,
    marginTop: 4,
  },
  bookChangeButtonText: {
    ...typography.role.metadata,
    color: "rgba(47,93,80,0.58)",
    fontSize: 12,
    lineHeight: 17,
  },
  bookCoverChangeButton: {
    alignSelf: "flex-start",
    minHeight: 32,
    justifyContent: "center",
    backgroundColor: "rgba(47,93,80,0.055)",
    borderRadius: 999,
    paddingHorizontal: 10,
    marginTop: 7,
  },
  bookCoverChangeButtonText: {
    ...typography.role.button,
    color: "rgba(47,93,80,0.70)",
    fontSize: 12,
    lineHeight: 17,
  },
  bookReflectionCard: {
    marginTop: 18,
    backgroundColor: "transparent",
    borderRadius: 0,
    paddingHorizontal: 2,
    paddingVertical: 0,
    borderWidth: 0,
    borderColor: "transparent",
  },
  bookReflectionLabel: {
    ...typography.role.label,
    color: "rgba(47,93,80,0.52)",
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 9,
  },
  bookReflectionInput: {
    ...typography.role.body,
    minHeight: 96,
    backgroundColor: "rgba(255,248,237,0.34)",
    borderWidth: 0,
    borderBottomWidth: 1,
    borderColor: "rgba(47,93,80,0.09)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  bookLookupPanel: {
    marginTop: 22,
    backgroundColor: "transparent",
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 10,
    borderWidth: 0,
    borderColor: "transparent",
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
    color: "rgba(31,41,51,0.50)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  bookLookupTitleAttribution: {
    ...typography.role.label,
  },
  bookLookupLoadingAttribution: {
    ...typography.role.prose,
  },
  bookLookupHelperTextAttribution: {
    ...typography.role.helper,
  },
  bookLookupCoverTextAttribution: {
    ...typography.role.bookTitle,
  },
  bookLookupBookTitleAttribution: {
    ...typography.role.metadata,
  },
  bookLookupBookAuthorAttribution: {
    ...typography.role.metadata,
  },
  bookLookupEmptyTextAttribution: {
    ...typography.role.prose,
  },
  bookLookupAttributionTextAttribution: {
    ...typography.role.metadata,
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
    marginBottom: 7,
  },
  bookLookupChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "transparent",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.035)",
  },
  bookLookupChoiceSelected: {
    backgroundColor: "rgba(47,93,80,0.035)",
    borderBottomColor: "rgba(47,93,80,0.075)",
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
    marginTop: 16,
    backgroundColor: "transparent",
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 10,
    borderWidth: 0,
    borderColor: "transparent",
  },
  recentBookPickerTitle: {
    ...typography.role.label,
    color: "rgba(31,41,51,0.50)",
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 6,
  },
  recentBookChoiceScroll: {
    maxHeight: 168,
  },
  recentBookChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "transparent",
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(47,93,80,0.035)",
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
    ...typography.role.bookTitle,
    color: colors.accent,
    fontSize: 15,
    lineHeight: 20,
  },
  recentBookChoiceCopy: {
    flex: 1,
    backgroundColor: "transparent",
  },
  recentBookChoiceTitle: {
    ...typography.role.metadata,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  recentBookChoiceMeta: {
    ...typography.role.metadata,
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  bookCompletedCard: {
    marginTop: 16,
    backgroundColor: "rgba(255,248,237,0.26)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 2,
    borderWidth: 0,
    borderColor: "transparent",
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
    ...typography.role.label,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
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
    ...typography.role.helper,
    color: "rgba(31,41,51,0.56)",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 16,
    marginBottom: 20,
    textAlign: "center",
  },
  bookReturnSecondaryButton: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
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
    ...typography.role.button,
    color: "rgba(47,93,80,0.64)",
    fontSize: 15,
    lineHeight: 21,
  },
  bookReturnSaveButton: {
    flex: 1,
    backgroundColor: "rgba(47,93,80,0.92)",
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
    ...typography.role.button,
    color: "#FFF8ED",
    fontSize: 15,
    lineHeight: 21,
  },
  bookReturnSaveButtonTextDisabled: {
    color: "rgba(47,93,80,0.42)",
  },
  bookAttributionBottomActions: {
    marginTop: 24,
  },
  bookAttributionBottomActionsStepOne: {
    marginTop: 18,
  },
  bookAttributionBottomActionsKeyboard: {
    marginTop: 28,
    paddingBottom: 12,
  },
  bookAttributionBottomActionsFinal: {
    flexDirection: "column-reverse",
    gap: 10,
    marginTop: 0,
  },
  bookReflectionFooter: {
    backgroundColor: "transparent",
    paddingTop: 10,
    paddingHorizontal: 0,
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
    paddingTop: 0,
    paddingBottom: 2,
  },
  bookRevealFooter: {
    backgroundColor: "transparent",
    paddingTop: 0,
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
    ...typography.role.metadata,
    color: "rgba(47,93,80,0.46)",
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1.35,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 8,
  },
  bookRevealEyebrowCompact: {
    marginBottom: 5,
  },
  bookRevealTitle: {
    ...typography.role.pageTitle,
    color: "#1B2A22",
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.45,
    textAlign: "center",
    marginBottom: 14,
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
    backgroundColor: "rgba(255,248,237,0.46)",
    borderRadius: 24,
    paddingVertical: 15,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(47,93,80,0.055)",
    marginBottom: 8,
  },
  bookRevealCardCompact: {
    gap: 12,
    padding: 12,
    borderRadius: 24,
    marginBottom: 4,
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
    ...typography.role.bookTitle,
    color: colors.text,
    fontSize: 20,
    lineHeight: 27,
  },
  bookRevealMeta: {
    ...typography.role.metadata,
    color: "rgba(31,41,51,0.50)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  bookRevealMetaCompact: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 5,
  },
  bookRevealNoteSaved: {
    ...typography.role.metadata,
    color: "rgba(47,93,80,0.52)",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 6,
  },
  bookRevealContinueButton: {
    backgroundColor: "rgba(47,93,80,0.92)",
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
  },
  bookRevealContinueButtonText: {
    ...typography.role.button,
    color: "#FFF8ED",
    fontSize: 15,
    lineHeight: 21,
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
    paddingVertical: 7,
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
    width: "92%",
    maxWidth: 328,
    alignSelf: "center",
    backgroundColor: "rgba(255,248,237,0.24)",
    paddingVertical: 4,
    paddingHorizontal: 14,
    marginTop: 16,
  },
  completedBookMetaCardCompact: {
    marginTop: 8,
  },
  completedBookMetaRow: {
    minHeight: 40,
    paddingHorizontal: 2,
    paddingVertical: 9,
  },
  completedBookMetaLabel: {
    flex: 1,
    minWidth: 0,
  },
  completedBookMetaValue: {
    minWidth: 92,
    flexShrink: 0,
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
    width: "92%",
    maxWidth: 328,
    alignSelf: "center",
  },
  completedBookInlineActions: {
    width: "100%",
    backgroundColor: "transparent",
    marginTop: 2,
  },
  completedBookReflectionLabel: {
    ...typography.role.metadata,
    color: "rgba(196,148,90,0.74)",
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  completedBookReflectionInput: {
    ...typography.role.body,
    minHeight: 76,
    backgroundColor: "rgba(255,248,237,0.30)",
    borderWidth: 0,
    borderBottomWidth: 1,
    borderColor: "rgba(47,93,80,0.07)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: "#5A5448",
    fontSize: 15,
    lineHeight: 22,
  },
  completedBookReturnButton: {
    width: "100%",
    minHeight: 48,
    backgroundColor: "rgba(47,93,80,0.92)",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  completedBookReturnButtonText: {
    ...typography.role.button,
    color: "#FFF8ED",
    fontSize: 15,
    lineHeight: 21,
  },
  completedBookSkipButton: {
    paddingVertical: 10,
    alignItems: "center",
  },
  completedBookSkipButtonText: {
    ...typography.role.button,
    color: "rgba(47,93,80,0.62)",
    fontSize: 14,
    lineHeight: 20,
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


