import { useState } from 'react';
import { useIngredients, useIngredientStockLevels, useCreateStockMovement } from '@cart-cloud/hooks';

interface InventoryManagementProps {
  cartId: string;
}

export function InventoryManagement({ cartId }: InventoryManagementProps) {
  const [showAddStock, setShowAddStock] = useState(false);
  const [selectedIngredient, setSelectedIngredient] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');

  const { data: ingredients } = useIngredients(cartId);
  const { data: stockLevels } = useIngredientStockLevels(cartId);
  const createStockMovement = useCreateStockMovement();

  const handleAddStock = () => {
    createStockMovement.mutate({
      cartId,
      movement: {
        ingredient_id: selectedIngredient,
        movement_type: 'manual_restock',
        quantity_delta: quantity,
        notes,
      },
    });
    setShowAddStock(false);
    setQuantity(0);
    setNotes('');
  };

  const handleWastage = () => {
    createStockMovement.mutate({
      cartId,
      movement: {
        ingredient_id: selectedIngredient,
        movement_type: 'wastage',
        quantity_delta: -quantity,
        notes,
      },
    });
    setShowAddStock(false);
    setQuantity(0);
    setNotes('');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Inventory Management</h2>
        <button
          onClick={() => setShowAddStock(true)}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600"
        >
          Add Stock
        </button>
      </div>

      {showAddStock && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4">Add Stock Movement</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ingredient</label>
              <select
                value={selectedIngredient}
                onChange={(e) => setSelectedIngredient(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">Select ingredient...</option>
                {ingredients?.map((ing) => (
                  <option key={ing.id} value={ing.id}>
                    {ing.name} ({ing.unit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="Optional notes..."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddStock}
                disabled={!selectedIngredient || quantity <= 0}
                className="flex-1 py-2 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Restock
              </button>
              <button
                onClick={handleWastage}
                disabled={!selectedIngredient || quantity <= 0}
                className="flex-1 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Record Wastage
              </button>
              <button
                onClick={() => setShowAddStock(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Current Stock Levels</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ingredient</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Quantity</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reorder Threshold</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {stockLevels?.map((level: any) => {
                const ingredient = ingredients?.find((i) => i.id === level.ingredient_id);
                const isLow = level.current_quantity <= (ingredient?.reorder_threshold || 0);
                return (
                  <tr key={level.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                      {ingredient?.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                      {level.current_quantity} {ingredient?.unit}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                      {ingredient?.reorder_threshold} {ingredient?.unit}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isLow ? (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Low Stock
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
