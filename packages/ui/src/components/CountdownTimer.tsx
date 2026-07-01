import * as React from 'react';
import { cn } from '../lib/utils';

interface CountdownTimerProps {
  estimatedReadyAt: string; // ISO 8601 timestamp
  className?: string;
  onComplete?: () => void;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({
  estimatedReadyAt,
  className,
  onComplete,
}) => {
  const [timeLeft, setTimeLeft] = React.useState<number>(0);
  const [isExpired, setIsExpired] = React.useState(false);

  React.useEffect(() => {
    const targetTime = new Date(estimatedReadyAt).getTime();
    
    const calculateTimeLeft = () => {
      const now = Date.now();
      const difference = targetTime - now;
      
      if (difference <= 0) {
        setTimeLeft(0);
        setIsExpired(true);
        onComplete?.();
        return;
      }
      
      setTimeLeft(difference);
      setIsExpired(false);
    };

    // Initial calculation
    calculateTimeLeft();

    // Update every second
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, [estimatedReadyAt, onComplete]);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  return (
    <div className={cn('font-mono font-semibold', className)}>
      {isExpired ? (
        <span className="text-status-ready">Ready!</span>
      ) : (
        <span>{formatTime(timeLeft)}</span>
      )}
    </div>
  );
};
