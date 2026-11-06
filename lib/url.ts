/**
 * Helper utility to construct invitation URLs dynamically based on current origin.
 */
export function getAppBaseUrl(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  return "http://localhost:3000";
}

export function buildGuestInvitationUrl(
  eventId: number | string,
  invitationType: string,
  guestName: string
): string {
  const base = getAppBaseUrl();
  return (
    `${base}/wedding2/` +
    `${eventId}/` +
    `${encodeURIComponent(invitationType.toLowerCase())}/` +
    `${encodeURIComponent(guestName)}`
  );
}

