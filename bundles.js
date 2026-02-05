/* bundles.js shim
   Ensures /bundles always runs the latest implementation from /frontend/bundles.js.
*/
(function(){
  try {
    var current = (document.currentScript && document.currentScript.src) ? new URL(document.currentScript.src, window.location.href) : null;
    var search = current ? current.search : '';
    var s = document.createElement('script');
    s.src = '/frontend/bundles.js' + search;
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    try {
      var s2 = document.createElement('script');
      s2.src = '/frontend/bundles.js';
      s2.async = false;
      (document.head || document.documentElement).appendChild(s2);
    } catch (_e2) {}
  }
})();
