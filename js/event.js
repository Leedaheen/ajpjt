/* ═══════════════════════════════════════════
   EVENT.JS — 이벤트 위임 레이어
   로딩 순서: db → state → api → ui → app → [event]

   현재 앱은 HTML onclick 속성을 직접 사용하므로
   이벤트 위임은 최소화되어 있습니다.
   온라인/오프라인, visibilitychange, SW 등의
   글로벌 이벤트는 app.js에 포함되어 있습니다.
═══════════════════════════════════════════ */
/* ── 스크롤바 페이드 인/아웃 ──────────────────────────────
   스크롤 중: .is-scrolling 추가 → thumb 표시
   멈추면 1.2s 후 클래스 제거 → thumb 페이드아웃           */
(function(){
  const _timers = new WeakMap();
  document.addEventListener('scroll', function(e){
    const el = e.target;
    if(!el || el === document) return;
    el.classList.add('is-scrolling');
    if(_timers.has(el)) clearTimeout(_timers.get(el));
    _timers.set(el, setTimeout(()=>el.classList.remove('is-scrolling'), 1200));
  }, {passive:true, capture:true});
})();
