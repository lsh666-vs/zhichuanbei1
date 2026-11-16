const { chromium } = require('../../node_modules/@playwright/test');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const diagnosticDir = path.resolve(process.argv[2] || path.resolve(__dirname, '../.runtime/diagnostics'));
(async () => {
  const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1120}, deviceScaleFactor: 1});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const target = path.resolve(diagnosticDir, 'field-diagnostics.html');
    await page.goto(pathToFileURL(target).href);
    await page.waitForFunction(() => document.querySelectorAll('.js-plotly-plot').length === 4 && [...document.querySelectorAll('.js-plotly-plot')].every(p => p._fullLayout));
    await page.locator('.updatemenu-button').filter({hasText: 'Re(Ey)'}).click();
    await page.waitForFunction(() => document.querySelector('.js-plotly-plot').data[0].visible === true);
    await page.locator('.slider-rail-rect').first().scrollIntoViewIfNeeded();
    const rail = await page.locator('.slider-rail-rect').first().boundingBox();
    await page.mouse.click(rail.x + rail.width - 2, rail.y + rail.height / 2);
    await page.waitForFunction(() => [...document.querySelectorAll('.js-plotly-plot')][1].layout.sliders[0].active === 8);
    await page.screenshot({path: path.resolve(diagnosticDir, 'browser-desktop.png'), fullPage: true});
    const result = await page.evaluate(() => ({
      title: document.title,
      plots: [...document.querySelectorAll('.js-plotly-plot')].map(p => ({traces: p.data.length, type: p.data[0].type})),
      canvases: document.querySelectorAll('canvas').length,
      externalScripts: [...document.scripts].filter(s => s.src).length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      sliders: document.querySelectorAll('.slider-container').length,
      signedFieldSelected: document.querySelector('.js-plotly-plot').data[0].visible === true,
      sliceActiveIndex: [...document.querySelectorAll('.js-plotly-plot')][1].layout.sliders[0].active,
      visibleSliceName: [...document.querySelectorAll('.js-plotly-plot')][1].data.find(t => t.visible === true).name,
    }));
    if (errors.length || result.plots.length !== 4 || !result.canvases) throw new Error(JSON.stringify({errors, result}));
    fs.writeFileSync(path.resolve(diagnosticDir, 'browser-check.json'), JSON.stringify({...result, pageErrors: errors}, null, 2));
    console.log(JSON.stringify({...result, pageErrors: errors}));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
