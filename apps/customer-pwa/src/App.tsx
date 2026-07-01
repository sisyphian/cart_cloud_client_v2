import { Routes, Route } from 'react-router-dom';
import { Button } from '@cart-cloud/ui';
import { useUser } from '@cart-cloud/hooks';

function App() {
  const { data: user, isLoading } = useUser();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center p-4">
        <h1 className="mb-4 text-3xl font-bold">CartCloud</h1>
        <p className="mb-8 text-center text-muted-foreground">
          Order food from street carts near you
        </p>
        <Button size="lg" className="w-full max-w-xs">
          Get Started
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-xl font-bold">CartCloud</h1>
          <p className="text-sm text-muted-foreground">Welcome, {user.name}</p>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<div>Home - Vendor List</div>} />
          <Route path="/vendors/:id" element={<div>Vendor Menu</div>} />
          <Route path="/orders/:id" element={<div>Order Tracking</div>} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
