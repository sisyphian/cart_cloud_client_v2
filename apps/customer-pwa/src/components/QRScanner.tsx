import { useState } from 'react';

interface QRScannerProps {
  onScan: (slug: string, token: string) => void;
  onCancel: () => void;
}

export function QRScanner({ onScan, onCancel }: QRScannerProps) {
  const [manualSlug, setManualSlug] = useState('');
  const [isScanning, setIsScanning] = useState(true);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualSlug) {
      onScan(manualSlug);
    }
  };

  const handleSimulatedScan = () => {
    // Simulate QR scan with a mock cart slug
    onScan('rafiqs-dhanmondi-7', 'simulated-qr-token');
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <header className="bg-gray-800 px-4 py-4 flex items-center justify-between">
        <button
          onClick={onCancel}
          className="text-white flex items-center gap-2"
        >
          <span>←</span>
          <span>Cancel</span>
        </button>
        <h1 className="text-white font-semibold">Scan QR Code</h1>
        <div className="w-16"></div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {isScanning ? (
          <div className="text-center">
            {/* Camera View Simulation */}
            <div className="relative w-72 h-72 bg-gray-800 rounded-lg overflow-hidden mb-6">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-6xl">📷</div>
              </div>
              {/* Scan Frame */}
              <div className="absolute inset-4 border-2 border-orange-500 rounded-lg">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-orange-500"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-orange-500"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-orange-500"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-orange-500"></div>
              </div>
              {/* Scan Line Animation */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-orange-500 animate-pulse"></div>
            </div>

            <p className="text-white text-lg mb-4">Point camera at QR code</p>
            <p className="text-gray-400 mb-6">Position the QR code within the frame</p>

            <button
              onClick={handleSimulatedScan}
              className="px-6 py-3 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition-colors mb-4"
            >
              Simulate QR Scan (_demo_)
            </button>

            <button
              onClick={() => setIsScanning(false)}
              className="text-gray-400 hover:text-white"
            >
              Enter code manually
            </button>
          </div>
        ) : (
          <div className="w-full max-w-md">
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-white text-xl font-semibold mb-4 text-center">
                Enter Cart Code
              </h2>
              <form onSubmit={handleManualSubmit} className="space-y-4">
                <div>
                  <label className="block text-gray-300 text-sm mb-2">
                    Cart Slug / Code
                  </label>
                  <input
                    type="text"
                    value={manualSlug}
                    onChange={(e) => setManualSlug(e.target.value)}
                    placeholder="e.g., rafiqs-dhanmondi-7"
                    className="w-full px-4 py-3 bg-gray-700 text-white border border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition-colors"
                >
                  View Menu
                </button>
                <button
                  type="button"
                  onClick={() => setIsScanning(true)}
                  className="w-full py-3 text-gray-400 hover:text-white"
                >
                  Back to Scanner
                </button>
              </form>
            </div>

            <div className="mt-6 p-4 bg-gray-800 rounded-lg">
              <p className="text-gray-300 text-sm mb-2">
                <strong>Demo Cart Codes:</strong>
              </p>
              <ul className="text-gray-400 text-sm space-y-1">
                <li>• rafiqs-dhanmondi-7</li>
                <li>• rafiqs-mirpur-10</li>
                <li>• dhanmondi-borhani-main</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
