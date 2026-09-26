import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { products } from '../data/catalog.js';
import { checkoutTaxRate, deliveryOptions } from '../data/checkout.js';

export type QueryResult = { rows: Array<Record<string, unknown>>; rowCount: number | null };
export type Database = {
  query: (text: string, values: unknown[]) => Promise<QueryResult>;
};
export type ApiResult = {
  status: number;
  body: { message?: string; error?: string; orderNumber?: string; total?: number };
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

export function createHandlers(database: Database) {
  return {
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
      const orderItems = requestedItems.map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId);
        return product ? {
          productId: product.id,
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
