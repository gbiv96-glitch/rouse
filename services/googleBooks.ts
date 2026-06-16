import type { BookMetadata } from "@/types/book";

const GOOGLE_BOOKS_VOLUME_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_BOOKS_MAX_RESULTS = 5;
const GOOGLE_BOOKS_LOOKUP_TIMEOUT_MS = 8000;
const googleBooksResultCache = new Map<string, BookMetadata[]>();
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

  return url.replace(/^http:\/\//i, "https://");
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

const getBestCoverUrl = (imageLinks?: GoogleBooksImageLinks): string | null => {
  const normalizedImageLinks = normalizeImageLinks(imageLinks);

  if (!normalizedImageLinks) {
    return null;
  }

  return (
    normalizedImageLinks.extraLarge ??
    normalizedImageLinks.large ??
    normalizedImageLinks.medium ??
    normalizedImageLinks.thumbnail ??
    normalizedImageLinks.small ??
    normalizedImageLinks.smallThumbnail ??
    null
  );
};

const readResponseBodyForDebug = async (response: Response): Promise<string> => {
  try {
    const body = await response.text();
    return body.length > 1200 ? `${body.slice(0, 1200)}... [truncated]` : body;
  } catch (error) {
    console.warn("Google Books lookup failed to read error response body", error);
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

const normalizeGoogleBook = (volume: GoogleBooksVolume): BookMetadata | null => {
  const skipReason = getGoogleBookSkipReason(volume);

  if (skipReason) return null;

  const volumeInfo = volume.volumeInfo;
  const title = volumeInfo?.title?.trim() ?? "";

  const subtitle = volumeInfo?.subtitle?.trim();
  const fullTitle = subtitle ? `${title}: ${subtitle}` : title;
  const authors = volumeInfo?.authors?.map((author) => author.trim()).filter(Boolean);

  return {
    title: fullTitle,
    author: authors?.length ? authors.join(", ") : null,
    coverUrl: getBestCoverUrl(volumeInfo?.imageLinks),
    googleBooksId: volume.id,
    isbn10: getIsbn(volumeInfo?.industryIdentifiers, "ISBN_10"),
    isbn13: getIsbn(volumeInfo?.industryIdentifiers, "ISBN_13"),
    source: "googleBooks",
  };
};

export async function searchGoogleBooks(query: string): Promise<BookMetadata[]> {
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
      console.warn(
        "Google Books API key is missing from this build. Check EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY in the EAS build environment.",
      );
      hasWarnedMissingGoogleBooksApiKey = true;
    }

    // Optional public Expo key for quota management only. Do not hardcode secrets here.
    const url =
      `${GOOGLE_BOOKS_VOLUME_SEARCH_URL}?` +
      `q=${encodeURIComponent(trimmedQuery)}` +
      `&maxResults=${GOOGLE_BOOKS_MAX_RESULTS}` +
      "&printType=books" +
      (apiKey ? `&key=${encodeURIComponent(apiKey)}` : "");

    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      const responseBody = await readResponseBodyForDebug(response);
      console.warn(
        `Google Books lookup failed with status ${response.status} ${response.statusText}`,
        responseBody,
      );

      if (response.status === 429) {
        lastLookupStatus = "rateLimited";
        console.warn("Google Books lookup rate limited; manual book entry remains available.");
        return [];
      }

      lastLookupStatus = "error";
      return [];
    }

    const data = (await response.json()) as GoogleBooksSearchResponse;
    const rawItems = data.items ?? [];

    const results = rawItems
      .map(normalizeGoogleBook)
      .filter((book): book is BookMetadata => book !== null);

    googleBooksResultCache.set(normalizedQuery, results);
    lastLookupStatus = results.length > 0 ? "ok" : "empty";
    return results;
  } catch (error) {
    lastLookupStatus = "error";
    console.warn("Google Books lookup failed", error);
    return [];
  }
}
