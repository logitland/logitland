// App-wide toasts and screen-reader announcements. Render <Toaster /> once in the root layout.

export interface ToastItem {
  id: number;
  message: string;
  leaving: boolean;
}

let next = 1;
export const toasts = $state<{ items: ToastItem[]; announcement: string }>({ items: [], announcement: '' });

export function toast(message: string, duration = 3600): void {
  const item: ToastItem = { id: next++, message, leaving: false };
  toasts.items.push(item);
  setTimeout(() => {
    const t = toasts.items.find((i) => i.id === item.id);
    if (t) t.leaving = true;
    setTimeout(() => {
      toasts.items = toasts.items.filter((i) => i.id !== item.id);
    }, 220);
  }, duration);
}

/** A polite, visually hidden announcement (for state changes that have no toast). */
export function announce(message: string): void {
  toasts.announcement = '';
  setTimeout(() => (toasts.announcement = message), 60);
}
