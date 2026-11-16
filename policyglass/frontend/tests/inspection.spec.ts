import { test, expect, Page } from '@playwright/test';
import * as THREE from 'three';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = '../.runtime/two-chat-76425c0/round3-verification';
let ppoId = '',
  sacId = '';
test.use({ actionTimeout: 15000 });
test.beforeAll(async ({ request }, info) => {
  const initial = await (await request.get('/api/experiments')).json();
  if (process.env.POLICYGLASS_EXPECT_FRESH_STORE === '1') expect(initial).toHaveLength(0);
  for (const algorithm of ['ppo', 'sac']) {
    const created = await request.post('/api/experiments', {
      data: {
        label: '第三轮独立 ' + algorithm,
        config: {
          algorithm,
          seed: 17,
          network: { hidden: [8, 8] },
          ppo: { rollout_steps: 4, minibatch_size: 4, epochs: 1 },
          sac: { warmup_steps: 4, batch_size: 4 },
        },
      },
    });
    expect(created.ok()).toBeTruthy();
    const experiment = await created.json();
    const started = await request.post(`/api/experiments/${experiment.id}/jobs`, {
      data: { iterations: 1, record: true, mode: 'train' },
    });
    expect(started.ok()).toBeTruthy();
    const job = await started.json();
    await expect
      .poll(async () => (await (await request.get('/api/jobs/' + job.id)).json()).status, { timeout: 60000 })
      .toBe('completed');
    if (algorithm === 'ppo') ppoId = experiment.id;
    else sacId = experiment.id;
  }
  await mkdir(root, { recursive: true });
  await writeFile(
    root + '/fixtures.json',
    JSON.stringify(
      { ppoId, sacId, baseURL: info.project.use.baseURL, initialExperimentCount: initial.length },
      null,
      2,
    ),
  );
});
async function api(page: Page, path: string) {
  const r = await page.request.get('/api' + path);
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function trainingTrace(page: Page, id: string) {
  const rows = await api(page, `/experiments/${id}/traces`);
  for (const row of rows) {
    const index = await api(page, `/traces/${row.id}/index`);
    if (index.events.some((e: any) => e.kind === 'optimizer')) return { ...index, id: row.id };
  }
  throw Error('The isolated fixture must retain an actual training Trace');
}
async function visibleInViewport(page: Page, element: any) {
  const b = (await element.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  return b;
}
async function load(page: Page, experiment: string, trace: string) {
  await page.goto('/?diagnostics=1&experiment=' + experiment);
  await page.getByLabel('选择历史Trace').selectOption(trace);
  await expect(page.getByRole('button', { name: '参数更新', exact: true })).toBeEnabled();
}
const keys = ['before', 'raw_gradient', 'gradient', 'delta', 'after'];
async function assertOptimizer(page: Page, event: any, parameter: string, index: number[]) {
  const values: any = {};
  for (const key of keys) {
    const value = index.reduce((p, i) => p[i], event.parameters[parameter][key]);
    await expect(page.getByTestId('optimizer-' + key)).toHaveAttribute('title', String(value));
    values[key] = value;
  }
  await expect(page.locator('.inspector .tags')).toContainText('optimizer');
  await expect(page.locator('.inspector .tags')).toContainText(event.id);
  return values;
}
async function gridExport(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出真实网格', exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
}
async function settleSurface(page: Page) {
  await page.locator('.surface-workspace').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = (window as any).__policyglassCamera;
        const canvas = document.querySelector('.surface-workspace canvas') as HTMLCanvasElement;
        return (
          !!c && Math.abs(c.width - canvas.clientWidth) < 1 && Math.abs(c.height - canvas.clientHeight) < 1
        );
      }),
    )
    .toBeTruthy();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await settleCamera(page);
}
async function settleCamera(page: Page) {
  await expect
    .poll(async () => {
      const before = await page.evaluate(() => (window as any).__policyglassCamera.world);
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => (window as any).__policyglassCamera.world);
      return Math.max(...before.map((v: number, i: number) => Math.abs(v - after[i])));
    })
    .toBeLessThan(1e-8);
}

