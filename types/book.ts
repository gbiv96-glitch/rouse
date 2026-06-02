export type BookMetadata = {
  title: string;
  author?: string | null;
  coverUrl?: string | null;
  googleBooksId?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
  source?: "manual" | "googleBooks";
};

export type BookMetadataFields = Omit<BookMetadata, "title" | "source"> & {
  bookSource?: BookMetadata["source"];
};
