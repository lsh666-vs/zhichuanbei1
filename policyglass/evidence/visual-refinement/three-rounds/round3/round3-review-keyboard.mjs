import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const require=createRequire('D:/传智杯1/counterlab/policyglass/frontend/package.json');
const {chromium}=require('@playwright/test');
const root='D:/传智杯1/counterlab/policyglass/.runtime/two-chat-76425c0/';
const context=await chromium.launchPersistentContext(root+'round3-review-profile-keyboard',{headless:true,channel:'chromium',viewport:{width:1440,height:900},args:['--disable-crash-reporter','--disable-breakpad','--enable-unsafe-swiftshader']});
const page=context.pages()[0];const results=[];let mutations=0;page.on('request',r=>{if(r.method()==='POST')mutations++;});
try{
 for(const size of [{width:1440,height:900},{width:1280,height:720}]){
  await page.setViewportSize(size);
  await page.goto('http://127.0.0.1:5173/?experiment=e3fc5bcb08554f17b6026e52fed8d3db');
  await page.locator('.event-list button').filter({hasText:'optimizer'}).first().waitFor({timeout:20000});
  const phase=page.getByRole('button',{name:'参数更新',exact:true});await phase.click();
  await page.waitForFunction(()=>document.querySelector('.inspector .tags')?.textContent.includes('optimizer'));
  const sel=page.locator('.inspector select');await sel.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const focused=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.trim().slice(0,80),label:document.activeElement?.getAttribute('aria-label')}));
  await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(600);
  await page.screenshot({path:root+`round3-review-optimizer-context-${size.width}.png`,fullPage:true});
  results.push({size,parameter:await sel.inputValue(),numericControls:await page.locator('.inspector input[type="number"]').count(),tabFromParameter:focused});
 }
 writeFileSync(root+'round3-review-keyboard.json',JSON.stringify({results,postCount:mutations},null,2));console.log(JSON.stringify({results,postCount:mutations}));
}finally{await context.close();}


