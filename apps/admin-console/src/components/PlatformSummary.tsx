interface PlatformSummaryProps {
  summary: {
    total_vendors: number;
    active_vendors: number;
    total_carts: number;
    active_carts: number;
    total_orders: number;
    total_revenue: number;
    orders_today: number;
    revenue_today: number;
  };
}

export function PlatformSummary({ summary }: PlatformSummaryProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-sm font-medium text-gray-500">Total Vendors</h3>
        <p className="text-3xl font-bold text-gray-900 mt-2">{summary.total_vendors}</p>
        <p className="text-sm text-green-600 mt-1">{summary.active_vendors} active</p>
      </div>
      
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-sm font-medium text-gray-500">Total Carts</h3>
        <p className="text-3xl font-bold text-gray-900 mt-2">{summary.total_carts}</p>
        <p className="text-sm text-green-600 mt-1">{summary.active_carts} open</p>
      </div>
      
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-sm font-medium text-gray-500">Total Orders</h3>
        <p className="text-3xl font-bold text-blue-600 mt-2">{summary.total_orders}</p>
        <p className="text-sm text-gray-500 mt-1">{summary.orders_today} today</p>
      </div>
      
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-sm font-medium text-gray-500">Total Revenue</h3>
        <p className="text-3xl font-bold text-green-600 mt-2">৳{summary.total_revenue.toLocaleString()}</p>
        <p className="text-sm text-gray-500 mt-1">৳{summary.revenue_today.toLocaleString()} today</p>
      </div>
    </div>
  );
}
