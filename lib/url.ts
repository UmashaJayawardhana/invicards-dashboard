/**
 * Helper utility to get the dashboard's current origin base URL.
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

/**
 * Helper utility to construct invitation URLs dynamically based on event ID, invitation type, and guest name.
 * Each event ID maps to its specific template folder / project deployment.
 */
export function buildGuestInvitationUrl(
  eventId: number | string,
  invitationType: string = "Single",
  guestName: string = ""
): string {
  const id = Number(eventId);
  const typeClean = (invitationType || "Single").trim();
  const nameClean = (guestName || "").trim();
  const encType = encodeURIComponent(typeClean);
  const encTypeLower = encodeURIComponent(typeClean.toLowerCase());
  const encName = encodeURIComponent(nameClean || "Guest");

  switch (id) {
    case 1:
      // Event 1: Wedding1/invite/[eventId]/[invitationType]
      return `https://wedding-invitation-sample-beta.vercel.app/Wedding1/invite/${id}/${encType}`;

    case 2:
      // Event 2: GnederReveal/Sample1/invite/[id]/[guestName]
      return `https://invicards.sithproduction.com/GnederReveal/Sample1/invite/${id}/${encName}`;

    case 3:
      // Event 3: ThankingCard/Sample1/invite/[id]
      return `https://wedding-invitation-sample-beta.vercel.app/ThankingCard/Sample1/invite/${id}`;

    case 5:
      // Event 5: wedding2/[eventId]/[invitationtype]/[guestname]
      return `https://wedding-invitation-sample-beta.vercel.app/wedding2/${id}/${encTypeLower}/${encName}`;

    case 7:
      // Event 7: wedding3/[eventId]/[invitationtype]/[guestname]
      return `https://wedding-invitation-sample-beta.vercel.app/wedding3/${id}/${encTypeLower}/${encName}`;

    default:
      // Fallback for other events: defaults to wedding3 template
      return `https://wedding-invitation-sample-beta.vercel.app/wedding3/${id}/${encTypeLower}/${encName}`;
  }
}

