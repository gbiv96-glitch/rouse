export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) {
    return "0 min";
  }

  const roundedMinutes = Math.round(minutes);
  const displayMinutes =
    minutes > 0 ? Math.max(1, roundedMinutes) : Math.max(0, roundedMinutes);

  if (displayMinutes < 60) {
    return `${displayMinutes} min`;
  }

  const hours = Math.floor(displayMinutes / 60);
  const remainingMinutes = displayMinutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${remainingMinutes} min`;
}
