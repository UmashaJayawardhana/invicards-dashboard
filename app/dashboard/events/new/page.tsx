"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getUserRole } from "@/lib/auth";

export default function CreateEventPage() {
  const router = useRouter();
  const supabase = createClient();

  const [eventType, setEventType] = useState("Wedding");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventVenue, setEventVenue] = useState("");

  const [loading, setLoading] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function checkAuth() {
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          router.replace("/login");
          return;
        }

        const role = getUserRole(user);
        if (role !== "admin") {
          // Customers cannot create events
          router.replace("/dashboard");
          return;
        }

        if (user.email) {
          setEmail(""); // Let admin enter customer's email
        }
      } catch {
        router.replace("/login");
      } finally {
        setAuthChecking(false);
      }
    }

    void checkAuth();
  }, [router, supabase]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage("");

    if (!contactPerson.trim()) {
      setErrorMessage("Please enter a contact person name.");
      return;
    }

    if (!eventDate) {
      setErrorMessage("Please select an event date.");
      return;
    }

    setLoading(true);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase
        .from("events")
        .insert({
          event_type: eventType,
          contact_person: contactPerson.trim(),
          email: email.trim() || null,
          mobile: mobile.trim() || null,
          event_date: eventDate,
          event_time: eventTime ? eventTime : null,
          event_venue: eventVenue.trim() || null,
          owner_user_id: user.id,
          order_date: new Date().toISOString(),
        })
        .select("event_id")
        .single();

      if (error) {
        throw error;
      }

      if (data?.event_id) {
        router.push(`/dashboard/events/${data.event_id}`);
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create event."
      );
      setLoading(false);
    }
  }

  if (authChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed]">
        <p className="text-black">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8f4ed] text-black">
      <header className="border-b border-[#e8ddcc] bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-5">
          <div>
            <p className="text-xs tracking-[0.25em] text-amber-800">
              INVI CARDS
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-black">
              Create New Event
            </h1>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-black hover:bg-gray-50"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-8">
        <div className="rounded-2xl border border-[#e8ddcc] bg-white p-6 sm:p-8">
          <div className="mb-6 border-b border-[#eee5d9] pb-4">
            <h2 className="text-xl font-semibold text-black">
              Event Information
            </h2>
            <p className="mt-1 text-sm text-black">
              Fill in the details for your new event. You can add invitations and guests once the event is created.
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-black">
                  Event Type *
                </label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
                >
                  <option value="Wedding">Wedding</option>
                  <option value="Engagement">Engagement</option>
                  <option value="Reception">Reception</option>
                  <option value="Birthday Party">Birthday Party</option>
                  <option value="Anniversary">Anniversary</option>
                  <option value="Baby Shower">Baby Shower</option>
                  <option value="Housewarming">Housewarming</option>
                  <option value="Corporate Event">Corporate Event</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-black">
                  Contact Person *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black placeholder:text-gray-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-black">
                  Customer Email (Assigned Account)
                </label>
                <input
                  type="email"
                  placeholder="customer@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black placeholder:text-gray-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-black">
                  Mobile Number
                </label>
                <input
                  type="tel"
                  placeholder="+1 234 567 8900"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black placeholder:text-gray-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-black">
                  Event Date *
                </label>
                <input
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-black">
                  Event Time
                </label>
                <input
                  type="time"
                  value={eventTime}
                  onChange={(e) => setEventTime(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-black">
                Event Venue
              </label>
              <input
                type="text"
                placeholder="e.g. Grand Ballroom, Hilton Hotel"
                value={eventVenue}
                onChange={(e) => setEventVenue(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black placeholder:text-gray-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#eee5d9] pt-6">
              <Link
                href="/dashboard"
                className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-black hover:bg-gray-50"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-[#8c6b45] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#745637] disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Event"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
