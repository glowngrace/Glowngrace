import { createContext, useContext } from 'react';
import type { Bundle, Product } from '../data/catalog';

export type CartLine =
  | { productId: number; quantity: number }
  | { bundleId: string; quantity: number };

export function isBundleLine(line: CartLine): line is { bundleId: string; quantity: number } {
  return 'bundleId' in line;
}

/** A stable identity for a line, safe for React keys and remove/change actions. */
export function lineKey(line: CartLine): string {
  return isBundleLine(line) ? `bundle:${line.bundleId}` : `product:${line.productId}`;
}

export type CartValue = {
  lines: CartLine[];
  isOpen: boolean;
  open: () => void;
  close: () => void;
  add: (product: Product, quantity?: number) => void;
  addBundle: (bundle: Bundle, quantity?: number) => void;
  removeLine: (key: string) => void;
  changeQuantity: (key: string, quantity: number) => void;
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