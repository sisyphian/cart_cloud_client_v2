interface DashboardStatsProps {
  stats: {
    total_orders: number;
    total_revenue: number;
    avg_prep_time_seconds: number;
    top_items: Array<{ name: string; count: number; revenue: number }>;
  };
}

export function DashboardStats({ stats }: DashboardStatsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-sm font-medium text-gray-500">Total Orders</h3>
        <p className="text-3xl font-bold text-gray-900 mt-2">{stats.total_orders}</p>
      </div>
      
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-sm font-medium text-gray-500">Total Revenue</h3>
        <p className="text-3xl font-bold text-green-600 mt-2">৳{stats.total_revenue.toLocaleString()}</p>
      </div>
      
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-sm font-medium text-gray-500">Avg. Prep Time</h3>
        <p className="text-3xl font-bold text-blue-600 mt-2">
          {Math.round(stats.avg_prep_time_seconds / 60)}m
        </p>
      </div>
      
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-sm font-medium text-gray-500">Top Item</h3>
        <p className="text-xl font-bold text-orange-600 mt-2 truncate">
          {stats.top_items[0]?.name || 'N/A'}
        </p>
        <p className="text-sm text-gray-500 mt-1">{stats.top_items[0]?.count || 0} sold</p>
      </div>
    </div>
  );
}
