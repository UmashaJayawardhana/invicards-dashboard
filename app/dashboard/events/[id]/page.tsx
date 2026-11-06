"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { getUserRole, UserRole } from "@/lib/auth";
import { buildGuestInvitationUrl } from "@/lib/url";

type EventDetails = {
  event_id: number;
  event_type: string;
  contact_person: string;
  email: string | null;
  mobile: string | null;
  event_date: string;
  event_time: string | null;
  event_venue: string | null;
  order_date: string | null;
};

type GuestInvitation = {
  wedding_invitation_id: number;
  guest_name: string;
  invitation_type: string;
  number_of_guests: number;
  rsvp_status: string;
  attending_count: number | null;
  responded_at: string | null;
  wish_message: string | null;
  created_at: string;
};

type QrModalState = {
  name: string;
  type: string;
  url: string;
  qrDataUrl: string;
};

function ManageEventContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventDetails | null>(null);
  const [guests, setGuests] = useState<GuestInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [userRole, setUserRole] = useState<UserRole>("customer");

  // QR and link modal states
  const [selectedQr, setSelectedQr] = useState<QrModalState | null>(null);
  const [generatingQrId, setGeneratingQrId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [modalCopied, setModalCopied] = useState(false);

  const eventId = Number(params?.id);

  const loadEvent = useCallback(async () => {
    if (!Number.isSafeInteger(eventId) || eventId < 1) {
      setError("Invalid event ID.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
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

      setEmail(user.email ?? "");
      const role = getUserRole(user);
      setUserRole(role);

      const { data: eventData, error: eventError } = await supabase
        .from("events")
        .select(
          "event_id, event_type, contact_person, email, mobile, event_date, event_time, event_venue, order_date, owner_user_id"
        )
        .eq("event_id", eventId)
        .maybeSingle();

      if (eventError) throw eventError;

      if (!eventData) {
        setError(`Event #${eventId} was not found.`);
        return;
      }

      // Customer permission check: only allow own event
      if (role === "customer") {
        const isOwner =
          eventData.owner_user_id === user.id ||
          (Boolean(eventData.email && user.email) &&
            eventData.email?.trim().toLowerCase() === user.email?.trim().toLowerCase()) ||
          (Boolean(eventData.contact_person && user.user_metadata?.full_name) &&
            eventData.contact_person?.trim().toLowerCase() === user.user_metadata?.full_name?.trim().toLowerCase());

        if (!isOwner) {
          setError(
            "Access Denied: You do not have permission to manage this event. Customers can only manage their own events."
          );
          return;
        }

        // If matched by email/name but owner_user_id was set to admin, auto-claim it!
        if (eventData.owner_user_id !== user.id && user.id) {
          void supabase
            .from("events")
            .update({ owner_user_id: user.id })
            .eq("event_id", eventId);
        }
      }

      setEvent(eventData as EventDetails);

      const { data: guestData, error: guestError } = await supabase
        .from("wedding_invitations")
        .select(
          "wedding_invitation_id, guest_name, invitation_type, number_of_guests, rsvp_status, attending_count, responded_at, wish_message, created_at"
        )
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });

      if (guestError) throw guestError;

      setGuests((guestData ?? []) as GuestInvitation[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load this event."
      );
    } finally {
      setLoading(false);
    }
  }, [eventId, router]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  // Generate public invitation URL
  const getGuestUrl = (guest: GuestInvitation): string => {
    if (!event) return "";
    return buildGuestInvitationUrl(
      event.event_id,
      guest.invitation_type,
      guest.guest_name
    );
  };

  // Generate QR code and open modal
  const handleOpenQrModal = async (guest: GuestInvitation) => {
    const url = getGuestUrl(guest);
    if (!url) return;

    setGeneratingQrId(guest.wedding_invitation_id);
    setModalCopied(false);

    try {
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: "H",
      });

      setSelectedQr({
        name: guest.guest_name,
        type: guest.invitation_type,
        url,
        qrDataUrl,
      });
    } catch (err) {
      console.error("Failed to generate QR code:", err);
    } finally {
      setGeneratingQrId(null);
    }
  };

  // Quick copy URL to clipboard from table
  const handleQuickCopy = async (guest: GuestInvitation) => {
    const url = getGuestUrl(guest);
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(guest.wedding_invitation_id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      // ignore clipboard error
    }
  };

  // Modal copy URL
  const handleModalCopy = async () => {
    if (!selectedQr) return;
    try {
      await navigator.clipboard.writeText(selectedQr.url);
      setModalCopied(true);
      setTimeout(() => setModalCopied(false), 2500);
    } catch {
      // ignore clipboard error
    }
  };

  // Download QR Code image
  const handleDownloadQr = () => {
    if (!selectedQr) return;
    const link = document.createElement("a");
    link.href = selectedQr.qrDataUrl;
    link.download = `invitation-${selectedQr.name.toLowerCase().replace(/\s+/g, "-")}.png`;
    link.click();
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed]">
        <p className="text-black">Loading event...</p>
      </main>
    );
  }

  // Calculate statistics
  const totalInvitedGuests = guests.reduce(
    (sum, guest) => sum + (guest.number_of_guests || 1),
    0
  );

  const acceptedInvitations = guests.filter(
    (guest) => guest.rsvp_status === "accepted"
  ).length;

  const acceptedGuestCount = guests
    .filter((guest) => guest.rsvp_status === "accepted")
    .reduce((sum, guest) => {
      const count =
        typeof guest.attending_count === "number" && guest.attending_count >= 0
          ? guest.attending_count
          : guest.number_of_guests || 1;
      return sum + count;
    }, 0);

  const declinedInvitations = guests.filter(
    (guest) => guest.rsvp_status === "declined"
  ).length;

  const pendingInvitations = guests.filter(
    (guest) => guest.rsvp_status === "pending"
  ).length;

  const wishCount = guests.filter(
    (guest) => guest.wish_message?.trim()
  ).length;

  return (
    <main className="min-h-screen bg-[#f8f4ed] text-black">
      <header className="border-b border-[#e8ddcc] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs tracking-[0.25em] text-amber-800">
                INVI CARDS
              </p>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  userRole === "admin"
                    ? "bg-amber-100 text-amber-900 border border-amber-300"
                    : "bg-emerald-100 text-emerald-900 border border-emerald-300"
                }`}
              >
                {userRole}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-black">
              Manage Event
            </h1>
            <p className="mt-1 text-sm text-black">{email}</p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-black hover:bg-gray-50 font-medium"
          >
            ← Back to {userRole === "admin" ? "Admin" : "Customer"} Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-5 py-8">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"
          >
            {error}
            <div className="mt-3">
              <Link href="/dashboard" className="text-sm font-medium underline">
                Return to dashboard
              </Link>
            </div>
          </div>
        )}

        {event && (
          <>
            {/* Event Summary Card */}
            <section className="rounded-2xl border border-[#e8ddcc] bg-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    Event #{event.event_id}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold capitalize text-black">
                    {event.event_type.replaceAll("_", " ")}
                  </h2>
                  <p className="mt-2 text-sm text-black">
                    Created{" "}
                    {event.order_date
                      ? new Date(event.order_date).toLocaleDateString()
                      : "—"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => void loadEvent()}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-black hover:bg-gray-50"
                  >
                    Refresh
                  </button>
                  <Link
                    href={`/dashboard/invitations/new?eventId=${event.event_id}`}
                    className="rounded-lg bg-[#8c6b45] px-4 py-2 text-sm font-medium text-white hover:bg-[#745637]"
                  >
                    + Create Invitations
                  </Link>
                </div>
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border border-[#eee5d9] p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-black">Contact Person</p>
                  <p className="mt-1 font-semibold text-black">{event.contact_person}</p>
                </div>
                <div className="rounded-lg border border-[#eee5d9] p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-black">Event Date</p>
                  <p className="mt-1 font-semibold text-black">{event.event_date}</p>
                </div>
                <div className="rounded-lg border border-[#eee5d9] p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-black">Event Time</p>
                  <p className="mt-1 font-semibold text-black">{event.event_time || "—"}</p>
                </div>
                <div className="rounded-lg border border-[#eee5d9] p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-black">Venue</p>
                  <p className="mt-1 font-semibold text-black">{event.event_venue || "—"}</p>
                </div>
                <div className="rounded-lg border border-[#eee5d9] p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-black">Email</p>
                  <p className="mt-1 break-words font-semibold text-black">{event.email || "—"}</p>
                </div>
                <div className="rounded-lg border border-[#eee5d9] p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-black">Mobile</p>
                  <p className="mt-1 font-semibold text-black">{event.mobile || "—"}</p>
                </div>
              </div>
            </section>

            {/* Guest Count & RSVP Metrics */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-[#e8ddcc] bg-white p-5 shadow-xs">
                <p className="text-sm font-medium text-black">Total Invited Guests</p>
                <p className="mt-3 text-3xl font-semibold text-black">
                  {totalInvitedGuests}
                </p>
                <p className="mt-1 text-xs text-black">
                  Across {guests.length} invitation{guests.length === 1 ? "" : "s"}
                </p>
              </div>

              <div className="rounded-2xl border border-[#e8ddcc] bg-white p-5 shadow-xs">
                <p className="text-sm font-medium text-emerald-800">Accepted (Attending)</p>
                <p className="mt-3 text-3xl font-semibold text-emerald-700">
                  {acceptedGuestCount}
                </p>
                <p className="mt-1 text-xs text-black">
                  From {acceptedInvitations} accepted invitation{acceptedInvitations === 1 ? "" : "s"}
                </p>
              </div>

              <div className="rounded-2xl border border-[#e8ddcc] bg-white p-5 shadow-xs">
                <p className="text-sm font-medium text-red-800">Declined Invitations</p>
                <p className="mt-3 text-3xl font-semibold text-red-700">
                  {declinedInvitations}
                </p>
                <p className="mt-1 text-xs text-black">
                  {declinedInvitations} guest{declinedInvitations === 1 ? "" : "s"} declined
                </p>
              </div>

              <div className="rounded-2xl border border-[#e8ddcc] bg-white p-5 shadow-xs">
                <p className="text-sm font-medium text-amber-800">Pending Responses</p>
                <p className="mt-3 text-3xl font-semibold text-amber-700">
                  {pendingInvitations}
                </p>
                <p className="mt-1 text-xs text-black">
                  Awaiting guest response
                </p>
              </div>
            </section>

            {/* Guest Invitations Table with QR & URL Actions */}
            <section className="rounded-2xl border border-[#e8ddcc] bg-white p-6 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-black">
                    Guest Invitations
                  </h2>
                  <p className="mt-1 text-sm text-black">
                    {guests.length} invitation{guests.length === 1 ? "" : "s"} • {totalInvitedGuests} total invited guests • {acceptedGuestCount} confirmed attending • {wishCount} wish{wishCount === 1 ? "" : "es"}.
                  </p>
                </div>
                <Link
                  href={`/dashboard/invitations/new?eventId=${event.event_id}`}
                  className="rounded-lg bg-[#8c6b45] px-4 py-2 text-sm font-medium text-white hover:bg-[#745637]"
                >
                  + Add Guests
                </Link>
              </div>

              {guests.length === 0 ? (
                <div className="mt-5 rounded-lg border border-dashed border-[#e8ddcc] p-8 text-center">
                  <p className="text-sm text-black">
                    No guest invitations have been added to this event yet.
                  </p>
                  <Link
                    href={`/dashboard/invitations/new?eventId=${event.event_id}`}
                    className="mt-4 inline-block rounded-lg bg-[#8c6b45] px-4 py-2 text-sm font-medium text-white hover:bg-[#745637]"
                  >
                    Create your first invitation
                  </Link>
                </div>
              ) : (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[950px] text-left text-sm text-black">
                    <thead>
                      <tr className="border-b border-[#e8ddcc] text-black">
                        <th className="py-3 pr-4 font-semibold text-black">Guest name</th>
                        <th className="py-3 pr-4 font-semibold text-black">Type</th>
                        <th className="py-3 pr-4 font-semibold text-black">Invited</th>
                        <th className="py-3 pr-4 font-semibold text-black">RSVP</th>
                        <th className="py-3 pr-4 font-semibold text-black">Attending</th>
                        <th className="py-3 pr-4 font-semibold text-black">Wish</th>
                        <th className="py-3 font-semibold text-black">QR / Invitation Link</th>
                      </tr>
                    </thead>
                    <tbody className="text-black">
                      {guests.map((guest) => {
                        const isCopied = copiedId === guest.wedding_invitation_id;
                        const isGenerating = generatingQrId === guest.wedding_invitation_id;
                        const guestUrl = getGuestUrl(guest);

                        return (
                          <tr
                            key={guest.wedding_invitation_id}
                            className="border-b border-[#eee5d9] last:border-0 text-black hover:bg-[#faf6f1]/50"
                          >
                            <td className="py-3 pr-4 font-semibold text-black">
                              {guest.guest_name}
                            </td>
                            <td className="py-3 pr-4 capitalize text-black">
                              {guest.invitation_type}
                            </td>
                            <td className="py-3 pr-4 text-black">
                              <span className="inline-flex items-center rounded-full bg-[#f4ebe1] px-2.5 py-0.5 text-xs font-semibold text-black">
                                {guest.number_of_guests} {guest.number_of_guests === 1 ? "Guest" : "Guests"}
                              </span>
                            </td>
                            <td className="py-3 pr-4 capitalize font-medium text-black">
                              <span
                                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                  guest.rsvp_status === "accepted"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : guest.rsvp_status === "declined"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {guest.rsvp_status}
                              </span>
                            </td>
                            <td className="py-3 pr-4 text-black">
                              {guest.rsvp_status === "accepted" ? (
                                <span className="font-semibold text-black">
                                  {guest.attending_count ?? guest.number_of_guests}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="max-w-xs py-3 pr-4 text-black">
                              <span
                                title={guest.wish_message || ""}
                                className="block truncate text-black text-xs"
                              >
                                {guest.wish_message?.trim() || "—"}
                              </span>
                            </td>
                            <td className="py-3 text-black">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleOpenQrModal(guest)}
                                  disabled={isGenerating}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#c2a679] bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-[#fbf7f0] transition disabled:opacity-50"
                                  title="View and download QR code"
                                >
                                  <svg
                                    className="h-3.5 w-3.5 text-[#8c6b45]"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                                    />
                                  </svg>
                                  {isGenerating ? "Generating..." : "View QR"}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleQuickCopy(guest)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-gray-50 transition"
                                  title="Copy public invitation link"
                                >
                                  {isCopied ? (
                                    <>
                                      <svg
                                        className="h-3.5 w-3.5 text-emerald-600"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M5 13l4 4L19 7"
                                        />
                                      </svg>
                                      <span className="text-emerald-700 font-semibold">Copied!</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg
                                        className="h-3.5 w-3.5 text-gray-600"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                        />
                                      </svg>
                                      Copy Link
                                    </>
                                  )}
                                </button>

                                <a
                                  href={guestUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-1.5 text-black hover:bg-gray-100 transition"
                                  title="Open invitation in new tab"
                                >
                                  <svg
                                    className="h-3.5 w-3.5 text-black"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                    />
                                  </svg>
                                </a>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* QR Code & Link Modal */}
      {selectedQr && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-3xl border border-[#e8ddcc] bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between">
              <div>
                <span className="rounded-full bg-[#f4ebe1] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#8c6b45]">
                  {selectedQr.type} Invitation
                </span>
                <h3 className="mt-2 text-xl font-semibold text-black">
                  {selectedQr.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedQr(null)}
                className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-black transition"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* QR Code Image Preview */}
            <div className="my-6 flex justify-center rounded-2xl border border-[#eee5d9] bg-[#fcf9f4] p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedQr.qrDataUrl}
                alt={`Invitation QR code for ${selectedQr.name}`}
                className="h-auto w-full max-w-[240px] rounded-lg shadow-xs"
              />
            </div>

            {/* Public URL Input */}
            <div>
              <label
                htmlFor="modalUrl"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-black"
              >
                Public Invitation URL
              </label>
              <input
                id="modalUrl"
                type="text"
                readOnly
                value={selectedQr.url}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3.5 py-2.5 text-xs text-black outline-none focus:border-[#8c6b45]"
              />
            </div>

            {/* Modal Action Buttons */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleModalCopy}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-[#8c6b45] px-4 py-3 text-xs font-semibold text-[#8c6b45] hover:bg-[#faf6f1] transition"
              >
                {modalCopied ? "✓ Link Copied!" : "Copy Link"}
              </button>

              <button
                type="button"
                onClick={handleDownloadQr}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#8c6b45] px-4 py-3 text-xs font-semibold text-white hover:bg-[#745637] transition shadow-xs"
              >
                Download QR
              </button>
            </div>

            <div className="mt-3">
              <a
                href={selectedQr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 text-center text-xs font-medium text-black hover:bg-gray-50 transition"
              >
                Open Invitation in New Tab →
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ManageEventPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed]">
          <p className="text-black">Loading event...</p>
        </main>
      }
    >
      <ManageEventContent />
    </Suspense>
  );
}
