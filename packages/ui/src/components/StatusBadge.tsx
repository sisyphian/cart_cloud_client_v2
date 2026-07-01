import * as React from 'react';
import { cn } from '../lib/utils';

export type OrderStatus = 
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled';

interface StatusBadgeProps {
  status: OrderStatus;
  className?: string;
}

const statusConfig: Record<OrderStatus, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-status-pending text-white',
  },
  confirmed: {
    label: 'Confirmed',
    className: 'bg-status-confirmed text-white',
  },
  preparing: {
    label: 'Preparing',
    className: 'bg-status-preparing text-white',
  },
  ready: {
    label: 'Ready',
    className: 'bg-status-ready text-white',
  },
  completed: {
    label: 'Completed',
    className: 'bg-status-completed text-white',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-status-cancelled text-white',
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => {
  const config = statusConfig[status];
  
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
};
