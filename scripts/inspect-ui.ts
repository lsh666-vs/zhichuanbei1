import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('.runtime/ui-inspection');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1536, height: 1080 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const started = performance.now();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4317');
  await page.getByRole('button', { name: '运行当前实例', exact: true }).waitFor();
  await expectReady();
  const readyMs = Math.round(performance.now() - started);
  const evaluationStarted = performance.now();
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await page.getByRole('heading', { name: '发现了一个反例', exact: true }).waitFor();
  const evaluationUiMs = Math.round(performance.now() - evaluationStarted);
  const playbackStarted = performance.now();
  await page
    .getByLabel('回放进度', { exact: true })
    .fill((await page.getByLabel('回放进度', { exact: true }).getAttribute('max')) ?? '0');
  const playbackUiMs = Math.round(performance.now() - playbackStarted);
  async function expectReady() {
    await page.waitForFunction(
      () => !(document.querySelector('.run-button') as HTMLButtonElement | null)?.disabled,
    );
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const violations = result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  const report = {
    errors,
    violations,
    dimensions,
    timings: {
      readyMs,
      evaluationUiMs,
      playbackUiMs,
      scope:
        'Single local browser run including automation and HTTP overhead; not a rendering profiler or cross-machine guarantee.',
    },
  };
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
