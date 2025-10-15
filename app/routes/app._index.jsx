import { useState, useMemo } from "react";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

// ------------------------------
// 🧠 Loader: Fetch from Prisma + Enrich with Shopify
// ------------------------------

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1️⃣ Fetch subscriptions
  const subscriptions = await prisma.subscription.findMany({
    orderBy: { createdAt: "desc" },
  });

  if (subscriptions.length !== 0) {
    // 🧪 Demo Data if DB is empty
    const demoProducts = [
      {
        id: "gid://shopify/Product/TEST123",
        title: "Demo Product - Winter Hoodie",
        image: "https://cdn.shopify.com/s/files/1/0680/4150/7113/files/demo_hoodie.jpg?v=170",
        subscribers: [
          {
            id: "demo_1",
            email: "john@example.com",
            active: true,
            createdAt: new Date().toISOString(),
          },
          {
            id: "demo_2",
            email: "jane@example.com",
            active: false,
            createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          },
        ],
      },
    ];

    const reports = {
      demandingProducts: 1,
      requests: 2,
      sentNotifications: 1,
      totalRevenue: 0,
    };

    console.log("🧪 Loaded demo test data (no real subscriptions)");
    return { reports, products: demoProducts };
  }

  // 2️⃣ If data exists → proceed as before
  const totalRequests = subscriptions.length;
  const rawIds = [...new Set(subscriptions.map((s) => s.productId))];

  // Convert to GIDs (assuming stored variant IDs)
  const variantGids = rawIds.map((id) =>
    id.startsWith("gid://shopify/") ? id : `gid://shopify/ProductVariant/${id}`
  );

  // 3️⃣ Resolve variant → product
  let variantToProductMap = {};
  if (variantGids.length > 0) {
    const variantQuery = `
      query getVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            product { id title featuredImage { url altText } }
          }
        }
      }
    `;
    const res = await admin.graphql(variantQuery, { variables: { ids: variantGids } });
    const json = await res.json();

    json.data.nodes
      .filter(Boolean)
      .forEach((v) => {
        variantToProductMap[v.id] = {
          productId: v.product.id,
          title: v.product.title,
          image: v.product.featuredImage?.url || null,
        };
      });
  }

  // 4️⃣ Merge into final structure
  const productsMap = {};
  subscriptions.forEach((s) => {
    const variantInfo = variantToProductMap[s.productId];
    if (!variantInfo) return;

    const productId = variantInfo.productId;
    if (!productsMap[productId]) {
      productsMap[productId] = {
        id: productId,
        title: variantInfo.title,
        image: variantInfo.image,
        subscribers: [],
      };
    }
    productsMap[productId].subscribers.push({
      id: s.id,
      email: s.email,
      active: s.active,
      createdAt: s.createdAt,
    });
  });

  const products = Object.values(productsMap);

  const reports = {
    demandingProducts: rawIds.length,
    requests: totalRequests,
    sentNotifications: 0,
    totalRevenue: 0,
  };

  console.log("✅ Loaded real data:", products);
  return { reports, products };
};


