import prisma from "../db.server";

const buildCorsHeaders = (request) => {
  const origin = request.headers.get("origin") || '*';
  const allowOrigin = origin === 'null' ? '*' : origin;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
};

// 🧩 1️⃣ Handle OPTIONS + GET with loader
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    // Respond to CORS preflight
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(request),
    });
  }

  // Optional: handle GET for testing
  return new Response(
    JSON.stringify({ ok: true, message: "API running" }),
    {
      status: 200,
      headers: buildCorsHeaders(request),
    }
  );
};

// 🧩 2️⃣ Handle POST with action
export const action = async ({ request }) => {
  try {
    const body = await request.json();
    const { email, inventoryItemId, productId } = body;

    if (!email || !inventoryItemId) {
      return new Response(JSON.stringify({ error: "Missing email or inventoryItemId" }), {
        status: 400,
        headers: buildCorsHeaders(request),
      });
    }

    const subscription = await prisma.subscription.upsert({
      where: { email_inventoryItemId: { email, inventoryItemId } },
      update: { active: true, productId },
      create: { email, inventoryItemId, productId },
    });

    return new Response(JSON.stringify({ ok: true, subscription }), {
      status: 201,
      headers: buildCorsHeaders(request),
    });
  } catch (err) {
    console.error("Subscribe API error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: buildCorsHeaders(request) }
    );
  }
};
