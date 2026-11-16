import { getStorage } from "@/lib/images";

/** Раздача готовых картинок. Имена файлов — id из базы, поэтому кэшируются навсегда. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const bytes = await getStorage().read(key.join("/"));
  if (!bytes) return new Response("Not found", { status: 404 });
  const type = key.at(-1)!.endsWith(".webp") ? "image/webp" : key.at(-1)!.endsWith(".png") ? "image/png" : "image/jpeg";
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" } });
}
