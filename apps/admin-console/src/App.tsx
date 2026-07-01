import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { PlatformSummary } from './components/PlatformSummary';
import { VendorList } from './components/VendorList';
import { useAdminPlatformSummary, useAdminVendors, useSuspendVendor } from '@cart-cloud/hooks';

function App() {
  return (
    <Routes>
      <Route path="/" element={<AdminDashboard />} />
      <Route path="/vendors" element={<Vendors />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AdminDashboard() {
  const navigate = useNavigate();
  const { data: summary } = useAdminPlatformSummary();
  const { data: vendors } = useAdminVendors();
  const suspendVendor = useSuspendVendor();

  const handleSuspendVendor = (vendorId: string, reason: string) => {
    suspendVendor.mutate({ vendorId, reason });
  };

  const handleSelectVendor = (vendorId: string) => {
    console.log('Selected vendor:', vendorId);
    // Could navigate to vendor detail page
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CartCloud Admin Console</h1>
            <p className="text-sm text-gray-500">Platform Administration</p>
          </div>
          <nav className="flex gap-4">
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 text-orange-600 border-b-2 border-orange-600 font-medium"
            >
              Dashboard
            </button>
            <button
              onClick={() => navigate('/vendors')}
              className="px-4 py-2 text-gray-500 hover:text-gray-700 font-medium"
            >
              Vendors
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {summary && <PlatformSummary summary={summary} />}
        
        {vendors && (
          <VendorList
            vendors={vendors}
            onSelectVendor={handleSelectVendor}
            onSuspendVendor={handleSuspendVendor}
          />
        )}
      </main>
    </div>
  );
}

function Vendors() {
  const navigate = useNavigate();
  const { data: vendors } = useAdminVendors();
  const suspendVendor = useSuspendVendor();

  const handleSuspendVendor = (vendorId: string, reason: string) => {
    suspendVendor.mutate({ vendorId, reason });
  };

  const handleSelectVendor = (vendorId: string) => {
    console.log('Selected vendor:', vendorId);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CartCloud Admin Console</h1>
            <p className="text-sm text-gray-500">Platform Administration</p>
          </div>
          <nav className="flex gap-4">
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 text-gray-500 hover:text-gray-700 font-medium"
            >
              Dashboard
            </button>
            <button
              onClick={() => navigate('/vendors')}
              className="px-4 py-2 text-orange-600 border-b-2 border-orange-600 font-medium"
            >
              Vendors
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {vendors && (
          <VendorList
            vendors={vendors}
            onSelectVendor={handleSelectVendor}
            onSuspendVendor={handleSuspendVendor}
          />
        )}
      </main>
    </div>
  );
}

export default App;
