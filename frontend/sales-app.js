(function (global) {
    'use strict';
    const key='h2s_dashboard_session_token_v1', app=document.getElementById('h2s-app');
    const access=document.querySelector('.sales-access'), form=document.getElementById('sales-login');
    const message=document.getElementById('sales-access-status'), management=document.getElementById('sales-management');
    let epoch=0, verified=null, pending=false;
    if(!global.H2SFieldSales||!global.H2SDashboardControls){
        message.textContent='The sales workspace could not load. Reload this page before continuing.';
        message.setAttribute('role','alert');console.error('Required Field Sales application modules are unavailable.');return;
    }
    const base=typeof global.API_URL==='string'&&/^https?:\/\//.test(global.API_URL)
        ? new URL(global.API_URL).origin
        : location.origin;
    const api=base+'/api/v1';
    function status(text,error=false){message.textContent=text;message.setAttribute('role',error?'alert':'status');}
    function gate(){
        verified=null;global.H2SFieldSales.reset();app.hidden=true;access.hidden=false;management.hidden=true;form.hidden=false;
    }
    async function request(action,token,body){
        const response=await global.fetch(api+'?action='+action,{method:body?'POST':'GET',cache:'no-store',referrerPolicy:'no-referrer',
            headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
            ...(body?{body:JSON.stringify(body)}:{})});
        const result=await response.json();
        if(!response.ok||result.ok!==true){
            const error=Error(result.error||'Your session could not be verified. Please try again.');
            error.status=response.status;throw error;
        }
        return result;
    }
    async function verify(token,generation){
        const result=await request('dashboardMe',token);
        if(generation!==epoch)return;
        if(!result.me||typeof result.me.userId!=='string'||!result.me.username||!['SALES','ADMIN','VA'].includes(result.me.role))
            throw Error('The account response is incomplete. Contact management.');
        if(result.me.role!=='SALES'){
            gate();form.hidden=true;management.hidden=false;status('This workspace is for sales representatives. Use your existing management dashboard.');return;
        }
        global.localStorage.setItem(key,token);
        verified={token,role:result.me.role};
        form.reset();access.hidden=true;app.hidden=false;
        global.H2SFieldSales.configure({apiBase:base,getSession:()=>verified,onLogout:logout});
        const query=new URLSearchParams(location.search),view=query.get('view')||'home';
        if(!['home','leads','new','quotes','orders','earnings','assessment'].includes(view))
            throw Error('This sales workspace link is not recognized. Open sales.html to continue.');
        await global.H2SFieldSales.navigate(view,query.get('lead'));
        global.H2SDashboardControls.bootstrapDashboardCustomSelects();
    }
    async function restore(){
        const generation=++epoch;gate();form.hidden=true;status('Checking your session...');
        let token;
        try{
            token=global.localStorage.getItem(key);
            if(!token){form.hidden=false;status('Sign in to see your leads, quotes and earnings.');return;}
            await verify(token,generation);
        }catch(error){
            if(generation!==epoch)return;
            if([401,403].includes(error.status)&&global.localStorage.getItem(key)===token)global.localStorage.removeItem(key);
            gate();console.error('Field Sales session verification failed:',error.message);status(error.message,true);
        }
    }
    async function logout(){
        const token=verified?.token;++epoch;gate();global.localStorage.removeItem(key);status('Signed out on this device.');
        try{await request('dashboardLogout',token,{});}
        catch(error){console.error('Field Sales server sign-out failed:',error.message);status('Signed out on this device. Server sign-out could not be confirmed; contact management if this device is shared.',true);}
    }
    form.addEventListener('submit',async event=>{
        event.preventDefault();if(pending)return;
        pending=true;const generation=++epoch;form.querySelector('button').disabled=true;status('Signing in...');
        try{
            const result=await request('dashboardLogin',null,{username:form.elements.username.value.trim(),pin:form.elements.pin.value.trim(),device:String(navigator.userAgent).slice(0,160)});
            if(generation!==epoch)return;
            const token=result.dashboardLogin?.token;
            if(typeof token!=='string'||!token)throw Error('Sign-in response was incomplete. Please try again.');
            await verify(token,generation);
        }catch(error){if(generation===epoch){gate();console.error('Field Sales sign-in failed:',error.message);status(error.message,true);}}
        finally{pending=false;form.querySelector('button').disabled=false;}
    });
    global.addEventListener('storage',event=>{if(event.key===key)restore();});
    restore();
})(window);
