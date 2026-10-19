import { after } from "next/server";
import { sendClickflarePostback, type PixelPayload } from "@/lib/clickflare";
import { supabase } from "@/lib/supabase";

// Public endpoint for the browser pixel (public/pixel.js), fired through GTM.
// Unlike the DealMaker webhook it can't hold a secret, so it only accepts
// requests from allowed origins and stores everything as source "pixel".

const ALLOWED_ORIGINS = (process.env.PIXEL_ALLOWED_ORIGINS || "https://invest.autocamp.com")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const MAX_BODY_BYTES = 16 * 1024;
const EVENT_NAME = /^[a-z0-9_]{1,64}$/;

const PIXEL_GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (char) => char.charCodeAt(0)
);

// Some traffic partners put subscriber emails in UTMs (e.g. utm_campaign=..._sub1=name@gmail.com).
// Raw emails are never stored; the pixel sends hashed emails in `data` instead.
const EMAIL = /[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function redactEmails(value: unknown): unknown {
  if (typeof value === "string") return value.replace(EMAIL, "[email]");
  if (Array.isArray(value)) return value.map(redactEmails);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactEmails(item)]));
  }
  return value;
}

function requestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) return origin;

  const referer = request.headers.get("referer");
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

async function storeEvent(request: Request, origin: string, payload: Record<string, unknown>) {
  const eventName = typeof payload.event === "string" ? payload.event : "";

  if (!EVENT_NAME.test(eventName)) {
    return "Invalid event";
  }

  const clean = redactEmails(payload) as Record<string, unknown>;

  const { error } = await supabase.from("raw_events").insert({
    source: "pixel",
    event_name: eventName,
    payload: {
      ...clean,
      server: {
        received_at: new Date().toISOString(),
        origin,
        ip: request.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
        user_agent: request.headers.get("user-agent"),
      },
    },
  });

  if (error) {
    throw error;
  }

  after(() => sendClickflarePostback(clean as PixelPayload));

  return null;
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(requestOrigin(request)),
  });
}

// sendBeacon / fetch from pixel.js. Body is JSON sent as text/plain to avoid a CORS preflight.
export async function POST(request: Request) {
  const origin = requestOrigin(request);
  const headers = corsHeaders(origin);

  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.text();

    if (body.length > MAX_BODY_BYTES) {
      return Response.json({ success: false, error: "Payload too large" }, { status: 413, headers });
    }

    const payload = JSON.parse(body);

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return Response.json({ success: false, error: "Invalid payload" }, { status: 400, headers });
    }

    const invalid = await storeEvent(request, origin, payload);

    if (invalid) {
      return Response.json({ success: false, error: invalid }, { status: 400, headers });
    }

    return Response.json({ success: true }, { headers });
  } catch (error) {
    console.error(error);

    return Response.json({ success: false }, { status: 500, headers });
  }
}

// Image-pixel fallback: <img src=".../api/collect?event=lead&visitor_id=...">
// Query params become the payload; always answers with a 1x1 gif.
export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const gif = new Response(PIXEL_GIF, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
    },
  });

  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return gif;
  }

  try {
    const payload = Object.fromEntries(new URL(request.url).searchParams);
    await storeEvent(request, origin, { ...payload, transport: "img" });
  } catch (error) {
    console.error(error);
  }

  return gif;
}
