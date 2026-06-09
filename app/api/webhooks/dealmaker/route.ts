import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {

  const apiKey = request.headers.get("x-api-key");

  if (apiKey !== process.env.WEBHOOK_API_KEY) {
    return Response.json(
      {
        success: false,
        error: "Unauthorized",
      },
      {
        status: 401,
      }
    );
  }

  try {
    const payload = await request.json();

    const { error } = await supabase
      .from("raw_events")
      .insert({
        source: "dealmaker",
        event_name: payload.event || null,
        payload,
      });

    if (error) {
      throw error;
    }

    return Response.json({
      success: true,
    });

  } catch (error) {
    console.error(error);

    return Response.json(
      {
        success: false,
      },
      {
        status: 500,
      }
    );
  }
}