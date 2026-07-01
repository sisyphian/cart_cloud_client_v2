import type { Order } from '@cart-cloud/api-client';

interface KDSOrderCardProps {
  order: Order;
  onUpdateStatus: (orderId: string, status: string) => void;
}

const statusColors: Record<string, string> = {
  placed: 'bg-blue-500',
  accepted: 'bg-indigo-500',
  preparing: 'bg-purple-500',
  ready: 'bg-green-500',
};

const statusLabels: Record<string, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
};

export function KDSOrderCard({ order, onUpdateStatus }: KDSOrderCardProps) {
  const getNextStatus = (currentStatus: string) => {
    const transitions: Record<string, string> = {
      placed: 'accepted',
      accepted: 'preparing',
      preparing: 'ready',
      ready: 'completed',
    };
    return transitions[currentStatus];
  };

  const nextStatus = getNextStatus(order.status);
  const canAdvance = nextStatus && order.status !== 'ready';

  const timeElapsed = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 1000 / 60);
  const isOverdue = timeElapsed > 15 && order.status !== 'completed';

  return (
    <div className={`bg-white rounded-lg shadow-md p-6 border-l-4 ${statusColors[order.status]} ${isOverdue ? 'ring-2 ring-red-500' : ''}`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-2xl font-bold text-gray-900">#{order.order_number}</h3>
          <p className="text-sm text-gray-500">{order.guest_display_name}</p>
        </div>
        <div className="text-right">
          <span className={`px-3 py-1 rounded-full text-sm font-medium text-white ${statusColors[order.status]}`}>
            {statusLabels[order.status]}
          </span>
          <p className="text-sm text-gray-500 mt-1">
            {timeElapsed} min ago
          </p>
        </div>
      </div>

      {order.queue_position && (
        <div className="mb-4">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
            Queue: #{order.queue_position}
          </span>
        </div>
      )}

      <div className="space-y-2 mb-4">
        {order.items.map((item) => (
          <div key={item.id} className="flex justify-between items-center py-2 border-b last:border-0">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-gray-400 w-8">{item.quantity}x</span>
              <span className="font-medium text-gray-900">{item.item_name_snapshot}</span>
            </div>
            {item.selected_options.length > 0 && (
              <div className="text-sm text-gray-500">
                {item.selected_options.map((opt, idx) => (
                  <span key={idx}>{opt.label}{idx < item.selected_options.length - 1 ? ', ' : ''}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {order.special_instructions && (
        <div className="mb-4 p-3 bg-yellow-50 rounded-lg">
          <p className="text-sm text-yellow-800">
            <span className="font-medium">Note:</span> {order.special_instructions}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {canAdvance && (
          <button
            onClick={() => onUpdateStatus(order.id, nextStatus!)}
            className="flex-1 py-3 bg-orange-500 text-white rounded-lg font-semibold hover:bg-orange-600 transition-colors"
          >
            {statusLabels[nextStatus!]}
          </button>
        )}
        
        {order.status === 'ready' && (
          <button
            onClick={() => onUpdateStatus(order.id, 'completed')}
            className="flex-1 py-3 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition-colors"
          >
            Complete
          </button>
        )}

        <button
          onClick={() => onUpdateStatus(order.id, 'cancelled_by_vendor')}
          className="px-4 py-3 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200 transition-colors"
        >
          Cancel
        </button>
      </div>

      {order.estimated_ready_at && order.status !== 'completed' && (
        <div className="mt-3 text-sm text-gray-500 text-center">
          Est. ready: {new Date(order.estimated_ready_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}
