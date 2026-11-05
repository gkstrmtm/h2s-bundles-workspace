const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),ts=require('typescript');
const {extractPortal}=require('../../tools/extract-portal-assets.js');
const {assertNoTemplateTokens}=require('../../tools/portal-template-check.cjs');
const root=path.resolve(__dirname,'..','..');
test('asset extraction only removes HTML styles, never styles inside JavaScript templates',()=>{
    const source='<html><head><style>.page{display:grid}</style><script>window.bootstrap=true;</script></head><body><main></main><script>const template=`<style>.dynamic{color:red}</style><p>Workflow</p>`;document.querySelector(\"main\").innerHTML=template;</script></body></html>';
    const result=extractPortal(source);
    assert.match(result.css,/\.page\{/);assert.doesNotMatch(result.css,/\.dynamic/);
    assert.match(result.js,/<style>\.dynamic/);assert.doesNotMatch(result.html,/%%|const template/);
    const dom=new JSDOM(result.html,{runScripts:'outside-only'});
    try {dom.window.eval(result.js);assert.equal(dom.window.document.querySelector('main p').textContent,'Workflow');}
    finally {dom.window.close();}
});
test('active management/customer sources and extraction reject unresolved related template tokens',()=>{
    for(const name of ['dash.html','dash.js','forecast-assistant.js','sales.html','sales-app.js','field-sales.js','field-commerce.js','field-workflow.js','field-earnings.js','field-agreement.html','field-agreement.js']){
        assertNoTemplateTokens(fs.readFileSync(path.join(root,'frontend',name),'utf8'),name);
    }
    assert.throws(()=>assertNoTemplateTokens('<main>%%H2S_STYLE_PLACEHOLDER%%</main>','fixture'),/Unresolved template/);
    assert.throws(()=>assertNoTemplateTokens('%%OTHER_TEMPLATE_TOKEN%%','fixture'),/OTHER_TEMPLATE_TOKEN/);
    assert.throws(()=>extractPortal('<style>body{}</style><script>document.body.innerHTML=\"%%UNRESOLVED_COPY%%\";</script>'),/UNRESOLVED_COPY/);
});
test('actual Forecast render contains no style placeholder and does not fetch business data',()=>{
    const source=fs.readFileSync(path.join(root,'frontend','dash.js'),'utf8');
    const ast=ts.createSourceFile('dash.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const statement=ast.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(ast)==='adminForecastCalculator'));
    assert.ok(statement);
    const dom=new JSDOM('<div id="adminForecastCalculator"></div>',{runScripts:'outside-only',url:'https://fixture.invalid'});
    try {
        dom.window.fetch=()=>{throw Error('Forecast inspection must not fetch');};
        dom.window.eval(statement.getText(ast)+';window.fixtureForecast=adminForecastCalculator;');
        dom.window.fixtureForecast.render();
        const rendered=dom.window.document.getElementById('adminForecastCalculator');
        assert.ok(rendered.querySelector('#forecastMainGrid'));
        assertNoTemplateTokens(rendered.innerHTML,'rendered Forecast');
    } finally {dom.window.close();}
});
