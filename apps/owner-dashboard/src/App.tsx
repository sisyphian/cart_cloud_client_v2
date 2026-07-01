import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { DashboardStats } from './components/DashboardStats';
import { OrderList } from './components/OrderList';
import { InventoryManagement } from './components/InventoryManagement';
import { useCartAnalytics, useCartOrders, useUpdateOrderStatus, useVendorMe, useVendorCarts } from '@cart-cloud/hooks';

function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardHome />} />
      <Route path="/cart/:cartId" element={<CartDashboard />} />
      <Route path="/cart/:cartId/orders" element={<CartOrders />} />
      <Route path="/cart/:cartId/inventory" element={<CartInventory />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function DashboardHome() {
  const navigate = useNavigate();
  const { data: vendor } = useVendorMe();
  const { data: carts } = useVendorCarts(vendor?.id || '');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">CartCloud Owner Dashboard</h1>
          <p className="text-sm text-gray-500">{vendor?.business_name || 'Loading...'}</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center py-12">
          <p className="text-xl mb-4 text-gray-700">Select a cart to view dashboard</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {carts?.map((cart) => (
              <button
                key={cart.id}
                onClick={() => navigate(`/cart/${cart.id}`)}
                className="bg-white hover:bg-gray-50 text-gray-900 p-6 rounded-lg shadow-sm transition-colors border border-gray-200"
              >
                <h3 className="text-lg font-semibold mb-2">{cart.name}</h3>
                <p className="text-sm text-gray-500">{cart.location_text}</p>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function CartDashboard() {
  const navigate = useNavigate();
  const { cartId } = useParams<{ cartId: string }>();
  const { data: vendor } = useVendorMe();
  const { data: carts } = useVendorCarts(vendor?.id || '');
  const updateOrderStatus = useUpdateOrderStatus();

  const { data: analytics } = useCartAnalytics(cartId || '');
  const { data: orders } = useCartOrders(cartId || '');

  const handleUpdateStatus = (orderId: string, status: string) => {
    updateOrderStatus.mutate({ id: orderId, status });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CartCloud Owner Dashboard</h1>
            <p className="text-sm text-gray-500">{vendor?.business_name || 'Loading...'}</p>
          </div>
          <select
            value={cartId}
            onChange={(e) => navigate(`/cart/${e.target.value}`)}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg"
          >
            <option value="">Select a cart...</option>
            {carts?.map((cart) => (
              <option key={cart.id} value={cart.id}>
                {cart.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-4 mb-6 border-b">
          <button
            onClick={() => navigate(`/cart/${cartId}`)}
            className="px-4 py-2 font-medium text-orange-600 border-b-2 border-orange-600"
          >
            Dashboard
          </button>
          <button
            onClick={() => navigate(`/cart/${cartId}/orders`)}
            className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700"
          >
            Orders
          </button>
          <button
            onClick={() => navigate(`/cart/${cartId}/inventory`)}
            className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700"
          >
            Inventory
          </button>
        </div>

        {analytics && <DashboardStats stats={analytics} />}
        {orders && <OrderList orders={orders} onUpdateStatus={handleUpdateStatus} />}
      </main>
    </div>
  );
}

function CartOrders() {
  const navigate = useNavigate();
  const { cartId } = useParams<{ cartId: string }>();
  const { data: vendor } = useVendorMe();
  const { data: carts } = useVendorCarts(vendor?.id || '');
  const updateOrderStatus = useUpdateOrderStatus();

  const { data: orders } = useCartOrders(cartId || '');

  const handleUpdateStatus = (orderId: string, status: string) => {
    updateOrderStatus.mutate({ id: orderId, status });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CartCloud Owner Dashboard</h1>
            <p className="text-sm text-gray-500">{vendor?.business_name || 'Loading...'}</p>
          </div>
          <select
            value={cartId}
            onChange={(e) => navigate(`/cart/${e.target.value}`)}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg"
          >
            <option value="">Select a cart...</option>
            {carts?.map((cart) => (
              <option key={cart.id} value={cart.id}>
                {cart.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-4 mb-6 border-b">
          <button
            onClick={() => navigate(`/cart/${cartId}`)}
            className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700"
          >
            Dashboard
          </button>
          <button
            onClick={() => navigate(`/cart/${cartId}/orders`)}
            className="px-4 py-2 font-medium text-orange-600 border-b-2 border-orange-600"
          >
            Orders
          </button>
          <button
            onClick={() => navigate(`/cart/${cartId}/inventory`)}
            className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700"
          >
            Inventory
          </button>
        </div>

        {orders && <OrderList orders={orders} onUpdateStatus={handleUpdateStatus} />}
      </main>
    </div>
  );
}

function CartInventory() {
  const navigate = useNavigate();
  const { cartId } = useParams<{ cartId: string }>();
  const { data: vendor } = useVendorMe();
  const { data: carts } = useVendorCarts(vendor?.id || '');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CartCloud Owner Dashboard</h1>
            <p className="text-sm text-gray-500">{vendor?.business_name || 'Loading...'}</p>
          </div>
          <select
            value={cartId}
            onChange={(e) => navigate(`/cart/${e.target.value}`)}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg"
          >
            <option value="">Select a cart...</option>
            {carts?.map((cart) => (
              <option key={cart.id} value={cart.id}>
                {cart.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-4 mb-6 border-b">
          <button
            onClick={() => navigate(`/cart/${cartId}`)}
            className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700"
          >
            Dashboard
          </button>
          <button
            onClick={() => navigate(`/cart/${cartId}/orders`)}
            className="px-4 py-2 font-medium text-gray-500 hover:text-gray-700"
          >
            Orders
          </button>
          <button
            onClick={() => navigate(`/cart/${cartId}/inventory`)}
            className="px-4 py-2 font-medium text-orange-600 border-b-2 border-orange-600"
          >
            Inventory
          </button>
        </div>

        <InventoryManagement cartId={cartId || ''} />
      </main>
    </div>
  );
}

export default App;
