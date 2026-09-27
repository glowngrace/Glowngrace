import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { products, type Product } from '../data/catalog.js';
import { checkoutTaxRate, deliveryOptions } from '../data/checkout.js';

export type QueryResult = { rows: Array<Record<string, unknown>>; rowCount: number | null };
export type Database = {
  query: (text: string, values: unknown[]) => Promise<QueryResult>;
};
export type ApiResult = {
  status: number;
  body: { message?: string; error?: string; orderNumber?: string; total?: number; products?: Product[]; product?: Product };
};

const checkoutSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{10,20}$/),
  address: z.string().trim().min(5).max(240),
  locality: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().regex(/^[1-9][0-9]{5}$/),
  landmark: z.string().trim().max(120).optional().default(''),
  deliveryMethod: z.enum(['standard', 'express', 'same_day']),
  paymentMethod: z.literal('cod'),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(50),
});

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(32).optional().default(''),
  topic: z.string().trim().min(2).max(80),
  message: z.string().trim().min(10).max(3000),
});
const newsletterSchema = z.object({
  email: z.string().trim().email().max(254),
});
const productSchema = z.object({
  name: z.string().trim().min(2).max(180),
  category: z.enum(['Makeup', 'Skincare', 'Fragrance', 'Gifting']),
  brand: z.string().trim().max(120).optional().default(''),
  sku: z.string().trim().max(64).optional().default(''),
  price: z.number().int().positive().max(99999999),
  mrp: z.number().int().positive().max(99999999),
  stock: z.number().int().min(0).max(999999),
  images: z.array(z.object({
    filename: z.string().trim().min(1).max(180).regex(/^[^\\/]+$/),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    data: z.string().max(409600).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    width: z.number().int().min(1).max(1200),
    height: z.number().int().min(1).max(1200),
  })).min(1).max(10),
  description: z.string().trim().min(1).max(3000),
}).refine((product) => product.mrp >= product.price, { path: ['mrp'] });

function mapProduct(row: Record<string, unknown>): Product {
  const images = Array.isArray(row.images) ? row.images.map(String) : [];
  return {
    id: Number(row.id),
    name: String(row.name),
    category: String(row.category),
    brand: row.brand ? String(row.brand) : undefined,
    sku: row.sku ? String(row.sku) : undefined,
    price: Number(row.price),
    mrp: Number(row.mrp),
    stock: Number(row.stock),
    rating: Number(row.rating),
    reviews: Number(row.reviews),
    badge: row.badge ? String(row.badge) : undefined,
    image: images[0] ?? `/images/${String(row.image)}`,
    images,
    description: String(row.description),
  };
}

function imageDimensions(data: Buffer, mimeType: string): { width: number; height: number } | null {
  if (mimeType === 'image/png' && data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.toString('ascii', 12, 16) === 'IHDR') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (mimeType === 'image/jpeg' && data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < data.length) {
      if (data[offset] !== 0xff) return null;
      const marker = data[offset + 1];
      const segmentLength = data.readUInt16BE(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > data.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (segmentLength < 8) return null;
        return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      }
      offset += 2 + segmentLength;
    }
  }
  if (mimeType === 'image/webp' && data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = data.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return {
        width: 1 + data.readUIntLE(24, 3),
        height: 1 + data.readUIntLE(27, 3),
      };
    }
    if (chunk === 'VP8 ' && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
      return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && data[20] === 0x2f) {
      return {
        width: 1 + data[21] + ((data[22] & 0x3f) << 8),
        height: 1 + ((data[22] >> 6) | (data[23] << 2) | ((data[24] & 0x0f) << 10)),
      };
    }
  }
  return null;
}

export type ProductImageResult = { status: number; mimeType?: string; data?: Buffer };

