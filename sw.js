//SW
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{try{for(const k of await caches.keys())await caches.delete(k);}catch(e){}try{await self.registration.unregister();}catch(e){}await self.clients.claim();})());});
self.addEventListener('fetch',()=>{});

