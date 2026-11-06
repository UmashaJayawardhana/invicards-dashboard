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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { guest_token, event_id, guest_name, wish_message } = body;

    const trimmedWish = String(wish_message || "").trim();

    if (!trimmedWish) {
      return NextResponse.json(
        { error: "Wish message cannot be empty." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (trimmedWish.length > 500) {
      return NextResponse.json(
        {
          error: `Wish message is too long (${trimmedWish.length} characters). Maximum allowed is 500.`,
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

    // 1. Find the invitation
    let lookupQuery = supabase
      .from("wedding_invitations")
      .select("wedding_invitation_id");

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

    const now = new Date().toISOString();

    // 2. Update wish message and wish_created_at
    const { data: updated, error: updateError } = await supabase
      .from("wedding_invitations")
      .update({
        wish_message: trimmedWish,
        wish_created_at: now,
      })
      .eq("wedding_invitation_id", existing.wedding_invitation_id)
      .select(
        "wedding_invitation_id, event_id, guest_name, wish_message, wish_created_at"
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
        message: "Wish message recorded successfully.",
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
