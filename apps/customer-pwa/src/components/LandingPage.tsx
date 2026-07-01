import { mockCarts } from '@cart-cloud/api-client';

interface LandingPageProps {
  onGetStarted: () => void;
  onScanQR: () => void;
}

export function LandingPage({ onGetStarted, onScanQR }: LandingPageProps) {
  const featuredCarts = mockCarts.slice(0, 3);

  return (
    <div>
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-orange-500 to-orange-600 text-white py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Order from Street Food Carts Near You
          </h1>
          <p className="text-xl md:text-2xl mb-8 text-orange-100">
            Scan a QR code at any participating cart to browse their menu and place your order instantly
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={onGetStarted}
              className="px-8 py-4 bg-white text-orange-600 rounded-lg font-semibold text-lg hover:bg-gray-100 transition-colors"
            >
              Get Started
            </button>
            <button
              onClick={onScanQR}
              className="px-8 py-4 bg-orange-700 text-white rounded-lg font-semibold text-lg hover:bg-orange-800 transition-colors"
            >
              Scan QR Code
            </button>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">📱</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">1. Scan QR Code</h3>
              <p className="text-gray-600">Find a CartCloud QR code at any participating street food cart and scan it with your phone</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🍜</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">2. Browse Menu</h3>
              <p className="text-gray-600">View the cart's full menu with prices, descriptions, and availability in real-time</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">✅</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">3. Order & Pickup</h3>
              <p className="text-gray-600">Place your order, pay online or cash, and track your order status until ready for pickup</p>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Carts */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">Featured Carts</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {featuredCarts.map((cart) => (
              <div key={cart.id} className="bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                <div className="h-48 bg-gradient-to-br from-orange-400 to-orange-500 flex items-center justify-center">
                  <span className="text-6xl">🛒</span>
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{cart.name}</h3>
                  <p className="text-gray-600 mb-4">{cart.location_text}</p>
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`w-2 h-2 rounded-full ${cart.is_open ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    <span className="text-sm text-gray-600">{cart.is_open ? 'Open Now' : 'Closed'}</span>
                  </div>
                  <button
                    onClick={onScanQR}
                    className="w-full py-3 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition-colors"
                  >
                    View Menu
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">Why CartCloud?</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 bg-gray-50 rounded-lg">
              <span className="text-3xl mb-4 block">⚡</span>
              <h3 className="font-semibold text-gray-900 mb-2">Fast Ordering</h3>
              <p className="text-sm text-gray-600">Place orders in seconds with our intuitive interface</p>
            </div>
            <div className="p-6 bg-gray-50 rounded-lg">
              <span className="text-3xl mb-4 block">💳</span>
              <h3 className="font-semibold text-gray-900 mb-2">Multiple Payments</h3>
              <p className="text-sm text-gray-600">Pay with cash, bKash, Nagad, or other mobile wallets</p>
            </div>
            <div className="p-6 bg-gray-50 rounded-lg">
              <span className="text-3xl mb-4 block">📍</span>
              <h3 className="font-semibold text-gray-900 mb-2">Real-time Tracking</h3>
              <p className="text-sm text-gray-600">Track your order status live from placement to pickup</p>
            </div>
            <div className="p-6 bg-gray-50 rounded-lg">
              <span className="text-3xl mb-4 block">🔒</span>
              <h3 className="font-semibold text-gray-900 mb-2">Secure Payments</h3>
              <p className="text-sm text-gray-600">Your payment information is always safe and secure</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4 bg-gradient-to-br from-orange-500 to-orange-600 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Order?</h2>
          <p className="text-xl mb-8 text-orange-100">
            Find a CartCloud QR code at your favorite street food cart and start ordering now
          </p>
          <button
            onClick={onScanQR}
            className="px-8 py-4 bg-white text-orange-600 rounded-lg font-semibold text-lg hover:bg-gray-100 transition-colors"
          >
            Scan QR Code to Start
          </button>
        </div>
      </section>
    </div>
  );
}
