import { SupabaseClient, User } from "@supabase/supabase-js";

export type UserRole = "admin" | "customer";

export type CustomerProfile = {
  user_id: string;
  username: string | null;
  full_name: string | null;
  role: UserRole;
  created_at?: string;
};

/**
 * Determine user role from user metadata, app metadata, or email convention (synchronous fallback).
 */
export function getUserRole(user: User | null): UserRole {
  if (!user) return "customer";

  // 1. Check user_metadata.role
  const userMetaRole = user.user_metadata?.role;
  if (typeof userMetaRole === "string") {
    const normalized = userMetaRole.trim().toLowerCase();
    if (normalized === "admin") return "admin";
    if (normalized === "customer") return "customer";
  }

  // 2. Check app_metadata.role
  const appMetaRole = user.app_metadata?.role;
  if (typeof appMetaRole === "string") {
    const normalized = appMetaRole.trim().toLowerCase();
    if (normalized === "admin") return "admin";
    if (normalized === "customer") return "customer";
  }

  // 3. Fallback convention: if email contains 'admin' or matches platform admin
  if (user.email) {
    const normalizedEmail = user.email.toLowerCase().trim();
    if (
      normalizedEmail.includes("admin") ||
      normalizedEmail === "unethmi0@gmail.com"
    ) {
      return "admin";
    }
  }

  // 4. Default role
  return "customer";
}

/**
 * Fetch user role from public.customer_profiles table.
 * Falls back to user metadata / conventions if not found.
 */
export async function fetchUserRole(
  supabase: SupabaseClient,
  user: User | null
): Promise<UserRole> {
  if (!user) return "customer";

  try {
    const { data, error } = await supabase
      .from("customer_profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!error && data?.role) {
      const normalized = data.role.trim().toLowerCase();
      if (normalized === "admin") return "admin";
      if (normalized === "customer") return "customer";
    }
  } catch (err) {
    console.warn("Could not query customer_profiles:", err);
  }

  return getUserRole(user);
}

/**
 * Save or update a profile in public.customer_profiles.
 */
export async function saveCustomerProfile(
  supabase: SupabaseClient,
  profile: {
    user_id: string;
    username?: string | null;
    full_name?: string | null;
    role?: UserRole;
  }
): Promise<{ data: CustomerProfile | null; error: Error | null }> {
  const targetRole = profile.role || "customer";

  try {
    const payload = {
      user_id: profile.user_id,
      username: profile.username?.trim() || null,
      full_name: profile.full_name?.trim() || null,
      role: targetRole,
    };

    const { data, error } = await supabase
      .from("customer_profiles")
      .upsert(payload, { onConflict: "user_id" })
      .select("user_id, username, full_name, role, created_at")
      .maybeSingle();

    if (error) {
      console.warn("Retrying customer_profiles upsert without username:", error.message);
      const retryPayload = {
        user_id: profile.user_id,
        full_name: profile.full_name?.trim() || null,
        role: targetRole,
      };

      const { data: retryData, error: retryError } = await supabase
        .from("customer_profiles")
        .upsert(retryPayload, { onConflict: "user_id" })
        .select("user_id, username, full_name, role, created_at")
        .maybeSingle();

      if (retryError) {
        return { data: null, error: new Error(retryError.message) };
      }

      return { data: retryData as CustomerProfile, error: null };
    }

    return { data: data as CustomerProfile, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error("Failed to save customer profile"),
    };
  }
}

/**
 * Update user's role in public.customer_profiles and auth user_metadata.
 */
export async function updateUserRole(
  supabase: SupabaseClient,
  userId: string,
  newRole: UserRole
): Promise<{ error: Error | null }> {
  try {
    const { error: profileError } = await supabase
      .from("customer_profiles")
      .upsert(
        {
          user_id: userId,
          role: newRole,
        },
        { onConflict: "user_id" }
      );

    await supabase.auth.updateUser({
      data: { role: newRole },
    });

    if (profileError) {
      return { error: new Error(profileError.message) };
    }

    return { error: null };
  } catch (err) {
    return {
      error: err instanceof Error ? err : new Error("Failed to update role"),
    };
  }
}
