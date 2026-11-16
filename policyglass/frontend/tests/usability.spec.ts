import { test, expect, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const evidence = '../.runtime/two-chat-76425c0/round2-verification';
test.use({ actionTimeout: 15000 });
async function api(page: Page, path: string, data?: any) {
  const r =
    data === undefined
      ? await page.request.get('/api' + path)
      : await page.request.post('/api' + path, { data });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function create(page: Page, label: string) {
  await page.goto('/?diagnostics=1');
  await page.getByRole('button', { name: '新建实验', exact: true }).click();
  await page.getByLabel('实验名称', { exact: true }).fill(label);
  await page.getByLabel('隐藏层宽度', { exact: true }).fill('8,8');
  await page.getByLabel('rollout / minibatch', { exact: true }).fill('4');
  await page.getByLabel('PPO epochs', { exact: true }).fill('1');
  await page
    .getByRole('button', { name: /创建实验/ })
    .last()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
  return new URL(page.url()).searchParams.get('experiment')!;
}
async function inViewport(page: Page, locator: any) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  return rect;
}
async function settledNetwork(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const probe = (window as any).__policyglassNetworkPick;
        const canvas = document.querySelector('[data-testid="scene-network"] canvas') as HTMLCanvasElement;
        return (
          !!probe &&
          Math.abs(probe.width - canvas.clientWidth) < 1 &&
          Math.abs(probe.height - canvas.clientHeight) < 1
        );
      }),
    )
    .toBeTruthy();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
]) {
  const size = viewport.width + 'x' + viewport.height;
  test('First-screen real forward and update to inspection ' + size, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize(viewport);
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const id = await create(page, '首屏真实计算 ' + size);
    const initial = await api(page, '/experiments/' + id);
    expect(initial.updates).toBe(0);
    expect(initial.env_steps).toBe(0);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const first = await inViewport(page, page.getByTestId('first-forward'));
    const update = await inViewport(page, page.getByTestId('first-update'));
    await expect(page.getByTestId('compute-state')).toContainText('待运行');
    await page.screenshot({ path: `${evidence}/01-entry-${size}.png` });
    await page.getByRole('button', { name: '前向传播', exact: true }).click();
    await expect(page.getByTestId('phase-guide')).toContainText('前向尚未计算');
    await expect(page.locator('.alert').filter({ hasText: '请先运行' })).toHaveCount(0);

    // The computation and result are real; only delay delivery to observe the running UI.
    let held = false,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/experiments/*/predict', async (route) => {
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response });
    });
    if (viewport.height === 720) {
      await page.getByTestId('first-forward').focus();
      await page.keyboard.press('Enter');
    } else await page.getByTestId('first-forward').click();
    await expect.poll(() => held).toBeTruthy();
    await expect(page.getByTestId('compute-state')).toContainText('前向计算中');
    await expect(page.getByTestId('first-update')).toBeDisabled();
    await page.screenshot({ path: `${evidence}/02-running-${size}.png` });
    release();
    await expect(page.getByTestId('inspect-computed')).toBeEnabled();
    await page.unroute('**/api/experiments/*/predict');
    const afterForward = await api(page, '/experiments/' + id);
    expect(afterForward.updates).toBe(initial.updates);
    expect(afterForward.env_steps).toBe(initial.env_steps);
    await page.getByTestId('inspect-computed').click();
    await expect(page.locator('.inspector h3')).toHaveText('actor/layer0');
    await page.getByRole('button', { name: '梯度反传', exact: true }).click();
    await expect(page.getByTestId('phase-guide')).toContainText('仅前向记录不含');
    // Advanced settings remain explicit and share the same state used to submit.
    await page.getByText('预算与计算模式', { exact: true }).click();
    await expect(page.getByLabel('计算模式')).toBeVisible();
    await expect(page.getByLabel('训练迭代预算')).toHaveValue('1');
    await page.getByText('预算与计算模式', { exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await inViewport(page, page.getByTestId('first-update'));
    if (viewport.height === 900) {
      await page.getByTestId('first-update').focus();
      await page.keyboard.press('Enter');
    } else await page.getByTestId('first-update').click();
    await expect(page.getByTestId('job-status')).toContainText('completed', { timeout: 60000 });
    await expect(page.getByTestId('compute-state')).toContainText('真实更新可检查');
    const afterUpdate = await api(page, '/experiments/' + id);
    expect(afterUpdate.env_steps).toBe(4);
    expect(afterUpdate.updates).toBe(1);
    await page.getByTestId('inspect-computed').click();
    await expect(page.locator('.inspector .tags')).toContainText('optimizer');
    await page.getByRole('button', { name: '专注网络检查', exact: true }).click();
    await settledNetwork(page);
    await expect(page.locator('.network-equation')).toContainText('dL/dz');
    await expect(page.locator('.network-equation > span').filter({ hasText: 'dL/dz' })).not.toContainText(
      '未计算',
    );
    await inViewport(page, page.getByRole('button', { name: '修改此偏置…', exact: true }));
    await page.screenshot({ path: `${evidence}/08-focused-gradient-${size}.png` });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${evidence}/03-ready-${size}.png` });
    expect(errors).toEqual([]);
    await writeFile(
      `${evidence}/control-${size}.json`,
      JSON.stringify(
        {
          id,
          first,
          update,
          initial: { updates: initial.updates, env: initial.env_steps },
          afterForward: { updates: afterForward.updates, env: afterForward.env_steps },
          afterUpdate: { updates: afterUpdate.updates, env: afterUpdate.env_steps },
          errors,
        },
        null,
        2,
      ),
    );
  });

  test('Focused complete network, actual picking and path navigation ' + size, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const experiment = await api(page, '/experiments', { label: '专注64网络 ' + size, config: {} });
    await page.goto('/?diagnostics=1&experiment=' + experiment.id);
    await page.getByTestId('first-forward').click();
    await expect(page.getByTestId('inspect-computed')).toBeEnabled();
    const traceRows = await api(page, `/experiments/${experiment.id}/traces`);
    const trace = await api(page, '/traces/' + traceRows.at(-1).id);
    const layer = trace.events.find((e: any) => e.label === 'actor/layer1');
    let numericalPosts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/(predict|jobs|branches|slice-jobs)$/.test(r.url())) numericalPosts++;
    });
    const entry = page.getByRole('button', { name: '专注网络检查', exact: true });
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.network-explorer')).toHaveAttribute('data-focused', 'true');
    await settledNetwork(page);
    await inViewport(page, page.getByTestId('scene-network'));
    await inViewport(page, page.getByTestId('network-readout'));
    await inViewport(page, page.getByRole('button', { name: '修改此权重…', exact: true }));
    await expect(page.getByTestId('network-summary')).toHaveAttribute('data-neurons', '149');
    await expect(page.getByTestId('network-summary')).toHaveAttribute('data-weights', '5440');
    await expect
      .poll(() => page.evaluate(() => (window as any).__policyglassNetworkPick?.nodes?.length))
      .toBe(64);
    const point = await page.evaluate(() => (window as any).__policyglassNetworkPick.nodes[7]);
    const box = (await page.getByTestId('scene-network').locator('canvas').boundingBox())!;
    await page.mouse.click(box.x + point.x, box.y + point.y);
    await expect(page.getByLabel('图中检查单元')).toHaveValue('7');
    await page.getByLabel('图中检查层').selectOption('1');
    await page.getByLabel('图中检查单元').fill('63');
    await page.getByLabel('图中检查输入').fill('63');
    await expect(page.getByTestId('network-output')).toHaveText(layer.output[0][63].toFixed(5));
    const shown = Number(await page.getByTestId('network-weight').textContent());
    expect(shown).toBeCloseTo(layer.weight[63][63], 5);
    await page.getByRole('button', { name: '聚焦所选路径', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).__policyglassNetworkPick?.mode)).toBe('path');
    await settledNetwork(page);
    const projection = await page.evaluate(() => (window as any).__policyglassNetworkPick);
    for (const p of [...projection.sourceNodes, projection.selectedTarget]) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.y).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(box.width);
      expect(p.y).toBeLessThan(box.height);
    }
    await page.screenshot({ path: `${evidence}/04-focused-path-${size}.png` });
    await page.getByRole('button', { name: '返回总览', exact: true }).click();
    await expect(page.getByLabel('图中检查单元')).toHaveValue('63');
    await expect(page.getByLabel('图中检查输入')).toHaveValue('63');
    await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
    await expect(page.locator('.network-explorer')).toHaveAttribute('data-focused', 'false');
    await entry.click();
    await page.getByRole('button', { name: '查看深层张量', exact: true }).click();
    await expect(page.getByRole('complementary', { name: '深层张量检查' })).toBeFocused();
    await entry.click();
    await page.getByRole('button', { name: '修改此权重…', exact: true }).click();
    await expect(page.getByLabel('干预路径')).toHaveValue('actor/weights.1');
    await expect(page.getByLabel('干预索引')).toHaveValue('63,63');
    expect(numericalPosts).toBe(0);
    const after = await api(page, '/experiments/' + experiment.id);
    expect(after.updates).toBe(0);
    expect(after.env_steps).toBe(0);
    expect(errors).toEqual([]);
    await writeFile(
      `${evidence}/focus-${size}.json`,
      JSON.stringify(
        {
          experiment: experiment.id,
          projection,
          selectedWeight: shown,
          actualWeight: layer.weight[63][63],
          numericalPosts,
          errors,
        },
        null,
        2,
      ),
    );
  });
}

test('SAC full overview retains every model and focus changes no computation', async ({ page }) => {
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const experiment = await api(page, '/experiments', {
    label: 'SAC完整模型专注总览',
    config: { algorithm: 'sac' },
  });
  await page.goto('/?diagnostics=1&experiment=' + experiment.id);
  await page.getByRole('tab', { name: '计算网络' }).click();
  await page.getByLabel('可视网络').selectOption('all');
  await page.getByRole('button', { name: '专注网络检查', exact: true }).click();
  await expect(page.getByTestId('network-summary')).toHaveAttribute('data-neurons', '737');
  await expect(page.getByTestId('network-summary')).toHaveAttribute('data-weights', '26688');
  await expect(page.locator('.network-models button')).toHaveCount(5);
  await settledNetwork(page);
  await page.screenshot({ path: evidence + '/05-sac-complete-overview.png' });
  await page.locator('.network-models button').filter({ hasText: 'Q₂' }).first().click();
  await expect(page.getByTestId('network-readout')).toContainText('q2 /');
  await expect(page.getByTestId('network-output')).toHaveText('未计算');
  await page.getByRole('button', { name: '聚焦所选路径', exact: true }).click();
  await settledNetwork(page);
  await page.screenshot({ path: evidence + '/06-sac-selected-path.png' });
  await page.getByRole('button', { name: '返回总览', exact: true }).click();
  await expect(page.getByTestId('network-summary')).toHaveAttribute('data-neurons', '737');
  expect((await api(page, '/experiments/' + experiment.id)).updates).toBe(0);
  expect((await api(page, '/experiments/' + experiment.id)).env_steps).toBe(0);
  expect(await api(page, `/experiments/${experiment.id}/traces`)).toHaveLength(0);
});

test('Real missing-batch task fails visibly and can retry with the train mode', async ({ page }) => {
  test.setTimeout(90000);
  const id = await create(page, '真实失败与重试');
  await page.getByText('预算与计算模式', { exact: true }).click();
  await page.getByLabel('计算模式').selectOption('fixed_batch');
  await page.getByTestId('first-update').click();
  await expect(page.getByTestId('job-status')).toContainText('failed', { timeout: 60000 });
  await expect(page.getByTestId('compute-state')).toContainText('失败，可重试');
  await expect(page.getByTestId('first-update')).toBeEnabled();
  await page.screenshot({ path: evidence + '/07-real-failure-retry.png' });
  await page.getByLabel('计算模式').selectOption('train');
  await page.getByTestId('first-update').click();
  await expect(page.getByTestId('job-status')).toContainText('completed', { timeout: 60000 });
  expect((await api(page, '/experiments/' + id)).updates).toBe(1);
});
