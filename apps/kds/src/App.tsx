import { useOrders } from '@cart-cloud/hooks';
import { StatusBadge, CountdownTimer, Card } from '@cart-cloud/ui';

function App() {
  const { data: orders, isLoading } = useOrders({ status: 'active' });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="h-screen bg-muted p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Kitchen Display System</h1>
        <div className="text-sm text-muted-foreground">
          {orders?.length || 0} active orders
        </div>
      </header>

      <div className="grid grid-cols-3 gap-4">
        {orders?.map((order) => (
          <Card key={order.id} className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-lg font-bold">#{order.id.slice(-4)}</span>
              <StatusBadge status={order.status} />
            </div>
            
            <div className="mb-3 space-y-1">
              {order.items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span>{item.quantity}x {item.name}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-xs text-muted-foreground">Est. ready:</span>
              <CountdownTimer estimatedReadyAt={order.estimatedReadyAt} />
            </div>

            <div className="mt-3 flex gap-2">
              <button className="flex-1 rounded bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90">
                Start
              </button>
              <button className="flex-1 rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
                Ready
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default App;
