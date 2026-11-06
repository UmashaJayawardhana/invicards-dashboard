"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type EventData = {
  event_id: number;
  event_type: string;
  contact_person: string;
  event_date: string;
  event_time: string | null;
  event_venue: string | null;
  email: string | null;
  mobile: string | null;
};

type InvitationData = {
  wedding_invitation_id: number;
  event_id: number;
  guest_name: string;
  invitation_type: string;
  number_of_guests: number;
  guest_token: string;
  rsvp_status: string;
  attending_count: number | null;
  responded_at: string | null;
  wish_message: string | null;
  wish_created_at: string | null;
};

type WishItem = {
  wedding_invitation_id: number;
  guest_name: string;
  wish_message: string;
  wish_created_at: string | null;
};

function WeddingInvitationContent() {
  const params = useParams<{
    eventId: string;
    type: string;
    guestName: string;
  }>();
  const searchParams = useSearchParams();

  const eventId = Number(params?.eventId);
  const invitationTypeParam = decodeURIComponent(params?.type || "Single");
  const guestNameParam = decodeURIComponent(params?.guestName || "Honored Guest");
  const tokenParam = searchParams.get("token");

  const [supabase] = useState(() => createClient());

  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<EventData | null>(null);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [wishes, setWishes] = useState<WishItem[]>([]);

  const isCouple = invitationTypeParam.toLowerCase() === "couple";
  const defaultGuestCount = isCouple ? 2 : 1;

  // RSVP state
  const [rsvpStatus, setRsvpStatus] = useState<string>("pending");
  const [attendingCount, setAttendingCount] = useState<number>(defaultGuestCount);
  const [maxGuests, setMaxGuests] = useState<number>(defaultGuestCount);
  const [submittingRsvp, setSubmittingRsvp] = useState(false);
  const [rsvpMessage, setRsvpMessage] = useState("");
  const [rsvpError, setRsvpError] = useState("");

  // Wish state
  const [wishText, setWishText] = useState("");
  const [submittingWish, setSubmittingWish] = useState(false);
  const [wishSuccess, setWishSuccess] = useState("");
  const [wishError, setWishError] = useState("");

  const loadData = useCallback(async () => {
    if (!Number.isSafeInteger(eventId) || eventId < 1) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // 1. Fetch Event Details
      const { data: eventData } = await supabase
        .from("events")
        .select(
          "event_id, event_type, contact_person, event_date, event_time, event_venue, email, mobile"
        )
        .eq("event_id", eventId)
        .maybeSingle();

      if (eventData) {
        setEvent(eventData as EventData);
      }

      // 2. Fetch specific invitation
      let invQuery = supabase
        .from("wedding_invitations")
        .select(
          "wedding_invitation_id, event_id, guest_name, invitation_type, number_of_guests, guest_token, rsvp_status, attending_count, responded_at, wish_message, wish_created_at"
        );

      if (tokenParam) {
        invQuery = invQuery.eq("guest_token", tokenParam);
      } else {
        invQuery = invQuery
          .eq("event_id", eventId)
          .ilike("guest_name", guestNameParam.trim());
      }

      const { data: invData } = await invQuery.maybeSingle();

      if (invData) {
        const item = invData as InvitationData;
        const resolvedType = (item.invitation_type || invitationTypeParam).toLowerCase();
        const resolvedMax =
          resolvedType === "couple"
            ? Math.max(2, item.number_of_guests || 2)
            : item.number_of_guests || 1;

        setInvitation(item);
        setRsvpStatus(item.rsvp_status || "pending");
        setMaxGuests(resolvedMax);
        setAttendingCount(
          item.attending_count && item.attending_count > 0
            ? item.attending_count
            : resolvedMax
        );
        if (item.wish_message) {
          setWishText(item.wish_message);
        }
      }

      // 3. Fetch public wishes for this event
      const { data: wishesData } = await supabase
        .from("wedding_invitations")
        .select("wedding_invitation_id, guest_name, wish_message, wish_created_at")
        .eq("event_id", eventId)
        .not("wish_message", "is", null)
        .order("wish_created_at", { ascending: false })
        .limit(20);

      if (wishesData) {
        const validWishes = wishesData.filter(
          (w) => w.wish_message && w.wish_message.trim().length > 0
        ) as WishItem[];
        setWishes(validWishes);
      }
    } catch (err) {
      console.error("Error loading invitation details:", err);
    } finally {
      setLoading(false);
    }
  }, [eventId, tokenParam, guestNameParam, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Option A: Direct Supabase update for RSVP
  const handleRsvp = async (status: "accepted" | "declined") => {
    if (!invitation) {
      setRsvpError("Invitation details not found. Cannot save RSVP.");
      return;
    }

    setSubmittingRsvp(true);
    setRsvpError("");
    setRsvpMessage("");

    const count = status === "accepted" ? attendingCount : 0;
    const now = new Date().toISOString();

    try {
      const { error } = await supabase
        .from("wedding_invitations")
        .update({
          rsvp_status: status,
          attending_count: count,
          responded_at: now,
        })
        .eq("wedding_invitation_id", invitation.wedding_invitation_id);

      if (error) {
        throw error;
      }

      setRsvpStatus(status);
      setRsvpMessage(
        status === "accepted"
          ? `Thank you! Your RSVP has been confirmed for ${count} guest${count === 1 ? "" : "s"}.`
          : "Thank you for letting us know. Your decline response has been recorded."
      );
    } catch (err) {
      console.error("RSVP update error:", err);
      setRsvpError(
        err instanceof Error
          ? err.message
          : "Unable to save your RSVP. Please verify Supabase permissions."
      );
    } finally {
      setSubmittingRsvp(false);
    }
  };

  // Option A: Direct Supabase update for Wish Message
  const handleSendWish = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = wishText.trim();

    if (!trimmed) {
      setWishError("Please enter your wish message.");
      return;
    }

    if (trimmed.length > 500) {
      setWishError("Wish message cannot exceed 500 characters.");
      return;
    }

    if (!invitation) {
      setWishError("Invitation details not found. Cannot save wish.");
      return;
    }

    setSubmittingWish(true);
    setWishError("");
    setWishSuccess("");

    const now = new Date().toISOString();

    try {
      const { error } = await supabase
        .from("wedding_invitations")
        .update({
          wish_message: trimmed,
          wish_created_at: now,
        })
        .eq("wedding_invitation_id", invitation.wedding_invitation_id);

      if (error) {
        throw error;
      }

      setWishSuccess("Your message has been saved to the guestbook! Thank you!");

      // Update wishes list locally
      setWishes((prev) => {
        const withoutCurrent = prev.filter(
          (w) => w.wedding_invitation_id !== invitation.wedding_invitation_id
        );
        return [
          {
            wedding_invitation_id: invitation.wedding_invitation_id,
            guest_name: invitation.guest_name,
            wish_message: trimmed,
            wish_created_at: now,
          },
          ...withoutCurrent,
        ];
      });
    } catch (err) {
      console.error("Wish update error:", err);
      setWishError(
        err instanceof Error
          ? err.message
          : "Unable to save your wish. Please verify Supabase permissions."
      );
    } finally {
      setSubmittingWish(false);
    }
  };

  const displayName = invitation?.guest_name || guestNameParam;
  const coupleTitle = event?.contact_person || "The Happy Couple";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fcf9f4]">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#c2a679] border-t-transparent"></div>
          <p className="mt-4 font-serif text-lg text-black">
            Loading your wedding invitation...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fcf9f4] font-serif text-black selection:bg-[#c2a679] selection:text-white">
      {/* Hero Header */}
      <header className="relative overflow-hidden border-b border-[#e8ddcc] bg-gradient-to-b from-[#f5ede0] to-[#fcf9f4] px-4 py-16 text-center sm:py-24">
        <div className="mx-auto max-w-3xl">
          <span className="inline-block rounded-full border border-[#c2a679] bg-[#fbf7f0] px-4 py-1 text-xs font-sans uppercase tracking-widest text-[#8c6b45]">
            Wedding Invitation
          </span>
          <h1 className="mt-6 text-4xl font-normal text-black sm:text-6xl md:text-7xl">
            {coupleTitle}
          </h1>
          <p className="mt-4 text-lg italic text-[#555] sm:text-xl">
            Request the honor of your presence to celebrate their wedding
          </p>

          <div className="mx-auto mt-8 h-px w-24 bg-[#c2a679]"></div>

          <div className="mt-8 inline-block rounded-2xl border border-[#e8ddcc] bg-white/80 px-6 py-4 shadow-sm backdrop-blur-xs">
            <p className="font-sans text-xs uppercase tracking-wider text-[#777]">
              Cordially Invited
            </p>
            <p className="mt-1 text-2xl font-semibold text-black">
              {displayName}
            </p>
            <p className="mt-1 font-sans text-xs text-[#8c6b45]">
              Invitation: {invitation?.invitation_type || invitationTypeParam} • Maximum {maxGuests} guest{maxGuests === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>

      {/* Main Details & Interactive Sections */}
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        {/* Event Details Card */}
        {event && (
          <section className="mb-12 rounded-3xl border border-[#e8ddcc] bg-white p-6 shadow-sm sm:p-10">
            <h2 className="text-center text-2xl font-medium text-black sm:text-3xl">
              Celebration Details
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-3 text-center">
              <div className="rounded-2xl border border-[#eee5d9] bg-[#fbf7f0] p-5">
                <p className="font-sans text-xs uppercase tracking-wider text-[#777]">
                  Date
                </p>
                <p className="mt-2 text-xl font-semibold text-black">
                  {event.event_date}
                </p>
              </div>
              <div className="rounded-2xl border border-[#eee5d9] bg-[#fbf7f0] p-5">
                <p className="font-sans text-xs uppercase tracking-wider text-[#777]">
                  Time
                </p>
                <p className="mt-2 text-xl font-semibold text-black">
                  {event.event_time || "To Be Announced"}
                </p>
              </div>
              <div className="rounded-2xl border border-[#eee5d9] bg-[#fbf7f0] p-5">
                <p className="font-sans text-xs uppercase tracking-wider text-[#777]">
                  Venue
                </p>
                <p className="mt-2 text-xl font-semibold text-black">
                  {event.event_venue || "Venue details to follow"}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* RSVP Section (Option A direct Supabase) */}
        <section
          id="rsvp"
          className="mb-12 rounded-3xl border border-[#e8ddcc] bg-white p-6 shadow-sm sm:p-10"
        >
          <div className="text-center">
            <span className="font-sans text-xs uppercase tracking-widest text-[#8c6b45]">
              RSVP
            </span>
            <h2 className="mt-2 text-3xl font-medium text-black sm:text-4xl">
              Will You Join Us?
            </h2>
            <p className="mx-auto mt-3 max-w-md font-sans text-sm text-[#555]">
              Please respond to let us know if you can share this special celebration with us.
            </p>
          </div>

          {/* Guest Count Selector */}
          <div className="mx-auto mt-8 max-w-md rounded-2xl border border-[#e8ddcc] bg-[#fbf7f0] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-sans text-sm font-semibold text-black">
                  Attending Guests
                </p>
                <p className="font-sans text-xs text-[#666]">
                  Up to {maxGuests} invited guest{maxGuests === 1 ? "" : "s"}
                </p>
              </div>
              <span className="rounded-full bg-[#e8ddcc] px-3 py-1 font-sans text-sm font-semibold text-black">
                {attendingCount} {attendingCount === 1 ? "Guest" : "Guests"}
              </span>
            </div>

            <div className="mt-5 flex items-center justify-center gap-6">
              <button
                type="button"
                onClick={() => setAttendingCount((prev) => Math.max(1, prev - 1))}
                disabled={attendingCount <= 1 || submittingRsvp}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#c2a679] text-2xl font-bold text-black transition hover:bg-[#e8ddcc] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Decrease guest count"
              >
                −
              </button>
              <span className="min-w-10 text-center font-sans text-3xl font-bold text-black">
                {attendingCount}
              </span>
              <button
                type="button"
                onClick={() =>
                  setAttendingCount((prev) => Math.min(maxGuests, prev + 1))
                }
                disabled={attendingCount >= maxGuests || submittingRsvp}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#c2a679] text-2xl font-bold text-black transition hover:bg-[#e8ddcc] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Increase guest count"
              >
                +
              </button>
            </div>
            <p className="mt-3 text-center font-sans text-xs text-[#777]">
              Adjust count if only part of your party will attend.
            </p>
          </div>

          {/* Decision Buttons */}
          <div className="mx-auto mt-8 grid max-w-md gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => handleRsvp("accepted")}
              disabled={submittingRsvp}
              className={`flex items-center justify-center gap-2 rounded-xl border px-5 py-4 font-sans font-medium transition ${
                rsvpStatus === "accepted"
                  ? "border-[#8c6b45] bg-[#8c6b45] text-white shadow-md"
                  : "border-[#c2a679] bg-white text-black hover:bg-[#fbf7f0]"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <svg
                className="h-5 w-5"
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
              Joyfully Accept
            </button>

            <button
              type="button"
              onClick={() => handleRsvp("declined")}
              disabled={submittingRsvp}
              className={`flex items-center justify-center gap-2 rounded-xl border px-5 py-4 font-sans font-medium transition ${
                rsvpStatus === "declined"
                  ? "border-[#555] bg-[#555] text-white shadow-md"
                  : "border-[#e8ddcc] bg-white text-black hover:bg-[#fbf7f0]"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Regretfully Decline
            </button>
          </div>

          {/* Status Feedback */}
          {rsvpMessage && (
            <div className="mx-auto mt-6 max-w-md rounded-xl border border-[#c2a679] bg-[#fbf7f0] p-4 text-center font-sans text-sm font-medium text-black">
              {rsvpMessage}
            </div>
          )}

          {rsvpError && (
            <div className="mx-auto mt-6 max-w-md rounded-xl border border-red-300 bg-red-50 p-4 text-center font-sans text-sm text-red-800">
              {rsvpError}
            </div>
          )}
        </section>

        {/* Guest Wishes & Guestbook Section */}
        <section className="rounded-3xl border border-[#e8ddcc] bg-white p-6 shadow-sm sm:p-10">
          <div className="text-center">
            <span className="font-sans text-xs uppercase tracking-widest text-[#8c6b45]">
              Guestbook
            </span>
            <h2 className="mt-2 text-3xl font-medium text-black sm:text-4xl">
              Leave a Message
            </h2>
            <p className="mx-auto mt-3 max-w-md font-sans text-sm text-[#555]">
              Share your warm wishes and blessings with the couple.
            </p>
          </div>

          <form onSubmit={handleSendWish} className="mx-auto mt-8 max-w-xl space-y-4">
            <div>
              <label
                htmlFor="wish"
                className="block font-sans text-xs font-semibold uppercase tracking-wider text-black"
              >
                Your Message
              </label>
              <textarea
                id="wish"
                rows={4}
                maxLength={500}
                value={wishText}
                onChange={(e) => setWishText(e.target.value)}
                placeholder="Write your wishes for the happy couple..."
                className="mt-2 w-full rounded-2xl border border-[#e8ddcc] bg-[#fbf7f0] p-4 font-sans text-sm text-black outline-none focus:border-[#8c6b45]"
              />
              <div className="mt-1 flex justify-between font-sans text-xs text-[#777]">
                <span>Max 500 characters</span>
                <span>{wishText.length} / 500</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submittingWish || !wishText.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#8c6b45] px-6 py-4 font-sans text-sm font-semibold text-white shadow-sm transition hover:bg-[#745637] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submittingWish ? "Saving Message..." : "Send Your Wishes"}
            </button>

            {wishSuccess && (
              <p className="text-center font-sans text-sm font-medium text-emerald-700">
                {wishSuccess}
              </p>
            )}

            {wishError && (
              <p className="text-center font-sans text-sm text-red-700">
                {wishError}
              </p>
            )}
          </form>

          {/* Wishes Display */}
          <div className="mt-14 border-t border-[#eee5d9] pt-10">
            <h3 className="text-center text-2xl font-medium text-black">
              Words of Love
            </h3>

            {wishes.length === 0 ? (
              <p className="mt-6 text-center font-sans text-sm text-[#777]">
                Be the first to leave a message for the couple!
              </p>
            ) : (
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {wishes.map((w) => (
                  <article
                    key={w.wedding_invitation_id}
                    className="rounded-2xl border border-[#eee5d9] bg-[#fbf7f0] p-5 shadow-xs"
                  >
                    <p className="font-sans text-sm leading-relaxed text-black">
                      &ldquo;{w.wish_message}&rdquo;
                    </p>
                    <div className="mt-4 border-t border-[#e8ddcc] pt-3">
                      <p className="font-sans text-xs font-semibold text-black">
                        {w.guest_name}
                      </p>
                      {w.wish_created_at && (
                        <p className="font-sans text-[11px] text-[#777]">
                          {new Date(w.wish_created_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e8ddcc] bg-[#f5ede0] py-10 text-center font-sans text-xs text-[#777]">
        <p>Created with InviCards • Wedding Celebration</p>
      </footer>
    </div>
  );
}

export default function WeddingInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#fcf9f4]">
          <p className="font-serif text-lg text-black">
            Loading invitation...
          </p>
        </div>
      }
    >
      <WeddingInvitationContent />
    </Suspense>
  );
}
