import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '运行当前实例', exact: true })).toBeEnabled();
});

test('editable strategy, real playback, version preservation and held-out regression', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByLabel('实验名称', { exact: true }).fill('E2E · 策略修正与版本');
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
  await expect(page.locator('.result-values .metric').first()).toContainText('9');
  await expect(page.locator('.result-values .metric').last()).toContainText('12');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByLabel('回放进度', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: '保存实验', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
  await page.getByLabel('策略预设').selectOption('interval-optimal');
  await expect(page.locator('.verdict-card h3')).toHaveText('直觉还不是结论');
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('当前实例通过');
  await page.getByLabel('保留样本数').fill('12');
  await page.getByRole('button', { name: '对比修正前后', exact: true }).click();
  const regression = page.getByRole('dialog');
  await expect(regression).toContainText('回归验证');
  await expect(regression.locator('.summary-metrics .regressed strong')).toHaveText('0');
  await expect(regression.locator('.regression-list details')).toHaveCount(13);
  await page.getByRole('button', { name: '关闭对话框' }).click();
  await page.getByRole('button', { name: '保存实验', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 个版本' })).toBeVisible();
  await page.getByRole('button', { name: '版本与复验', exact: true }).click();
  await expect(page.locator('.version-row')).toHaveCount(2);
  await page.locator('.version-row').last().getByRole('button', { name: '恢复此版本' }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
  expect(errors).toEqual([]);
});

test('seeded search, shrinking, export download and verified import', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '搜索反例', exact: true }).click();
  await expect(page.locator('.search-result')).toContainText('第 2 个样本');
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
  await page.getByRole('button', { name: '缩减这个反例', exact: true }).click();
  const reduction = page.getByRole('button', { name: /步缩减 · 查看证据/ });
  await expect(reduction).toBeVisible();
  await reduction.click();
  await expect(page.locator('.reduction-list details')).toHaveCount(26);
  await page.getByRole('button', { name: '关闭对话框' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '实验包', exact: true }).click();
  const download = await downloadPromise;
  const filename = testInfo.outputPath('round-trip.json');
  await download.saveAs(filename);
  await page.getByLabel('导入实验包文件').setInputFiles(filename);
  await expect(page.getByRole('status').filter({ hasText: '实验包已导入' })).toBeVisible();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
  const reportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'HTML 报告', exact: true }).click();
  const report = await reportPromise;
  expect(report.suggestedFilename()).toMatch(/\.html$/);
  await report.saveAs(testInfo.outputPath('report.html'));
});

test('all three domains accept new data and reject invalid edits clearly', async ({ page }) => {
  await page.getByRole('button', { name: /编辑实验输入/ }).click();
  await page.getByLabel('对象 A 结束', { exact: true }).fill('0');
  await page.getByRole('button', { name: '应用输入', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByLabel('对象 A 结束', { exact: true }).fill('4');
  await page.getByLabel('对象 A 收益', { exact: true }).fill('20');
  await page.getByRole('button', { name: '应用输入', exact: true }).click();
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('当前实例通过');
  await expect(page.locator('.result-values .metric').first()).toContainText('20');
  await page.getByRole('tab', { name: /0-1 资源分配/ }).click();
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
  await expect(page.locator('.result-values .metric').first()).toContainText('13');
  await expect(page.locator('.result-values .metric').last()).toContainText('20');
  await page.getByRole('tab', { name: /图路由/ }).click();
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.result-values .metric').first()).toContainText('11');
  await expect(page.locator('.result-values .metric').last()).toContainText('6');
  await page.getByLabel('策略预设').selectOption('graph-global');
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('当前实例通过');
});

test('desktop and mobile layouts, accessible controls and keyboard dialog restoration', async ({
  page,
}, testInfo) => {
  await expect(page.locator('.hero-art')).toBeVisible();
  await expect(page.getByRole('button', { name: /生成策略提案/ })).toBeDisabled();
  const desktop = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(desktop.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '实验手册' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const modal = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(modal.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '实验手册' })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(overflow).toBe(false);
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('AI preview never applies until confirmation (UI fixture, not a live model test)', async ({ page }) => {
  await page.route('**/api/ai/status', (route) =>
    route.fulfill({
      json: {
        configured: true,
        provider: 'UI test fixture',
        model: 'fixture',
        baseUrl: 'http://localhost',
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    }),
  );
  await page.route('**/api/ai/propose', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        strategy: { ...body.currentStrategy, name: '结束最早优先', score: 'end', direction: 'asc' },
        explanation: '仅用于测试提案确认交互。',
        assumptions: ['最大收益目标仍需实际检验。'],
        source: 'live-model',
      },
    });
  });
  await page.reload();
  await expect(page.getByLabel('自然语言策略')).toBeEnabled();
  await page.getByLabel('自然语言策略').fill('按结束时间升序选择任务');
  await page.getByRole('button', { name: /生成策略提案/ }).click();
  await expect(page.getByRole('dialog')).toContainText('确认 AI 提案');
  await expect(page.getByLabel('评分表达式', { exact: true })).toHaveValue('value');
  await page.getByRole('button', { name: '确认应用策略', exact: true }).click();
  await expect(page.getByLabel('评分表达式', { exact: true })).toHaveValue('end');
  await expect(page.locator('.verdict-card h3')).toHaveText('直觉还不是结论');
});

test('network failure is recoverable and local draft restores without stale verdict', async ({ page }) => {
  await page.getByLabel('实验名称', { exact: true }).fill('E2E · 本地恢复');
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
  await page.route('**/api/evaluate', (route) => route.abort('connectionrefused'));
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法连接本地实验服务');
  await expect(page.getByRole('button', { name: '运行当前实例', exact: true })).toBeEnabled();
  await page.unroute('**/api/evaluate');
  await page.reload();
  await expect(page.getByLabel('实验名称', { exact: true })).toHaveValue('E2E · 本地恢复');
  await expect(page.locator('.verdict-card h3')).toHaveText('直觉还不是结论');
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
});

test('cancelled search is visibly incomplete and UI remains usable', async ({ page }) => {
  await page.getByRole('tab', { name: /图路由/ }).click();
  await page.getByLabel('策略预设').selectOption('graph-global');
  await page.getByLabel('样本预算').fill('2000');
  await page.getByLabel('实例规模').fill('12');
  await page.getByRole('button', { name: '搜索反例', exact: true }).click();
  await page.getByRole('button', { name: '取消计算', exact: true }).click();
  await expect(page.locator('.progress-strip')).toContainText('已取消');
  await expect(page.getByRole('button', { name: '运行当前实例', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('当前实例通过');
});

test('undefined scores fail explicitly without claiming sampled pass', async ({ page }) => {
  await page.getByLabel('评分表达式', { exact: true }).fill('value / (end - end)');
  await page.getByRole('button', { name: '搜索反例', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('除数为 0');
  await expect(page.locator('.progress-strip')).toContainText('未完成');
  await expect(page.locator('.search-result')).toHaveCount(0);
});
