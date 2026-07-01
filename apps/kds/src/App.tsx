import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { KDSOrderCard } from './components/KDSOrderCard';
import { useKDSQueue, useUpdateOrderStatus } from '@cart-cloud/hooks';
import { mockCarts } from '@cart-cloud/api-client';

function App() {
  return (
    <Routes>
      <Route path="/" element={<KDSHome />} />
      <Route path="/cart/:cartId" element={<KDSCart />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function KDSHome() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-900">
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-white">CartCloud KDS</h1>
          <p className="text-gray-400">Kitchen Display System</p>
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center text-gray-400 py-12">
          <p className="text-xl mb-4">Select a cart to view orders</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {mockCarts.map((cart) => (
              <button
                key={cart.id}
                onClick={() => navigate(`/cart/${cart.id}`)}
                className="bg-gray-800 hover:bg-gray-700 text-white p-6 rounded-lg transition-colors"
              >
                <h3 className="text-lg font-semibold mb-2">{cart.name}</h3>
                <p className="text-sm text-gray-400">{cart.location_address}</p>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function KDSCart() {
  const navigate = useNavigate();
  const { cartId } = useParams<{ cartId: string }>();
  const updateOrderStatus = useUpdateOrderStatus();
  
  const { data: orders, isLoading } = useKDSQueue(cartId || '');

  const handleUpdateStatus = (orderId: string, status: string) => {
    updateOrderStatus.mutate({ id: orderId, status });
  };

  return (
    <div className="min-h-screen bg-gray-900">
      <header className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <button
              onClick={() => navigate('/')}
              className="text-gray-400 hover:text-white mr-4"
            >
              ← Back
            </button>
            <h1 className="text-2xl font-bold text-white">CartCloud KDS</h1>
            <p className="text-gray-400">Kitchen Display System</p>
          </div>
          <select
            value={cartId}
            onChange={(e) => navigate(`/cart/${e.target.value}`)}
            className="px-4 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg"
          >
            {mockCarts.map((cart) => (
              <option key={cart.id} value={cart.id}>
                {cart.name}
              </option>
            ))}
          </select>
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
          </div>
        ) : orders && orders.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {orders
              .sort((a, b) => (a.queue_position || 999) - (b.queue_position || 999))
              .map((order) => (
                <KDSOrderCard
                  key={order.id}
                  order={order}
                  onUpdateStatus={handleUpdateStatus}
                />
              ))}
          </div>
        ) : (
          <div className="text-center text-gray-400 py-12">
            <p className="text-xl">No active orders</p>
            <p className="text-sm mt-2">New orders will appear here automatically</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
