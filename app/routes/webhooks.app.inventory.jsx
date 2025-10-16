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
    // console.log("Webhook verified!", payload, rawBody);
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
                // console.log(
                //   "✅ Resolved productId:",
                //   productId,
                //   matchingVariant,
                // );
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
      // console.log(
      //   `🔔 Item restocked — inventoryItemId=${inventoryItemId}, productId=${productId}, available=${available}`,
      // );
      try {
        let subs = [];
        if (productId) {
          // query by productId when available (preferred)
          subs = await prisma.subscription.findMany({
            where: { productId: `${productId}`, active: true },
          });
        } else {
          console.error(
            `No valid productId found for inventoryItemId=${inventoryItemId}. Skipping subscriber lookup.`,
          );
        }

        // console.log("Subscriptions found:", subs);
        if (subs.length > 0) {
          console.log(`Found ${subs.length} subscribers, sending emails...`);
          await Promise.all(
            subs.map((s) =>
              sendNotificationEmail({
                to: s.email,
                inventoryItemId,
                available,
                productId: s.productId || productId,
                shopDomain:
                  request.headers.get("x-shopify-shop-domain") ||
                  request.headers.get("x-shopify-shop"),
              }),
            ),
          );
          // 🧹 Delete subscribers after sending mails
          try {
            const idsToDelete = subs.map((s) => s.id);
            await prisma.subscription.deleteMany({
              where: { id: { in: idsToDelete } },
            });
            console.log(
              `🗑️ Deleted ${idsToDelete.length} subscribers after mailing.`,
            );
          } catch (deleteErr) {
            console.error("❌ Failed to delete subscribers:", deleteErr);
          }
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

/* -----------------------------
   🧱  EMAIL HELPERS SECTION
   ----------------------------- */

// Fetch shop + product data
async function fetchShopAndProduct(shop, variantId, token) {
  try {
    if (!shop) {
      console.error("❌ Missing shop domain — cannot fetch data.");
      return null;
    }

    // console.log("Fetching variant/product data for", { shop, variantId, token });

    // 1️⃣ Build GraphQL query (like your Remix loader)
    const variantQuery = `
      query getVariant($id: ID!) {
        node(id: $id) {
          ... on ProductVariant {
            id
            title
            price
            image { url altText }
            product {
              id
              title
              handle
              featuredImage { url altText }
            }
          }
        }
      }
    `;

    // Shopify GIDs always need the full prefix
    const gid = variantId.startsWith("gid://shopify/")
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;

    const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: variantQuery, variables: { id: gid } }),
    });

    const json = await res.json();
    const variantNode = json?.data?.node;

    if (!variantNode) {
      console.warn("⚠️ Variant not found:", variantId, json);
      return null;
    }

    // 2️⃣ Extract clean data
    const product = variantNode.product || {};
    // const productId = product.id?.split("/").pop();
    const variantNumericId = variantNode.id?.split("/").pop();

    // 3️⃣ Fetch shop info separately
    const shopRes = await fetch(`https://${shop}/admin/api/${apiVersion}/shop.json`, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
    });
    const shopData = (await shopRes.json())?.shop;

    // console.log("✅ Fetched variant/product:", { variantNode, shopData });

    // 4️⃣ Return unified data
    return {
      shopInfo: {
        name: shopData?.name || shop.replace(".myshopify.com", ""),
        logo: shopData?.image?.src || null,
        domain: shopData?.domain || shop,
        currency: shopData?.currency || "USD",
      },
      productInfo: {
        variantId: variantNumericId,
        variantTitle: variantNode.title,
        title: product.title,
        handle: product.handle,
        image:
          variantNode.image?.url ||
          product.featuredImage?.url ||
          "https://cdn.shopify.com/s/files/1/placeholder.png",
        price: variantNode.price || "—",
      },
    };
  } catch (err) {
    console.error("❌ Failed to fetch variant/product:", err);
    return null;
  }
}


