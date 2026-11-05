(function () {
    'use strict';
    const walkthrough=[...document.scripts].some(script=>script.src&&new URL(script.src).pathname==='/walkthrough/boot.js');
    const documentVersion=Number(new URLSearchParams(location.search).get('reviewNavigation'))||0;
    const notify=message=>parent.postMessage({...message,documentVersion},location.origin);
    const wantedRole=new URLSearchParams(location.search).get('reviewRole');
    const role=walkthrough&&wantedRole==='PRO'?'PRO':wantedRole==='SALES'?'SALES':'ADMIN';
    Object.defineProperty(window,'localStorage',{value:sessionStorage});
    const reviewToken=role==='PRO'?'local-review-pro':role==='SALES'?'h2s-sales:local-review':'local-review-admin';
    localStorage.setItem('h2s_dashboard_session_token_v1',reviewToken);
    if(walkthrough&&role==='PRO')localStorage.setItem('h2s_portal_token','pro');
    localStorage.setItem('h2s_api_base',location.origin+'/api');
    if(walkthrough&&role==='PRO')localStorage.removeItem('h2s_admin_token');
    else localStorage.setItem('h2s_admin_token','local-review-dispatch');
    window.API_URL=location.origin+'/api/v1';
    const requestedTab=new URLSearchParams(location.search).get('reviewTab');
    if(requestedTab&&role!=='SALES'){const url=new URL(location.href);url.searchParams.set('tab',requestedTab==='quotes'?'fieldsales':requestedTab);history.replaceState(null,'',url);}
    const nativeFetch=window.fetch.bind(window);
    const nativeOpen=window.open.bind(window);
    function reviewNavigation(value){
        const url=new URL(value,location.href);
        if(walkthrough&&url.protocol==='https:'&&url.hostname==='checkout.stripe.com'){
            fetch('/walkthrough/status').then(r=>r.json()).then(data=>{
                const checkout=(data.checkouts||[]).find(item=>item.url===url.href);
                if(!checkout)throw Error('No matching synthetic provider reservation. External checkout remains blocked.');
                notify({type:'h2s-review-navigation',url:location.origin+'/walkthrough/provider?session='+encodeURIComponent(checkout.sessionId)});
            }).catch(error=>alert(error.message));
            return true;
        }
        if(url.origin!==location.origin){alert('External navigation is disabled in this local review.');return true;}
        if(walkthrough&&url.protocol!=='blob:'){
            notify({type:'h2s-review-navigation',url:url.href});return true;
        }
        return false;
    }
    window.open=(url,...args)=>url&&reviewNavigation(url)?null:nativeOpen(url,...args);
    document.addEventListener('click',event=>{
        const link=event.target.closest?.('a[href]');if(!link||link.download||link.href.startsWith('blob:'))return;
        if((walkthrough||new URL(link.href).origin!==location.origin)&&reviewNavigation(link.href)){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    window.fetch=function(input,init={}){
        const request=input instanceof Request?input:null,url=new URL(request?request.url:String(input),location.href);
        if(url.pathname.startsWith('/api/')){
            url.protocol=location.protocol;url.host=location.host;
            const headers=new Headers(init.headers||request?.headers||{});
            if(!headers.has('Authorization'))headers.set('Authorization','Bearer '+localStorage.getItem('h2s_dashboard_session_token_v1'));
            const response=nativeFetch(request?new Request(url.href,request):url.href,{...init,headers});
            if(walkthrough&&(init.method||request?.method||'GET').toUpperCase()!=='GET')
                response.then(()=>notify({type:'h2s-review-change'}),error=>console.error('Local application request failed:',error.message));
            return response;
        }
        if(url.origin!==location.origin)return Promise.reject(Error('External network access is blocked in this isolated review.'));
        return nativeFetch(input,init);
    };
    const banner=()=>{
        document.title='[LOCAL SYNTHETIC] '+document.title;
        const note=document.createElement('aside');note.id='local-review-notice';note.setAttribute('role','note');
        note.textContent=walkthrough?'LOCAL SYNTHETIC APPLICATION SESSION — no production connection or real money. ':'LOCAL SYNTHETIC REVIEW ONLY - current saved working-tree UI. No production connection. Stripe, assignments, notifications and legacy writes are blocked. Test prices/data are NOT approved Home2Smart offers. ';
        if(walkthrough)note.style.cssText='font:11px system-ui;padding:4px 8px;background:Canvas;color:CanvasText;border-bottom:1px solid lightgray;';
        const link=document.createElement('a');link.href='/';link.textContent=walkthrough?'Review navigator':'Review index / limitations';note.append(link);document.body.prepend(note);
        if(walkthrough){
            notify({type:'h2s-review-ready'});
            let positionTimer;
            addEventListener('message',async event=>{
                if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='h2s-review-position'||event.data.documentVersion!==documentVersion)return;
                const command=event.data;
                let attempt=0;
                clearInterval(positionTimer);
                const timer=setInterval(()=>{
                    if(++attempt>100){clearInterval(timer);notify({type:'h2s-review-position-failed',navigationVersion:command.navigationVersion});return;}
                    const root=document.getElementById('field-sales-pane');if(!root?.classList.contains('active'))return;
                    const mode=command.leadId?'opportunities':command.mode;
                    if(!command.openedLead){
                        const button=root.querySelector('[data-sales-mode="'+mode+'"]');
                        if(button?.getAttribute('aria-pressed')!=='true'){button?.click();return;}
                    }else if(!root.querySelector('[data-sales-form="save"]'))return;
                    if(command.leadId){
                        const lead=root.querySelector('[data-sales-lead="'+command.leadId+'"]');
                        if(lead){lead.click();command.leadId=null;command.openedLead=true;return;}
                        if(!root.querySelector('[data-sales-form="save"]'))return;
                    }
                    if(command.focus){
                        const target=root.querySelector(command.focus);if(!target)return;
                        target.closest('details')?.setAttribute('open','');
                        target.scrollIntoView({block:'start'});
                    }
                    clearInterval(timer);
                    notify({type:'h2s-review-positioned',navigationVersion:command.navigationVersion});
                },150);
                positionTimer=timer;
            });
        }
        if(requestedTab!=='quotes'||role==='SALES')return;
        const timer=setInterval(()=>{const button=document.querySelector('#field-sales-pane.active [data-sales-mode="transactions"]');if(button){clearInterval(timer);button.click();}},100);
        setTimeout(()=>clearInterval(timer),20000);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',banner,{once:true});else banner();
})();
