import {  emailConfig} from "../shopify.server";
// import shopify from "../shopify.server";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const action = async ({ request }) => {
    // console.log(`Running webhook`,request,"shopify config",shopify);
     try {
    // Get raw body
    const rawBody = await request.text();

    // Get HMAC from header
    const hmacHeader = request.headers.get("x-shopify-hmac-sha256");

    // Compute HMAC using your secret
    const generatedHmac = crypto
      .createHmac("sha256", "bb38d8badf261d31dc6cbc58d08e41219b842c8edcc6b0d033972c299c05e743")
      .update(rawBody, "utf8")
      .digest("base64");

    // Compare HMACs
    if (generatedHmac !== hmacHeader) {
      console.error("HMAC validation failed",generatedHmac,hmacHeader);
      return new Response("Unauthorized", { status: 401 });
    }

    // Parse JSON payload
    const payload = JSON.parse(rawBody);

    // Your logic here
    console.log("Webhook verified!", payload,rawBody);
    const inventoryItemId = payload.inventory_item_id;
    const available = Number(payload.available ?? 0);

    if (available > 0  ) {
     console.log(`🔔 Item ${inventoryItemId} restocked (${available})`);
     await sendTestEmail({  inventoryItemId, available });
    }
    return new Response("ok");
  } catch (err) {
      console.error("Webhook authentication failed:", err);
  if (err instanceof Error) {
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
  }
    return new Response("Webhook error", { status: 500 });
  }
//  try {
//     const { topic, shop, payload } = await authenticate.webhook(request);
//     console.log(`📦 Received ${topic} webhook from ${shop}`);
//   const inventoryItemId = payload.inventory_item_id;
//   const available = Number(payload.available ?? 0);

//   if (available > 0) {
//     console.log(`🔔 Item ${inventoryItemId} restocked (${available})`);
//     await sendTestEmail({ shop, inventoryItemId, available });
//   }

//   return new Response("ok");
//   } catch (err) {
//     console.error("Webhook authentication failed:", err);
//     if (err instanceof Error) {
//       console.error("Error message:", err.message);
//       console.error("Error stack:", err.stack);
//     }
//     return new Response("Webhook authentication failed", { status: 401 });
//   }


};

async function sendTestEmail({  inventoryItemId, available }) {
  const {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    testNotifyEmail,
  } = emailConfig;

  if (!smtpHost || !testNotifyEmail) {
    console.warn("⚠️ Email environment vars missing, skipping email send.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const html = `
    <h2>Inventory Update</h2>

    <p>Inventory Item ID: ${inventoryItemId}</p>
    <p>Now available: ${available}</p>
  `;

  await transporter.sendMail({
    from: `Shopify App <no-reply@Shop>`,
    to: testNotifyEmail,
    subject: `Test restock alert for Shop`,
    html,
  });

  console.log(`✅ Sent test email to ${testNotifyEmail}`);
}
