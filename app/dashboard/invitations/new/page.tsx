
"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { getUserRole, fetchUserRole, UserRole } from "@/lib/auth";
import { buildGuestInvitationUrl } from "@/lib/url";

type EventItem = {
  event_id: number;
  event_type: string;
  event_date: string;
  contact_person: string;
};

type InvitationType = "Single" | "Couple" | "Family";

type GuestInvitation = {
  wedding_invitation_id: number;
  event_id: number;
  guest_name: string;
  invitation_type: InvitationType;
  number_of_guests: number;
  guest_token: string;
  rsvp_status: string;
  created_at: string;
};

function NewInvitationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlEventId = searchParams.get("eventId");

  const [supabase] = useState(() => createClient());

  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [userRole, setUserRole] = useState<UserRole>("customer");

  const [invitationType, setInvitationType] =
    useState<InvitationType>("Single");

  const [guestName, setGuestName] = useState("");
  const [familyGuestCount, setFamilyGuestCount] = useState("4");

  const [generatedUrl, setGeneratedUrl] = useState("");
  const [qrCode, setQrCode] = useState("");

  const [guests, setGuests] = useState<GuestInvitation[]>([]);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedEvent = events.find(
    (event) => String(event.event_id) === selectedEventId
  );

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        router.replace("/login");
        return;
      }

      const role = await fetchUserRole(supabase, user);
      setUserRole(role);

      let query = supabase
        .from("events")
        .select("event_id, event_type, event_date, contact_person, email, owner_user_id")
        .order("event_id", { ascending: false });

      if (role === "customer") {
        query = query.or(
          `owner_user_id.eq.${user.id}${user.email ? `,email.eq.${user.email}` : ""}`
        );
      }

      const { data, error: eventsError } = await query;

      if (eventsError) {
        throw eventsError;
      }

      const eventList = (data ?? []) as EventItem[];

      setEvents(eventList);

      if (urlEventId && eventList.some((e) => String(e.event_id) === urlEventId)) {
        setSelectedEventId(urlEventId);
      } else if (eventList.length > 0) {
        setSelectedEventId(String(eventList[0].event_id));
      }
    } catch (err) {
      console.error("Error loading events:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load your events."
      );
    } finally {
      setLoading(false);
    }
  }, [router, supabase, urlEventId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const handleGenerate = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    setError("");
    setSuccess("");
    setGeneratedUrl("");
    setQrCode("");

    const name = guestName.trim();

    if (!selectedEvent) {
      setError("Please select an event.");
      return;
    }

    if (!name) {
      setError("Please enter the guest name.");
      return;
    }

    let numberOfGuests = 1;

    if (invitationType === "Couple") {
      numberOfGuests = 2;
    } else if (invitationType === "Family") {
      const count = Number(familyGuestCount);

      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 50
      ) {
        setError(
          "Family guest count must be a whole number between 1 and 50."
        );
        return;
      }

      numberOfGuests = count;
    }

    setGenerating(true);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        router.replace("/login");
        return;
      }

      // Verify that this event belongs to the customer (or user is admin)
      const { data: ownedEvent, error: ownershipError } =
        await supabase
          .from("events")
          .select("event_id, owner_user_id, email")
          .eq("event_id", selectedEvent.event_id)
          .maybeSingle();

      if (ownershipError) {
        throw ownershipError;
      }

      if (!ownedEvent) {
        throw new Error(
          "Event not found."
        );
      }

      if (userRole === "customer") {
        const isOwner =
          ownedEvent.owner_user_id === user.id ||
          (Boolean(ownedEvent.email && user.email) &&
            ownedEvent.email?.trim().toLowerCase() === user.email?.trim().toLowerCase());

        if (!isOwner) {
          throw new Error("You do not have permission to create invitations for this event.");
        }

        // If matched by email but owner_user_id was not set, auto-link it!
        if (!ownedEvent.owner_user_id && user.id) {
          void supabase.from("events").update({ owner_user_id: user.id }).eq("event_id", selectedEvent.event_id);
        }
      }

      const guestToken = crypto.randomUUID();

      // Save the invitation in Supabase.
      const { data: insertedGuest, error: insertError } =
        await supabase
          .from("wedding_invitations")
          .insert({
            event_id: selectedEvent.event_id,
            guest_name: name,
            invitation_type: invitationType,
            number_of_guests: numberOfGuests,
            guest_token: guestToken,
          })
          .select(
            "wedding_invitation_id, event_id, guest_name, invitation_type, number_of_guests, guest_token, rsvp_status, created_at"
          )
          .single();

      if (insertError) {
        throw insertError;
      }

      const savedGuest =
        insertedGuest as GuestInvitation;

      // Construct dynamic public invitation URL
      const url = buildGuestInvitationUrl(
        selectedEvent.event_id,
        invitationType,
        name
      );

      // Generate QR code from the public URL.
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: "H",
      });

      setGeneratedUrl(url);
      setQrCode(qrDataUrl);
      setGuests((previous) => [savedGuest, ...previous]);

      setSuccess(
        "Invitation record saved and QR code generated."
      );

      setGuestName("");
    } catch (err) {
      console.error("Error generating invitation:", {
        message: (err as { message?: string })?.message,
        code: (err as { code?: string })?.code,
        details: (err as { details?: string })?.details,
        hint: (err as { hint?: string })?.hint,
      });

      setError(
        err instanceof Error
          ? err.message
          : "Unable to generate the invitation."
      );
    } finally {
      setGenerating(false);
    }
  };

  const copyUrl = async () => {
    if (!generatedUrl) return;

    try {
      await navigator.clipboard.writeText(generatedUrl);
      setSuccess("Invitation URL copied to clipboard.");
      setError("");
    } catch {
      setError(
        "Could not copy automatically. Please select and copy the URL."
      );
    }
  };

  const downloadQr = () => {
    if (!qrCode) return;

    const link = document.createElement("a");
    link.href = qrCode;
    link.download = `invitation-${guestName || "guest"}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <p className="text-sm text-gray-600">
          Loading your events...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[#8c6b45]">
              Invi Cards
            </p>

            <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">
              Create Guest Invitation
            </h1>

            <p className="mt-2 text-sm text-gray-600">
              Create a guest invitation and generate its QR code.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {selectedEventId && (
              <Link
                href={`/dashboard/events/${selectedEventId}`}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                ← Back to Event #{selectedEventId}
              </Link>
            )}
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Back to {userRole === "admin" ? "Admin" : "Customer"} Dashboard
            </Link>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {success && (
          <div
            role="status"
            className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700"
          >
            {success}
          </div>
        )}

        {events.length === 0 ? (
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">
              No events found
            </h2>

            <p className="mt-2 text-sm text-gray-600">
              Create an event first before generating guest invitations.
            </p>

            <Link
              href="/dashboard"
              className="mt-5 inline-flex rounded-lg bg-[#8c6b45] px-5 py-3 text-sm font-medium text-white hover:bg-[#755738]"
            >
              Go to Dashboard
            </Link>
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
              <h2 className="mb-6 text-lg font-semibold text-gray-900">
                Invitation Details
              </h2>

              <form
                onSubmit={handleGenerate}
                className="space-y-5"
              >
                <div>
                  <label
                    htmlFor="event"
                    className="mb-2 block text-sm font-medium text-gray-700"
                  >
                    Select Event
                  </label>

                  <select
                    id="event"
                    value={selectedEventId}
                    onChange={(e) => {
                      setSelectedEventId(e.target.value);
                      setGeneratedUrl("");
                      setQrCode("");
                      setError("");
                      setSuccess("");
                    }}
                    required
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm outline-none focus:border-[#8c6b45] focus:ring-1 focus:ring-[#8c6b45]"
                  >
                    {events.map((event) => (
                      <option
                        key={event.event_id}
                        value={String(event.event_id)}
                      >
                        {event.event_type} —{" "}
                        {event.contact_person} (Event #
                        {event.event_id})
                      </option>
                    ))}
                  </select>

                  {selectedEvent && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span>Event Date: <strong className="text-black">{selectedEvent.event_date}</strong></span>
                      <span>•</span>
                      <span>
                        Target Template:{" "}
                        <strong className="text-[#8c6b45]">
                          {selectedEvent.event_id === 1
                            ? "Wedding 1 (Wedding1/invite/...)"
                            : selectedEvent.event_id === 2
                            ? "Gender Reveal (GnederReveal/...)"
                            : selectedEvent.event_id === 3
                            ? "Thanking Card (ThankingCard/Sample1/...)"
                            : selectedEvent.event_id === 5
                            ? "Wedding 2 (wedding2/...)"
                            : selectedEvent.event_id === 7
                            ? "Wedding 3 (wedding3/...)"
                            : "Wedding 3 (wedding3/...)"}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="invitationType"
                    className="mb-2 block text-sm font-medium text-gray-700"
                  >
                    Invitation Type
                  </label>

                  <select
                    id="invitationType"
                    value={invitationType}
                    onChange={(e) => {
                      setInvitationType(
                        e.target.value as InvitationType
                      );
                      setGeneratedUrl("");
                      setQrCode("");
                      setError("");
                      setSuccess("");
                    }}
                    required
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm outline-none focus:border-[#8c6b45] focus:ring-1 focus:ring-[#8c6b45]"
                  >
                    <option value="Single">Single</option>
                    <option value="Couple">Couple</option>
                    <option value="Family">Family</option>
                  </select>

                  <p className="mt-2 text-xs text-gray-500">
                    {invitationType === "Couple"
                      ? "Couple invitation automatically admits 2 guests."
                      : invitationType === "Family"
                      ? "Specify the number of family members below."
                      : "Single invitation admits 1 guest."}
                  </p>
                </div>

                {invitationType === "Family" && (
                  <div>
                    <label
                      htmlFor="familyGuestCount"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Family Guest Count
                    </label>

                    <input
                      id="familyGuestCount"
                      type="number"
                      min="1"
                      max="50"
                      step="1"
                      value={familyGuestCount}
                      onChange={(e) =>
                        setFamilyGuestCount(e.target.value)
                      }
                      required
                      className="w-full rounded-lg border border-gray-300 px-3 py-3 text-sm outline-none focus:border-[#8c6b45] focus:ring-1 focus:ring-[#8c6b45]"
                    />

                    <p className="mt-2 text-xs text-gray-500">
                      Enter the total number of people invited in this family.
                    </p>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="guestName"
                    className="mb-2 block text-sm font-medium text-gray-700"
                  >
                    Guest Name
                  </label>

                  <input
                    id="guestName"
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder={
                      invitationType === "Family"
                        ? "e.g. Nethmi Family"
                        : "Enter guest name"
                    }
                    maxLength={100}
                    required
                    className="w-full rounded-lg border border-gray-300 px-3 py-3 text-sm outline-none focus:border-[#8c6b45] focus:ring-1 focus:ring-[#8c6b45]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={generating || events.length === 0}
                  className="w-full rounded-lg bg-[#8c6b45] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#755738] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {generating
                    ? "Generating Invitation..."
                    : "Generate Invitation & QR Code"}
                </button>
              </form>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
              <h2 className="mb-5 text-lg font-semibold text-gray-900">
                Generated Invitation
              </h2>

              {!generatedUrl || !qrCode ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 px-5 py-10 text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#f7f0e7] text-2xl text-[#8c6b45]">
                    QR
                  </div>

                  <p className="text-sm font-medium text-gray-700">
                    Your QR code will appear here
                  </p>

                  <p className="mt-2 max-w-xs text-xs leading-5 text-gray-500">
                    Select an event, choose the invitation type, and enter the guest details.
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex justify-center rounded-lg bg-white p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrCode}
                      alt="Guest invitation QR code"
                      className="h-auto w-full max-w-[280px]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="generatedUrl"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Public Invitation URL
                    </label>

                    <input
                      id="generatedUrl"
                      type="text"
                      value={generatedUrl}
                      readOnly
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-3 text-xs text-gray-700"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={copyUrl}
                      className="rounded-lg border border-[#8c6b45] px-4 py-3 text-sm font-semibold text-[#8c6b45] hover:bg-[#faf6f1]"
                    >
                      Copy URL
                    </button>

                    <button
                      type="button"
                      onClick={downloadQr}
                      className="rounded-lg bg-[#8c6b45] px-4 py-3 text-sm font-semibold text-white hover:bg-[#755738]"
                    >
                      Download QR
                    </button>
                  </div>

                  <a
                    href={generatedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg border border-gray-200 px-4 py-3 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Open Invitation
                  </a>
                </div>
              )}
            </section>
          </div>
        )}

        {guests.length > 0 && (
          <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Invitations Created This Session
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500">
                    <th className="px-3 py-3 font-medium">
                      Guest Name
                    </th>
                    <th className="px-3 py-3 font-medium">
                      Type
                    </th>
                    <th className="px-3 py-3 font-medium">
                      Guest Count
                    </th>
                    <th className="px-3 py-3 font-medium">
                      RSVP Status
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {guests.map((guest) => (
                    <tr
                      key={guest.wedding_invitation_id}
                      className="border-b border-gray-100 last:border-0"
                    >
                      <td className="px-3 py-3 font-medium text-gray-900">
                        {guest.guest_name}
                      </td>

                      <td className="px-3 py-3 capitalize text-gray-600">
                        {guest.invitation_type}
                      </td>

                      <td className="px-3 py-3 text-gray-600">
                        {guest.number_of_guests}
                      </td>

                      <td className="px-3 py-3 capitalize text-gray-600">
                        {guest.rsvp_status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              This list shows invitations created during the current page session.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

export default function NewInvitationPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-gray-50">
          <p className="text-sm text-gray-600">Loading invitations page...</p>
        </main>
      }
    >
      <NewInvitationContent />
    </Suspense>
  );
}