export function createHandlers(database: Database) {
  return {
    async products(method: string | undefined, body: unknown): Promise<ApiResult> {
      if (method === 'GET') {
        try {
          const result = await database.query(
            `SELECT product.id, product.name, product.category, product.brand, product.sku, product.price,
                    product.mrp, product.stock, product.rating, product.reviews, product.badge,
                    product.image, product.description,
                    COALESCE(
                      (SELECT json_agg('/api/products/' || product.id || '/images/' || image.position ORDER BY image.position)
                       FROM product_images AS image WHERE image.product_id = product.id),
                      '[]'::json
                    ) AS images
             FROM products AS product ORDER BY product.id`,
            [],
          );
          return { status: 200, body: { products: result.rows.map(mapProduct) } };
        } catch (error) {
          console.error('Unable to load catalogue products', error);
          return { status: 500, body: { error: 'server_error', message: 'The catalogue could not be loaded. Please try again shortly.' } };
        }
      }
      if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
      const parsed = productSchema.safeParse(body);
      if (!parsed.success) {
        return { status: 400, body: { error: 'invalid_product', message: 'Check product details, prices, and upload 1–10 supported product images.' } };
      }

      const product = parsed.data;
      const uploadedImages = product.images.map((image, position) => {
        const data = Buffer.from(image.data, 'base64');
        const dimensions = imageDimensions(data, image.mimeType);
        if (data.length === 0 || data.length > 307200 || !dimensions ||
          dimensions.width < 1 || dimensions.width > 1200 || dimensions.height < 1 || dimensions.height > 1200) {
          return null;
        }
        return { ...image, position };
      });
      if (uploadedImages.some((image) => image === null)) {
        return { status: 400, body: { error: 'invalid_product_image', message: 'Each image must be a valid JPEG, PNG or WebP file no larger than 1200 × 1200 px or 300 KB.' } };
      }
      const validImages = uploadedImages.filter((image): image is NonNullable<typeof image> => image !== null);
      const primaryImage = product.images[0];
      if (!primaryImage) return { status: 400, body: { error: 'invalid_product_image', message: 'Upload at least one product image.' } };
      try {
        const result = await database.query(
          `WITH created_product AS (
             INSERT INTO products (name, category, brand, sku, price, mrp, stock, image, description)
             VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6, $7, $8, $9)
             RETURNING id, name, category, brand, sku, price, mrp, stock, rating, reviews, badge, image, description
           ),
           created_images AS (
             INSERT INTO product_images (product_id, position, filename, mime_type, image_data, width, height)
             SELECT created_product.id, image.position, image.filename, image.mime_type,
                    decode(image.data, 'base64'), image.width, image.height
             FROM created_product
             CROSS JOIN jsonb_to_recordset($10::jsonb) AS image(
               position INTEGER, filename VARCHAR(180), mime_type VARCHAR(32),
               data TEXT, width INTEGER, height INTEGER
             )
             RETURNING product_id, position
           )
           SELECT created_product.*,
             COALESCE(
               (SELECT json_agg('/api/products/' || created_product.id || '/images/' || created_images.position ORDER BY created_images.position)
                FROM created_images WHERE created_images.product_id = created_product.id),
               '[]'::json
             ) AS images
           FROM created_product`,
          [
            product.name, product.category, product.brand, product.sku, product.price, product.mrp,
            product.stock, product.images[0].filename, product.description,
            JSON.stringify(validImages.map((image) => ({
              position: image.position,
              filename: image.filename,
              mime_type: image.mimeType,
              data: image.data,
              width: image.width,
              height: image.height,
            }))),
          ],
        );
        const savedProduct = result.rows[0];
        if (!savedProduct) throw new Error('The catalogue did not confirm the saved product.');
        return { status: 201, body: { product: mapProduct(savedProduct), message: 'Product added to the catalogue.' } };
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
          return { status: 409, body: { error: 'duplicate_sku', message: 'That SKU is already in the catalogue. Use a unique SKU or leave it blank.' } };
        }
        console.error('Unable to save catalogue product', error);
        return { status: 500, body: { error: 'server_error', message: 'The product could not be saved. Please try again shortly.' } };
      }
    },
    async productImage(productId: number, imageIndex: number): Promise<ProductImageResult> {
      if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(imageIndex) || imageIndex < 0 || imageIndex > 9) {
        return { status: 404 };
      }
      try {
        const result = await database.query(
          'SELECT mime_type, image_data FROM product_images WHERE product_id = $1 AND position = $2',
          [productId, imageIndex],
        );
        const image = result.rows[0];
        if (!image || !Buffer.isBuffer(image.image_data)) return { status: 404 };
        return { status: 200, mimeType: String(image.mime_type), data: image.image_data };
      } catch (error) {
        console.error('Unable to load catalogue product image', error);
        return { status: 500 };
      }
    },
    async contact(method: string | undefined, body: unknown): Promise<ApiResult> {
      if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
      const parsed = contactSchema.safeParse(body);
      if (!parsed.success) return { status: 400, body: { error: 'invalid_form', message: 'Please check the details and try again.' } };

      try {
        const { name, email, phone, topic, message } = parsed.data;
        await database.query(
          'INSERT INTO contact_requests (name, email, phone, topic, message) VALUES ($1, $2, $3, $4, $5)',
          [name, email, phone || null, topic, message],
        );
        return { status: 201, body: { message: 'Thank you. We will be in touch within one working day.' } };
      } catch (error) {
        console.error('Unable to save contact request', error);
        return { status: 500, body: { error: 'server_error', message: 'We could not send your message right now. Please try again shortly.' } };
      }
    },
    async newsletter(method: string | undefined, body: unknown): Promise<ApiResult> {
      if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
      const parsed = newsletterSchema.safeParse(body);
      if (!parsed.success) return { status: 400, body: { error: 'invalid_email', message: 'Enter a valid email address to subscribe.' } };

      try {
        await database.query(
          'INSERT INTO newsletter_subscribers (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET updated_at = NOW()',
          [parsed.data.email],
        );
        return { status: 201, body: { message: 'You are on the list. Look out for a little glow in your inbox.' } };
      } catch (error) {
        console.error('Unable to save newsletter subscription', error);
        return { status: 500, body: { error: 'server_error', message: 'We could not subscribe you right now. Please try again shortly.' } };
      }
    },
    async checkout(method: string | undefined, body: unknown): Promise<ApiResult> {
      if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
      const parsed = checkoutSchema.safeParse(body);
      if (!parsed.success) {
        return { status: 400, body: { error: 'invalid_checkout', message: 'Please check your delivery and contact details and try again.' } };
      }

      const requestedItems = parsed.data.items;
      if (new Set(requestedItems.map((item) => item.productId)).size !== requestedItems.length) {
        return { status: 400, body: { error: 'duplicate_items', message: 'Please remove duplicate products from your bag and try again.' } };
      }
      const staticOrderItems = requestedItems.map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId);
        return product ? {
          productId: product.id,
          name: product.name,
          unitPricePaise: product.price * 100,
          quantity: item.quantity,
        } : null;
      });
      const missingProductIds = requestedItems
        .filter((_item, index) => staticOrderItems[index] === null)
        .map((item) => item.productId);
      let savedProducts = new Map<number, { name: string; price: number }>();
      if (missingProductIds.length) {
        try {
          const result = await database.query(
            'SELECT id, name, price FROM products WHERE id = ANY($1::integer[])',
            [missingProductIds],
          );
          savedProducts = new Map(result.rows.map((row) => [Number(row.id), { name: String(row.name), price: Number(row.price) }]));
        } catch (error) {
          console.error('Unable to verify catalogue products for checkout', error);
          return { status: 500, body: { error: 'server_error', message: 'We could not verify your bag right now. Please try again shortly.' } };
        }
      }
      const orderItems = requestedItems.map((item, index) => {
        const staticItem = staticOrderItems[index];
        if (staticItem) return staticItem;
        const product = savedProducts.get(item.productId);
        return product ? {
          productId: item.productId,
          name: product.name,
          unitPricePaise: product.price * 100,
          quantity: item.quantity,
        } : null;
      });
      if (orderItems.some((item) => !item)) {
        return { status: 400, body: { error: 'unknown_product', message: 'One of the products in your bag is no longer available.' } };
      }

      const items = orderItems.filter((item): item is NonNullable<typeof item> => item !== null);
      const deliveryFee = deliveryOptions.find((option) => option.id === parsed.data.deliveryMethod)?.fee;
      if (deliveryFee === undefined) {
        return { status: 400, body: { error: 'invalid_delivery', message: 'Please choose an available delivery method.' } };
      }
      const subtotalPaise = items.reduce((sum, item) => sum + item.unitPricePaise * item.quantity, 0);
      const shippingPaise = deliveryFee * 100;
      const taxPaise = Math.round(subtotalPaise * checkoutTaxRate);
      const totalPaise = subtotalPaise + shippingPaise + taxPaise;
      const orderNumber = `GG-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      const { firstName, lastName, email, phone, address, locality, city, state, postalCode, landmark, deliveryMethod } = parsed.data;

      try {
        const result = await database.query(
          `WITH created_order AS (
             INSERT INTO orders (
               order_number, customer_name, email, phone, street_address, locality,
               city, state, postal_code, landmark, delivery_method, payment_method,
               subtotal_paise, shipping_paise, tax_paise, total_paise
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'cod', $12, $13, $14, $15
             )
             RETURNING id, order_number, total_paise, created_at
           ),
           created_items AS (
             INSERT INTO order_items (order_id, product_id, product_name, unit_price_paise, quantity)
             SELECT created_order.id, item.product_id, item.product_name, item.unit_price_paise, item.quantity
             FROM created_order
             CROSS JOIN jsonb_to_recordset($16::jsonb) AS item(
               product_id INTEGER,
               product_name VARCHAR(180),
               unit_price_paise BIGINT,
               quantity INTEGER
             )
             RETURNING order_id
           )
           SELECT created_order.id, created_order.order_number, created_order.total_paise,
             created_order.created_at, COUNT(created_items.order_id)::INTEGER AS item_count
           FROM created_order LEFT JOIN created_items ON created_items.order_id = created_order.id
           GROUP BY created_order.id, created_order.order_number,
             created_order.total_paise, created_order.created_at`,
          [
            orderNumber,
            `${firstName} ${lastName}`.trim(),
            email,
            phone,
            address,
            locality,
            city,
            state,
            postalCode,
            landmark || null,
            deliveryMethod,
            subtotalPaise,
            shippingPaise,
            taxPaise,
            totalPaise,
            JSON.stringify(items.map((item) => ({
              product_id: item.productId,
              product_name: item.name,
              unit_price_paise: item.unitPricePaise,
              quantity: item.quantity,
            }))),
          ],
        );
        const savedOrder = result.rows[0];
        if (!savedOrder || savedOrder.order_number !== orderNumber || Number(savedOrder.item_count) !== items.length) {
          throw new Error('The checkout order could not be confirmed after saving.');
        }
        return {
          status: 201,
          body: {
            orderNumber,
            total: totalPaise / 100,
            message: `Order ${orderNumber} is confirmed. You’ll pay cash on delivery.`,
          },
        };
      } catch (error) {
        console.error('Unable to save checkout order', error);
        return { status: 500, body: { error: 'server_error', message: 'We could not place your order right now. Your bag is safe—please try again shortly.' } };
      }
    },
  };
}
