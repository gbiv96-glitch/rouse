import type { BookMetadata } from "@/types/book";
import {
  areBookWorkIdentitiesCompatible,
  getBookWorkIdentity,
  getCanonicalBookTitle,
  isPresentationOnlyLabel,
  normalizeBookIdentityText,
  type BookWorkIdentity,
} from "@/utils/bookIdentity";

const GOOGLE_BOOKS_VOLUME_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_BOOKS_MAX_CANDIDATES = 20;
const GOOGLE_BOOKS_MAX_GROUPED_RESULTS = 5;
const GOOGLE_BOOKS_LOOKUP_TIMEOUT_MS = 8000;
const googleBooksResultCache = new Map<string, BookSearchGroup[]>();
let lastLookupStatus: GoogleBooksLookupStatus = "idle";
let hasWarnedMissingGoogleBooksApiKey = false;

export type GoogleBooksLookupStatus =
  | "idle"
  | "ok"
  | "empty"
  | "rateLimited"
  | "error";

type GoogleBooksIndustryIdentifier = {
  type?: string;
  identifier?: string;
};

type GoogleBooksImageLinks = {
  smallThumbnail?: string;
  thumbnail?: string;
  small?: string;
  medium?: string;
  large?: string;
  extraLarge?: string;
};

type GoogleBooksVolumeInfo = {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  language?: string;
  industryIdentifiers?: GoogleBooksIndustryIdentifier[];
  imageLinks?: GoogleBooksImageLinks;
};

type GoogleBooksVolume = {
  id?: string;
  volumeInfo?: GoogleBooksVolumeInfo;
};

type GoogleBooksSearchResponse = {
  totalItems?: number;
  items?: GoogleBooksVolume[];
};

export type GoogleVolumeCandidate = {
  sourceOrder: number;
  rawTitle: string;
  rawSubtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedDate: string | null;
  language: string | null;
  volumeId: string | null;
  isbn10: string | null;
  isbn13: string | null;
  coverUrls: string[];
  workIdentity: BookWorkIdentity;
};

export type GoogleBookCoverCandidate = {
  url: string;
  sourceVolumeId: string | null;
};

export type BookSearchGroup = BookMetadata & {
  workIdentityKey: string;
  representative: GoogleVolumeCandidate;
  candidates: GoogleVolumeCandidate[];
  coverCandidates: GoogleBookCoverCandidate[];
};

const warnInDev = (message: string, detail?: unknown) => {
  if (!__DEV__) return;

  if (detail) {
    console.warn(message, detail);
  } else {
    console.warn(message);
  }
};

const fetchWithTimeout = async (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, GOOGLE_BOOKS_LOOKUP_TIMEOUT_MS);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

export function getLastGoogleBooksLookupStatus(): GoogleBooksLookupStatus {
  return lastLookupStatus;
}

