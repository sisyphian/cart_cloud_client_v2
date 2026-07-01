import type { Order } from '@cart-cloud/api-client';

interface OrderListProps {
  orders: Order[];
  onUpdateStatus: (orderId: string, status: string) => void;
}

const statusColors: Record<string, string> = {
  placed: 'bg-blue-100 text-blue-800',
  accepted: 'bg-indigo-100 text-indigo-800',
  preparing: 'bg-purple-100 text-purple-800',
  ready: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled_by_customer: 'bg-red-100 text-red-800',
  cancelled_by_vendor: 'bg-red-100 text-red-800',
};

const statusLabels: Record<string, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled_by_customer: 'Cancelled',
  cancelled_by_vendor: 'Cancelled',
};

export function OrderList({ orders, onUpdateStatus }: OrderListProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-semibold text-gray-900">Recent Orders</h2>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order #</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                  {order.order_number}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                  {order.guest_display_name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[order.status]}`}>
                    {statusLabels[order.status]}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                  ৳{order.total}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(order.created_at).toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {order.status === 'placed' && (
                    <button
                      onClick={() => onUpdateStatus(order.id, 'accepted')}
                      className="text-indigo-600 hover:text-indigo-900 mr-3"
                    >
                      Accept
                    </button>
                  )}
                  {order.status === 'accepted' && (
                    <button
                      onClick={() => onUpdateStatus(order.id, 'preparing')}
                      className="text-purple-600 hover:text-purple-900 mr-3"
                    >
                      Start
                    </button>
                  )}
                  {order.status === 'preparing' && (
                    <button
                      onClick={() => onUpdateStatus(order.id, 'ready')}
                      className="text-green-600 hover:text-green-900 mr-3"
                    >
                      Ready
                    </button>
                  )}
                  {order.status === 'ready' && (
                    <button
                      onClick={() => onUpdateStatus(order.id, 'completed')}
                      className="text-gray-600 hover:text-gray-900 mr-3"
                    >
                      Complete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {orders.length === 0 && (
        <div className="px-6 py-12 text-center text-gray-500">
          No orders found
        </div>
      )}
    </div>
  );
}
