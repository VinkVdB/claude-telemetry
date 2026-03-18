// src/server/sse/broadcaster.ts

type Subscriber = (event: string, data: string) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function broadcast(event: string, data: any): void {
  const payload = JSON.stringify(data);
  for (const sub of subscribers) {
    sub(event, payload);
  }
}

export function subscriberCount(): number {
  return subscribers.size;
}
