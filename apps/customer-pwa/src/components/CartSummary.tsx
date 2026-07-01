import { useAddToCart, useRemoveFromCart, useUpdateCartItemQuantity, getLocalCart } from '@cart-cloud/hooks';
import type { MenuItem } from '@cart-cloud/api-client';

interface CartSummaryProps {
  cartId: string;
  onCheckout: () => void;
}

export function CartSummary({ cartId, onCheckout }: CartSummaryProps) {
  const addToCart = useAddToCart();
  const removeFromCart = useRemoveFromCart();
  const updateQuantity = useUpdateCartItemQuantity();
  
  const cart = getLocalCart(cartId);

  if (!cart || cart.items.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 text-center text-gray-500">
        Your cart is empty
      </div>
    );
  }

  const handleAddItem = (item: MenuItem) => {
    addToCart.mutate({
      cartId,
      item: {
        menu_item_id: item.id,
        quantity: 1,
        item_name: item.name,
        unit_price: item.price,
      },
    });
  };

  const handleRemoveItem = (menuItemId: string) => {
    removeFromCart.mutate({ cartId, menuItemId });
  };

  const handleUpdateQuantity = (menuItemId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveItem(menuItemId);
    } else {
      updateQuantity.mutate({ cartId, menuItemId, quantity });
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">Your Cart</h2>
      
      <div className="space-y-3">
        {cart.items.map((item) => (
          <div key={item.menu_item_id} className="flex items-center justify-between py-2 border-b">
            <div className="flex-1">
              <p className="font-medium text-gray-900">{item.item_name}</p>
              <p className="text-sm text-gray-500">৳{item.unit_price} each</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleUpdateQuantity(item.menu_item_id, item.quantity - 1)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
              >
                -
              </button>
              <span className="w-8 text-center font-medium">{item.quantity}</span>
              <button
                onClick={() => handleUpdateQuantity(item.menu_item_id, item.quantity + 1)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
              >
                +
              </button>
              <span className="w-20 text-right font-semibold text-orange-600">
                ৳{item.unit_price * item.quantity}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t pt-4 space-y-2">
        <div className="flex justify-between text-gray-600">
          <span>Subtotal</span>
          <span>৳{cart.subtotal}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Platform fee</span>
          <span>৳{(cart.subtotal * 0.05).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xl font-bold text-gray-900 pt-2 border-t">
          <span>Total</span>
          <span className="text-orange-600">
            ৳{(cart.subtotal * 1.05).toFixed(2)}
          </span>
        </div>
      </div>

      <button
        onClick={onCheckout}
        className="w-full py-3 bg-orange-500 text-white rounded-lg font-semibold hover:bg-orange-600 transition-colors"
      >
        Proceed to Checkout
      </button>
    </div>
  );
}
