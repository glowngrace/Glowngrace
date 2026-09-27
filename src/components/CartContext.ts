import { createContext, useContext } from 'react';
import type { Product } from '../data/catalog';

export type CartLine = { productId: number; quantity: number };
export type CartValue = {
  lines: CartLine[];
  isOpen: boolean;
  open: () => void;
  close: () => void;
  add: (product: Product, quantity?: number) => void;
  remove: (productId: number) => void;
  changeQuantity: (productId: number, quantity: number) => void;
  clear: () => void;
  count: number;
  total: number;
};

export const CartContext = createContext<CartValue | null>(null);

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside CartProvider.');
  return value;
}
