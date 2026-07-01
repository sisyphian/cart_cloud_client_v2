import { useCartMenu } from '@cart-cloud/hooks';
import type { MenuCategory, MenuItem } from '@cart-cloud/api-client';

interface CartMenuProps {
  slug: string;
  qrToken?: string;
  onAddToCart: (item: MenuItem) => void;
}

export function CartMenu({ slug, qrToken, onAddToCart }: CartMenuProps) {
  const { data: menu, isLoading, error } = useCartMenu(slug, qrToken);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div className="p-8 text-center text-red-600">
        Failed to load menu. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h1 className="text-2xl font-bold text-gray-900">{menu.cart_name}</h1>
        <div className="flex gap-4 mt-2 text-sm text-gray-600">
          {menu.is_open && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              Open
            </span>
          )}
          {!menu.is_open && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-red-500 rounded-full"></span>
              Closed
            </span>
          )}
          {menu.accepts_cash && <span>Cash accepted</span>}
          {menu.accepts_online_payment && <span>Online payment accepted</span>}
        </div>
        {menu.estimated_wait_seconds > 0 && (
          <p className="text-sm text-gray-500 mt-1">
            Estimated wait: ~{Math.ceil(menu.estimated_wait_seconds / 60)} min
          </p>
        )}
      </div>

      {menu.categories.map((category: MenuCategory) => (
        <div key={category.id} className="space-y-3">
          <h2 className="text-xl font-semibold text-gray-800 border-b pb-2">
            {category.name}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {category.items.map((item: MenuItem) => (
              <div
                key={item.id}
                className="bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                {item.image_url && (
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="w-full h-32 object-cover"
                  />
                )}
                <div className="p-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{item.name}</h3>
                      {item.name_bn && (
                        <p className="text-sm text-gray-600">{item.name_bn}</p>
                      )}
                      {item.description && (
                        <p className="text-sm text-gray-500 mt-1">{item.description}</p>
                      )}
                    </div>
                    <span className="text-lg font-bold text-orange-600 ml-4">
                      ৳{item.price}
                    </span>
                  </div>
                  {item.dietary_tags.length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {item.dietary_tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => onAddToCart(item)}
                    disabled={!item.is_available || !menu.is_open}
                    className={`mt-3 w-full py-2 rounded-lg font-medium transition-colors ${
                      item.is_available && menu.is_open
                        ? 'bg-orange-500 text-white hover:bg-orange-600'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {item.is_available ? 'Add to Cart' : 'Unavailable'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
