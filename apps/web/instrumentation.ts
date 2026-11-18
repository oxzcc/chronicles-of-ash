/** Запускается один раз при старте сервера Next.js. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startImageWorker } = await import("./lib/images");
    startImageWorker();
  }
}
