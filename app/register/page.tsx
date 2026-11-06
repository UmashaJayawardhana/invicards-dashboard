"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchUserRole, updateCustomerProfile, UserRole } from "@/lib/auth";

type RegisteredCustomer = {
  user_id: string;
  username: string | null;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  email?: string | null;
  created_at: string | null;
  assignedEvents?: Array<{ event_id: number; event_type: string }>;
};

export default function RegisterPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  // Current session & auth role
  const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  // Active view tab for Admin: "directory" or "register"
  const [activeTab, setActiveTab] = useState<"directory" | "register">("directory");

  // Customer directory list & loading states
  const [customers, setCustomers] = useState<RegisteredCustomer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [tableMessage, setTableMessage] = useState("");

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "customer" | "admin">("all");

  // Registration Form state
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("customer");
  const [regMessage, setRegMessage] = useState("");
  const [isRegSuccess, setIsRegSuccess] = useState(false);
  const [regLoading, setRegLoading] = useState(false);

  // Edit Customer Modal state
  const [editingCustomer, setEditingCustomer] = useState<RegisteredCustomer | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("customer");
  const [editIsActive, setEditIsActive] = useState<boolean>(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Load customer directory and assigned events
  const loadCustomers = useCallback(async () => {
    setCustomersLoading(true);
    try {
      let profiles: any[] = [];

      // Query profiles from customer_profiles
      const { data: profData, error: profError } = await supabase
        .from("customer_profiles")
        .select("user_id, username, full_name, role, created_at, is_active, email")
        .order("created_at", { ascending: false });

      if (profError) {
        // Fallback if is_active or email columns haven't been added to postgres yet
        const { data: fallbackData, error: fallbackError } = await supabase
          .from("customer_profiles")
          .select("user_id, username, full_name, role, created_at")
          .order("created_at", { ascending: false });

        if (fallbackError) {
          throw fallbackError;
        }
        profiles = fallbackData || [];
      } else {
        profiles = profData || [];
      }

      // Query events to correlate assignments
      let eventsList: any[] = [];
      const { data: evData } = await supabase
        .from("events")
        .select("event_id, event_type, contact_person, email, owner_user_id");

      if (evData) {
        eventsList = evData;
      }

      const mapped: RegisteredCustomer[] = profiles.map((p) => {
        // Match events owned by user or matching email/name
        const userEvents = eventsList.filter(
          (ev) =>
            ev.owner_user_id === p.user_id ||
            (p.email && ev.email && ev.email.toLowerCase() === p.email.toLowerCase()) ||
            (p.full_name &&
              ev.contact_person &&
              ev.contact_person.toLowerCase() === p.full_name.toLowerCase())
        );

        let resolvedEmail = p.email;
        if (!resolvedEmail && userEvents.length > 0 && userEvents[0].email) {
          resolvedEmail = userEvents[0].email;
        }

        return {
          user_id: p.user_id,
          username: p.username || null,
          full_name: p.full_name || null,
          role: (p.role === "admin" ? "admin" : "customer") as UserRole,
          is_active: p.is_active !== false,
          email: resolvedEmail || null,
          created_at: p.created_at || null,
          assignedEvents: userEvents.map((ev) => ({
            event_id: ev.event_id,
            event_type: ev.event_type,
          })),
        };
      });

      setCustomers(mapped);
    } catch (err) {
      console.error("Failed to load customer profiles:", err);
    } finally {
      setCustomersLoading(false);
    }
  }, [supabase]);

  // Initial authentication check
  useEffect(() => {
    let active = true;

    async function checkCurrentAuth() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!active) return;

        if (user) {
          const detectedRole = await fetchUserRole(supabase, user);
          setCurrentUserRole(detectedRole);
          if (detectedRole === "admin") {
            setActiveTab("directory");
            void loadCustomers();
          } else {
            setActiveTab("register");
          }
        } else {
          setCurrentUserRole(null);
          setActiveTab("register");
        }
      } catch {
        if (active) {
          setCurrentUserRole(null);
          setActiveTab("register");
        }
      } finally {
        if (active) setAuthChecking(false);
      }
    }

    void checkCurrentAuth();

    return () => {
      active = false;
    };
  }, [loadCustomers, supabase]);

  // Handle new user registration
  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRegMessage("");
    setIsRegSuccess(false);
    setRegLoading(true);

    try {
      const targetRole = role;
      const targetEmail = email.trim();
      const targetFullName = fullName.trim();
      const targetUsername = username.trim();

      const { data, error } = await supabase.auth.signUp({
        email: targetEmail,
        password,
        options: {
          data: {
            full_name: targetFullName,
            username: targetUsername,
            role: targetRole,
          },
        },
      });

      if (error) {
        setRegMessage(error.message);
        setIsRegSuccess(false);
        return;
      }

      setIsRegSuccess(true);

      // Reset form
      setFullName("");
      setUsername("");
      setEmail("");
      setPassword("");
      setRole("customer");

      if (currentUserRole === "admin") {
        setRegMessage(
          `Account created for ${targetEmail} (${targetRole.toUpperCase()}) and active by default.`
        );
        // Refresh customer directory
        await loadCustomers();
      } else if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setRegMessage(
          "Account created successfully. Please check your email to confirm your account, then log in."
        );
      }
    } catch (err) {
      setRegMessage(err instanceof Error ? err.message : "Failed to register account.");
      setIsRegSuccess(false);
    } finally {
      setRegLoading(false);
    }
  }

  // Quick toggle active / inactive status
  const handleToggleActive = async (customer: RegisteredCustomer) => {
    const newStatus = !customer.is_active;

    // Optimistic UI update
    setCustomers((prev) =>
      prev.map((c) =>
        c.user_id === customer.user_id ? { ...c, is_active: newStatus } : c
      )
    );

    try {
      const { error } = await supabase
        .from("customer_profiles")
        .update({ is_active: newStatus })
        .eq("user_id", customer.user_id);

      if (error) {
        // Revert on failure
        setCustomers((prev) =>
          prev.map((c) =>
            c.user_id === customer.user_id ? { ...c, is_active: customer.is_active } : c
          )
        );
        setTableMessage(
          `Could not update active status: ${error.message}. Please run the SQL migration to add 'is_active'.`
        );
      } else {
        setTableMessage(
          `Customer ${customer.full_name || customer.username} is now marked ${
            newStatus ? "ACTIVE" : "INACTIVE"
          }.`
        );
        setTimeout(() => setTableMessage(""), 4000);
      }
    } catch (err) {
      console.error("Toggle active error:", err);
    }
  };

  // Open Edit Customer Modal
  const handleOpenEdit = (customer: RegisteredCustomer) => {
    setEditingCustomer(customer);
    setEditFullName(customer.full_name || "");
    setEditUsername(customer.username || "");
    setEditEmail(customer.email || "");
    setEditRole(customer.role);
    setEditIsActive(customer.is_active);
    setEditError("");
  };

  // Save Customer Changes from Modal
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;

    setEditSaving(true);
    setEditError("");

    try {
      const { data: updated, error } = await updateCustomerProfile(
        supabase,
        editingCustomer.user_id,
        {
          full_name: editFullName,
          username: editUsername,
          role: editRole,
          is_active: editIsActive,
          email: editEmail,
        }
      );

      if (error) {
        setEditError(error.message);
        return;
      }

      // Update local state
      setCustomers((prev) =>
        prev.map((c) =>
          c.user_id === editingCustomer.user_id
            ? {
                ...c,
                full_name: editFullName.trim() || null,
                username: editUsername.trim() || null,
                role: editRole,
                is_active: editIsActive,
                email: editEmail.trim() || null,
              }
            : c
        )
      );

      setEditingCustomer(null);
      setTableMessage(`Profile for "${editFullName || editUsername}" updated successfully!`);
      setTimeout(() => setTableMessage(""), 4000);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update customer.");
    } finally {
      setEditSaving(false);
    }
  };

  // Filtered customer list
  const filteredCustomers = customers.filter((c) => {
    // Status filter
    if (statusFilter === "active" && !c.is_active) return false;
    if (statusFilter === "inactive" && c.is_active) return false;

    // Role filter
    if (roleFilter !== "all" && c.role !== roleFilter) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (
        (c.full_name && c.full_name.toLowerCase().includes(q)) ||
        (c.username && c.username.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        c.role.toLowerCase().includes(q)
      );
    }

    return true;
  });

  // Overview Counts
  const totalCount = customers.length;
  const activeCount = customers.filter((c) => c.is_active).length;
  const inactiveCount = customers.filter((c) => !c.is_active).length;
  const adminCount = customers.filter((c) => c.role === "admin").length;

  if (authChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed]">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-widest text-amber-800">
            INVI CARDS
          </p>
          <p className="mt-2 text-black">Loading user portal...</p>
        </div>
      </main>
    );
  }

  // --------------------------------------------------------------------------
  // ADMIN CONSOLE VIEW (when logged in as admin)
  // --------------------------------------------------------------------------
  if (currentUserRole === "admin") {
    return (
      <main className="min-h-screen bg-[#f8f4ed] text-black">
        {/* Header */}
        <header className="border-b border-[#e8ddcc] bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold tracking-[0.25em] text-amber-800">
                  INVI CARDS
                </p>
                <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900">
                  Admin Console
                </span>
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-black">
                Customer & User Management
              </h1>
              <p className="mt-0.5 text-xs text-gray-600">
                Manage registered customer profiles, toggle active status, and register new accounts.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-50 transition shadow-xs"
              >
                ← Back to Dashboard
              </Link>
              <button
                onClick={() => setActiveTab(activeTab === "directory" ? "register" : "directory")}
                className="rounded-lg bg-[#8c6b45] px-4 py-2 text-sm font-medium text-white hover:bg-[#745637] transition shadow-xs"
              >
                {activeTab === "directory" ? "+ Register New User" : "View Customer Directory"}
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl space-y-6 px-5 py-8">
          {tableMessage && (
            <div
              role="status"
              className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-medium text-emerald-900"
            >
              {tableMessage}
            </div>
          )}

          {/* Metric Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-[#e8ddcc] bg-white p-5 shadow-xs">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                Total Registered Users
              </p>
              <p className="mt-2 text-3xl font-bold text-black">{totalCount}</p>
            </div>

            <div className="rounded-2xl border border-[#e8ddcc] bg-white p-5 shadow-xs">
              <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">
                Active Customers
              </p>
              <p className="mt-2 text-3xl font-bold text-emerald-600">{activeCount}</p>
            </div>

            <div className="rounded-2xl border border-[#e8ddcc] bg-white p-5 shadow-xs">
              <p className="text-xs font-medium uppercase tracking-wider text-rose-700">
                Inactive Customers
              </p>
              <p className="mt-2 text-3xl font-bold text-rose-600">{inactiveCount}</p>
            </div>

            <div className="rounded-2xl border border-[#e8ddcc] bg-white p-5 shadow-xs">
              <p className="text-xs font-medium uppercase tracking-wider text-amber-800">
                Platform Administrators
              </p>
              <p className="mt-2 text-3xl font-bold text-amber-900">{adminCount}</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-[#e8ddcc]">
            <button
              onClick={() => setActiveTab("directory")}
              className={`border-b-2 px-6 py-3 text-sm font-semibold transition ${
                activeTab === "directory"
                  ? "border-[#8c6b45] text-[#8c6b45]"
                  : "border-transparent text-gray-600 hover:text-black"
              }`}
            >
              Customer Directory ({customers.length})
            </button>
            <button
              onClick={() => setActiveTab("register")}
              className={`border-b-2 px-6 py-3 text-sm font-semibold transition ${
                activeTab === "register"
                  ? "border-[#8c6b45] text-[#8c6b45]"
                  : "border-transparent text-gray-600 hover:text-black"
              }`}
            >
              + Register New Account
            </button>
          </div>

          {/* ----------------- TAB 1: CUSTOMER DIRECTORY ----------------- */}
          {activeTab === "directory" && (
            <div className="rounded-2xl border border-[#e8ddcc] bg-white p-6 shadow-xs">
              {/* Controls bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#eee5d9] pb-5">
                <div>
                  <h2 className="text-lg font-semibold text-black">
                    Registered Customers & Users
                  </h2>
                  <p className="text-xs text-gray-600">
                    Click "Edit" to modify customer profile or toggle between Active and Inactive.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Refresh button */}
                  <button
                    onClick={() => void loadCustomers()}
                    disabled={customersLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <span className={customersLoading ? "animate-spin" : ""}>↻</span>
                    Refresh
                  </button>

                  {/* Status Filter */}
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-black outline-none focus:border-[#8c6b45]"
                  >
                    <option value="all">All Statuses ({totalCount})</option>
                    <option value="active">Active Only ({activeCount})</option>
                    <option value="inactive">Inactive Only ({inactiveCount})</option>
                  </select>

                  {/* Role Filter */}
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value as any)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-black outline-none focus:border-[#8c6b45]"
                  >
                    <option value="all">All Roles</option>
                    <option value="customer">Customers</option>
                    <option value="admin">Admins</option>
                  </select>

                  {/* Search box */}
                  <input
                    type="text"
                    placeholder="Search name, username, email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-56 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-black placeholder:text-gray-400 outline-none focus:border-[#8c6b45]"
                  />
                </div>
              </div>

              {/* Table */}
              {customersLoading ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  Loading customer profiles...
                </div>
              ) : filteredCustomers.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  {searchQuery || statusFilter !== "all" || roleFilter !== "all"
                    ? "No customers match your search criteria."
                    : "No customers registered yet."}
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left text-sm text-black">
                    <thead>
                      <tr className="border-b border-[#e8ddcc] bg-[#faf6f1]/60 text-gray-700">
                        <th className="py-3 px-4 font-semibold">Customer / User</th>
                        <th className="py-3 px-4 font-semibold">Role</th>
                        <th className="py-3 px-4 font-semibold">Status</th>
                        <th className="py-3 px-4 font-semibold">Assigned Events</th>
                        <th className="py-3 px-4 font-semibold">Registered</th>
                        <th className="py-3 px-4 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomers.map((cust) => (
                        <tr
                          key={cust.user_id}
                          className="border-b border-[#eee5d9] last:border-0 hover:bg-[#faf6f1]/50 transition"
                        >
                          {/* Name & Contact */}
                          <td className="py-3 px-4">
                            <p className="font-semibold text-black">
                              {cust.full_name || "No name provided"}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-gray-600">
                              <span>@{cust.username || "no-username"}</span>
                              {cust.email && (
                                <>
                                  <span>•</span>
                                  <span>{cust.email}</span>
                                </>
                              )}
                            </div>
                          </td>

                          {/* Role Badge */}
                          <td className="py-3 px-4">
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                                cust.role === "admin"
                                  ? "border border-amber-300 bg-amber-100 text-amber-900"
                                  : "border border-emerald-300 bg-emerald-100 text-emerald-900"
                              }`}
                            >
                              {cust.role}
                            </span>
                          </td>

                          {/* Active / Inactive Status */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {cust.is_active ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
                                  Active
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-800">
                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-600"></span>
                                  Inactive
                                </span>
                              )}

                              <button
                                onClick={() => void handleToggleActive(cust)}
                                title={
                                  cust.is_active
                                    ? "Click to deactivate this customer account"
                                    : "Click to activate this customer account"
                                }
                                className={`rounded px-2 py-0.5 text-[11px] font-medium transition border ${
                                  cust.is_active
                                    ? "border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100"
                                    : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                }`}
                              >
                                {cust.is_active ? "Deactivate" : "Activate"}
                              </button>
                            </div>
                          </td>

                          {/* Events */}
                          <td className="py-3 px-4">
                            {cust.assignedEvents && cust.assignedEvents.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {cust.assignedEvents.map((ev) => (
                                  <Link
                                    key={ev.event_id}
                                    href={`/dashboard/events/${ev.event_id}`}
                                    className="rounded-md border border-[#c2a679] bg-[#faf6f1] px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                                  >
                                    #{ev.event_id} {ev.event_type}
                                  </Link>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-500">No events</span>
                            )}
                          </td>

                          {/* Registered Date */}
                          <td className="py-3 px-4 text-xs text-gray-600">
                            {cust.created_at
                              ? new Date(cust.created_at).toLocaleDateString()
                              : "—"}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleOpenEdit(cust)}
                              className="rounded-lg border border-[#8c6b45] px-3 py-1.5 text-xs font-semibold text-[#8c6b45] hover:bg-[#8c6b45] hover:text-white transition"
                            >
                              Edit Profile
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ----------------- TAB 2: REGISTER NEW ACCOUNT FORM ----------------- */}
          {activeTab === "register" && (
            <div className="mx-auto max-w-2xl rounded-2xl border border-[#e8ddcc] bg-white p-8 shadow-xs">
              <div className="border-b border-[#eee5d9] pb-4">
                <h2 className="text-xl font-bold text-black">
                  Register New Customer or Admin Account
                </h2>
                <p className="mt-1 text-xs text-gray-600">
                  Create credentials and assign initial permissions. Active by default upon creation.
                </p>
              </div>

              <form onSubmit={handleRegister} className="mt-6 space-y-5">
                {regMessage && (
                  <div
                    role="alert"
                    className={`rounded-lg p-4 text-sm font-medium ${
                      isRegSuccess
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {regMessage}
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Account Role
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setRole("customer")}
                      className={`rounded-lg border p-2.5 text-center text-sm font-medium transition ${
                        role === "customer"
                          ? "border-[#8c6b45] bg-[#8c6b45] text-white"
                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      Customer
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole("admin")}
                      className={`rounded-lg border p-2.5 text-center text-sm font-medium transition ${
                        role === "admin"
                          ? "border-[#8c6b45] bg-[#8c6b45] text-white"
                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      Admin
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {role === "customer"
                      ? "Customer can manage their assigned event and create invitation links."
                      : "Admin has full platform administration rights."}
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Full Name
                  </label>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm text-black outline-none focus:border-[#8c6b45]"
                    placeholder="e.g. Kasun Silva"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Username
                  </label>
                  <input
                    required
                    minLength={3}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm text-black outline-none focus:border-[#8c6b45]"
                    placeholder="e.g. kasunsilva"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Email Address
                  </label>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm text-black outline-none focus:border-[#8c6b45]"
                    placeholder="user@example.com"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <input
                    required
                    type="password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm text-black outline-none focus:border-[#8c6b45]"
                    placeholder="At least 8 characters"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setActiveTab("directory")}
                    className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={regLoading}
                    className="rounded-lg bg-[#8c6b45] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#745637] transition disabled:opacity-60 shadow-xs"
                  >
                    {regLoading ? "Registering..." : `Register ${role === "admin" ? "Admin" : "Customer"}`}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* ----------------- EDIT CUSTOMER MODAL ----------------- */}
        {editingCustomer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl border border-[#e8ddcc] bg-white p-6 shadow-xl animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-[#eee5d9] pb-4">
                <div>
                  <h3 className="text-lg font-bold text-black">Edit Customer Profile</h3>
                  <p className="text-xs text-gray-500">User ID: {editingCustomer.user_id}</p>
                </div>
                <button
                  onClick={() => setEditingCustomer(null)}
                  className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-black"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="mt-5 space-y-4">
                {editError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {editError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm text-black outline-none focus:border-[#8c6b45]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase">
                    Username
                  </label>
                  <input
                    type="text"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm text-black outline-none focus:border-[#8c6b45]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase">
                    Email
                  </label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm text-black outline-none focus:border-[#8c6b45]"
                    placeholder="user@example.com"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Role Selection */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase">
                      Account Role
                    </label>
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as UserRole)}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm text-black outline-none focus:border-[#8c6b45]"
                    >
                      <option value="customer">Customer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  {/* Status Selection */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase">
                      Account Status
                    </label>
                    <select
                      value={editIsActive ? "active" : "inactive"}
                      onChange={(e) => setEditIsActive(e.target.value === "active")}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm text-black outline-none focus:border-[#8c6b45]"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#eee5d9]">
                  <button
                    type="button"
                    onClick={() => setEditingCustomer(null)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="rounded-lg bg-[#8c6b45] px-5 py-2 text-sm font-medium text-white hover:bg-[#745637] transition disabled:opacity-60"
                  >
                    {editSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    );
  }

  // --------------------------------------------------------------------------
  // PUBLIC SELF-REGISTRATION VIEW (when logged out)
  // --------------------------------------------------------------------------
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed] px-4 py-10">
      <form
        onSubmit={handleRegister}
        className="w-full max-w-md space-y-5 rounded-2xl bg-white p-8 shadow-sm"
      >
        <div className="flex items-center justify-between">
          <Link
            href="/login"
            className="text-xs font-medium text-amber-800 hover:underline"
          >
            ← Back to Login
          </Link>
        </div>

        <div className="text-center">
          <p className="text-sm tracking-[0.25em] text-amber-700">INVI CARDS</p>
          <h1 className="mt-3 text-3xl font-semibold text-gray-900">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Manage your wedding and event invitations in one place.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Full name
          </label>
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900 placeholder:text-gray-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
            placeholder="Your full name"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Username
          </label>
          <input
            required
            minLength={3}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900 placeholder:text-gray-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
            placeholder="Choose a username"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900 placeholder:text-gray-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
            placeholder="user@example.com"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            required
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900 placeholder:text-gray-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
            placeholder="At least 8 characters"
          />
        </div>

        {regMessage && (
          <p
            role="status"
            className={`rounded-lg p-3 text-sm ${
              isRegSuccess
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {regMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={regLoading}
          className="w-full rounded-lg bg-[#8c6b45] p-3 font-medium text-white hover:bg-[#745637] disabled:opacity-60"
        >
          {regLoading ? "Creating account..." : "Create account"}
        </button>

        <p className="text-center text-sm text-gray-600">
          Already registered?{" "}
          <Link className="font-medium text-amber-800 underline" href="/login">
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}
