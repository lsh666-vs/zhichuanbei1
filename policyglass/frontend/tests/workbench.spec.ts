import { test, expect, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const evidence = '../.runtime/e2e';
async function create(page: Page, algorithm = 'ppo', name = 'E2E PPO real flow') {
  await page.getByRole('button', { name: '新建实验', exact: true }).click();
  await page.getByLabel('实验名称', { exact: true }).fill(name);
  await page.getByLabel('算法', { exact: true }).selectOption(algorithm);
  await page.getByLabel('隐藏层宽度', { exact: true }).fill('8,8');
  if (algorithm === 'ppo') {
    await page.getByLabel('rollout / minibatch', { exact: true }).fill('4');
    await page.getByLabel('PPO epochs', { exact: true }).fill('2');
  } else await page.getByLabel('warmup 交互步', { exact: true }).fill('4');
  await page.getByRole('button', { name: '创建实验', exact: false }).last().click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return new URL(page.url()).searchParams.get('experiment')!;
}
async function train(page: Page) {
  await page.getByRole('button', { name: /启动计算|继续计算/ }).click();
  await expect(page.getByTestId('job-status')).toContainText('completed', { timeout: 60000 });
  await expect(page.locator('.event-list button').first()).toBeVisible();
}
test('PPO actual create → inspect → branch → notes → export → import → deterministic recomputation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mkdir(evidence, { recursive: true });
  await page.goto('/');
  const id = await create(page);
  await train(page);
  const traces = await (await page.request.get(`/api/experiments/${id}/traces`)).json();
  const tid = traces.at(-1).id;
  const idx = await (await page.request.get(`/api/traces/${tid}/index`)).json();
  const fr = await (await page.request.get(`/api/traces/${tid}/frames`)).json();
  expect(fr.frames.length).toBe(4);
  await page.getByLabel('样本回放位置').fill('1');
  await expect(page.locator('.playback code')).toContainText('sample_id ' + fr.sample_ids[1]);
  await expect(page.locator('canvas')).toBeVisible();
  await page.screenshot({ path: evidence + '/01-arm.png', fullPage: true });
  await page.getByRole('tab', { name: '计算网络' }).click();
  await page.getByLabel(/展开全部单元/).check();
  const li = idx.events.findIndex((e) => e.kind === 'layer' && e.label === 'actor/layer0');
  await page.locator('.event-list button').nth(li).click();
  await expect(page.locator('.inspector h3')).toHaveText('actor/layer0');
  const event = await (await page.request.get(`/api/traces/${tid}/events/${li}`)).json();
  await expect(page.locator('.inspector')).toContainText(event.output[1][0].toFixed(5));
  await page.getByLabel('回看该次更新已完成的反传结果').check();
  await expect(page.locator('.inspector')).toContainText('总 dL/dz');
  await page.screenshot({ path: evidence + '/02-network.png', fullPage: true });
  await page.getByRole('tab', { name: '局部损失' }).click();
  await page.getByLabel('网格分辨率', { exact: true }).fill('5');
  await page.getByRole('button', { name: '计算真实切片' }).click();
  await expect(page.getByTestId('value-loss')).toBeVisible();
  const grid = await (
    await page.request.post(`/api/experiments/${id}/loss-slice`, {
      data: {
        checkpoint: idx.origin_checkpoint,
        path_x: 'actor/biases.2',
        path_y: 'actor/biases.2',
        index_x: [0],
        index_y: [1],
        extent: 0.1,
        resolution: 5,
      },
    })
  ).json();
  const displayed = Number(await page.getByTestId('value-loss').textContent());
  expect(Math.abs(displayed - grid.loss[2][2])).toBeLessThanOrEqual(
    Math.max(1e-20, Math.abs(grid.loss[2][2]) * 1e-4),
  );
  await page.screenshot({ path: evidence + '/03-loss.png', fullPage: true });
  await page.getByRole('button', { name: '受控分支', exact: true }).click();
  await page.getByLabel('干预路径').fill('ppo.learning_rate');
  await page.getByRole('button', { name: '创建受控分支' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ppo.learning_rate');
  const child = new URL(page.url()).searchParams.get('experiment')!;
  await page.getByLabel('计算模式').selectOption('fixed_batch');
  await train(page);
  const childTraces = await (await page.request.get(`/api/experiments/${child}/traces`)).json();
  const childTrace = await (await page.request.get(`/api/traces/${childTraces.at(-1).id}/index`)).json();
  const opi = childTrace.events.findIndex((e) => e.kind === 'optimizer' && e.label === 'actor');
  const expected = await (
    await page.request.get(`/api/traces/${childTraces.at(-1).id}/events/${opi}`)
  ).json();
  await page.getByRole('button', { name: '引用与笔记', exact: true }).click();
  await page
    .getByLabel('实验笔记', { exact: true })
    .fill('Real E2E: fixed-batch branch; actual origin ' + childTrace.origin_checkpoint);
  await page.getByRole('button', { name: '保存引用笔记' }).click();
  await expect(page.locator('.note')).toContainText('Real E2E');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const file = await downloaded;
  const saved = evidence + '/actual-export.pgwork';
  await file.saveAs(saved);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '最近实验' })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(saved);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Imported experiment');
  const imported = new URL(page.url()).searchParams.get('experiment')!;
  await page.getByLabel('计算模式').selectOption('fixed_batch');
  await train(page);
  const newTraces = await (await page.request.get(`/api/experiments/${imported}/traces`)).json();
  const newIdx = await (await page.request.get(`/api/traces/${newTraces.at(-1).id}/index`)).json();
  const oi = newIdx.events.findIndex((e) => e.kind === 'optimizer' && e.label === 'actor');
  const actual = await (await page.request.get(`/api/traces/${newTraces.at(-1).id}/events/${oi}`)).json();
  expect(actual.parameters).toEqual(expected.parameters);
  await page.getByRole('button', { name: '引用与笔记', exact: true }).click();
  await expect(page.locator('.note')).toContainText('Real E2E');
  await page.reload();
  await page.getByRole('button', { name: '引用与笔记', exact: true }).click();
  await expect(page.locator('.note')).toContainText('Real E2E');
  expect(errors).toEqual([]);
});
test('SAC double-Q real grid, actor path and eight complete course controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const id = await create(page, 'sac', 'E2E SAC double Q');
  await train(page);
  await page.getByRole('tab', { name: '双 Q 曲面' }).click();
  await page.getByLabel('网格分辨率', { exact: true }).fill('5');
  await page.getByRole('button', { name: '计算真实切片' }).click();
  await expect(page.getByTestId('value-q1')).toBeVisible();
  await page.getByLabel('网格 i', { exact: true }).fill('1');
  await page.getByLabel('网格 j', { exact: true }).fill('3');
  const traces = await (await page.request.get(`/api/experiments/${id}/traces`)).json();
  const idx = await (await page.request.get(`/api/traces/${traces.at(-1).id}/index`)).json();
  const frames = await (await page.request.get(`/api/traces/${traces.at(-1).id}/frames`)).json();
  const f = frames.frames[0].before;
  const obs = [
    ...f.qpos_rad.map(Math.sin),
    ...f.qpos_rad.map(Math.cos),
    ...f.qvel_rad_s,
    ...f.tip_m,
    ...f.target_m,
  ];
  const grid = await (
    await page.request.post(`/api/experiments/${id}/q-slice`, {
      data: {
        checkpoint: idx.origin_checkpoint,
        observation: obs,
        axes: [0, 1],
        fixed_action: [0, 0, 0],
        resolution: 5,
      },
    })
  ).json();
  await expect(page.getByTestId('value-q1')).toHaveText(grid.q1[1][3].toFixed(5));
  await expect(page.getByTestId('value-minimum')).toHaveText(
    Math.min(grid.q1[1][3], grid.q2[1][3]).toFixed(5),
  );
  await page.screenshot({ path: evidence + '/04-q.png', fullPage: true });
  await page.getByRole('tab', { name: '计算网络' }).click();
  const e = idx.events.findIndex((e) => e.label === 'q1_actor_path/layer0');
  await page.locator('.event-list button').nth(e).click();
  await expect(page.locator('.inspector h3')).toHaveText('q1_actor_path/layer0');
  await page.getByLabel('回看该次更新已完成的反传结果').check();
  await page.getByRole('button', { name: '机制课程', exact: true }).last().click();
  for (let i = 0; i < 8; i++) {
    await page.locator('.course-picker button').nth(i).click();
    await expect(page.getByLabel('课程预测')).toBeVisible();
    await expect(page.getByLabel('课程解释')).toBeVisible();
    await expect(page.getByRole('button', { name: '引用当前事件并保存课程记录' })).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: evidence + '/05-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('Real task pause, reload, resume, cancel and corrupt import errors', async ({ page }) => {
  await page.goto('/');
  const id = await create(page, 'ppo', 'E2E task lifecycle');
  await page.getByLabel('训练迭代预算').fill('100');
  await page.getByRole('button', { name: /启动计算|继续计算/ }).click();
  await page.getByRole('button', { name: '暂停任务', exact: true }).click();
  await expect(page.getByTestId('job-status')).toContainText('paused', { timeout: 60000 });
  await page.reload();
  await expect(page.getByTestId('job-status')).toContainText('paused');
  await page.getByRole('button', { name: '恢复任务', exact: true }).click();
  await page.getByRole('button', { name: '取消任务', exact: true }).click();
  await expect(page.getByTestId('job-status')).toContainText('cancelled', { timeout: 60000 });
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'corrupt.pgz',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not a checkpoint'),
    });
  await expect(page.getByRole('alert')).toContainText('操作未完成');
  const exp = await (await page.request.get(`/api/experiments/${id}`)).json();
  expect(exp.checkpoint).toMatch(/^[a-f0-9]{32}$/);
});

