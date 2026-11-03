(function () {
    'use strict';
    const role=new URLSearchParams(location.search).get('reviewRole')==='SALES'?'SALES':'ADMIN';
    Object.defineProperty(window,'localStorage',{value:sessionStorage});
    localStorage.setItem('h2s_dashboard_session_token_v1',role==='SALES'?'h2s-sales:local-review':'local-review-admin');
    localStorage.setItem('h2s_api_base',location.origin+'/api');
    localStorage.setItem('h2s_admin_token','local-review-dispatch');
    window.API_URL=location.origin+'/api/v1';
    const requestedTab=new URLSearchParams(location.search).get('reviewTab');
    if(requestedTab&&role!=='SALES'){const url=new URL(location.href);url.searchParams.set('tab',requestedTab==='quotes'?'fieldsales':requestedTab);history.replaceState(null,'',url);}
    const nativeFetch=window.fetch.bind(window);
    const nativeOpen=window.open.bind(window);
    window.open=(url,...args)=>{if(url&&new URL(url,location.href).origin!==location.origin){alert('External navigation is disabled in this local review.');return null;}return nativeOpen(url,...args);};
    document.addEventListener('click',event=>{const link=event.target.closest?.('a[href]');if(link&&new URL(link.href,location.href).origin!==location.origin){event.preventDefault();event.stopImmediatePropagation();alert('External navigation is disabled in this local review.');}},true);
    window.fetch=function(input,init={}){
        const request=input instanceof Request?input:null,url=new URL(request?request.url:String(input),location.href);
        if(url.pathname.startsWith('/api/')){
            url.protocol=location.protocol;url.host=location.host;
            const headers=new Headers(init.headers||request?.headers||{});
            if(!headers.has('Authorization'))headers.set('Authorization','Bearer '+localStorage.getItem('h2s_dashboard_session_token_v1'));
            return nativeFetch(request?new Request(url.href,request):url.href,{...init,headers});
        }
        if(url.origin!==location.origin)return Promise.reject(Error('External network access is blocked in this isolated review.'));
        return nativeFetch(input,init);
    };
    const banner=()=>{
        document.title='[LOCAL SYNTHETIC] '+document.title;
        const note=document.createElement('aside');note.id='local-review-notice';note.setAttribute('role','note');
        note.textContent='LOCAL SYNTHETIC REVIEW ONLY - current saved working-tree UI. No production connection. Stripe, assignments, notifications and legacy writes are blocked. Test prices/data are NOT approved Home2Smart offers. ';
        const link=document.createElement('a');link.href='/';link.textContent='Review index / limitations';note.append(link);document.body.prepend(note);
        if(requestedTab!=='quotes'||role==='SALES')return;
        const timer=setInterval(()=>{const button=document.querySelector('#field-sales-pane.active [data-sales-mode="transactions"]');if(button){clearInterval(timer);button.click();}},100);
        setTimeout(()=>clearInterval(timer),20000);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',banner,{once:true});else banner();
})();
