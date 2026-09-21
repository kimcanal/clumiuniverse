// Service Worker for /order/orders.html — handles incoming Web Push
// notifications and clicks on them. Scoped to /order/ (its own directory),
// so it never touches the main site.

async function notifyOpenClientsOfNewOrder() {
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientsList) {
    client.postMessage({ type: 'clumi-new-order' });
  }
}

self.addEventListener('push', event => {
  let data = { title: 'New order', body: 'Open the orders page to see details.' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // Non-JSON payload — fall back to the default text above.
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: '../assets/clumi-logo.svg',
        badge: '../assets/clumi-logo.svg',
        tag: 'clumi-new-order',
      }),
      // Also tell any already-open orders.html tab to refresh its list right away —
      // otherwise the notification arrives but the on-screen list stays stale until
      // someone manually reloads the page.
      notifyOpenClientsOfNewOrder(),
    ])
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clientsList => {
      for (const client of clientsList) {
        if (client.url.includes('/order/orders') && 'focus' in client) {
          client.postMessage({ type: 'clumi-new-order' });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('./orders.html');
      }
    })
  );
});