// Generate HTML Template
function generateRestockHTML({ shop, product }) {
  const addToCartUrl = `https://${shop.domain}/cart/${product.variantId || ""}:1`;
  const productUrl = `https://${shop.domain}/products/${product.handle}`;
  const subject = `${product.title} is back in stock!`;

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f9fafb; margin:0; color:#111827; }
      .container { max-width:560px; margin:24px auto; background:#fff; border-radius:8px; box-shadow:0 1px 4px rgba(0,0,0,0.08); overflow:hidden; }
      .header { text-align:center; padding:20px; }
      .header img { max-width:100px; border-radius:8px; }
      .shop-name { font-weight:600; font-size:18px; margin-top:8px; }
      .title { text-align:center; font-size:20px; font-weight:600; margin-top:12px; }
      .subtext { text-align:center; color:#6b7280; font-size:14px; margin:10px 0 20px; }
      .image { display:block; width:100%; max-width:320px; margin:0 auto 10px; border-radius:8px; }
      .price { text-align:center; font-weight:600; margin-bottom:16px; }
      .btn { display:block; width:80%; margin:8px auto; text-align:center; text-decoration:none; padding:12px 0; border-radius:6px; font-weight:600; }
      .btn-primary { background:#1e40af; color:#fff; }
      .btn-secondary { border:1px solid #1e40af; color:#1e40af; background:#fff; }
      .footer { text-align:center; font-size:12px; color:#9ca3af; padding:16px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        ${shop.logo ? `<img src="${shop.logo}" alt="${shop.name}" />` : ""}
        <div class="shop-name">${shop.name}</div>
      </div>
      <div class="title">${product.title} is available now!</div>
      <div class="subtext">Get it before it sells out again.</div>
      <img src="${product.image}" alt="${product.title}" class="image" />
      <div class="price">${shop.currency} ${product.price}</div>
      <a href="${addToCartUrl}" class="btn btn-primary">Add to Cart</a>
      <a href="${productUrl}" class="btn btn-secondary">View Item</a>
      <div class="footer">You’re receiving this email because you requested a back-in-stock alert from ${shop.name}.</div>
    </div>
  </body>
  </html>
  `;
  return { subject, html };
}

// Send Restock Notification
async function sendNotificationEmail({ to, productId, shopDomain }) {
  const { smtpHost, smtpPort, smtpUser, smtpPass } = emailConfig;

  if (!smtpHost || !to) {
    console.warn("⚠️ Missing SMTP configuration or recipient.");
    return;
  }

  const session = await prisma.session.findFirst({
    where: { shop: shopDomain },
  });
  const token = session?.accessToken;

  if (!token) {
    console.warn("⚠️ No Shopify token found for shop", shopDomain);
    return;
  }

  const data = await fetchShopAndProduct(shopDomain, productId, token);
  if (!data) {
    console.warn("⚠️ Missing product/shop info for email");
    return;
  }

  const { shopInfo, productInfo } = data;
  const { subject, html } = generateRestockHTML({
    shop: shopInfo,
    product: productInfo,
  });
  // console.log("Generated email HTML:", html);

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.sendMail({
    from: `${shopInfo.name} <no-reply@${shopInfo.domain}>`,
    to,
    subject,
    html,
  });

  // console.log(`✅ Restock email sent to ${to}`);
}

// Fallback Test Email
async function sendTestEmail({ inventoryItemId, available }) {
  const { smtpHost, smtpPort, smtpUser, smtpPass, testNotifyEmail } =
    emailConfig;
  if (!testNotifyEmail) return;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const html = `
    <h2>We have an error send mail to customer for the below product</h2>
    <p>Inventory Item ID: ${inventoryItemId}</p>
    <p>Now available: ${available}</p>
  `;

  await transporter.sendMail({
    from: `Shopify App <no-reply@Shop>`,
    to: testNotifyEmail,
    subject: `Test restock alert`,
    html,
  });

  console.log(`✅ Test email sent to ${testNotifyEmail}`);
}
