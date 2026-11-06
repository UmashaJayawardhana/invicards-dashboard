"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { fetchUserRole, UserRole } from "@/lib/auth";
import { buildGuestInvitationUrl } from "@/lib/url";

type DashboardEvent = {
  event_id: number;
  event_type: string;
  contact_person: string;
  email: string | null;
  mobile: string | null;
  event_date: string;
  event_time: string | null;
  event_venue: string | null;
  created_at: string | null;
  owner_user_id?: string | null;
};

type DashboardInvitation = {
  wedding_invitation_id: number;
  event_id: number;
  guest_name: string;
  invitation_type: string;
  rsvp_status: string;
  wish_message: string | null;
  created_at: string;
  number_of_guests?: number;
  attending_count?: number | null;
  guest_token?: string | null;
};

type QrModalState = {
  name: string;
  type: string;
  url: string;
  qrDataUrl: string;
};

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [role, setRole] = useState<UserRole>("customer");
  const [actualRole, setActualRole] = useState<UserRole>("customer");
  const [roleUpdating, setRoleUpdating] = useState(false);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [invitations, setInvitations] = useState<DashboardInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Quick Invitation URL generator state for Customer
  const [quickGuestName, setQuickGuestName] = useState("");
  const [quickGuestType, setQuickGuestType] = useState<"Single" | "Couple" | "Family">("Single");
  const [quickFamilyCount, setQuickFamilyCount] = useState("4");
  const [quickEventId, setQuickEventId] = useState<string>("");
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickSuccessUrl, setQuickSuccessUrl] = useState("");
  const [quickMessage, setQuickMessage] = useState("");

  // QR Modal and Copy feedback states
  const [selectedQr, setSelectedQr] = useState<QrModalState | null>(null);
  const [generatingQrId, setGeneratingQrId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [modalCopied, setModalCopied] = useState(false);

  const loadDashboardData = useCallback(
    async (currentRole: UserRole, uid: string, uemail: string) => {
      setLoading(true);
      setErrorMessage("");

      try {
        let eventsList: DashboardEvent[] = [];
        let invitationsList: DashboardInvitation[] = [];

        if (currentRole === "admin") {
          // ADMIN: load all events across the platform
          const { data: eventData, error: eventError } = await supabase
            .from("events")
            .select(
              "event_id, event_type, contact_person, email, mobile, event_date, event_time, event_venue, order_date, owner_user_id"
            )
            .order("event_id", { ascending: false });

          if (eventError) {
            console.error("Admin events load error:", eventError);
            throw new Error(`Could not load events: ${eventError.message}`);
          }

          eventsList = (eventData ?? []).map((event) => ({
            ...event,
            created_at: event.order_date,
          })) as DashboardEvent[];

          // Load recent invitations across all events (non-fatal if invitations fails)
          try {
            const { data: invData, error: invError } = await supabase
              .from("wedding_invitations")
              .select(
                "wedding_invitation_id, event_id, guest_name, invitation_type, rsvp_status, wish_message, created_at, number_of_guests, attending_count, guest_token"
              )
              .order("created_at", { ascending: false })
              .limit(150);

            if (invError) {
              console.warn("Could not load invitations:", invError.message);
            } else if (invData) {
              invitationsList = invData as DashboardInvitation[];
            }
          } catch (invErr) {
            console.warn("Failed fetching invitations for admin:", invErr);
          }
        } else {
          // CUSTOMER: load events from public.events owned by this customer
          let ownedEvents: any[] = [];
          if (uid) {
            const { data: byOwner, error: ownerError } = await supabase
              .from("events")
              .select(
                "event_id, event_type, contact_person, email, mobile, event_date, event_time, event_venue, order_date, owner_user_id"
              )
              .eq("owner_user_id", uid)
              .order("event_id", { ascending: false });

            if (ownerError) {
              console.error("Error loading owned events:", ownerError);
            } else if (byOwner) {
              ownedEvents = byOwner;
            }
          }

          // Also check if any event was assigned to this customer by email
          let emailEvents: any[] = [];
          if (uemail) {
            const { data: byEmail, error: emailError } = await supabase
              .from("events")
              .select(
                "event_id, event_type, contact_person, email, mobile, event_date, event_time, event_venue, order_date, owner_user_id"
              )
              .ilike("email", uemail.trim())
              .order("order_date", { ascending: false });

            if (!emailError && byEmail) {
              emailEvents = byEmail;
            }
          }

          // Also check if contact person matches customer name in customer_profiles
          let nameEvents: any[] = [];
          const { data: prof } = await supabase
            .from("customer_profiles")
            .select("full_name")
            .eq("user_id", uid)
            .maybeSingle();

          const customerName = prof?.full_name?.trim();
          if (customerName) {
            const { data: byName } = await supabase
              .from("events")
              .select(
                "event_id, event_type, contact_person, email, mobile, event_date, event_time, event_venue, order_date, owner_user_id"
              )
              .ilike("contact_person", customerName)
              .order("order_date", { ascending: false });

            if (byName) {
              nameEvents = byName;
            }
          }

          // Combine and deduplicate by event_id
          const eventsMap = new Map<number, DashboardEvent>();
          for (const ev of [...ownedEvents, ...emailEvents, ...nameEvents]) {
            eventsMap.set(ev.event_id, {
              ...ev,
              created_at: ev.order_date,
            });

            // If an event belongs to this customer by email/name but owner_user_id is pointing elsewhere, claim it!
            if (ev.owner_user_id !== uid && uid) {
              void supabase
                .from("events")
                .update({ owner_user_id: uid })
                .eq("event_id", ev.event_id);
            }
          }

          eventsList = Array.from(eventsMap.values());

          if (eventsList.length > 0) {
            // Set default event for quick URL creator
            setQuickEventId(String(eventsList[0].event_id));

            const eventIds = eventsList.map((e) => e.event_id);
            const { data: invData, error: invError } = await supabase
              .from("wedding_invitations")
              .select(
                "wedding_invitation_id, event_id, guest_name, invitation_type, rsvp_status, wish_message, created_at, number_of_guests, attending_count, guest_token"
              )
              .in("event_id", eventIds)
              .order("created_at", { ascending: false });

            if (invError) {
              console.warn("Could not load invitations:", invError.message);
            } else {
              invitationsList = (invData ?? []) as DashboardInvitation[];
            }
          }
        }

        setEvents(eventsList);
        setInvitations(invitationsList);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "An unexpected error occurred."
        );
      } finally {
        setLoading(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          router.replace("/login");
          return;
        }

        if (!active) return;

        const detectedRole = await fetchUserRole(supabase, user);
        const userEmail = user.email ?? "";
        const id = user.id;

        // Check customer account status (must be active / true)
        if (detectedRole === "customer") {
          try {
            const { data: profile } = await supabase
              .from("customer_profiles")
              .select("*")
              .eq("user_id", id)
              .maybeSingle();

            if (profile) {
              const isInactive =
                profile.status === false ||
                profile.status === "false" ||
                profile.status === "inactive" ||
                profile.status === "disabled" ||
                profile.is_active === false ||
                profile.is_active === "false";

              if (isInactive) {
                await supabase.auth.signOut();
                if (active) router.replace("/login?error=inactive");
                return;
              }
            }
          } catch (statusErr) {
            console.warn("Could not verify customer active status on dashboard:", statusErr);
          }
        }

        setEmail(userEmail);
        setCurrentUserId(id);
        setRole(detectedRole);
        setActualRole(detectedRole);

        await loadDashboardData(detectedRole, id, userEmail);
      } catch {
        if (active) router.replace("/login");
      }
    }

    void init();

    return () => {
      active = false;
    };
  }, [loadDashboardData, router, supabase]);

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(`Could not log out: ${error.message}`);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  async function handleSwitchView() {
    setRoleUpdating(true);

    // When switching to admin view from customer login, logout from profile and redirect to login page
    if (actualRole === "customer" || (role === "customer" && actualRole !== "admin")) {
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
      return;
    }

    // If an Admin is previewing customer view, toggle back and forth
    try {
      const nextRole: UserRole = role === "admin" ? "customer" : "admin";
      setRole(nextRole);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await loadDashboardData(nextRole, user.id, user.email ?? "");
      }
    } catch (err) {
      console.error("Failed to switch view:", err);
    } finally {
      setRoleUpdating(false);
    }
  }

  // Quick URL creation handler
  async function handleQuickCreateUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!quickGuestName.trim()) return;

    const targetEventId = Number(quickEventId) || (events[0] ? events[0].event_id : null);
    if (!targetEventId) {
      setQuickMessage("Please select an event.");
      return;
    }

    setQuickLoading(true);
    setQuickMessage("");

    try {
      let count = 1;
      if (quickGuestType === "Couple") count = 2;
      else if (quickGuestType === "Family") count = Number(quickFamilyCount) || 4;

      const guestToken = crypto.randomUUID();
      const name = quickGuestName.trim();

      const { data: newGuest, error: insertError } = await supabase
        .from("wedding_invitations")
        .insert({
          event_id: targetEventId,
          guest_name: name,
          invitation_type: quickGuestType,
          number_of_guests: count,
          guest_token: guestToken,
        })
        .select(
          "wedding_invitation_id, event_id, guest_name, invitation_type, rsvp_status, wish_message, created_at, number_of_guests, attending_count, guest_token"
        )
        .single();

      if (insertError) throw insertError;

      const generatedUrl = buildGuestInvitationUrl(targetEventId, quickGuestType, name);
      setQuickSuccessUrl(generatedUrl);
      setQuickMessage(`Invitation URL generated for ${name}!`);
      setQuickGuestName("");

      if (newGuest) {
        setInvitations((prev) => [newGuest as DashboardInvitation, ...prev]);
      }
    } catch (err) {
      setQuickMessage(
        err instanceof Error ? err.message : "Failed to create invitation URL."
      );
    } finally {
      setQuickLoading(false);
    }
  }

  // Copy URL to clipboard
  const handleCopyUrl = async (id: number, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      // ignore clipboard error
    }
  };

  // Open QR modal
  const handleOpenQrModal = async (inv: DashboardInvitation) => {
    const url = buildGuestInvitationUrl(inv.event_id, inv.invitation_type, inv.guest_name);
    setGeneratingQrId(inv.wedding_invitation_id);
    setModalCopied(false);
    try {
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: "H",
      });
      setSelectedQr({
        name: inv.guest_name,
        type: inv.invitation_type,
        url,
        qrDataUrl,
      });
    } catch (err) {
      console.error("QR Code error:", err);
    } finally {
      setGeneratingQrId(null);
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

  // Statistics
  const accepted = invitations.filter((inv) => inv.rsvp_status === "accepted").length;
  const declined = invitations.filter((inv) => inv.rsvp_status === "declined").length;
  const pending = invitations.filter((inv) => inv.rsvp_status === "pending").length;

  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshEvents = async () => {
    setRefreshing(true);
    try {
      await loadDashboardData(role, currentUserId, email);
    } finally {
      setRefreshing(false);
    }
  };

  const filteredEvents = events.filter((ev) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      ev.event_id.toString().includes(q) ||
      ev.event_type.toLowerCase().includes(q) ||
      ev.contact_person.toLowerCase().includes(q) ||
      (ev.email && ev.email.toLowerCase().includes(q)) ||
      (ev.mobile && ev.mobile.toLowerCase().includes(q)) ||
      (ev.event_venue && ev.event_venue.toLowerCase().includes(q))
    );
  });

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed]">
        <div className="text-center">
          <p className="text-sm font-medium tracking-widest text-amber-800">
            INVI CARDS
          </p>
          <p className="mt-2 text-black">Loading your dashboard...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8f4ed] text-black">
      {/* Top Header */}
      <header className="border-b border-[#e8ddcc] bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs tracking-[0.25em] text-amber-800 font-semibold">
                INVI CARDS
              </p>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  role === "admin"
                    ? "bg-amber-100 text-amber-900 border border-amber-300"
                    : "bg-emerald-100 text-emerald-900 border border-emerald-300"
                }`}
              >
                {role}
              </span>
            </div>

            <h1 className="mt-1 text-2xl font-semibold text-black">
              {role === "admin" ? "Admin Dashboard" : "Customer Dashboard"}
            </h1>

            <p className="mt-1 text-sm text-gray-700">{email}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Admin only: Link to Register page */}
            {role === "admin" && (
              <Link
                href="/register"
                className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-900 shadow-xs transition"
              >
                + Register User / Customer
              </Link>
            )}

            {/* Admin only: Create Event button */}
            {role === "admin" && (
              <Link
                href="/dashboard/events/new"
                className="rounded-lg bg-[#8c6b45] px-4 py-2 text-sm font-medium text-white hover:bg-[#745637] shadow-xs transition"
              >
                + Create Event
              </Link>
            )}

            {/* Switch view / Logout for Customer */}
            {role === "customer" && actualRole === "customer" ? (
              <button
                onClick={handleSwitchView}
                disabled={roleUpdating}
                title="Log out and sign in as administrator"
                className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 transition disabled:opacity-50"
              >
                {roleUpdating ? "Logging out..." : "Switch to Admin View"}
              </button>
            ) : role === "admin" ? (
              <button
                onClick={handleSwitchView}
                disabled={roleUpdating}
                title="Preview Customer Dashboard"
                className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 transition disabled:opacity-50"
              >
                {roleUpdating ? "Switching..." : "Switch to Customer View"}
              </button>
            ) : (
              <button
                onClick={handleSwitchView}
                disabled={roleUpdating}
                title="Return to Admin Dashboard"
                className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 transition disabled:opacity-50"
              >
                {roleUpdating ? "Switching..." : "Return to Admin View"}
              </button>
            )}

            <button
              onClick={handleLogout}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-black hover:bg-gray-50 transition"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-5 py-8">
        {errorMessage && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {errorMessage}
          </div>
        )}

        {/* ----------------- ADMIN DASHBOARD VIEW ----------------- */}
        {role === "admin" && (
          <>
            {/* Quick Admin Navigation & Info */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-6">
              <div>
                <h2 className="text-xl font-bold text-amber-950">
                  Platform Administration Console
                </h2>
                <p className="mt-1 text-sm text-amber-900">
                  Full control across all events, invitations, customer accounts, and registration.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/register"
                  className="rounded-lg bg-amber-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-900 shadow-sm"
                >
                  Register New Customer / User
                </Link>
                <Link
                  href="/dashboard/events/new"
                  className="rounded-lg bg-[#8c6b45] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#745637] shadow-sm"
                >
                  + Create New Event
                </Link>
              </div>
            </div>

            {/* Platform Overview Metrics */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Total Platform Events", value: events.length },
                { label: "Total Invitations Sent", value: invitations.length },
                { label: "Attending Guests", value: accepted },
                { label: "Pending Responses", value: pending },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-[#e8ddcc] bg-white p-5 shadow-xs"
                >
                  <p className="text-sm font-medium text-gray-700">{item.label}</p>
                  <p className="mt-3 text-3xl font-semibold text-black">
                    {item.value}
                  </p>
                </div>
              ))}
            </section>

            {/* All Events Management Section */}
            <section className="rounded-2xl border border-[#e8ddcc] bg-white p-6 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#eee5d9]">
                <div>
                  <h2 className="text-lg font-semibold text-black">
                    All Platform Events ({events.length})
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Manage any customer event or click "Manage Event" to view event details and guest invitations.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleRefreshEvents}
                    disabled={refreshing}
                    title="Refresh all events from database"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
                  >
                    <span className={refreshing ? "animate-spin" : ""}>↻</span>
                    {refreshing ? "Refreshing..." : "Refresh"}
                  </button>
                  <input
                    type="text"
                    placeholder="Search by ID, name, email, mobile..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-64 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder:text-gray-400 focus:border-amber-700 focus:outline-none"
                  />
                  <Link
                    href="/dashboard/events/new"
                    className="rounded-lg bg-[#8c6b45] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#745637] transition"
                  >
                    + New Event
                  </Link>
                </div>
              </div>

              {filteredEvents.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  {searchQuery ? "No events match your search." : "No events created yet."}
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm text-black">
                    <thead>
                      <tr className="border-b border-[#e8ddcc] text-gray-700 bg-[#faf6f1]/60">
                        <th className="py-3 px-4 font-semibold">Event ID</th>
                        <th className="py-3 px-4 font-semibold">Event Type</th>
                        <th className="py-3 px-4 font-semibold">Contact / Customer</th>
                        <th className="py-3 px-4 font-semibold">Date & Time</th>
                        <th className="py-3 px-4 font-semibold">Venue</th>
                        <th className="py-3 px-4 font-semibold">Order Date</th>
                        <th className="py-3 px-4 font-semibold">Status</th>
                        <th className="py-3 px-4 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((ev) => (
                        <tr
                          key={ev.event_id}
                          className="border-b border-[#eee5d9] last:border-0 hover:bg-[#faf6f1]/50 transition"
                        >
                          <td className="py-3 px-4 font-bold text-amber-900">
                            #{ev.event_id}
                          </td>
                          <td className="py-3 px-4">
                            <span className="inline-block rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900 capitalize">
                              {ev.event_type.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-black">{ev.contact_person}</p>
                            {ev.email && (
                              <p className="text-xs text-gray-600">{ev.email}</p>
                            )}
                            {ev.mobile && (
                              <p className="text-xs text-gray-500">Tel: {ev.mobile}</p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-medium text-black">{ev.event_date}</p>
                            {ev.event_time && (
                              <p className="text-xs text-gray-500">{ev.event_time}</p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <p className="text-sm text-gray-800">{ev.event_venue || "No venue set"}</p>
                          </td>
                          <td className="py-3 px-4 text-xs text-gray-600">
                            {ev.created_at ? new Date(ev.created_at).toLocaleDateString() : "—"}
                          </td>
                          <td className="py-3 px-4">
                            {ev.owner_user_id ? (
                              <span
                                title={`Owner UUID: ${ev.owner_user_id}`}
                                className="inline-block rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-800"
                              >
                                Assigned
                              </span>
                            ) : (
                              <span className="inline-block rounded-full bg-gray-100 border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                                Unassigned
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={`/dashboard/events/${ev.event_id}`}
                                className="rounded-md border border-[#8c6b45] px-3 py-1.5 text-xs font-semibold text-[#8c6b45] hover:bg-[#8c6b45] hover:text-white transition"
                              >
                                Manage Event
                              </Link>
                              <Link
                                href={`/dashboard/invitations/new?eventId=${ev.event_id}`}
                                className="rounded-md bg-[#8c6b45] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#745637] transition"
                              >
                                + Invitations
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* ----------------- CUSTOMER DASHBOARD VIEW ----------------- */}
        {role === "customer" && (
          <>
            <div>
              <h2 className="text-xl font-semibold text-black">
                My Event Portal
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Manage your event, create invitation URLs for your guests, and track RSVPs and wishes.
              </p>
            </div>

            {/* Customer's Event Cards */}
            {events.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#d8cbbb] bg-white p-10 text-center">
                <h3 className="text-lg font-semibold text-gray-800">
                  No Event Assigned
                </h3>
                <p className="mt-2 text-sm text-gray-600 max-w-md mx-auto">
                  You currently have no events assigned to your account. Please contact your administrator or check back soon.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Event Card list */}
                {events.map((event) => (
                  <div
                    key={event.event_id}
                    className="rounded-2xl border border-[#e8ddcc] bg-white p-6 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#eee5d9] pb-5">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                            Event #{event.event_id}
                          </span>
                          <span className="text-xs text-gray-500">
                            Order Date: {event.created_at ? new Date(event.created_at).toLocaleDateString() : "—"}
                          </span>
                        </div>
                        <h3 className="mt-2 text-2xl font-bold text-gray-900 capitalize">
                          {event.event_type.replaceAll("_", " ")}
                        </h3>
                        <p className="mt-1 text-sm text-gray-600">
                          Contact Person: <strong className="text-black">{event.contact_person}</strong>
                          {event.mobile && ` • Mobile: ${event.mobile}`}
                          {event.email && ` • Email: ${event.email}`}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          href={`/dashboard/events/${event.event_id}`}
                          className="rounded-lg bg-[#8c6b45] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#745637] transition shadow-xs"
                        >
                          Manage Event & Guests →
                        </Link>
                        <Link
                          href={`/dashboard/invitations/new?eventId=${event.event_id}`}
                          className="rounded-lg border border-[#8c6b45] px-4 py-2.5 text-sm font-semibold text-[#8c6b45] hover:bg-[#faf6f1] transition"
                        >
                          + Create Invitation URLs
                        </Link>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 sm:grid-cols-3 text-sm">
                      <div className="rounded-xl border border-[#eee5d9] bg-[#faf6f1]/60 p-3.5">
                        <p className="text-xs font-medium uppercase tracking-wider text-gray-600">Event Date</p>
                        <p className="mt-1 font-semibold text-black">{event.event_date || "TBD"}</p>
                      </div>
                      <div className="rounded-xl border border-[#eee5d9] bg-[#faf6f1]/60 p-3.5">
                        <p className="text-xs font-medium uppercase tracking-wider text-gray-600">Event Time</p>
                        <p className="mt-1 font-semibold text-black">{event.event_time || "—"}</p>
                      </div>
                      <div className="rounded-xl border border-[#eee5d9] bg-[#faf6f1]/60 p-3.5">
                        <p className="text-xs font-medium uppercase tracking-wider text-gray-600">Venue</p>
                        <p className="mt-1 font-semibold text-black truncate">{event.event_venue || "—"}</p>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Quick Create Invitation URL Card */}
                <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
                  <div className="border-b border-[#eee5d9] pb-4">
                    <h3 className="text-lg font-semibold text-black">
                      Create Guest Invitation URL
                    </h3>
                    <p className="mt-1 text-sm text-gray-600">
                      Instantly generate a personalized invitation URL and QR code for your guest.
                    </p>
                  </div>

                  <form onSubmit={handleQuickCreateUrl} className="mt-5 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      {events.length > 1 && (
                        <div>
                          <label className="block text-xs font-medium text-gray-700">
                            Select Event
                          </label>
                          <select
                            value={quickEventId}
                            onChange={(e) => setQuickEventId(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm text-black focus:border-amber-700 focus:outline-none"
                          >
                            {events.map((ev) => (
                              <option key={ev.event_id} value={ev.event_id}>
                                #{ev.event_id} - {ev.event_type}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className={events.length > 1 ? "" : "sm:col-span-2"}>
                        <label className="block text-xs font-medium text-gray-700">
                          Guest Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={quickGuestName}
                          onChange={(e) => setQuickGuestName(e.target.value)}
                          placeholder="e.g. John Doe, Sarah & Mike, Smith Family"
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm text-black focus:border-amber-700 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700">
                          Invitation Type
                        </label>
                        <select
                          value={quickGuestType}
                          onChange={(e) => setQuickGuestType(e.target.value as any)}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm text-black focus:border-amber-700 focus:outline-none"
                        >
                          <option value="Single">Single (1 guest)</option>
                          <option value="Couple">Couple (2 guests)</option>
                          <option value="Family">Family (Multiple guests)</option>
                        </select>
                      </div>

                      {quickGuestType === "Family" && (
                        <div>
                          <label className="block text-xs font-medium text-gray-700">
                            Total Family Guests
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={quickFamilyCount}
                            onChange={(e) => setQuickFamilyCount(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm text-black focus:border-amber-700 focus:outline-none"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <button
                        type="submit"
                        disabled={quickLoading}
                        className="rounded-lg bg-[#8c6b45] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#745637] transition shadow-xs disabled:opacity-60"
                      >
                        {quickLoading ? "Creating URL..." : "+ Generate Invitation URL"}
                      </button>

                      {events[0] && (
                        <Link
                          href={`/dashboard/invitations/new?eventId=${events[0].event_id}`}
                          className="text-xs font-medium text-amber-800 underline"
                        >
                          Advanced invitation builder →
                        </Link>
                      )}
                    </div>

                    {/* Quick Success Message & URL Copy Box */}
                    {quickMessage && (
                      <div
                        className={`mt-4 rounded-xl p-4 text-sm ${
                          quickSuccessUrl
                            ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border border-amber-200 bg-amber-50 text-amber-900"
                        }`}
                      >
                        <p className="font-semibold">{quickMessage}</p>
                        {quickSuccessUrl && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={quickSuccessUrl}
                              className="flex-1 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-mono text-gray-800"
                            />
                            <button
                              type="button"
                              onClick={() => void handleCopyUrl(0, quickSuccessUrl)}
                              className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 transition"
                            >
                              {copiedId === 0 ? "✓ Copied!" : "Copy URL"}
                            </button>
                            <a
                              href={quickSuccessUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg border border-emerald-700 px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition"
                            >
                              Open URL ↗
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </form>
                </div>

                {/* Customer Event Summary Stats */}
                <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "My Invitations", value: invitations.length },
                    { label: "Confirmed Attending", value: accepted },
                    { label: "Declined", value: declined },
                    { label: "Pending Responses", value: pending },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-2xl border border-[#e8ddcc] bg-white p-5 shadow-xs"
                    >
                      <p className="text-sm font-medium text-gray-700">{item.label}</p>
                      <p className="mt-3 text-3xl font-semibold text-black">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </section>

                {/* Customer Invitations & URLs List */}
                <section className="rounded-2xl border border-[#e8ddcc] bg-white p-6 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#eee5d9] pb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-black">
                        My Guest Invitations & URLs ({invitations.length})
                      </h3>
                      <p className="mt-1 text-sm text-gray-600">
                        View generated URLs, copy links, and inspect QR codes for each invited guest.
                      </p>
                    </div>

                    {events[0] && (
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/dashboard/events/${events[0].event_id}`}
                          className="text-sm font-medium text-amber-800 underline"
                        >
                          View Full Event Manager →
                        </Link>
                      </div>
                    )}
                  </div>

                  {invitations.length === 0 ? (
                    <div className="mt-6 rounded-lg border border-dashed border-[#e8ddcc] p-8 text-center">
                      <p className="text-sm text-gray-600">
                        No invitations created yet. Use the form above to generate your first guest invitation URL!
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[850px] text-left text-sm text-black">
                        <thead>
                          <tr className="border-b border-[#e8ddcc] text-gray-700">
                            <th className="py-3 pr-4 font-semibold">Guest Name</th>
                            <th className="py-3 pr-4 font-semibold">Type</th>
                            <th className="py-3 pr-4 font-semibold">RSVP Status</th>
                            <th className="py-3 pr-4 font-semibold">Invitation URL & Actions</th>
                            <th className="py-3 font-semibold">Wish</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invitations.map((inv) => {
                            const url = buildGuestInvitationUrl(
                              inv.event_id,
                              inv.invitation_type,
                              inv.guest_name
                            );
                            const isCopied = copiedId === inv.wedding_invitation_id;
                            const isGeneratingQr = generatingQrId === inv.wedding_invitation_id;

                            return (
                              <tr
                                key={inv.wedding_invitation_id}
                                className="border-b border-[#eee5d9] last:border-0 hover:bg-[#faf6f1]/50"
                              >
                                <td className="py-3 pr-4 font-medium text-black">
                                  {inv.guest_name}
                                </td>
                                <td className="py-3 pr-4 capitalize text-gray-700">
                                  {inv.invitation_type}
                                </td>
                                <td className="py-3 pr-4 capitalize font-semibold">
                                  <span
                                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${
                                      inv.rsvp_status === "accepted"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : inv.rsvp_status === "declined"
                                        ? "bg-red-100 text-red-800"
                                        : "bg-amber-100 text-amber-800"
                                    }`}
                                  >
                                    {inv.rsvp_status}
                                  </span>
                                </td>
                                <td className="py-3 pr-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void handleCopyUrl(inv.wedding_invitation_id, url)}
                                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                                        isCopied
                                          ? "bg-emerald-600 text-white"
                                          : "border border-gray-300 bg-white text-gray-800 hover:bg-gray-100"
                                      }`}
                                    >
                                      {isCopied ? "✓ Copied" : "Copy URL"}
                                    </button>
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="rounded-md border border-[#8c6b45] px-2.5 py-1 text-xs font-semibold text-[#8c6b45] hover:bg-[#8c6b45] hover:text-white transition"
                                    >
                                      Open ↗
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => void handleOpenQrModal(inv)}
                                      disabled={isGeneratingQr}
                                      className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-100 transition"
                                    >
                                      {isGeneratingQr ? "..." : "QR Code"}
                                    </button>
                                  </div>
                                </td>
                                <td className="py-3 text-gray-600 max-w-xs truncate">
                                  {inv.wish_message?.trim() || "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>

      {/* QR Code Modal */}
      {selectedQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  QR Code & Invitation Link
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                  Guest: <strong className="text-black">{selectedQr.name}</strong> ({selectedQr.type})
                </p>
              </div>
              <button
                onClick={() => setSelectedQr(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="my-5 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedQr.qrDataUrl}
                alt="Invitation QR Code"
                className="h-64 w-64 rounded-xl border border-gray-200 p-2 shadow-inner"
              />
            </div>

            <div className="space-y-3">
              <input
                type="text"
                readOnly
                value={selectedQr.url}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-xs font-mono text-gray-800"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleModalCopy}
                  className="flex-1 rounded-lg bg-[#8c6b45] p-2.5 text-center text-xs font-semibold text-white hover:bg-[#745637] transition"
                >
                  {modalCopied ? "✓ Link Copied!" : "Copy Link"}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadQr}
                  className="flex-1 rounded-lg border border-gray-300 p-2.5 text-center text-xs font-semibold text-gray-800 hover:bg-gray-50 transition"
                >
                  Download QR (.png)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
