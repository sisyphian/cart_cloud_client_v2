import { Routes, Route } from 'react-router-dom';
import { Button, Card, CardHeader, CardTitle, CardContent } from '@cart-cloud/ui';

function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">CartCloud Owner Dashboard</h1>
            <nav className="flex gap-4">
              <Button variant="ghost">Dashboard</Button>
              <Button variant="ghost">Orders</Button>
              <Button variant="ghost">Menu</Button>
              <Button variant="ghost">Settings</Button>
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<div>Orders Management</div>} />
          <Route path="/menu" element={<div>Menu Management</div>} />
          <Route path="/settings" element={<div>Settings</div>} />
        </Routes>
      </main>
    </div>
  );
}

function Dashboard() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Dashboard</h2>
      
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Today's Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">24</div>
            <p className="text-sm text-muted-foreground">+12% from yesterday</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">$1,234</div>
            <p className="text-sm text-muted-foreground">+8% from yesterday</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Avg. Prep Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">12m</div>
            <p className="text-sm text-muted-foreground">-2m from last week</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between border-b pb-4">
                <div>
                  <div className="font-medium">Order #{1000 + i}</div>
                  <div className="text-sm text-muted-foreground">2 items • $15.50</div>
                </div>
                <div className="text-sm text-muted-foreground">5 min ago</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
