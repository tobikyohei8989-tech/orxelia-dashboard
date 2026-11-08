const CACHE='tobita-match-assets-v3';const SHELL=['./manifest.webmanifest','./icon.svg'];self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;const u=new URL(req.url);if(u.pathname.endsWith('/app.html')||req.mode==='navigate'){event.respondWith(fetch(new Request(req,{cache:'no-store'})));return}event.respondWith(fetch(req).catch(()=>caches.match(req)))});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const url=new URL('./app.html',self.registration.scope).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(c=>c.url.startsWith(url));
  if(existing){await existing.focus();return;}
  await self.clients.openWindow(url);
 })());
});

self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{}}catch{data={body:event.data?.text()||'新しいお知らせ'}}
 event.waitUntil(self.registration.showNotification(data.title||'パートナーリンク',{body:data.body||'新しいお知らせがあります',tag:data.tag||'tobita-notification',icon:'./icon.svg',badge:'./icon.svg',data:{url:'./app.html'}}));
});
