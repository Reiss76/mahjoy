(() => {
  const section=document.getElementById('mahjoy-dragon');
  if(!section || matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const observer=new IntersectionObserver(async entries=>{
    if(!entries.some(entry=>entry.isIntersecting))return;
    observer.disconnect();section.classList.add('is-enhanced');
    try { const {mount}=await import('./scene.js?v=20261125-classic'); await mount(section); }
    catch(error) { console.warn('MAH JOY: using static tile image.',error); section.classList.remove('is-enhanced'); }
  },{rootMargin:'600px'});
  observer.observe(section);
})();
