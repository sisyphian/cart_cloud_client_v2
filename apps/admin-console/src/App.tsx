import { Routes, Route } from 'react-router-dom';
import { Button, Card, CardHeader, CardTitle, CardContent } from '@cart-cloud/ui';

function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">CartCloud Admin Console</h1>
            <nav className="flex gap-4">
              <Button variant="ghost">Dashboard</Button>
              <Button variant="ghost">Tenants</Button>
              <Button variant="ghost">Users</Button>
              <Button variant="ghost">System</Button>
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<AdminDashboard />} />
          <Route path="/tenants" element={<div>Tenant Management</div>} />
          <Route path="/users" element={<div>User Management</div>} />
          <Route path="/system" element={<div>System Health</div>} />
        </Routes>
      </main>
    </div>
  );
}

function AdminDashboard() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Admin Dashboard</h2>
      
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Total Tenants</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">156</div>
            <p className="text-sm text-muted-foreground">Active vendors</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Total Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">12,345</div>
            <p className="text-sm text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">$45.2K</div>
            <p className="text-sm text-muted-foreground">This month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Users</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">8,432</div>
            <p className="text-sm text-muted-foreground">Last 30 days</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between border-b pb-4">
                <div>
                  <div className="font-medium">New tenant registered</div>
                  <div className="text-sm text-muted-foreground">Taco Stand #{i}</div>
                </div>
                <div className="text-sm text-muted-foreground">{i * 5} min ago</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
