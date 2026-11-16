import { test, expect } from '@playwright/test';

test('Keyboard dialog, reduced motion and source tabs remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: '新建实验', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(page.getByLabel('实验名称', { exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: /创建实验/ })).toBeEnabled();
  await dialog.getByRole('button', { name: /创建实验/ }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '关闭新建' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: /创建实验/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByLabel('实验名称', { exact: true }).fill('Keyboard source check');
  await page.getByLabel('隐藏层宽度', { exact: true }).fill('8,8');
  await dialog.getByRole('button', { name: /创建实验/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Keyboard source check' })).toBeVisible();
  await expect(page.getByLabel('减弱动效')).toBeChecked();
  const arm = page.getByRole('tab', { name: '物理实验' });
  await arm.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '计算网络' })).toBeFocused();
  await expect(page.getByRole('tab', { name: '计算网络' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: '局部损失' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(arm).toBeFocused();
});

test('Offline optional assistant previews actual authorized event and sends nothing', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(request.url());
  });
  const created = await (
    await page.request.post('/api/experiments', {
      data: { label: 'Assistant offline source', config: { network: { hidden: [8, 8] } } },
    })
  ).json();
  const predicted = await (
    await page.request.post(`/api/experiments/${created.id}/predict`, { data: { noise: [0, 0, 0] } })
  ).json();
  await page.goto('/?experiment=' + created.id);
  await page.getByLabel('选择历史Trace').selectOption(predicted.trace_id);
  await page.getByRole('button', { name: '数值讲解', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '未配置 DeepSeek' })).toBeVisible();
  await page.getByRole('button', { name: '预览将发送的内容' }).click();
  await expect(page.getByText('完整外发内容', { exact: true })).toBeVisible();
  await expect(page.locator('.explanation-panel pre')).toContainText(predicted.trace_id);
  await expect(page.getByRole('button', { name: '同意发送这些内容' })).toBeDisabled();
  expect(external).toEqual([]);
});

test('Production uses local docs, defensive headers and text-only user labels', async ({ page }) => {
  const hostile = '<img src=x onerror="window.__unsafe=true">';
  const created = await (
    await page.request.post('/api/experiments', {
      data: { label: hostile, config: { network: { hidden: [8, 8] } } },
    })
  ).json();
  await page.goto('http://127.0.0.1:8787/?experiment=' + created.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(hostile);
  expect(await page.evaluate(() => (window as any).__unsafe)).toBeUndefined();
  expect(await page.locator('h1 img').count()).toBe(0);
  const response = await page.request.get('http://127.0.0.1:8787/');
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const calls: string[] = [];
  page.on('request', (r) => calls.push(r.url()));
  await page.goto('http://127.0.0.1:8787/docs');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PolicyGlass 本地 API');
  expect(calls.every((url) => new URL(url).hostname === '127.0.0.1')).toBeTruthy();
  const denied = await page.request.post('http://127.0.0.1:8787/api/experiments', {
    headers: { Origin: 'https://untrusted.invalid' },
    data: {},
  });
  expect(denied.status()).toBe(403);
});

test('All registered research results stay visible and selected trained state imports without learning', async ({
  page,
}, testInfo) => {
  const source = await (await page.request.get('/api/studies/reference')).json();
  expect(source.rows).toHaveLength(20);
  await testInfo.attach('actual-study-availability', {
    body: JSON.stringify(source),
    contentType: 'application/json',
  });
  if (process.env.POLICYGLASS_REQUIRE_STUDY === '1')
    expect(source.rows.every((row) => row.available && row.status === 'completed')).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '真实训练研究 · 全部种子' })).toBeVisible();
  const selected = source.rows.find((r) => r.condition === 'ppo_reference' && r.seed === 11);
  if (!selected.available) {
    await expect(
      page.getByRole('button', { name: '导入 ppo_reference seed 11', exact: true }),
    ).toBeDisabled();
    return; // Availability is checked explicitly; missing data is never a successful trained-policy claim.
  }
  await expect(page.getByText('登记 20 条', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '导入 ppo_reference seed 11', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('登记研究 · ppo_reference · seed 11');
  const id = new URL(page.url()).searchParams.get('experiment');
  const detail = await (await page.request.get('/api/experiments/' + id)).json();
  expect(detail.env_steps).toBe(selected.metrics.env_steps);
  expect(detail.updates).toBe(selected.metrics.updates);
  expect(detail.intervention.checkpoint_sha256).toBe(selected.checkpoint_sha256);
  await page.getByRole('button', { name: '前向实验', exact: true }).click();
  await page.getByRole('button', { name: '只运行前向' }).click();
  await expect(page.getByText('实时前向 · 不更新', { exact: false }).first()).toBeVisible();
  const after = await (await page.request.get('/api/experiments/' + id)).json();
  expect(after.updates).toBe(selected.metrics.updates);
  expect(after.env_steps).toBe(selected.metrics.env_steps);
});
