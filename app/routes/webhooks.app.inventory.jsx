import { emailConfig, apiVersion } from "../shopify.server";
import prisma from "../db.server";
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
      .createHmac(
        "sha256",
        "bb38d8badf261d31dc6cbc58d08e41219b842c8edcc6b0d033972c299c05e743",
      )
      .update(rawBody, "utf8")
      .digest("base64");

    // Compare HMACs
    if (generatedHmac !== hmacHeader) {
      console.error("HMAC validation failed", generatedHmac, hmacHeader);
      return new Response("Unauthorized", { status: 401 });
    }

    // Parse JSON payload
    const payload = JSON.parse(rawBody);

    // Your logic here
    console.log("Webhook verified!", payload, rawBody);
    const inventoryItemId = payload.inventory_item_id; // testing with Selling Plans Ski Wax
    const available = Number(payload.available ?? 0);
    // Prefer productId from payload; fallback to inventoryItemId if necessary
    let productId = "";

    // If productId is missing but we have inventoryItemId, try to resolve it via Admin REST using stored session token.
    if (productId === "") {
      try {
        const shop =
          request.headers.get("x-shopify-shop-domain") ||
          request.headers.get("x-shopify-shop") ||
          null;

        if (shop) {
          const session = await prisma.session.findFirst({ where: { shop } });
          const token = session?.accessToken;

          if (token) {
            const url = `https://${shop}/admin/api/${apiVersion}/variants.json?inventory_item_ids=${inventoryItemId}`;
            const res = await fetch(url, {
              headers: {
                "X-Shopify-Access-Token": token,
                "Content-Type": "application/json",
              },
            });

            if (res.ok) {
              const data = await res.json();
              // console.log("Resolved product data:", data);

              const matchingVariant = data?.variants?.find(
                (v) => String(v.inventory_item_id) === String(inventoryItemId),
              );

              if (matchingVariant) {
                productId = String(matchingVariant.id);
                console.log("✅ Resolved productId:", productId,matchingVariant);
              } else {
                console.warn(
                  "⚠️ No variant found for inventory_item_id:",
                  inventoryItemId,
                );
              }
            } else {
              console.warn(
                "Admin REST lookup failed",
                res.status,
                await res.text(),
              );
            }
          } else {
            console.warn("No session token found for shop", shop);
          }
        } else {
          console.warn(
            "Shop header missing; cannot resolve product from inventory item",
          );
        }
      } catch (err) {
        console.error(
          "Error resolving productId from inventoryItemId via Admin REST",
          err,
        );
      }
    }
    if (available > 0) {
      console.log(
        `🔔 Item restocked — inventoryItemId=${inventoryItemId}, productId=${productId}, available=${available}`,
      );
      try {
        let subs = [];
        if (productId) {
          // query by productId when available (preferred)
          subs = await prisma.subscription.findMany({
            where: { productId: `${productId}`, active: true },
          });
        } else if (inventoryItemId) {
          // fallback to inventoryItemId
          subs = await prisma.subscription.findMany({
            where: { inventoryItemId: `${inventoryItemId}`, active: true },
          });
        }

        console.log("Subscriptions found:", subs);
        if (subs.length > 0) {
          console.log(`Found ${subs.length} subscribers, sending emails...`);
          await Promise.all(
            subs.map((s) =>
              sendNotificationEmail({
                to: s.email,
                inventoryItemId,
                available,
                productId: s.productId || productId,
              }),
            ),
          );
        } else {
          // To admin mail if something is failing
          console.log(
            `No subscribers for product=${productId} or inventory=${inventoryItemId}, sending admin email.`,
          );
          await sendTestEmail({ inventoryItemId, available });
        }
      } catch (err) {
        console.error("Error querying subscriptions", err);
      }
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
};
// single mail
async function sendTestEmail({ inventoryItemId, available }) {
  const { smtpHost, smtpPort, smtpUser, smtpPass, testNotifyEmail } =
    emailConfig;

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
//  mass email to all subscribers
async function sendNotificationEmail({
  to,
  inventoryItemId,
  available,
  productId,
}) {
  const { smtpHost, smtpPort, smtpUser, smtpPass } = emailConfig;

  if (!smtpHost || !to) {
    console.warn(
      "⚠️ Email environment vars or recipient missing, skipping email send.",
    );
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
    ${productId ? `<p>Product ID: ${productId}</p>` : ""}
    <p>Now available: ${available}</p>
  `;

  await transporter.sendMail({
    from: `Shopify App <no-reply@Shop>`,
    to,
    subject: `Restock alert for ${productId ?? inventoryItemId}`,
    html,
  });

  console.log(`✅ Sent notification email to ${to}`);
}
