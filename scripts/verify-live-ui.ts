/** Opt-in: two paid real-provider requests through the actual workbench. */
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const url = 'http://127.0.0.1:4317';
const status = await fetch(url + '/api/ai/status').then((r) => r.json());
if (!status.configured) throw new Error('Start the local service with its private .env first.');
const directory = resolve('.runtime/live-ui');
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1536, height: 1080 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const started = performance.now();
  await page.goto(url);
  await expect(page.getByLabel('自然语言策略')).toBeEnabled();
  await page
    .getByLabel('自然语言策略')
    .fill(
      '优先选择结束最早的区间，评分为 end，升序，平局按 ID 升序。请说明最多任务数与最大收益的适用条件不同。',
    );
  await page.getByRole('button', { name: /生成策略提案/ }).click();
  await expect(page.getByRole('dialog')).toContainText('确认 AI 提案', { timeout: 35000 });
  await expect(page.getByLabel('评分表达式', { exact: true })).toHaveValue('value');
  await page.screenshot({ path: resolve(directory, 'proposal.png'), fullPage: true });
  await page.getByRole('button', { name: '确认应用策略', exact: true }).click();
  await expect(page.getByLabel('评分表达式', { exact: true })).toHaveValue('end');
  await page.getByLabel('策略预设').selectOption('interval-value');
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
  await page.getByRole('button', { name: 'AI 解读本次证据', exact: true }).click();
  await expect(page.locator('.ai-explanation p')).not.toBeEmpty({ timeout: 35000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(directory, 'explanation.png'), fullPage: true });
  const after = await fetch(url + '/api/ai/status').then((r) => r.json());
  const result = {
    kind: 'real-provider-through-browser',
    at: new Date().toISOString(),
    provider: after.provider,
    model: after.model,
    calls: after.calls - status.calls,
    inputTokens: after.inputTokens - status.inputTokens,
    outputTokens: after.outputTokens - status.outputTokens,
    elapsedMs: Math.round(performance.now() - started),
    previewConfirmed: true,
    explanationRendered: true,
    pageErrors: errors,
    scope:
      'Two real paid model requests through visible workbench; arbitrary model prose still needs human review.',
  };
  writeFileSync(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
