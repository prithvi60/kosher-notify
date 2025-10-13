import { getProductFromInventoryItem } from "../shopify.server";

/**
 * Resolve a numeric productId from an inventory item id using the Admin API helper.
 * Returns a string product id (e.g. '123456789') or null if it cannot be resolved.
 *
 * @param {import('@shopify/shopify-app-react-router').Session} session - shop session used for Admin API
 * @param {string|number} inventoryItemId
 * @returns {Promise<string|null>}
 */
export async function resolveProductIdFromInventory(session, inventoryItemId) {
  if (!inventoryItemId) return null;
  try {
    const variant = await getProductFromInventoryItem(session, inventoryItemId);
    // variant.product.id may be a GID like 'gid://shopify/Product/12345'
    const gid = variant?.product?.id || variant?.product_id || variant?.id || null;
    if (!gid) return null;
    const str = String(gid);
    const m = str.match(/\/(\d+)$/);
    return m ? m[1] : null;
  } catch (err) {
    console.error('resolveProductIdFromInventory error:', err);
    return null;
  }
}

export default resolveProductIdFromInventory;
