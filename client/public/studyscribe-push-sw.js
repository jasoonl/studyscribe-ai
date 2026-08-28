self.addEventListener("push", (event) => {
  const fallback = {
    title: "StudyScribe AI",
    body: "You have a new notification.",
    url: "/dashboard",
    tag: "studyscribe-notification",
  };

  let payload = fallback;
  try {
    payload = { ...fallback, ...(event.data ? event.data.json() : {}) };
  } catch {
    // Display the generic notification if a malformed push payload is received.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url },
      icon: "/favicon.ico",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = event.notification.data?.url || "/dashboard";
  event.waitUntil(clients.openWindow(new URL(destination, self.location.origin).href));
});
