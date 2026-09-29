import { addPlatforms, getPlatforms } from "../../lib/server/monitor";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getPlatforms(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && new URL(origin).host !== request.headers.get("host")) {
    return Response.json({ error: "Invalid origin." }, { status: 403 });
  }
  try {
    const body = await request.text();
    if (body.length > 200_000) throw new Error("Request too large.");
    const inputs = JSON.parse(body);
    if (!Array.isArray(inputs) || inputs.length > 100) throw new Error("Invalid platforms.");
    return Response.json(await addPlatforms(inputs));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save platforms." }, { status: 400 });
  }
}
