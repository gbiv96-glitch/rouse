import type { BookMetadata } from "@/types/book";

const GOOGLE_BOOKS_VOLUME_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_BOOKS_MAX_RESULTS = 5;

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
  items?: GoogleBooksVolume[];
};

const normalizeCoverUrl = (url?: string): string | null => {
  if (!url) {
    return null;
  }

  return url.replace(/^http:\/\//i, "https://");
};

const getBestCoverUrl = (imageLinks?: GoogleBooksImageLinks): string | null => {
  if (!imageLinks) {
    return null;
  }

  return normalizeCoverUrl(
    imageLinks.extraLarge ??
      imageLinks.large ??
      imageLinks.medium ??
      imageLinks.thumbnail ??
      imageLinks.small ??
      imageLinks.smallThumbnail,
  );
};

const getIsbn = (
  identifiers: GoogleBooksIndustryIdentifier[] | undefined,
  type: "ISBN_10" | "ISBN_13",
): string | null =>
  identifiers?.find((identifier) => identifier.type === type)?.identifier ?? null;

const normalizeGoogleBook = (volume: GoogleBooksVolume): BookMetadata | null => {
  const volumeInfo = volume.volumeInfo;
  const title = volumeInfo?.title?.trim();

  if (!volume.id || !title) {
    return null;
  }

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

  if (!trimmedQuery) {
    return [];
  }

  const params = new URLSearchParams({
    q: trimmedQuery,
    maxResults: String(GOOGLE_BOOKS_MAX_RESULTS),
    printType: "books",
  });

  // TODO: Add a public Expo env key here if quota needs require it later.
  const url = `${GOOGLE_BOOKS_VOLUME_SEARCH_URL}?${params.toString()}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`Google Books lookup failed with status ${response.status}`);
      return [];
    }

    const data = (await response.json()) as GoogleBooksSearchResponse;

    return (
      data.items
        ?.map(normalizeGoogleBook)
        .filter((book): book is BookMetadata => book !== null) ?? []
    );
  } catch (error) {
    console.warn("Google Books lookup failed", error);
    return [];
  }
}