// Independently construct the actual discrete surface from the server arrays.
// Camera matrices are read-only diagnostics of the live OrbitControls camera.
async function rayModel(page: Page, grid: any, field: string) {
  const c = await page.evaluate(() => (window as any).__policyglassCamera);
  const box = (await page.locator('.surface-workspace canvas').boundingBox())!;
  const camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;
  camera.projectionMatrix.fromArray(c.projection);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.matrixWorld.fromArray(c.world);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const values = grid[field],
    flat = values.flat(),
    lo = Math.min(...flat),
    range = Math.max(Math.max(...flat) - lo, 1e-12);
  const extent = Math.max(...grid.x.map(Math.abs), ...grid.y.map(Math.abs)) || 1;
  const positions: number[] = [],
    ids: number[] = [];
  for (let i = 0; i < grid.x.length; i++)
    for (let j = 0; j < grid.y.length; j++)
      positions.push(grid.x[i] / extent, grid.y[j] / extent, (values[i][j] - lo) / range);
  for (let i = 0; i < grid.x.length - 1; i++)
    for (let j = 0; j < grid.y.length - 1; j++) {
      const a = i * grid.y.length + j;
      ids.push(a, a + grid.y.length, a + 1, a + 1, a + grid.y.length, a + grid.y.length + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(ids);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  const position = geometry.getAttribute('position'),
    ray = new THREE.Raycaster();
  const plan = (face: number, corner: number) => {
    const vi = ids.slice(face * 3, face * 3 + 3),
      vertices = vi.map((i) => new THREE.Vector3().fromBufferAttribute(position, i));
    for (const weight of [0.8, 0.7, 0.6]) {
      const point = new THREE.Vector3();
      vertices.forEach((p, i) => point.addScaledVector(p, i === corner ? weight : (1 - weight) / 2));
      const n = point.clone().project(camera);
      const clientX = Math.round(box.x + ((n.x + 1) * c.width) / 2),
        clientY = Math.round(box.y + ((1 - n.y) * c.height) / 2);
      const px = Math.round(clientX - box.x),
        py = Math.round(clientY - box.y);
      if (px < 4 || px > c.width - 4 || py < 4 || py > c.height - 4) continue;
      ray.setFromCamera(new THREE.Vector2((px / c.width) * 2 - 1, 1 - (py / c.height) * 2), camera);
      const hit = ray.intersectObject(mesh)[0];
      if (!hit || hit.faceIndex !== face) continue;
      const nearest = vi.reduce(
        (best, v) =>
          new THREE.Vector3().fromBufferAttribute(position, v).distanceToSquared(hit.point) <
          new THREE.Vector3().fromBufferAttribute(position, best).distanceToSquared(hit.point)
            ? v
            : best,
        vi[0],
      );
      if (nearest !== vi[corner]) continue;
      return {
        face,
        corner,
        px,
        py,
        clientX,
        clientY,
        vertex: nearest,
        index: [Math.floor(nearest / grid.y.length), nearest % grid.y.length],
      };
    }
  };
  return {
    plan,
    faces: ids.length / 3,
    lo,
    range,
    extent,
    camera: c,
    firstVertices: [0, 1, 15].map((i) => [position.getX(i), position.getY(i), position.getZ(i)]),
    dispose: () => {
      geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
  };
}
async function clickPlan(page: Page, grid: any, field: string, model: any, plan: any) {
  const b = (await page.locator('.surface-workspace canvas').boundingBox())!;
  await page.mouse.click(plan.clientX, plan.clientY);
  await page.waitForTimeout(100);
  await writeFile(
    root + '/last-click-debug.json',
    JSON.stringify(
      {
        plan,
        box: b,
        expected: model.firstVertices,
        diagnostics: await page.evaluate(() => ({
          hit: (window as any).__policyglassSurfaceHit,
          camera: (window as any).__policyglassCamera,
          debug: (window as any).__policyglassSurfaceDebug,
        })),
        element: await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
          x: b.x + plan.px,
          y: b.y + plan.py,
        }),
      },
      null,
      2,
    ),
  );
  const [i, j] = plan.index;
  await expect(page.getByTestId('surface-probe')).toHaveAttribute('data-i', String(i));
  await expect(page.getByTestId('surface-probe')).toHaveAttribute('data-j', String(j));
  const hit = await page.evaluate(() => (window as any).__policyglassSurfaceHit);
  expect(hit.face).toBe(plan.face);
  expect(hit.vertex).toBe(plan.vertex);
  await expect(page.getByLabel('网格 i', { exact: true })).toHaveValue(String(i));
  await expect(page.getByLabel('网格 j', { exact: true })).toHaveValue(String(j));
  await expect(page.getByTestId('probe-' + field)).toHaveAttribute('title', String(grid[field][i][j]));
  await expect(page.getByTestId('probe-x')).toHaveAttribute('title', String(grid.x[i]));
  await expect(page.getByTestId('probe-y')).toHaveAttribute('title', String(grid.y[j]));
  await expect
    .poll(() =>
      page.evaluate((field) => (window as any).__policyglassSurfaceMarkers?.[field]?.index.join(','), field),
    )
    .toBe(i + ',' + j);
  const marker = await page.evaluate((field) => (window as any).__policyglassSurfaceMarkers[field], field);
  expect(marker.position[0]).toBeCloseTo(grid.x[i] / model.extent, 12);
  expect(marker.position[1]).toBeCloseTo(grid.y[j] / model.extent, 12);
  expect(marker.position[2]).toBeCloseTo((grid[field][i][j] - model.lo) / model.range + 0.01, 12);
  return { ...plan, value: grid[field][i][j], marker };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
]) {
  const size = viewport.width + 'x' + viewport.height;
  test('Optimizer matrix, vector and alpha stay in the recorded event ' + size, async ({ page }) => {
    await mkdir(root, { recursive: true });
    await page.setViewportSize(viewport);
    const before = await api(page, '/experiments/' + ppoId),
      paramsBefore = await api(page, `/experiments/${ppoId}/parameters?checkpoint=${before.checkpoint}`);
    const trace = await trainingTrace(page, ppoId),
      ei = trace.events.findIndex((e: any) => e.kind === 'optimizer' && e.label === 'actor');
    const event = await api(page, `/traces/${trace.id}/events/${ei}`);
    await load(page, ppoId, trace.id);
    await page.getByRole('button', { name: '参数更新', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('optimizer-inspection')).toBeVisible();
    const traceSelection = await page.getByLabel('选择历史Trace').inputValue(),
      sample = await page.getByLabel('样本回放位置').inputValue();
    let posts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST') posts++;
    });
    await page.getByLabel('优化器参数', { exact: true }).selectOption('weights.1');
    await page.getByLabel('优化器参数', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('优化器矩阵行')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('优化器矩阵列')).toBeFocused();
    await page.getByLabel('优化器矩阵行').fill('7');
    await page.getByLabel('优化器矩阵列').fill('7');
    const matrix = await assertOptimizer(page, event, 'weights.1', [7, 7]);
    await page.getByTestId('optimizer-inspection').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await visibleInViewport(page, page.locator('.optimizer-step'));
    await page.screenshot({ path: `${root}/01-optimizer-matrix-${size}.png` });
    await page.getByLabel('优化器矩阵行').fill('999');
    await expect(page.getByLabel('优化器矩阵行')).toHaveValue('7');
    await page.getByLabel('优化器矩阵列').fill('-9');
    await expect(page.getByLabel('优化器矩阵列')).toHaveValue('0');
    await page.getByLabel('优化器矩阵列').focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByLabel('优化器矩阵列')).toHaveValue('1');
    await page.getByLabel('优化器参数', { exact: true }).selectOption('biases.1');
    await expect(page.getByLabel('优化器矩阵列')).toHaveCount(0);
    await page.getByLabel('优化器向量索引').fill('999');
    await expect(page.getByLabel('优化器向量索引')).toHaveValue('7');
    const vector = await assertOptimizer(page, event, 'biases.1', [7]);
    await expect(page.getByLabel('选择历史Trace')).toHaveValue(traceSelection);
    await expect(page.getByLabel('样本回放位置')).toHaveValue(sample);
    await page.getByRole('tab', { name: '计算网络' }).click();
    await expect(page.getByLabel('图中检查层')).toHaveValue('1');
    await expect(page.getByLabel('图中检查单元')).toHaveValue('7');
    await expect(page.getByLabel('图中检查输入')).toHaveValue('0');
    expect(posts).toBe(0);
    expect(await api(page, `/experiments/${ppoId}/parameters?checkpoint=${before.checkpoint}`)).toEqual(
      paramsBefore,
    );
    const after = await api(page, '/experiments/' + ppoId);
    expect([after.checkpoint, after.updates, after.env_steps]).toEqual([
      before.checkpoint,
      before.updates,
      before.env_steps,
    ]);
    const sac = await api(page, '/experiments/' + sacId),
      sacTrace = await trainingTrace(page, sacId),
      ai = sacTrace.events.findIndex((e: any) => e.kind === 'optimizer' && e.label === 'alpha');
    const alpha = await api(page, `/traces/${sacTrace.id}/events/${ai}`);
    await load(page, sacId, sacTrace.id);
    await page.locator('.event-list button').nth(ai).click();
    await expect(page.getByTestId('optimizer-path')).toHaveText('alpha/log_alpha · 标量');
    await expect(page.getByTestId('optimizer-inspection').locator('input')).toHaveCount(0);
    const scalar = await assertOptimizer(page, alpha, 'log_alpha', []);
    await page.getByTestId('optimizer-inspection').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${root}/02-optimizer-alpha-${size}.png` });
    const sacAfter = await api(page, '/experiments/' + sacId);
    expect([sacAfter.checkpoint, sacAfter.updates, sacAfter.env_steps]).toEqual([
      sac.checkpoint,
      sac.updates,
      sac.env_steps,
    ]);
    expect(posts).toBe(0);
    await writeFile(
      `${root}/optimizer-${size}.json`,
      JSON.stringify(
        {
          ppo: ppoId,
          trace: trace.id,
          event: event.id,
          matrix,
          vector,
          sac: sacId,
          sacTrace: sacTrace.id,
          alphaEvent: alpha.id,
          scalar,
          posts,
        },
        null,
        2,
      ),
    );
  });

  for (const kind of ['q', 'loss'])
    test('Real ' + kind + ' probe, nearest corners and rotated camera ' + size, async ({ page }) => {
      test.setTimeout(120000);
      await mkdir(root, { recursive: true });
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const before = await api(page, '/experiments/' + sacId);
      const parameters = await api(page, `/experiments/${sacId}/parameters?checkpoint=${before.checkpoint}`);
      await page.goto('/?diagnostics=1&experiment=' + sacId);
      await page.getByRole('tab', { name: kind === 'q' ? '双 Q 曲面' : '局部损失' }).click();
      await expect(page.getByTestId('surface-probe')).toBeVisible({ timeout: 60000 });
      const grid = await gridExport(page);
      await settleSurface(page);
      await visibleInViewport(page, page.getByTestId('scene-' + kind));
      await visibleInViewport(page, page.getByTestId('surface-probe'));
      let numericalPosts = 0;
      page.on('request', (r) => {
        if (r.method() === 'POST' && /\/(slice-jobs|predict|jobs|branches)$/.test(r.url())) numericalPosts++;
      });
      if (kind === 'q') {
        const bothMarker = await page.evaluate(() => (window as any).__policyglassSurfaceMarkers.q2.color);
        await page.getByRole('button', { name: '显示 Q₂', exact: true }).click();
        await expect(page.getByLabel('显示', { exact: true })).toHaveValue('q2');
        await expect
          .poll(() => page.evaluate(() => (window as any).__policyglassSurfaceMarkers.q2.color))
          .toBe(bothMarker);
        expect(bothMarker).toBe('#687dcb');
        await page.screenshot({ path: `${root}/03-q2-stable-${size}.png` });
        await page.getByRole('button', { name: '显示 Q₁', exact: true }).click();
      }
      const field = kind === 'q' ? 'q1' : 'loss';
      await settleSurface(page);
      let model = await rayModel(page, grid, field);
      const results: any[] = [];
      if (kind === 'q') {
        const plan = model.plan(20, 2);
        expect(plan, 'reviewed face20 third corner must remain genuinely visible').toBeTruthy();
        results.push(await clickPlan(page, grid, field, model, plan));
        expect(plan!.index).toEqual([0, 11]);
      }
      let plans: any[] = [];
      for (let f = 0; f < model.faces; f++) {
        const all = [0, 1, 2].map((c) => model.plan(f, c));
        if (all.every(Boolean)) {
          plans = all;
          break;
        }
      }
      expect(plans).toHaveLength(3);
      for (const plan of plans) results.push(await clickPlan(page, grid, field, model, plan));
      let boundary: any;
      for (let f = 0; f < model.faces && !boundary; f++)
        for (let corner = 0; corner < 3; corner++) {
          const p = model.plan(f, corner);
          if (
            p &&
            (p.index[0] === 0 ||
              p.index[1] === 0 ||
              p.index[0] === grid.x.length - 1 ||
              p.index[1] === grid.y.length - 1)
          ) {
            boundary = p;
            break;
          }
        }
      expect(boundary).toBeTruthy();
      results.push(await clickPlan(page, grid, field, model, boundary));
      await page.getByTestId('surface-probe').focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowUp');
      const i = Number(await page.getByLabel('探针网格 i').inputValue()),
        j = Number(await page.getByLabel('探针网格 j').inputValue());
      await expect(page.getByTestId('probe-' + field)).toHaveAttribute('title', String(grid[field][i][j]));
      await page.getByLabel('探针网格 i').fill('999');
      await expect(page.getByLabel('网格 i', { exact: true })).toHaveValue(String(grid.x.length - 1));
      await page.getByLabel('探针网格 j').fill('-1');
      await expect(page.getByLabel('网格 j', { exact: true })).toHaveValue('0');
      const box = (await page.locator('.surface-workspace canvas').boundingBox())!,
        cameraBefore = model.camera.world;
      await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.25);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.75 - 70, box.y + box.height * 0.25 + 35, { steps: 8 });
      await page.mouse.up();
      await expect
        .poll(() => page.evaluate(() => (window as any).__policyglassCamera.world.join(',')))
        .not.toBe(cameraBefore.join(','));
      await settleCamera(page);
      model.dispose();
      model = await rayModel(page, grid, field);
      let rotated: any;
      for (let f = 0; f < model.faces && !rotated; f++) rotated = model.plan(f, 2);
      expect(rotated).toBeTruthy();
      results.push({ ...(await clickPlan(page, grid, field, model, rotated)), rotated: true });
      await page.screenshot({ path: `${root}/04-${kind}-probe-rotated-${size}.png` });
      model.dispose();
      const exported = await gridExport(page);
      expect(exported.request).toEqual(grid.request);
      expect(exported.selected_point.index).toEqual(rotated.index);
      expect(exported.selected_point.values[field]).toBe(grid[field][rotated.index[0]][rotated.index[1]]);
      expect(numericalPosts).toBe(0);
      expect(errors).toEqual([]);
      if (kind === 'q') {
        await page.getByLabel('动作轴 x', { exact: true }).selectOption('2');
        await expect(page.getByTestId('surface-probe')).toHaveCount(0);
        await page.getByLabel('动作轴 x', { exact: true }).selectOption(String(grid.request.body.axes[0]));
      } else {
        await page.getByLabel('参数偏移范围 ±').fill('0.12');
        await expect(page.getByTestId('surface-probe')).toHaveCount(0);
        await page.getByLabel('参数偏移范围 ±').fill(String(grid.request.body.extent));
      }
      await expect(page.getByTestId('surface-probe')).toBeVisible();
      let held = false,
        release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/slice-jobs/*', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const data = await response.json();
        if (data.status === 'completed' && !held) {
          held = true;
          await gate;
        }
        await route.fulfill({ response });
      });
      await page.getByRole('button', { name: '计算真实切片', exact: true }).click();
      await expect.poll(() => held).toBeTruthy();
      await expect(page.getByTestId('surface-probe')).toHaveCount(0);
      await page.getByRole('button', { name: '取消切片计算', exact: true }).click();
      release();
      await expect(page.getByRole('button', { name: '计算真实切片', exact: true })).toBeEnabled();
      await expect(page.getByTestId('surface-probe')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '导出真实网格', exact: true })).toHaveCount(0);
      const after = await api(page, '/experiments/' + sacId);
      expect([after.checkpoint, after.updates, after.env_steps]).toEqual([
        before.checkpoint,
        before.updates,
        before.env_steps,
      ]);
      expect(await api(page, `/experiments/${sacId}/parameters?checkpoint=${before.checkpoint}`)).toEqual(
        parameters,
      );
      await writeFile(
        `${root}/${kind}-${size}.json`,
        JSON.stringify(
          {
            request: grid.request,
            results,
            exportedSelection: exported.selected_point,
            viewerNumericalPosts: 0,
            cancelledRealResponseStayedHidden: true,
            errors,
          },
          null,
          2,
        ),
      );
    });
}
