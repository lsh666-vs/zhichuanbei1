import { test, expect, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const evidence = '../.runtime/ui-refinement';
async function create(page: Page, algorithm: string, label: string, small = false) {
  await page.goto('/?diagnostics=1');
  await page.getByRole('button', { name: '新建实验', exact: true }).click();
  await page.getByLabel('实验名称', { exact: true }).fill(label);
  await page.getByLabel('算法', { exact: true }).selectOption(algorithm);
  if (small) await page.getByLabel('隐藏层宽度', { exact: true }).fill('8,8');
  if (algorithm === 'sac') await page.getByLabel('warmup 交互步', { exact: true }).fill('4');
  await page.getByRole('button', { name: '创建实验', exact: false }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
  return new URL(page.url()).searchParams.get('experiment')!;
}

test('Default complete network: actual 3D node picking, W/b, forward and single-bias intervention', async ({
  page,
}) => {
  test.setTimeout(120000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const id = await create(page, 'ppo', '真实完整网络与偏置操作');
  const detail = await (await page.request.get('/api/experiments/' + id)).json();
  const parameters = await (
    await page.request.get('/api/experiments/' + id + '/parameters?checkpoint=' + detail.checkpoint)
  ).json();
  await page.getByRole('tab', { name: '计算网络' }).click();
  await expect(page.getByTestId('network-summary')).toHaveAttribute('data-neurons', '149');
  await expect(page.getByTestId('network-summary')).toHaveAttribute('data-weights', '5440');
  await expect(page.getByTestId('network-summary')).toHaveAttribute('data-biases', '134');
  await expect(page.getByLabel('全部权重连线', { exact: true })).toBeChecked();
  await expect(page.getByTestId('network-weight')).toHaveText(parameters.actor['weights.0'][0][0].toFixed(5));
  await expect(page.getByTestId('network-bias')).toHaveText('0');
  await page.screenshot({ path: evidence + '/02-default-complete-network.png', fullPage: true });
  await expect
    .poll(() => page.evaluate(() => (window as any).__policyglassNetworkPick?.nodes?.length))
    .toBe(64);
  const point = await page.evaluate(() =>
    (window as any).__policyglassNetworkPick.nodes.find((n: any) => n.neuron === 7),
  );
  const box = await page.getByTestId('scene-network').locator('canvas').boundingBox();
  await page.mouse.click(box!.x + point.x, box!.y + point.y);
  await expect(page.getByLabel('图中检查单元')).toHaveValue('7');
  await expect(page.getByTestId('network-weight')).toHaveText(parameters.actor['weights.0'][7][0].toFixed(5));
  await page.getByLabel('图中检查层').selectOption('1');
  await page.getByLabel('图中检查单元').fill('63');
  await page.getByLabel('图中检查输入').fill('63');
  const actual = parameters.actor['weights.1'][63][63];
  await expect(page.getByTestId('network-weight')).toHaveText(
    Math.abs(actual) < 0.001 ? actual.toExponential(4) : actual.toFixed(5),
  );
  await page.getByRole('button', { name: '计算 Actor 前向', exact: true }).click();
  await expect(page.getByTestId('network-output')).not.toHaveText('未计算');
  const traces = await (await page.request.get('/api/experiments/' + id + '/traces')).json();
  const trace = await (await page.request.get('/api/traces/' + traces.at(-1).id)).json();
  const layer = trace.events.find((event: any) => event.label === 'actor/layer0');
  const shown = Number(await page.getByTestId('network-output').textContent());
  expect(Math.abs(shown - layer.output[0][0])).toBeLessThan(0.000006);
  expect((await (await page.request.get('/api/experiments/' + id)).json()).updates).toBe(0);
  await page.locator('.network-explorer').screenshot({ path: evidence + '/03-real-forward-network.png' });
  await page.getByRole('button', { name: '修改此偏置…', exact: true }).click();
  await expect(page.getByLabel('干预路径')).toHaveValue('actor/biases.0');
  await page.getByLabel('新的绝对值', { exact: true }).fill('0.25');
  await page.getByRole('button', { name: '创建受控分支', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('actor/biases.0');
  await expect(page.getByTestId('network-bias')).toHaveText('0.25000');
  const unchanged = await (
    await page.request.get('/api/experiments/' + id + '/parameters?checkpoint=' + detail.checkpoint)
  ).json();
  expect(unchanged).toEqual(parameters);
  expect(errors).toEqual([]);
});

test('Q and loss views compute actual meshes and show actionable prerequisites', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await create(page, 'ppo', 'PPO 曲面前提说明', true);
  await page.getByRole('tab', { name: '双 Q 曲面' }).click();
  await expect(page.locator('.surface-empty')).toContainText('双 Q 属于 SAC');
  await expect(page.getByRole('button', { name: '新建 SAC 查看双 Q' })).toBeVisible();
  const id = await create(page, 'sac', '实际自动双Q与局部损失', true);
  await page.getByRole('tab', { name: '双 Q 曲面' }).click();
  await expect(page.getByTestId('value-q1')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.surface-empty')).toHaveCount(0);
  const detail = await (await page.request.get('/api/experiments/' + id)).json();
  const grid = await (
    await page.request.post('/api/experiments/' + id + '/q-slice', {
      data: {
        checkpoint: detail.checkpoint,
        observation: detail.observation,
        axes: [0, 1],
        fixed_action: [0, 0, 0],
        resolution: 15,
      },
    })
  ).json();
  await expect(page.getByTestId('value-q1')).toHaveText(grid.q1[7][7].toFixed(5));
  await page.screenshot({ path: evidence + '/04-real-q-surface.png', fullPage: true });
  await page.getByRole('tab', { name: '局部损失' }).click();
  await expect(page.locator('.surface-empty')).toContainText('先记录一批真实学习数据');
  await page.getByRole('button', { name: '记录一次真实更新' }).click();
  await expect(page.getByTestId('value-loss')).toBeVisible({ timeout: 60000 });
  expect(Number.isFinite(Number(await page.getByTestId('value-loss').textContent()))).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: evidence + '/05-real-loss-surface.png', fullPage: true });
  expect(errors).toEqual([]);
});
