import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { CartMenu } from './components/CartMenu';
import { CartSummary } from './components/CartSummary';
import { OrderTracking } from './components/OrderTracking';
import { LandingPage } from './components/LandingPage';
import { AuthModal } from './components/AuthModal';
import { QRScanner } from './components/QRScanner';
import { useCancelOrder, useUser } from '@cart-cloud/hooks';
import type { MenuItem } from '@cart-cloud/api-client';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/scan-qr" element={<ScanQR />} />
      <Route path="/menu/:slug" element={<Menu />} />
      <Route path="/checkout/:slug" element={<Checkout />} />
      <Route path="/tracking/:orderId" element={<Tracking />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Home() {
  const navigate = useNavigate();
  const { data: user } = useUser();

  const handleGetStarted = () => navigate('/auth');
  const handleScanQR = () => navigate(user ? '/scan-qr' : '/auth');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-orange-600">CartCloud</h1>
          <button
            onClick={handleScanQR}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600"
          >
            {user ? 'Scan QR Code' : 'Login / Register'}
          </button>
        </div>
      </header>
      <LandingPage onGetStarted={handleGetStarted} onScanQR={handleScanQR} />
    </div>
  );
}

function Auth() {
  const navigate = useNavigate();

  const handleSuccess = () => navigate('/');
  const handleClose = () => navigate('/');

  return <AuthModal onSuccess={handleSuccess} onClose={handleClose} />;
}

function ScanQR() {
  const navigate = useNavigate();

  const handleScan = (slug: string, token: string) => {
    navigate(`/menu/${slug}`);
  };

  const handleCancel = () => navigate('/');

  return <QRScanner onScan={handleScan} onCancel={handleCancel} />;
}

function Menu() {
  const navigate = useNavigate();
  const location = useLocation();
  const slug = location.pathname.split('/').pop() || '';
  const createOrder = useCreateOrder();

  const handleAddToCart = (item: MenuItem) => {
    console.log('Add to cart:', item);
  };

  const handleCheckout = () => {
    navigate(`/checkout/${slug}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <button
            onClick={() => navigate('/')}
            className="text-gray-600 hover:text-gray-900"
          >
            ← Back to Home
          </button>
          <h1 className="text-xl font-bold text-gray-900">Order Menu</h1>
          <div className="w-20"></div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <CartMenu slug={slug} qrToken={qrToken} onAddToCart={handleAddToCart} />
          </div>
          <div className="lg:col-span-1">
            <CartSummary cartId={slug} onCheckout={handleCheckout} />
          </div>
        </div>
      </main>
    </div>
  );
}

function Checkout() {
  const navigate = useNavigate();
  const location = useLocation();
  const slug = location.pathname.split('/').pop() || '';
  const createOrder = useCreateOrder();

  const handlePlaceOrder = (paymentMethod: string) => {
    const cart = JSON.parse(localStorage.getItem(`cart_${slug}`) || '{}');
    
    createOrder.mutate(
      {
        slug,
        items: cart.items.map((item: any) => ({
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
        })),
        payment_method: paymentMethod,
        special_instructions: '',
      },
      {
        onSuccess: (order) => {
          localStorage.removeItem(`cart_${slug}`);
          navigate(`/tracking/${order.id}`);
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <button
            onClick={() => navigate('/')}
            className="text-gray-600 hover:text-gray-900"
          >
            ← Back to Home
          </button>
        </div>
      </header>
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Checkout</h2>
          
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">Select Payment Method</h3>
            
            <button
              onClick={() => handlePlaceOrder('cash')}
              className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-orange-500 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">💵</span>
                <div>
                  <p className="font-medium">Cash</p>
                  <p className="text-sm text-gray-500">Pay when you pick up</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => handlePlaceOrder('bkash')}
              className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-orange-500 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">📱</span>
                <div>
                  <p className="font-medium">bKash</p>
                  <p className="text-sm text-gray-500">Mobile payment</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => handlePlaceOrder('nagad')}
              className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-orange-500 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">📱</span>
                <div>
                  <p className="font-medium">Nagad</p>
                  <p className="text-sm text-gray-500">Mobile payment</p>
                </div>
              </div>
            </button>
          </div>

          <button
            onClick={() => navigate(`/menu/${slug}`)}
            className="mt-6 w-full py-3 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Tracking() {
  const navigate = useNavigate();
  const location = useLocation();
  const orderId = location.pathname.split('/').pop() || '';
  const cancelOrder = useCancelOrder();

  const handleCancelOrder = (reason: string) => {
    cancelOrder.mutate(
      { id: orderId, reason },
      {
        onSuccess: () => {
          navigate('/');
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <button
            onClick={() => navigate('/')}
            className="text-gray-600 hover:text-gray-900"
          >
            ← Back to Home
          </button>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <OrderTracking orderId={orderId} />
        <div className="mt-6">
          <button
            onClick={() => handleCancelOrder('Changed my mind')}
            className="w-full py-3 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200 transition-colors"
          >
            Cancel Order
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
