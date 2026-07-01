import { useEffect, useRef } from 'react';
import { getWSManager, disconnectWSManager, type WSMessage } from './WSManager';

interface UseWebSocketOptions {
  url: string;
  onMessage?: (message: WSMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  enabled?: boolean;
}

export const useWebSocket = ({
  url,
  onMessage,
  onConnect,
  onDisconnect,
  onError,
  enabled = true,
}: UseWebSocketOptions) => {
  const managerRef = useRef<ReturnType<typeof getWSManager> | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const manager = getWSManager({
      url,
      onMessage,
      onConnect,
      onDisconnect,
      onError,
    });

    managerRef.current = manager;
    manager.connect();

    return () => {
      // Don't disconnect on unmount - let the singleton manage lifecycle
      // This allows multiple components to share the same connection
    };
  }, [url, enabled]);

  const send = (message: WSMessage) => {
    managerRef.current?.send(message);
  };

  const disconnect = () => {
    disconnectWSManager(url);
  };

  return { send, disconnect };
};
