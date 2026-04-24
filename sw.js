// Service Worker لإشعارات إنـقـاذ حــيـاة
const CACHE_NAME = 'inqadh-hayah-v60';
const urlsToCache = [
  '/',
  '/index.html',
  '/qr.html',
  '/styles.css',
  '/app.js',
  '/governorate-regions.js',
  '/yemen-governorates.js',
  '/manifest.json',
  '/vendor/qrcode-generator.js'
];

// تثبيت Service Worker (ملف واحد فاشل لا يمنع الباقي)
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('تم تثبيت Service Worker');
      return Promise.allSettled(urlsToCache.map((u) => cache.add(u).catch((err) => {
        console.warn('تعذر كاش:', u, err);
      })));
    })
  );
});

// تفعيل Service Worker — السيطرة على النوافذ فوراً بعد التحديث
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('حذف الكاش القديم:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// اعتراض الطلبات — API من الشبكة؛ صفحات HTML من الشبكة أولاً ثم الكاش
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({
            error: 'تعذر الاتصال. تحقق من الإنترنت.'
          }),
          { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        )
      )
    );
    return;
  }

  // صفحات HTML: شبكة أولاً ليصل المستخدم أحدث نشر عند الاتصال
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  try {
    const path = new URL(url).pathname;
    if (path.endsWith('.html') || path === '/') {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            if (response && response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
          .catch(() => caches.match(event.request))
      );
      return;
    }
  } catch (_) { /* ignore */ }

  // CSS/JS وغيرها: كاش أولاً ثم الشبكة (دعم عدم الاتصال)
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// Web Push من الخادم (رسالة جديدة للمتبرع)
self.addEventListener('push', (event) => {
  let payload = { title: 'إنقاذ حياة', body: '', data: {} };
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (e) {
    /* ignore */
  }
  const title = payload.title || 'إنقاذ حياة';
  const data = payload.data || {};
  const options = {
    body: payload.body || '',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    data: data,
    tag: data.messageId ? `push-msg-${data.messageId}` : 'blood-connect-push',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// معالجة الإشعارات
self.addEventListener('notificationclick', (event) => {
  console.log('تم النقر على الإشعار:', event.notification.tag);
  
  event.notification.close();
  
  const action = event.action;
  const data = event.notification.data || {};
  
  if (data.openMessages === '1' || data.openMessages === 1) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes('index.html') && 'focus' in client) {
            client.focus();
            client.postMessage({ type: 'OPEN_MESSAGE', messageId: data.messageId });
            return;
          }
        }
        return clients.openWindow('/index.html').then((client) => {
          if (client && client.postMessage) {
            client.postMessage({ type: 'OPEN_MESSAGE', messageId: data.messageId });
          }
        });
      })
    );
    return;
  }

  if (action === 'call' && data.phone) {
    // فتح تطبيق الاتصال مباشرة
    event.waitUntil(
      clients.openWindow(`tel:${data.phone}`)
    );
  } else if (action === 'view' || !action) {
    // فتح الصفحة وعرض الرسالة
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // البحث عن نافذة مفتوحة
          for (let i = 0; i < clientList.length; i++) {
            const client = clientList[i];
            if (client.url.includes('/index.html') && 'focus' in client) {
              // فتح النافذة الموجودة
              client.focus();
              client.postMessage({
                type: 'OPEN_MESSAGE',
                messageId: data.messageId
              });
              return;
            }
          }
          // فتح نافذة جديدة
          return clients.openWindow('/index.html#messages').then((client) => {
            if (client) {
              client.postMessage({
                type: 'OPEN_MESSAGE',
                messageId: data.messageId
              });
            }
          });
        })
    );
  }
});

// استقبال رسائل من الصفحة الرئيسية
self.addEventListener('message', (event) => {
  console.log('رسالة من الصفحة الرئيسية:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data && event.data.type === 'SEND_NOTIFICATION') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  }
});

// معالجة الإشعارات المغلقة
self.addEventListener('notificationclose', (event) => {
  console.log('تم إغلاق الإشعار:', event.notification.tag);
});

