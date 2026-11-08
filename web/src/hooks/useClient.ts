import { useEffect, useMemo, useState } from 'react';
import { TodooCardClient, type DeviceInfo, type LogEntry } from '../lib/ble';

let singleton: TodooCardClient | null = null;
export function getClient(): TodooCardClient {
  if (!singleton) singleton = new TodooCardClient();
  return singleton;
}

export function useClient() {
  const client = useMemo(getClient, []);
  const [info, setInfo] = useState<DeviceInfo | null>(client.info);
  const [connected, setConnected] = useState(client.connected);
  const [log, setLog] = useState<LogEntry[]>([]);

  useEffect(() => {
    const onInfo = (e: Event) => setInfo({ ...((e as CustomEvent<DeviceInfo | null>).detail as DeviceInfo) });
    const onLog = (e: Event) => setLog((l) => [...l.slice(-499), (e as CustomEvent<LogEntry>).detail]);
    const onDisc = () => setConnected(false);
    client.addEventListener('info', onInfo);
    client.addEventListener('log', onLog);
    client.addEventListener('disconnected', onDisc);
    const t = setInterval(() => setConnected(client.connected), 1000);
    return () => {
      client.removeEventListener('info', onInfo);
      client.removeEventListener('log', onLog);
      client.removeEventListener('disconnected', onDisc);
      clearInterval(t);
    };
  }, [client]);

  return { client, info, connected, log, setConnected, clearLog: () => setLog([]) };
}