// ------------------------------
// 🧩 Frontend UI
// ------------------------------
export default function BackInStockDashboard() {
  const { reports, products } = useLoaderData();
  const [openProductId, setOpenProductId] = useState(null);
  const [search, setSearch] = useState("");

  // 🔍 Search filter
  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.subscribers.some((s) => s.email.toLowerCase().includes(q))
    );
  }, [search, products]);

  return (
    <s-page heading="Back in Stock">
      {/* ---------- Quick Reports Section ---------- */}
      <s-card>
        <s-heading level="3">Quick reports</s-heading>
        <s-divider />

        <s-stack direction="inline" gap="loose" wrap>
          <ReportBox label="Demanding products" value={reports.demandingProducts} />
          <ReportBox label="Requests" value={reports.requests} />
          {/* <ReportBox label="Sent notifications" value={reports.sentNotifications} />
          <ReportBox label="Total revenue" value={`${reports.totalRevenue} ₹`} /> */}
        </s-stack>
      </s-card>

      {/* ---------- Sticky Search Header ---------- */}
      <div
        style={{
          position: "sticky",
          top: 0,
          background: "#fff",
          zIndex: 10,
          padding: "12px 0",
          borderBottom: "1px solid #e5e7eb",
          marginBottom: "8px",
        }}
      >
        <s-section>
          <s-stack direction="inline" alignment="center" gap="base">
            <s-heading level="4" style={{ marginBottom: "0" }}>
              Product Subscriber Overview
            </s-heading>
            <input
              type="text"
              placeholder="Search by product or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
              }}
            />
          </s-stack>
        </s-section>
      </div>

      {/* ---------- Accordion Product List ---------- */}
      {filteredProducts.length === 0 ? (
        <s-text>No back-in-stock requests found.</s-text>
      ) : (
        <div style={{ marginTop: "1rem" }}>
          {filteredProducts.map((p) => (
            <AccordionProduct
              key={p.id}
              product={p}
              isOpen={openProductId === p.id}
              onToggle={() =>
                setOpenProductId(openProductId === p.id ? null : p.id)
              }
            />
          ))}
        </div>
      )}
    </s-page>
  );
}

// ------------------------------
// 🧱 Accordion Product Component
// ------------------------------
// ------------------------------
// 🧱 Accordion Product Component (Fixed)
// ------------------------------
function AccordionProduct({ product, isOpen, onToggle }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        marginBottom: "10px",
        background: "#fff",
        overflow: "hidden",
        transition: "box-shadow 0.2s ease",
        boxShadow: isOpen ? "0 2px 6px rgba(0,0,0,0.08)" : "none",
      }}
    >
      {/* Header (Accessible) */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle()}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          cursor: "pointer",
          background: isOpen ? "#f9fafb" : "#fcfcfc",
          transition: "background 0.2s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {product.image && (
            <img
              src={product.image}
              alt={product.title}
              width="40"
              height="40"
              style={{ borderRadius: "4px", objectFit: "cover" }}
            />
          )}
          <strong>{product.title}</strong>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <s-badge tone="success">{product.subscribers.length}</s-badge>
          <span
            style={{
              transition: "transform 0.25s ease",
              transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
              fontSize: "18px",
              color: "#6b7280",
            }}
          >
            ▶
          </span>
        </div>
      </div>

      {/* Collapsible Subscriber Table */}
      <div
        style={{
          maxHeight: isOpen ? "1000px" : "0",
          opacity: isOpen ? 1 : 0,
          transition: "all 0.3s ease",
          overflow: "hidden",
          padding: isOpen ? "12px 16px" : "0 16px",
        }}
      >
        {isOpen && (
          <>
            {product.subscribers.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "14px",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "8px",
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Email
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "8px",
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Active
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "8px",
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Created At
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.subscribers.map((s) => (
                      <tr key={s.id}>
                        <td style={{ padding: "8px", borderBottom: "1px solid #f0f0f0" }}>
                          {s.email}
                        </td>
                        <td style={{ padding: "8px", borderBottom: "1px solid #f0f0f0" }}>
                          {s.active ? "✅" : "❌"}
                        </td>
                        <td style={{ padding: "8px", borderBottom: "1px solid #f0f0f0" }}>
                          {new Date(s.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <s-text>No subscribers found.</s-text>
            )}
          </>
        )}
      </div>
    </div>
  );
}


// ------------------------------
// 🧱 ReportBox Helper
// ------------------------------
function ReportBox({ label, value }) {
  return (
    <div
      style={{
        flex: "1 1 20%",
        background: "#fafafa",
        borderRadius: "8px",
        padding: "12px 16px",
        textAlign: "center",
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ color: "#6b7280", fontSize: "13px" }}>{label}</div>
      <div style={{ fontWeight: "bold", fontSize: "18px", marginTop: "4px" }}>
        {value}
      </div>
    </div>
  );
}
