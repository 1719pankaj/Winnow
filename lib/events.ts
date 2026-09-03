import { ProgressEvent } from './types';
import { store } from './store';

type EventListener = (event: ProgressEvent) => void;

class SearchEventHub {
  private listeners = new Map<string, Set<EventListener>>();

  subscribe(searchId: string, listener: EventListener): () => void {
    if (!this.listeners.has(searchId)) {
      this.listeners.set(searchId, new Set());
    }
    this.listeners.get(searchId)!.add(listener);

    return () => {
      const set = this.listeners.get(searchId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(searchId);
        }
      }
    };
  }

  broadcast(searchId: string, event: ProgressEvent): void {
    const set = this.listeners.get(searchId);
    if (set) {
      set.forEach((listener) => {
        try {
          listener(event);
        } catch (err) {
          console.error(`[EventHub] Error notifying listener for search ${searchId}:`, err);
        }
      });
    }
  }
}

const globalForEvents = globalThis as unknown as {
  winnowEventHub: SearchEventHub | undefined;
};

export const eventHub = globalForEvents.winnowEventHub ?? new SearchEventHub();
globalForEvents.winnowEventHub = eventHub;

/**
 * Formats a ProgressEvent into standard Server-Sent Event text.
 */
export function formatSSE(event: ProgressEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
