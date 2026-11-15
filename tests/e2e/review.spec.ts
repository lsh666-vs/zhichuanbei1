import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '运行当前实例', exact: true })).toBeEnabled();
});

test('selected domain tab preserves the current editable experiment', async ({ page }) => {
  await page.getByLabel('实验名称', { exact: true }).fill('review · 保留活动实验');
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
  await page.getByRole('tab', { name: /区间调度/ }).click();
  await expect(page.getByLabel('实验名称', { exact: true })).toHaveValue('review · 保留活动实验');
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
});

test('switching between domains preserves each draft instead of replacing the only recovery copy', async ({
  page,
}) => {
  await page.getByLabel('实验名称', { exact: true }).fill('review · 区间草稿');
  await page.getByLabel('评分表达式', { exact: true }).fill('value + duration');
  await page.getByRole('tab', { name: /0-1 资源分配/ }).click();
  await page.getByLabel('实验名称', { exact: true }).fill('review · 背包草稿');
  await page.getByRole('tab', { name: /区间调度/ }).click();
  await expect(page.getByLabel('实验名称', { exact: true })).toHaveValue('review · 区间草稿');
  await expect(page.getByLabel('评分表达式', { exact: true })).toHaveValue('value + duration');
  await page.getByRole('tab', { name: /0-1 资源分配/ }).click();
  await expect(page.getByLabel('实验名称', { exact: true })).toHaveValue('review · 背包草稿');
});

test('a previous AI explanation is removed when shrinking changes the evaluated input (fixture)', async ({
  page,
}) => {
  await page.route('**/api/ai/status', (route) =>
    route.fulfill({
      json: {
        configured: true,
        provider: 'UI review fixture',
        model: 'fixture',
        baseUrl: 'http://localhost',
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    }),
  );
  await page.route('**/api/ai/explain', (route) =>
    route.fulfill({ json: { text: '旧输入说明，仅用于测试陈旧解释清除。', source: 'live-model' } }),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: '运行当前实例', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '搜索反例', exact: true }).click();
  await expect(page.locator('.search-result')).toContainText('发现反例');
  await page.getByRole('button', { name: 'AI 解读本次证据', exact: true }).click();
  await expect(page.locator('.ai-explanation')).toContainText('旧输入说明');
  await page.getByRole('button', { name: '缩减这个反例', exact: true }).click();
  await expect(page.getByRole('button', { name: /步缩减 · 查看证据/ })).toBeVisible();
  await expect(page.locator('.ai-explanation')).toHaveCount(0);
});

test('dead-end and unreachable graph results do not present numerical placeholder as a complete path', async ({
  page,
}) => {
  await page.getByRole('tab', { name: /图路由/ }).click();
  await page.getByRole('button', { name: /编辑实验输入/ }).click();
  await page.getByRole('button', { name: '删除边 AT', exact: true }).click();
  await page.getByRole('button', { name: '应用输入', exact: true }).click();
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
  await expect(page.locator('.result-values .metric').first()).toContainText('未到达');
  await expect(page.locator('.difference')).toContainText('不比较数值差距');
  await page.getByRole('button', { name: /编辑实验输入/ }).click();
  await page.getByRole('button', { name: '删除边 BT', exact: true }).click();
  await page.getByRole('button', { name: '应用输入', exact: true }).click();
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('当前实例通过');
  await expect(page.locator('.result-values .metric').last()).toContainText('不可达');
  await expect(page.locator('.trace-track.reference')).toContainText('目标不可达');
});

test('a missing background job is a terminal recoverable error rather than a permanent UI lock (fixture)', async ({
  page,
}) => {
  await page.route('**/api/jobs/*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 404, json: { error: '任务不存在' } });
    } else await route.fallback();
  });
  await page.getByRole('tab', { name: /图路由/ }).click();
  await page.getByLabel('策略预设').selectOption('graph-global');
  await page.getByLabel('样本预算').fill('2000');
  await page.getByLabel('实例规模').fill('12');
  await page.getByRole('button', { name: '搜索反例', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('任务');
  await expect(page.locator('.progress-strip')).toContainText('未完成');
  await expect(page.getByRole('button', { name: '运行当前实例', exact: true })).toBeEnabled();
});

test('an autosaved unfinished expression restores as an editable draft rather than being discarded', async ({
  page,
}) => {
  await page.getByLabel('实验名称', { exact: true }).fill('review · 未完成的策略草稿');
  await page.getByLabel('评分表达式', { exact: true }).fill('value / (');
  await page.reload();
  await expect(page.getByLabel('实验名称', { exact: true })).toHaveValue('review · 未完成的策略草稿');
  await expect(page.getByLabel('评分表达式', { exact: true })).toHaveValue('value / (');
  await expect(page.locator('.verdict-card h3')).toHaveText('直觉还不是结论');
  await page.getByLabel('评分表达式', { exact: true }).fill('value');
  await page.getByRole('button', { name: '运行当前实例', exact: true }).click();
  await expect(page.locator('.verdict-card h3')).toHaveText('发现了一个反例');
});
