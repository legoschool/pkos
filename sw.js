/* 드라이브판 기록장은 2026-11-10 나의지식서재(https://legoschool.github.io/pkos-library/)로 모았다.
   예전에 설치된 이 서비스 워커가 새로 받아지면 옛 화면 사본(pkos-shell-*, pkos-share-inbox 캐시)을 지우고 스스로 해제한 뒤,
   열려 있던 창을 다시 읽어 안내 페이지가 보이게 한다. 같은 주소의 다른 앱 캐시는 지우지 않는다. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('pkos-shell-') || key === 'pkos-share-inbox') await caches.delete(key);
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
})()));