const normalizeCoverUrl = (url?: string): string | null => {
  if (!url) {
    return null;
  }

  const normalizedUrl = url.replace(/^http:\/\//i, "https://");
  return /^https:\/\//i.test(normalizedUrl) ? normalizedUrl : null;
};

const normalizeImageLinks = (
  imageLinks?: GoogleBooksImageLinks,
): GoogleBooksImageLinks | undefined => {
  if (!imageLinks) {
    return undefined;
  }

  return {
    smallThumbnail: normalizeCoverUrl(imageLinks.smallThumbnail) ?? undefined,
    thumbnail: normalizeCoverUrl(imageLinks.thumbnail) ?? undefined,
    small: normalizeCoverUrl(imageLinks.small) ?? undefined,
    medium: normalizeCoverUrl(imageLinks.medium) ?? undefined,
    large: normalizeCoverUrl(imageLinks.large) ?? undefined,
    extraLarge: normalizeCoverUrl(imageLinks.extraLarge) ?? undefined,
  };
};

const getCoverUrls = (imageLinks?: GoogleBooksImageLinks): string[] => {
  const normalizedImageLinks = normalizeImageLinks(imageLinks);

  if (!normalizedImageLinks) {
    return [];
  }

  return [
    normalizedImageLinks.extraLarge,
    normalizedImageLinks.large,
    normalizedImageLinks.medium,
    normalizedImageLinks.thumbnail,
    normalizedImageLinks.small,
    normalizedImageLinks.smallThumbnail,
  ].filter(
    (url, index, urls): url is string =>
      Boolean(url) && urls.indexOf(url) === index,
  );
};

const readResponseBodyForDebug = async (response: Response): Promise<string> => {
  try {
    const body = await response.text();
    return body.length > 1200 ? `${body.slice(0, 1200)}... [truncated]` : body;
  } catch (error) {
    warnInDev("Google Books lookup failed to read error response body", error);
    return "[unreadable response body]";
  }
};

const getIsbn = (
  identifiers: GoogleBooksIndustryIdentifier[] | undefined,
  type: "ISBN_10" | "ISBN_13",
): string | null =>
  identifiers?.find((identifier) => identifier.type === type)?.identifier ?? null;

const getGoogleBookSkipReason = (volume: GoogleBooksVolume): string | null => {
  const volumeInfo = volume.volumeInfo;
  const title = volumeInfo?.title?.trim();

  if (!title) return "missing title";

  return null;
};

const normalizeGoogleVolumeCandidate = (
  volume: GoogleBooksVolume,
  sourceOrder: number,
): GoogleVolumeCandidate | null => {
  const skipReason = getGoogleBookSkipReason(volume);

  if (skipReason) return null;

  const volumeInfo = volume.volumeInfo;
  const rawTitle = volumeInfo?.title?.trim() ?? "";
  const rawSubtitle = volumeInfo?.subtitle?.trim() || null;
  const authors = volumeInfo?.authors
    ?.map((author) => author.trim())
    .filter(Boolean);

  return {
    sourceOrder,
    rawTitle,
    rawSubtitle,
    authors: authors ?? [],
    publisher: volumeInfo?.publisher?.trim() || null,
    publishedDate: volumeInfo?.publishedDate?.trim() || null,
    language: volumeInfo?.language?.trim() || null,
    volumeId: volume.id?.trim() || null,
    isbn10: getIsbn(volumeInfo?.industryIdentifiers, "ISBN_10"),
    isbn13: getIsbn(volumeInfo?.industryIdentifiers, "ISBN_13"),
    coverUrls: getCoverUrls(volumeInfo?.imageLinks),
    workIdentity: getBookWorkIdentity({
      title: rawTitle,
      subtitle: rawSubtitle,
      authors,
      language: volumeInfo?.language,
    }),
  };
};

function getRepresentativeScore(candidate: GoogleVolumeCandidate) {
  const titleWithoutSubtitle = getCanonicalBookTitle({ title: candidate.rawTitle });
  const hasPresentationOnlyMetadata =
    isPresentationOnlyLabel(candidate.rawSubtitle) ||
    normalizeBookIdentityText(titleWithoutSubtitle) !==
      normalizeBookIdentityText(candidate.rawTitle);

  return (
    (candidate.workIdentity.authorSignature ? 16 : 0) +
    (hasPresentationOnlyMetadata ? 0 : 8) +
    (candidate.coverUrls.length > 0 ? 4 : 0) +
    (candidate.isbn13 ? 2 : 0) +
    (candidate.isbn10 ? 1 : 0) +
    (candidate.volumeId ? 1 : 0)
  );
}

function arraysEqual(first: readonly string[], second: readonly string[]) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function haveCompatibleSearchVariantSignals(
  first: GoogleVolumeCandidate[],
  second: GoogleVolumeCandidate[],
) {
  const firstIdentity = first[0].workIdentity;
  const secondIdentity = second[0].workIdentity;

  return (
    arraysEqual(
      firstIdentity.protectedQualifiers,
      secondIdentity.protectedQualifiers,
    ) &&
    arraysEqual(
      firstIdentity.volumePartQualifiers,
      secondIdentity.volumePartQualifiers,
    )
  );
}

function absorbUnambiguousAuthorlessCandidateGroups(
  candidateGroups: GoogleVolumeCandidate[][],
) {
  const authoredGroups = candidateGroups.filter(
    (group) => group[0].workIdentity.authorSignature,
  );
  const absorbedGroups = new Set<GoogleVolumeCandidate[]>();

  candidateGroups.forEach((authorlessGroup) => {
    const authorlessIdentity = authorlessGroup[0].workIdentity;
    if (authorlessIdentity.authorSignature) return;

    const groupsWithSameTitle = candidateGroups.filter(
      (group) =>
        group[0].workIdentity.normalizedTitle ===
        authorlessIdentity.normalizedTitle,
    );
    const authoredGroupsWithSameTitle = authoredGroups.filter(
      (group) =>
        group[0].workIdentity.normalizedTitle ===
        authorlessIdentity.normalizedTitle,
    );
    const distinctAuthoredIdentityKeys = new Set(
      authoredGroupsWithSameTitle.map((group) => group[0].workIdentity.key),
    );
    const knownLanguages = new Set(
      groupsWithSameTitle
        .flat()
        .map((candidate) => candidate.workIdentity.language)
        .filter(Boolean),
    );

    if (
      distinctAuthoredIdentityKeys.size !== 1 ||
      knownLanguages.size > 1
    ) {
      return;
    }

    const compatibleAuthoredGroups = authoredGroupsWithSameTitle.filter((group) =>
      haveCompatibleSearchVariantSignals(authorlessGroup, group),
    );

    if (compatibleAuthoredGroups.length !== 1) return;

    compatibleAuthoredGroups[0].push(...authorlessGroup);
    absorbedGroups.add(authorlessGroup);
  });

  return candidateGroups.filter((group) => !absorbedGroups.has(group));
}

function compareRepresentativeCandidates(
  first: GoogleVolumeCandidate,
  second: GoogleVolumeCandidate,
) {
  return (
    getRepresentativeScore(second) - getRepresentativeScore(first) ||
    first.sourceOrder - second.sourceOrder ||
    (first.volumeId ?? "").localeCompare(second.volumeId ?? "")
  );
}

function createBookSearchGroup(
  candidates: GoogleVolumeCandidate[],
): BookSearchGroup {
  const rankedCandidates = [...candidates].sort(compareRepresentativeCandidates);
  const representative = rankedCandidates[0];
  const seenCoverUrls = new Set<string>();
  const coverCandidates = rankedCandidates.flatMap((candidate) => {
    const bestCandidateCoverUrl = candidate.coverUrls[0];
    if (!bestCandidateCoverUrl || seenCoverUrls.has(bestCandidateCoverUrl)) {
      return [];
    }

    seenCoverUrls.add(bestCandidateCoverUrl);
    return [
      {
        url: bestCandidateCoverUrl,
        sourceVolumeId: candidate.volumeId,
      },
    ];
  });

  return {
    title: representative.workIdentity.canonicalTitle,
    author: representative.workIdentity.displayAuthor || null,
    coverUrl: coverCandidates[0]?.url ?? null,
    googleBooksId: representative.volumeId,
    isbn10: representative.isbn10,
    isbn13: representative.isbn13,
    source: "googleBooks",
    workIdentityKey: representative.workIdentity.key,
    representative,
    candidates: rankedCandidates,
    coverCandidates,
  };
}

export function groupGoogleVolumeCandidates(
  candidates: GoogleVolumeCandidate[],
): BookSearchGroup[] {
  const candidateGroups: GoogleVolumeCandidate[][] = [];

  candidates.forEach((candidate) => {
    const compatibleGroup = candidate.workIdentity.key
      ? candidateGroups.find((group) =>
          group.every((groupCandidate) =>
            areBookWorkIdentitiesCompatible(
              candidate.workIdentity,
              groupCandidate.workIdentity,
            ),
          ),
        )
      : undefined;

    if (compatibleGroup) {
      compatibleGroup.push(candidate);
    } else {
      candidateGroups.push([candidate]);
    }
  });

  return absorbUnambiguousAuthorlessCandidateGroups(candidateGroups)
    .map(createBookSearchGroup)
    .slice(0, GOOGLE_BOOKS_MAX_GROUPED_RESULTS);
}

export function getBookMetadataFromSearchGroup(
  group: BookSearchGroup,
): BookMetadata {
  return {
    title: group.title,
    author: group.author ?? null,
    coverUrl: group.coverUrl ?? null,
    googleBooksId: group.googleBooksId ?? null,
    isbn10: group.isbn10 ?? null,
    isbn13: group.isbn13 ?? null,
    source: "googleBooks",
  };
}

export async function searchGoogleBooks(
  query: string,
): Promise<BookSearchGroup[]> {
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  if (!trimmedQuery) {
    lastLookupStatus = "idle";
    return [];
  }

  const cachedResults = googleBooksResultCache.get(normalizedQuery);

  if (cachedResults) {
    lastLookupStatus = cachedResults.length > 0 ? "ok" : "empty";
    return cachedResults;
  }

  try {
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY;
    const hasApiKey = Boolean(apiKey);

    if (!hasApiKey && !hasWarnedMissingGoogleBooksApiKey) {
      warnInDev(
        "Google Books API key is missing from this build. Check EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY in the EAS build environment.",
      );
      hasWarnedMissingGoogleBooksApiKey = true;
    }

    // Optional public Expo key for quota management only. Do not hardcode secrets here.
    const url =
      `${GOOGLE_BOOKS_VOLUME_SEARCH_URL}?` +
      `q=${encodeURIComponent(trimmedQuery)}` +
      `&maxResults=${GOOGLE_BOOKS_MAX_CANDIDATES}` +
      "&printType=books" +
      (apiKey ? `&key=${encodeURIComponent(apiKey)}` : "");

    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      const responseBody = __DEV__
        ? await readResponseBodyForDebug(response)
        : undefined;
      warnInDev(
        `Google Books lookup failed with status ${response.status} ${response.statusText}`,
        responseBody,
      );

      if (response.status === 429) {
        lastLookupStatus = "rateLimited";
        warnInDev(
          "Google Books lookup rate limited; manual book entry remains available.",
        );
        return [];
      }

      lastLookupStatus = "error";
      return [];
    }

    const data = (await response.json()) as GoogleBooksSearchResponse;
    const rawItems = data.items ?? [];

    const candidates = rawItems
      .map(normalizeGoogleVolumeCandidate)
      .filter(
        (candidate): candidate is GoogleVolumeCandidate => candidate !== null,
      );
    const results = groupGoogleVolumeCandidates(candidates);

    googleBooksResultCache.set(normalizedQuery, results);
    lastLookupStatus = results.length > 0 ? "ok" : "empty";
    return results;
  } catch (error) {
    lastLookupStatus = "error";
    warnInDev("Google Books lookup failed", error);
    return [];
  }
}