test('Saved forward events and actual physical reset keep sources explicit', async ({ page }) => {
  await page.goto('/');
  const id = await create(page, 'ppo', 'E2E forward and physics');
  await page.getByRole('button', { name: '前向实验', exact: true }).click();
  await page.getByRole('button', { name: '只运行前向' }).click();
  await expect(page.locator('.tool-content')).toContainText('无参数更新');
  let exp = await (await page.request.get(`/api/experiments/${id}`)).json();
  expect(exp.updates).toBe(0);
  const cp = exp.checkpoint;
  const traceRows = await (await page.request.get(`/api/experiments/${id}/traces`)).json();
  expect(traceRows.length).toBe(1);
  await page.reload();
  await expect(page.locator('.source-metric')).toContainText('历史前向记录');
  await expect(page.locator('.inspector .small')).toContainText('未执行反传');
  await page.getByRole('tab', { name: '物理实验' }).click();
  await page.getByRole('button', { name: '视图控制', exact: true }).click();
  await page.getByLabel('更改质量/阻尼并显式重置环境（清除旧批次）').check();
  await page.getByLabel('质量倍率', { exact: true }).fill('2');
  await page.getByLabel('实际仿真控制步', { exact: true }).fill('0');
  await page.getByRole('button', { name: '记录并计算干预' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('物理干预');
  const child = new URL(page.url()).searchParams.get('experiment');
  exp = await (await page.request.get(`/api/experiments/${child}`)).json();
  expect(exp.geometry.masses_kg).toEqual([0.4, 1.6, 1]);
  expect(exp.physics.time_s).toBe(0);
  expect(exp.has_batch).toBe(false);
  const parent = await (await page.request.get(`/api/experiments/${id}`)).json();
  expect(parent.checkpoint).toBe(cp);
});

test('Actual SAC detach course and five-seed replay protocol execute through UI', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  await create(page, 'sac', 'E2E actual course protocol');
  await train(page);
  await page.getByRole('button', { name: '机制课程', exact: true }).last().click();
  await page.locator('.course-picker button').nth(4).click();
  await page.getByRole('button', { name: '固定批次比较冻结参数 / detach Q' }).click();
  await expect(page.locator('.tool-content')).toContainText('两次使用同批次');
  await page.locator('.course-picker button').nth(6).click();
  await page.getByLabel('每个实验 train 迭代数', { exact: true }).fill('1');
  const done = page.waitForEvent('download');
  await page.getByRole('button', { name: '登记并依次运行 10 个实验' }).click();
  const artifact = await done;
  await artifact.saveAs(evidence + '/actual-five-seed-study.json');
  await expect(page.locator('.tool-content table tbody tr')).toHaveCount(10);
  await expect(page.locator('.tool-content table tbody')).not.toContainText('failed');
  await expect(page.locator('.tool-content')).toContainText('有效 5/5');
});

test('Production workbench serves local assets without CDN dependencies', async ({ page }) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:8787')) external.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:8787/');
  await expect(page.getByRole('heading', { name: '最近实验' })).toBeVisible();
  await expect(page.locator('.connection')).toContainText('已连接');
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
