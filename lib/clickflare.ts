import { supabase } from "@/lib/supabase";

// Relays funnel conversions captured by the pixel to ClickFlare as S2S postbacks:
//   {CLICKFLARE_POSTBACK_URL}?click_id=...&ct=<event>&txid=<event>-<visitor_id>
// ct must match a custom conversion with the same name in ClickFlare.
// Payout is not sent: ClickFlare uses the payout configured on the offer.

const CONVERSION_EVENTS = ["lead", "account_created", "investment_complete"];

type Touch = { cf_click_id?: string } | null | undefined;

export type PixelPayload = {
  event: string;
  visitor_id?: string;
  event_id?: string;
  first_touch?: Touch;
  last_touch?: Touch;
};

export function clickflareClickId(payload: PixelPayload) {
  return payload.last_touch?.cf_click_id || payload.first_touch?.cf_click_id || null;
}

export async function sendClickflarePostback(payload: PixelPayload) {
  const postbackUrl = process.env.CLICKFLARE_POSTBACK_URL;
  const clickId = clickflareClickId(payload);

  if (!postbackUrl || !clickId || !CONVERSION_EVENTS.includes(payload.event)) {
    return;
  }

  const url = new URL(postbackUrl);
  url.searchParams.set("click_id", clickId);
  url.searchParams.set("ct", payload.event);
  // One conversion per visitor and event, so a repeated event isn't counted twice.
  url.searchParams.set("txid", `${payload.event}-${payload.visitor_id || payload.event_id}`);

  let status: number | null = null;
  let error: string | null = null;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    status = response.status;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Keep a record of every postback attempt for debugging and reconciliation.
  await supabase.from("raw_events").insert({
    source: "clickflare_postback",
    event_name: payload.event,
    payload: {
      url: url.toString(),
      click_id: clickId,
      visitor_id: payload.visitor_id || null,
      event_id: payload.event_id || null,
      status,
      error,
    },
  });
}
