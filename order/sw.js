// Service Worker for /order/orders.html — handles incoming Web Push
// notifications and clicks on them. Scoped to /order/ (its own directory),
// so it never touches the main site.

self.addEventListener('push', event => {
  let data = { title: 'New order', body: 'Open the orders page to see details.' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // Non-JSON payload — fall back to the default text above.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '../assets/clumi-logo.svg',
      badge: '../assets/clumi-logo.svg',
      tag: 'clumi-new-order',
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsList => {
      for (const client of clientsList) {
        if (client.url.includes('/order/orders') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('./orders.html');
      }
    })
  );
});
