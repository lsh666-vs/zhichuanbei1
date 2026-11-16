import { test, expect, Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const evidence = '../.runtime/two-chat-76425c0/verification';
test.use({ actionTimeout: 15000 });
async function api(page: Page, path: string, data?: any) {
  const response =
    data === undefined
      ? await page.request.get('/api' + path)
      : await page.request.post('/api' + path, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function fixture(page: Page) {
  await mkdir(evidence, { recursive: true });
  const experiment = await api(page, '/experiments', {
    label: '第一轮真实 SAC 来源验证',
    config: {
      algorithm: 'sac',
      seed: 17,
      network: { hidden: [8, 8] },
      sac: { warmup_steps: 4, batch_size: 4 },
    },
  });
  const job = await api(page, `/experiments/${experiment.id}/jobs`, {
    iterations: 1,
    record: true,
    mode: 'train',
  });
  await expect.poll(async () => (await api(page, '/jobs/' + job.id)).status).toBe('completed');
  const traces = await api(page, `/experiments/${experiment.id}/traces`);
  const trace = { ...(await api(page, '/traces/' + traces.at(-1).id)), id: traces.at(-1).id };
  const origin = await api(
    page,
    `/experiments/${experiment.id}/parameters?checkpoint=${trace.origin_checkpoint}`,
  );
  const output = await api(
    page,
    `/experiments/${experiment.id}/parameters?checkpoint=${trace.output_checkpoint}`,
  );
  return { experiment, trace, origin, output };
}
async function enter(page: Page, id: string, tab = '计算网络') {
  await page.goto('/?experiment=' + id);
  await page.getByRole('tab', { name: tab }).click();
}
async function exported(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出真实网格' }).click();
  const result = await download;
  return JSON.parse(await readFile((await result.path())!, 'utf8'));
}

test('Network edits bind origin/output, W, forward and SAC post-critic to complete parent states', async ({
  page,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { experiment, trace, origin, output } = await fixture(page);
  const log: any = { experiment: experiment.id, trace: trace.id, cases: [] };
  expect(origin.actor['biases.2'][0]).not.toBe(output.actor['biases.2'][0]);
  for (const [cp, parameters] of [
    [trace.origin_checkpoint, origin],
    [trace.output_checkpoint, output],
  ] as const) {
    await enter(page, experiment.id);
    await page.getByLabel('图中检查层').selectOption('2');
    await expect(page.getByTestId('network-output')).not.toHaveText('未计算');
    await page.getByLabel('来源检查点').selectOption(cp);
    await page.getByRole('button', { name: '修改此偏置…', exact: true }).click();
    await expect(page.getByLabel('新的绝对值', { exact: true })).toHaveValue(
      String(parameters.actor['biases.2'][0]),
    );
    await expect(page.getByTestId('branch-original')).toHaveText(String(parameters.actor['biases.2'][0]));
    await expect(page.getByTestId('branch-provenance')).toContainText(cp);
    await expect(page.getByTestId('network-output')).toHaveText('未计算');
    if (cp === trace.output_checkpoint)
      await page.screenshot({ path: evidence + '/01-complete-parent-edit.png', fullPage: true });
    await page.getByRole('button', { name: '创建受控分支', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('experiment') !== experiment.id);
    const childId = new URL(page.url()).searchParams.get('experiment');
    const child = await api(page, '/experiments/' + childId);
    const childParameters = await api(
      page,
      `/experiments/${childId}/parameters?checkpoint=${child.checkpoint}`,
    );
    expect(child.parent_checkpoint).toBe(cp);
    expect(childParameters).toEqual(parameters);
    log.cases.push({ cp, value: parameters.actor['biases.2'][0], child: childId, unchanged: true });
  }
  await enter(page, experiment.id);
  await page.getByLabel('来源检查点').selectOption(trace.output_checkpoint);
  await page.getByRole('button', { name: '修改此权重…', exact: true }).click();
  await expect(page.getByTestId('branch-original')).toHaveText(String(output.actor['weights.0'][0][0]));
  await page.getByLabel('来源检查点').selectOption(trace.origin_checkpoint);
  await expect(page.getByTestId('branch-provenance')).toContainText('交接已失效');
  await expect(page.getByRole('button', { name: '创建受控分支', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '修改此权重…', exact: true }).click();
  await expect(page.getByTestId('branch-original')).toHaveText(String(origin.actor['weights.0'][0][0]));
  await expect(page.getByRole('button', { name: '创建受控分支', exact: true })).toBeEnabled();
  log.cases.push({ case: 'W and source invalidation', passed: true });

  await enter(page, experiment.id);
  const post = page.locator('.event-list button').filter({ hasText: 'q1_actor_path/layer0' });
  await post.click();
  await expect(page.getByTestId('parameter-source-warning')).toContainText('没有可直接分支的完整检查点');
  await page.getByRole('button', { name: '修改此权重…', exact: true }).click();
  await expect(page.getByLabel('干预路径')).toHaveValue('q1/weights.0');
  await expect(page.getByTestId('branch-original')).toHaveText(String(origin.q1['weights.0'][0][0]));
  await expect(page.getByTestId('network-output')).toHaveText('未计算');
  await expect(page.getByTestId('branch-provenance')).toContainText('q1_actor_path/layer0');
  await page.screenshot({ path: evidence + '/02-post-critic-complete-state.png', fullPage: true });
  log.cases.push({
    case: 'post-critic',
    actualEvent: trace.events.find((e: any) => e.label === 'q1_actor_path/layer0').weight[0][0],
    parent: origin.q1['weights.0'][0][0],
  });
  await page.getByRole('button', { name: '创建受控分支', exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get('experiment') !== experiment.id);
  const postChildId = new URL(page.url()).searchParams.get('experiment');
  const postChild = await api(page, '/experiments/' + postChildId);
  expect(postChild.parent_checkpoint).toBe(trace.origin_checkpoint);
  expect(
    await api(page, `/experiments/${postChildId}/parameters?checkpoint=${postChild.checkpoint}`),
  ).toEqual(origin);

  await enter(page, experiment.id);
  await page.getByLabel('来源检查点').selectOption(trace.output_checkpoint);
  await page.getByRole('button', { name: '计算 Actor 前向', exact: true }).click();
  await expect(page.getByTestId('network-output')).not.toHaveText('未计算');
  await page.getByRole('button', { name: '修改此权重…', exact: true }).click();
  await expect(page.getByTestId('branch-original')).toHaveText(String(output.actor['weights.0'][0][0]));
  await expect(page.getByTestId('branch-provenance')).toContainText(trace.output_checkpoint);
  const unchangedOrigin = await api(
    page,
    `/experiments/${experiment.id}/parameters?checkpoint=${trace.origin_checkpoint}`,
  );
  const unchangedOutput = await api(
    page,
    `/experiments/${experiment.id}/parameters?checkpoint=${trace.output_checkpoint}`,
  );
  expect(unchangedOrigin).toEqual(origin);
  expect(unchangedOutput).toEqual(output);
  expect((await api(page, '/experiments/' + experiment.id)).updates).toBe(1);
  expect(errors).toEqual([]);
  log.cases.push({ case: 'forward', passed: true });
  await writeFile(evidence + '/network-results.json', JSON.stringify(log, null, 2));
});

test('Surface request identity covers drafts, real grids, exports and delayed real responses', async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { experiment } = await fixture(page);
  const requests: any[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/slice-jobs')) requests.push(r.postDataJSON());
  });
  await enter(page, experiment.id, '双 Q 曲面');
  await expect(page.getByTestId('value-q1')).toBeVisible();
  const first = await exported(page);
  expect(first.axes).toEqual([0, 1]);
  expect(requests).toHaveLength(1);
  await page.getByLabel('网格 i', { exact: true }).fill('4');
  await page.getByLabel('网格 j', { exact: true }).fill('10');
  const oldValue = Number(await page.getByTestId('value-q1').textContent());
  await page.getByLabel('动作轴 x', { exact: true }).selectOption('2');
  await expect(page.getByTestId('surface-stale')).toBeVisible();
  await expect(page.getByTestId('value-q1')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导出真实网格' })).toHaveCount(0);
  expect(requests).toHaveLength(1);
  await page.screenshot({ path: evidence + '/03-q-draft-pending.png', fullPage: true });
  await page.getByRole('button', { name: '计算真实切片', exact: true }).click();
  await expect(page.getByTestId('value-q1')).toBeVisible();
  await expect(page.getByTestId('surface-provenance')).toContainText('动作 a[2] · Nm');
  const second = await exported(page);
  const direct = await api(page, `/experiments/${experiment.id}/q-slice`, second.request.body);
  expect(second.axes).toEqual([2, 1]);
  expect(second.q1).toEqual(direct.q1);
  expect(second.request.body.fixed_action).toEqual(second.fixed_action);
  await page.getByLabel('网格 i', { exact: true }).fill('4');
  await page.getByLabel('网格 j', { exact: true }).fill('10');
  expect(Number(await page.getByTestId('value-q1').textContent())).toBeCloseTo(direct.q1[4][10], 5);
  expect(direct.q1[4][10]).not.toBeCloseTo(oldValue, 3);
  const count = requests.length;
  await page.getByLabel('显示', { exact: true }).selectOption('minimum');
  await page.waitForTimeout(350);
  expect(requests).toHaveLength(count);
  await page.getByLabel('未绘动作维固定值 Nm（所选两维由网格覆盖） 0', { exact: true }).fill('0.5');
  await expect(page.getByTestId('surface-stale')).toBeVisible();
  await page.getByRole('button', { name: '计算真实切片', exact: true }).click();
  await expect(page.getByTestId('value-q1')).toBeVisible();
  await expect(page.getByTestId('surface-provenance')).toContainText('a[0]=0.5 Nm');
  await page.screenshot({ path: evidence + '/04-q-computed-identity.png', fullPage: true });

  // Delay the delivery of an actual completed server response, without fabricating
  // the request, numerical result or status; then edit while it is in flight.
  let held = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/slice-jobs/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (body.status === 'completed' && !held) {
      held = true;
      await gate;
    }
    await route.fulfill({ response });
  });
  await page.getByLabel('网格分辨率', { exact: true }).fill('13');
  await page.getByRole('button', { name: '计算真实切片', exact: true }).click();
  await expect.poll(() => held).toBeTruthy();
  await page.getByLabel('动作轴 x', { exact: true }).selectOption('0');
  release();
  await expect(page.getByRole('button', { name: '计算真实切片', exact: true })).toBeEnabled();
  await expect(page.getByTestId('surface-stale')).toBeVisible();
  await expect(page.getByTestId('value-q1')).toHaveCount(0);
  await page.unroute('**/api/slice-jobs/*');
  await page.getByRole('button', { name: '计算真实切片', exact: true }).click();
  await expect(page.getByTestId('value-q1')).toBeVisible();
  const raced = await exported(page);
  expect(raced.axes).toEqual([0, 1]);
  expect(raced.x).toHaveLength(13);

  await page.getByRole('tab', { name: '局部损失' }).click();
  await expect(page.getByTestId('value-loss')).toBeVisible();
  const edits: [string, string][] = [
    ['x 参数', 'actor/weights.2'],
    ['x 坐标', '0,0'],
    ['y 参数', 'actor/biases.1'],
    ['y 坐标', '2'],
    ['参数偏移范围 ±', '0.06'],
    ['网格分辨率', '7'],
  ];
  // Each independent input must immediately invalidate the previous mesh. Revert
  // between checks so this is not just a stale flag inherited from the first edit.
  for (const [label, value] of edits) {
    const input = page.getByLabel(label, { exact: true });
    const previous = await input.inputValue();
    await input.fill(value);
    await expect(page.getByTestId('surface-stale')).toBeVisible();
    await expect(page.getByTestId('value-loss')).toHaveCount(0);
    await input.fill(previous);
    await expect(page.getByTestId('value-loss')).toBeVisible();
  }
  for (const [label, value] of edits) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: '计算真实切片', exact: true }).click();
  await expect(page.getByTestId('value-loss')).toBeVisible();
  const loss = await exported(page);
  const lossDirect = await api(page, `/experiments/${experiment.id}/loss-slice`, loss.request.body);
  expect(loss.loss).toEqual(lossDirect.loss);
  expect(loss.directions.map((d: any) => [d.path, d.index])).toEqual([
    ['actor/weights.2', [0, 0]],
    ['actor/biases.1', [2]],
  ]);
  expect(loss.x).toHaveLength(7);
  expect(loss.request.body.extent).toBe(0.06);
  await expect(page.getByTestId('surface-provenance')).toContainText('actor/weights.2[0,0]');
  await expect(page.getByTestId('surface-provenance')).toContainText('实际 critic 更新后阶段');
  await page.screenshot({ path: evidence + '/05-loss-computed-identity.png', fullPage: true });
  expect(errors).toEqual([]);
  await writeFile(
    evidence + '/surface-results.json',
    JSON.stringify(
      {
        experiment: experiment.id,
        oldValue,
        newValue: direct.q1[4][10],
        requests,
        delayedRealResponseRejected: true,
        first,
        second,
        raced,
        loss,
        errors,
      },
      null,
      2,
    ),
  );
});
