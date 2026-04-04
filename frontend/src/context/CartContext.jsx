import React, { createContext, useContext, useState } from 'react';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cart, setCart] = useState([]);

  const addToCart = (component, qty = 1) => {
    const safeQty = Math.max(1, Number(qty) || 1);
    setCart(prev => {
      const existing = prev.find(i => i.id === component.id);
      if (existing) {
        return prev.map(i => i.id === component.id
          ? { ...i, qty: Math.min(i.qty + safeQty, component.stock) }
          : i
        );
      }
      return [...prev, { ...component, qty: Math.min(safeQty, component.stock) }];
    });
  };

  const updateQty = (id, qty) => {
    if (qty <= 0) return removeFromCart(id);
    const safeQty = Math.max(1, Number(qty) || 1);
    setCart(prev => prev.map(i => i.id === id
      ? { ...i, qty: Math.min(safeQty, i.stock || safeQty) }
      : i
    ));
  };

  const removeFromCart = (id) => setCart(prev => prev.filter(i => i.id !== id));
  const clearCart = () => setCart([]);
  const totalItems = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <CartContext.Provider value={{ cart, addToCart, updateQty, removeFromCart, clearCart, totalItems }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
