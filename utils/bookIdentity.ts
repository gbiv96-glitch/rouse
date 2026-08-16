export const BOOK_WORK_IDENTITY_VERSION = "v1";

export const PRESENTATION_ONLY_LABELS = [
  "Deluxe Edition",
  "Anniversary Edition",
  "Movie Tie-In",
  "Movie Tie-In Edition",
  "Collector's Edition",
  "Special Edition",
] as const;

export type BookIdentityInput = {
  title?: string | null;
  subtitle?: string | null;
  author?: string | null;
  authors?: readonly string[] | null;
  language?: string | null;
};

export type BookWorkIdentity = {
  version: typeof BOOK_WORK_IDENTITY_VERSION;
  key: string;
  canonicalTitle: string;
  normalizedTitle: string;
  displayAuthor: string;
  authorSignature: string;
  language: string;
  protectedQualifiers: string[];
  volumePartQualifiers: string[];
};

const PRESENTATION_LABEL_PATTERNS: readonly {
  label: (typeof PRESENTATION_ONLY_LABELS)[number];
  pattern: RegExp;
}[] = [
  { label: "Deluxe Edition", pattern: /deluxe\s+edition/iu },
  { label: "Anniversary Edition", pattern: /anniversary\s+edition/iu },
  {
    label: "Movie Tie-In",
    pattern: /movie\s+tie[\s-]*in/iu,
  },
  {
    label: "Movie Tie-In Edition",
    pattern: /movie\s+tie[\s-]*in\s+edition/iu,
  },
  {
    label: "Collector's Edition",
    pattern: /collector(?:['’]s|s)\s+edition/iu,
  },
  { label: "Special Edition", pattern: /special\s+edition/iu },
];

const PROTECTED_QUALIFIER_PATTERNS: readonly {
  qualifier: string;
  pattern: RegExp;
}[] = [
  { qualifier: "translation", pattern: /\b(?:translated|translation)\b/u },
  { qualifier: "abridged", pattern: /\babridged\b/u },
  { qualifier: "unabridged", pattern: /\bunabridged\b/u },
  { qualifier: "adapted", pattern: /\b(?:adapted|adaptation)\b/u },
  {
    qualifier: "young-readers",
    pattern: /\byoung\s+(?:reader|readers|adult)\b/u,
  },
  { qualifier: "annotated", pattern: /\bannotated\b/u },
  { qualifier: "critical", pattern: /\bcritical\s+edition\b/u },
  { qualifier: "revised", pattern: /\brevised\b/u },
  { qualifier: "updated", pattern: /\bupdated\b/u },
  { qualifier: "expanded", pattern: /\bexpanded\b/u },
  {
    qualifier: "graphic-adaptation",
    pattern: /\bgraphic\s+(?:novel|adaptation)\b/u,
  },
  { qualifier: "manga", pattern: /\bmanga\b/u },
  { qualifier: "comic", pattern: /\bcomics?\b/u },
  { qualifier: "illustrated", pattern: /\billustrated\b/u },
  { qualifier: "study-guide", pattern: /\bstudy\s+guide\b/u },
  { qualifier: "workbook", pattern: /\bworkbook\b/u },
  { qualifier: "companion", pattern: /\bcompanion\b/u },
  { qualifier: "summary", pattern: /\b(?:summary|summaries)\b/u },
  {
    qualifier: "boxed-set",
    pattern: /\b(?:boxed\s+set|box\s+set|boxed\s+collection)\b/u,
  },
  { qualifier: "omnibus", pattern: /\bomnibus\b/u },
  {
    qualifier: "collection",
    pattern: /\b(?:collection|collected\s+works|multi\s+book)\b/u,
  },
  { qualifier: "screenplay", pattern: /\bscreenplay\b/u },
  { qualifier: "retelling", pattern: /\bretelling\b/u },
];

const VOLUME_PART_PATTERN =
  /\b(volume|vol|part|book)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gu;

function normalizeDisplayText(value?: string | null) {
  return value?.normalize("NFKC").trim().replace(/\s+/gu, " ") ?? "";
}

export function normalizeBookIdentityText(value?: unknown) {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFKC")
    .replace(/[‘’]/gu, "'")
    .replace(/[‐‑‒–—―]/gu, "-")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function isPresentationOnlyLabel(value?: string | null) {
  const normalizedValue = normalizeBookIdentityText(value);
  if (!normalizedValue) return false;

  return PRESENTATION_ONLY_LABELS.some(
    (label) => normalizeBookIdentityText(label) === normalizedValue,
  );
}

function stripTerminalPresentationLabel(value: string) {
  for (const { pattern } of PRESENTATION_LABEL_PATTERNS) {
    const terminalPattern = new RegExp(
      `(?:\\s*(?:[:\\-–—]\\s*|\\(\\s*)|\\s+)${pattern.source}\\s*\\)?$`,
      "iu",
    );
    const strippedValue = value.replace(terminalPattern, "").trim();

    if (strippedValue && strippedValue !== value) {
      return strippedValue.replace(/[\s:–—-]+$/u, "").trim();
    }
  }

  return value;
}

export function getCanonicalBookTitle(input: BookIdentityInput) {
  const rawTitle = normalizeDisplayText(input.title);
  if (!rawTitle) return "";

  const title = stripTerminalPresentationLabel(rawTitle);
  const subtitle = normalizeDisplayText(input.subtitle);

  if (!subtitle || isPresentationOnlyLabel(subtitle)) {
    return title;
  }

  const normalizedTitle = normalizeBookIdentityText(title);
  const normalizedSubtitle = normalizeBookIdentityText(subtitle);
  if (
    normalizedSubtitle &&
    (normalizedTitle === normalizedSubtitle ||
      normalizedTitle.endsWith(` ${normalizedSubtitle}`))
  ) {
    return title;
  }

  return `${title}: ${subtitle}`;
}

export function getOrderedAuthorDisplay(input: BookIdentityInput) {
  if (input.authors) {
    const authors = input.authors
      .map((author) => normalizeDisplayText(author))
      .filter(Boolean);

    if (authors.length > 0) {
      return authors.join(", ");
    }
  }

  return normalizeDisplayText(input.author);
}

export function getProtectedBookQualifiers(input: BookIdentityInput) {
  const searchableText = normalizeBookIdentityText(
    [input.title, input.subtitle].filter(Boolean).join(" "),
  );
  if (!searchableText) return [];

  return PROTECTED_QUALIFIER_PATTERNS.filter(({ pattern }) =>
    pattern.test(searchableText),
  ).map(({ qualifier }) => qualifier);
}

export function getVolumePartQualifiers(input: BookIdentityInput) {
  const searchableText = normalizeBookIdentityText(
    [input.title, input.subtitle].filter(Boolean).join(" "),
  );
  const qualifiers = new Set<string>();

  for (const match of searchableText.matchAll(VOLUME_PART_PATTERN)) {
    qualifiers.add(`${match[1]}:${match[2]}`);
  }

  return [...qualifiers].sort();
}

function arraysEqual(first: readonly string[], second: readonly string[]) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

export function getBookWorkIdentity(input: BookIdentityInput): BookWorkIdentity {
  const canonicalTitle = getCanonicalBookTitle(input);
  const normalizedTitle = normalizeBookIdentityText(canonicalTitle);
  const displayAuthor = getOrderedAuthorDisplay(input);
  const authorSignature = normalizeBookIdentityText(displayAuthor);
  const language = normalizeBookIdentityText(input.language);
  const protectedQualifiers = getProtectedBookQualifiers(input);
  const volumePartQualifiers = getVolumePartQualifiers(input);
  const key =
    normalizedTitle && authorSignature
      ? [
          BOOK_WORK_IDENTITY_VERSION,
          normalizedTitle,
          authorSignature,
          protectedQualifiers.join(","),
          volumePartQualifiers.join(","),
        ].join("|")
      : "";

  return {
    version: BOOK_WORK_IDENTITY_VERSION,
    key,
    canonicalTitle,
    normalizedTitle,
    displayAuthor,
    authorSignature,
    language,
    protectedQualifiers,
    volumePartQualifiers,
  };
}

export function areBookWorkIdentitiesCompatible(
  first: BookWorkIdentity,
  second: BookWorkIdentity,
) {
  if (
    !first.normalizedTitle ||
    first.normalizedTitle !== second.normalizedTitle ||
    !first.authorSignature ||
    first.authorSignature !== second.authorSignature
  ) {
    return false;
  }

  if (first.language && second.language && first.language !== second.language) {
    return false;
  }

  return (
    arraysEqual(first.protectedQualifiers, second.protectedQualifiers) &&
    arraysEqual(first.volumePartQualifiers, second.volumePartQualifiers)
  );
}

export function areBooksWorkCompatible(
  first: BookIdentityInput,
  second: BookIdentityInput,
) {
  return areBookWorkIdentitiesCompatible(
    getBookWorkIdentity(first),
    getBookWorkIdentity(second),
  );
}
