export const deliveryOptions = [
  { id: 'standard', title: 'Standard delivery', detail: '2–3 business days · Lucknow', fee: 0 },
  { id: 'express', title: 'Express delivery', detail: 'Next-day delivery · Lucknow', fee: 49 },
  { id: 'same_day', title: 'Same-day delivery', detail: 'Order before noon · Lucknow', fee: 99 },
] as const satisfies ReadonlyArray<{
  id: 'standard' | 'express' | 'same_day';
  title: string;
  detail: string;
  fee: number;
}>;

export const checkoutTaxRate = 0.05;

const rupeeFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
});

export function formatRupees(amount: number) {
  return `₹${rupeeFormatter.format(amount)}`;
}
