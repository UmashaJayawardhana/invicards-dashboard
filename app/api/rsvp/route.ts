import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabase() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const eventId = searchParams.get("event_id");
  const guestName = searchParams.get("guest_name");

  if (!token && (!eventId || !guestName)) {
    return NextResponse.json(
      { error: "Provide either 'token' or both 'event_id' and 'guest_name'." },
      { status: 400, headers: corsHeaders }
    );
  }

  const supabase = getSupabase();
  let query = supabase
    .from("wedding_invitations")
    .select(
      "wedding_invitation_id, event_id, guest_name, invitation_type, number_of_guests, guest_token, rsvp_status, attending_count, responded_at, wish_message, wish_created_at"
    );

  if (token) {
    query = query.eq("guest_token", token);
  } else if (eventId && guestName) {
    query = query
      .eq("event_id", Number(eventId))
      .ilike("guest_name", guestName.trim());
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Invitation not found." },
      { status: 404, headers: corsHeaders }
    );
  }

  return NextResponse.json({ invitation: data }, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      guest_token,
      event_id,
      guest_name,
      rsvp_status,
      attending_count,
    } = body;

    // Validate RSVP status
    const normalizedStatus = String(rsvp_status || "").toLowerCase().trim();
    if (!["accepted", "declined", "pending"].includes(normalizedStatus)) {
      return NextResponse.json(
        {
          error:
            "Invalid rsvp_status. Must be 'accepted', 'declined', or 'pending'.",
        },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!guest_token && (!event_id || !guest_name)) {
      return NextResponse.json(
        {
          error:
            "Missing identifier. Provide either 'guest_token' or both 'event_id' and 'guest_name'.",
        },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = getSupabase();

    // 1. Fetch current invitation to verify limits
    let lookupQuery = supabase
      .from("wedding_invitations")
      .select("wedding_invitation_id, invitation_type, number_of_guests");

    if (guest_token) {
      lookupQuery = lookupQuery.eq("guest_token", guest_token);
    } else {
      lookupQuery = lookupQuery
        .eq("event_id", Number(event_id))
        .ilike("guest_name", String(guest_name).trim());
    }

    const { data: existing, error: lookupError } =
      await lookupQuery.maybeSingle();

    if (lookupError) {
      return NextResponse.json(
        { error: lookupError.message },
        { status: 500, headers: corsHeaders }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: "Invitation not found." },
        { status: 404, headers: corsHeaders }
      );
    }

    // 2. Compute validated attending_count
    let finalAttendingCount: number | null = null;
    const isCouple = String(existing.invitation_type || "").toLowerCase() === "couple";
    const maxGuests = isCouple
      ? Math.max(2, existing.number_of_guests || 2)
      : existing.number_of_guests || 1;

    if (normalizedStatus === "declined") {
      finalAttendingCount = 0;
    } else if (normalizedStatus === "accepted") {
      if (typeof attending_count === "number" && Number.isFinite(attending_count)) {
        finalAttendingCount = Math.max(0, Math.min(attending_count, maxGuests));
      } else {
        finalAttendingCount = maxGuests; // default to maximum invited guests if unspecified
      }
    }

    const now = new Date().toISOString();

    // 3. Update the invitation record
    const { data: updated, error: updateError } = await supabase
      .from("wedding_invitations")
      .update({
        rsvp_status: normalizedStatus,
        attending_count: finalAttendingCount,
        responded_at: now,
      })
      .eq("wedding_invitation_id", existing.wedding_invitation_id)
      .select(
        "wedding_invitation_id, event_id, guest_name, rsvp_status, attending_count, responded_at"
      )
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: `RSVP recorded as ${normalizedStatus}.`,
        invitation: updated,
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Internal server error.",
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
