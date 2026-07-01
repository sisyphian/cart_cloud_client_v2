import type { Vendor } from '@cart-cloud/api-client';

interface VendorListProps {
  vendors: Vendor[];
  onSelectVendor: (vendorId: string) => void;
  onSuspendVendor: (vendorId: string, reason: string) => void;
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  verified: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
  terminated: 'bg-gray-100 text-gray-800',
};

export function VendorList({ vendors, onSelectVendor, onSuspendVendor }: VendorListProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-semibold text-gray-900">Vendors</h2>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Business Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subscription</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Commission</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {vendors.map((vendor) => (
              <tr key={vendor.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                  {vendor.business_name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[vendor.registration_status]}`}>
                    {vendor.registration_status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-500 capitalize">
                  {vendor.subscription_tier}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                  {vendor.platform_commission_pct}%
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(vendor.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => onSelectVendor(vendor.id)}
                    className="text-indigo-600 hover:text-indigo-900 mr-3"
                  >
                    View
                  </button>
                  {vendor.registration_status === 'verified' && (
                    <button
                      onClick={() => {
                        const reason = prompt('Enter suspension reason:');
                        if (reason) onSuspendVendor(vendor.id, reason);
                      }}
                      className="text-red-600 hover:text-red-900"
                    >
                      Suspend
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {vendors.length === 0 && (
        <div className="px-6 py-12 text-center text-gray-500">
          No vendors found
        </div>
      )}
    </div>
  );
}
