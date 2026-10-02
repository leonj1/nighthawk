import { addPlatforms, deleteInstance, deletePlatform, getPlatforms } from "../../lib/server/monitor.ts";
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

export async function DELETE(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && new URL(origin).host !== request.headers.get("host")) {
    return Response.json({ error: "Invalid origin." }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const platformId = searchParams.get("platformId");
  const instanceUrl = searchParams.get("instanceUrl");
  if (!platformId) return Response.json({ error: "Platform ID is required." }, { status: 400 });
  const deleted = instanceUrl === null
    ? await deletePlatform(platformId)
    : await deleteInstance(platformId, instanceUrl);
  if (!deleted) return Response.json({ error: instanceUrl === null ? "Platform not found." : "Instance not found." }, { status: 404 });
  return new Response(null, { status: 204 });
}
