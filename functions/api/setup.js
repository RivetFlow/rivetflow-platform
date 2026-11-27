
export async function onRequestPost() {
  return Response.json(
    {
      success: false,
      error: "This setup endpoint is disabled."
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
