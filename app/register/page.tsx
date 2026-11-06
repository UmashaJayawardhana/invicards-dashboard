"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getUserRole, UserRole } from "@/lib/auth";

export default function RegisterPage() {
  const supabase = createClient();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("customer");
  const [message, setMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null);

  useEffect(() => {
    async function checkCurrentAuth() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setCurrentUserRole(getUserRole(user));
      }
    }
    void checkCurrentAuth();
  }, [supabase]);

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setIsSuccess(false);
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          username: username.trim(),
          role: role,
        },
      },
    });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      setIsSuccess(false);
      return;
    }

    setIsSuccess(true);

    if (currentUserRole === "admin") {
      setMessage(
        `Account successfully registered for ${email.trim()} with role: ${role.toUpperCase()}.`
      );
      // Reset form fields
      setFullName("");
      setUsername("");
      setEmail("");
      setPassword("");
      setRole("customer");
    } else if (data.session) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setMessage(
        "Account created. Check your email to confirm your account, then log in."
      );
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed] px-4 py-10">
      <form
        onSubmit={handleRegister}
        className="w-full max-w-md space-y-5 rounded-2xl bg-white p-8 shadow-sm"
      >
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-xs font-medium text-amber-800 hover:underline"
          >
            ← Back to Dashboard
          </Link>
          {currentUserRole === "admin" && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
              Admin Mode
            </span>
          )}
        </div>

        <div className="text-center">
          <p className="text-sm tracking-[0.25em] text-amber-700">INVI CARDS</p>
          <h1 className="mt-3 text-3xl font-semibold text-gray-900">
            {currentUserRole === "admin"
              ? "Register New User"
              : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {currentUserRole === "admin"
              ? "Create a new customer or admin account."
              : "Manage your invitations in one place."}
          </p>
        </div>

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
              ? "Customer can only handle their assigned event and create invitations."
              : "Admin can manage all events and register users."}
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

        {message && (
          <p
            role="status"
            className={`rounded-lg p-3 text-sm ${
              isSuccess
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[#8c6b45] p-3 font-medium text-white hover:bg-[#745637] disabled:opacity-60"
        >
          {loading
            ? "Creating account..."
            : currentUserRole === "admin"
            ? `Register ${role === "admin" ? "Admin" : "Customer"} Account`
            : "Create account"}
        </button>

        {currentUserRole === "admin" ? (
          <div className="text-center pt-2">
            <Link
              className="font-medium text-amber-800 underline text-sm"
              href="/dashboard"
            >
              Return to Admin Dashboard
            </Link>
          </div>
        ) : (
          <p className="text-center text-sm text-gray-600">
            Already registered?{" "}
            <Link className="font-medium text-amber-800 underline" href="/login">
              Log in
            </Link>
          </p>
        )}
      </form>
    </main>
  );
}
