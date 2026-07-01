import { useOrder } from '@cart-cloud/hooks';
import type { Order } from '@cart-cloud/api-client';

interface OrderTrackingProps {
  orderId: string;
}

const statusColors: Record<string, string> = {
  pending_payment: 'bg-yellow-100 text-yellow-800',
  placed: 'bg-blue-100 text-blue-800',
  accepted: 'bg-indigo-100 text-indigo-800',
  preparing: 'bg-purple-100 text-purple-800',
  ready: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled_by_customer: 'bg-red-100 text-red-800',
  cancelled_by_vendor: 'bg-red-100 text-red-800',
  payment_failed: 'bg-red-100 text-red-800',
};

const statusLabels: Record<string, string> = {
  pending_payment: 'Payment Pending',
  placed: 'Order Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled_by_customer: 'Cancelled',
  cancelled_by_vendor: 'Cancelled',
  payment_failed: 'Payment Failed',
};

export function OrderTracking({ orderId }: OrderTrackingProps) {
  const { data: order, isLoading, error } = useOrder(orderId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="p-8 text-center text-red-600">
        Failed to load order. Please try again.
      </div>
    );
  }

  const isCancelled = order.status.includes('cancelled');
  const isCompleted = order.status === 'completed';

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Order #{order.order_number}</h1>
            <p className="text-sm text-gray-500 mt-1">
              Placed at {new Date(order.created_at).toLocaleString()}
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[order.status]}`}>
            {statusLabels[order.status]}
          </span>
        </div>

        {order.estimated_ready_at && !isCancelled && !isCompleted && (
          <div className="mt-4 p-4 bg-orange-50 rounded-lg">
            <p className="text-sm text-orange-800">
              <span className="font-medium">Estimated ready time:</span>{' '}
              {new Date(order.estimated_ready_at).toLocaleString()}
            </p>
          </div>
        )}

        {order.queue_position && !isCancelled && !isCompleted && (
          <div className="mt-2 text-sm text-gray-600">
            Queue position: <span className="font-semibold">{order.queue_position}</span>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Items</h2>
        <div className="space-y-3">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between py-2 border-b">
              <div className="flex-1">
                <p className="font-medium text-gray-900">{item.item_name_snapshot}</p>
                <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
              </div>
              <span className="font-semibold text-gray-900">৳{item.line_total}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t space-y-2">
          <div className="flex justify-between text-gray-600">
            <span>Subtotal</span>
            <span>৳{order.subtotal}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Platform fee</span>
            <span>৳{order.platform_fee}</span>
          </div>
          <div className="flex justify-between text-xl font-bold text-gray-900 pt-2 border-t">
            <span>Total</span>
            <span className="text-orange-600">৳{order.total}</span>
          </div>
        </div>
      </div>

      {!isCancelled && !isCompleted && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Progress</h2>
          <div className="space-y-4">
            <div className={`flex items-center gap-3 ${['placed', 'accepted', 'preparing', 'ready', 'completed'].includes(order.status) ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${['placed', 'accepted', 'preparing', 'ready', 'completed'].includes(order.status) ? 'bg-green-100' : 'bg-gray-100'}`}>
                ✓
              </div>
              <span>Order Placed</span>
            </div>
            <div className={`flex items-center gap-3 ${['accepted', 'preparing', 'ready', 'completed'].includes(order.status) ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${['accepted', 'preparing', 'ready', 'completed'].includes(order.status) ? 'bg-green-100' : 'bg-gray-100'}`}>
                ✓
              </div>
              <span>Accepted by Vendor</span>
            </div>
            <div className={`flex items-center gap-3 ${['preparing', 'ready', 'completed'].includes(order.status) ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${['preparing', 'ready', 'completed'].includes(order.status) ? 'bg-green-100' : 'bg-gray-100'}`}>
                ✓
              </div>
              <span>Preparing</span>
            </div>
            <div className={`flex items-center gap-3 ${['ready', 'completed'].includes(order.status) ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${['ready', 'completed'].includes(order.status) ? 'bg-green-100' : 'bg-gray-100'}`}>
                ✓
              </div>
              <span>Ready for Pickup</span>
            </div>
            <div className={`flex items-center gap-3 ${order.status === 'completed' ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${order.status === 'completed' ? 'bg-green-100' : 'bg-gray-100'}`}>
                ✓
              </div>
              <span>Completed</span>
            </div>
          </div>
        </div>
      )}

      {isCancelled && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-red-800">Order Cancelled</h2>
          {order.cancellation_reason && (
            <p className="text-red-600 mt-2">Reason: {order.cancellation_reason}</p>
          )}
        </div>
      )}
    </div>
  );
}
