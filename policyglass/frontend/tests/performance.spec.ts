import { test, expect, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

type Frame = { time: number; calls: number; triangles: number; geometries: number; textures: number };
declare global {
  interface Window {
    __policyglassFrames?: Frame[];
    __policyglassRenderer?: Record<string, unknown>;
  }
}

test.use({ deviceScaleFactor: 1 });

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (fraction: number) => {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * fraction;
    return sorted[Math.floor(i)] + (i % 1) * (sorted[Math.ceil(i)] - sorted[Math.floor(i)]);
  };
  return {
    count: sorted.length,
    p50: q(0.5),
    p95: q(0.95),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
}

async function view(page: Page, name: string, id: string) {
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByTestId('scene-' + id)).toBeVisible();
}

async function frameWindow(page: Page, milliseconds = 5000) {
  await page.waitForTimeout(750); // shader/layout settling is outside the measured window
  await page.evaluate(() => {
    window.__policyglassFrames = [];
  });
  await page.waitForTimeout(milliseconds);
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const memory = (performance as any).memory;
    return {
      frames: window.__policyglassFrames ?? [],
      renderer: window.__policyglassRenderer ?? null,
      canvas: {
        width: canvas.width,
        height: canvas.height,
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
      },
      jsHeap: memory
        ? {
            usedBytes: memory.usedJSHeapSize,
            totalBytes: memory.totalJSHeapSize,
            limitBytes: memory.jsHeapSizeLimit,
          }
        : null,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    };
  });
  if (milliseconds >= 5000) {
    expect(result.frames.length, 'Diagnostic hook must record actual render callbacks').toBeGreaterThan(2);
  }
  const intervals = result.frames.slice(1).map((frame, i) => frame.time - result.frames[i].time);
  const intervalStats = stats(intervals);
  return {
    ...result,
    requestedWindowMs: milliseconds,
    frameIntervalsMs: intervals,
    frameIntervalMs: intervalStats,
    deliveryFps:
      result.frames.length > 1
        ? ((result.frames.length - 1) * 1000) / (result.frames.at(-1)!.time - result.frames[0].time)
        : null,
    p95Within30FpsBudget: intervalStats.p95 !== null && intervalStats.p95 <= 1000 / 30,
  };
}

async function fullscreen1080p(page: Page) {
  expect(await page.evaluate(() => devicePixelRatio)).toBe(1);
  const style = await page.addStyleTag({
    content: `
      .scene {
        position: fixed !important;
        inset: 0 !important;
        width: 1920px !important;
        height: 1080px !important;
        min-width: 1920px !important;
        max-width: 1920px !important;
        z-index: 2147483000 !important;
        border: 0 !important;
        border-radius: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
      }
    `,
  });
  try {
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const canvas = document.querySelector('canvas')!;
          return [canvas.width, canvas.height, canvas.clientWidth, canvas.clientHeight];
        }),
      )
      .toEqual([1920, 1080, 1920, 1080]);
    const result = await frameWindow(page);
    expect([result.canvas.width, result.canvas.height]).toEqual([1920, 1080]);
    return { layout: 'temporary test-only fixed scene; actual 1920x1080 backing canvas, DPR 1', ...result };
  } finally {
    await style.evaluate((element) => (element as HTMLStyleElement).remove());
    await page.waitForTimeout(750);
  }
}

async function eventLatency(page: Page, index: number, label: string) {
  // Browser timestamps avoid adding Playwright actionability/polling overhead.
  // Measures programmatic button activation -> actual Inspector heading commit.
  return page.evaluate(
    async ({ index, label }) => {
      const inspector = document.querySelector('.inspector')!;
      const button = document.querySelectorAll<HTMLButtonElement>('.event-list button')[index];
      const started = performance.now();
      return new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error('Inspector selection timed out'));
        }, 15000);
        const observer = new MutationObserver(() => {
          if (inspector.querySelector('h3')?.textContent === label) {
            observer.disconnect();
            clearTimeout(timeout);
            resolve(performance.now() - started);
          }
        });
        observer.observe(inspector, { subtree: true, childList: true, characterData: true });
        button.click();
      });
    },
    { index, label },
  );
}

test('Collect genuine renderer, event-selection and repeated-view performance evidence', async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  const evidence = '../.runtime/performance';
  await mkdir(evidence, { recursive: true });
  const report: Record<string, any> = {
    schema: 'policyglass.performance.browser.v1',
    startedUtc: new Date().toISOString(),
    status: 'running',
    browser: browser.version(),
    configuredMode:
      'Playwright Chromium headless; enable-unsafe-swiftshader is configured; classify actual renderer below',
    viewportRequested: { width: 1920, height: 1080 },
    sourceSha256: {},
    views: {},
    fullscreenViews: {},
    selection: { cold: [], warm: [] },
    repeatedViews: [],
    limitations: [
      'Frame intervals are genuine R3F useFrame delivery, including browser scheduling; they are not GPU completion times.',
      'diagnostics=1 forces continuous invalidation; normal idle mode uses on-demand drawing.',
      'A 1920x1080 viewport is not a claim of a 1920x1080 canvas; actual CSS/backing dimensions are recorded per view.',
      'fullscreenViews temporarily fixes the same scene to 1920x1080 CSS pixels at DPR 1 and asserts actual backing size; normal workbench views remain separately recorded.',
      'Headless/software rendering cannot establish hardware 30FPS. A performance target miss remains in the artifact.',
      'Inspector selection is programmatic DOM button activation to heading commit; cold and warm cache samples are separate.',
      'JS heap and WebGL geometry/texture counts do not represent total browser/GPU memory; repeated views are a bounded observation.',
      'This test passes when evidence collection and real computation succeed; p95 performance budgets are reported, not silently asserted as passed.',
    ],
  };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (const path of [
      'src/App.tsx',
      'src/Scenes.tsx',
      'tests/performance.spec.ts',
      'playwright.config.ts',
    ]) {
      report.sourceSha256[path] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    }
    try {
      const session = await browser.newBrowserCDPSession();
      const system = await session.send('SystemInfo.getInfo');
      report.gpu = {
        devices: system.gpu.devices,
        featureStatus: system.gpu.featureStatus,
        auxAttributes: system.gpu.auxAttributes,
      };
      await session.detach();
    } catch (error) {
      report.gpu = { unavailable: String(error) };
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    const created = await page.request.post('/api/experiments', {
      data: { label: 'Performance default 64x64 SAC', config: { algorithm: 'sac', seed: 1701 } },
    });
    expect(created.ok()).toBeTruthy();
    const experiment = await created.json();
    report.config = experiment.config;
    const start = await page.request.post(`/api/experiments/${experiment.id}/jobs`, {
      data: { iterations: 1, record: true, mode: 'train' },
    });
    expect(start.status()).toBe(202);
    const job = await start.json();
    await expect
      .poll(async () => (await (await page.request.get(`/api/jobs/${job.id}`)).json()).status, {
        timeout: 60000,
      })
      .toBe('completed');
    const traces = await (await page.request.get(`/api/experiments/${experiment.id}/traces`)).json();
    const source = traces.at(-1);
    const index = await (await page.request.get(`/api/traces/${source.id}/index`)).json();
    report.source = {
      experiment: experiment.id,
      trace: source.id,
      traceBytes: source.bytes,
      origin: index.origin_checkpoint,
      output: index.output_checkpoint,
    };
    await page.goto(`/?experiment=${experiment.id}&diagnostics=1`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Performance default 64x64 SAC' }),
    ).toBeVisible();
    await expect(page.locator('.event-list button').first()).toBeVisible();
    await expect
      .poll(async () => page.evaluate(() => window.__policyglassFrames?.length ?? 0))
      .toBeGreaterThan(2);
    report.userAgent = await page.evaluate(() => navigator.userAgent);
    report.views.arm = await frameWindow(page);
    report.fullscreenViews.arm = await fullscreen1080p(page);
    await view(page, '计算网络', 'network');
    await page.getByLabel(/展开全部单元/).check();
    const events = index.events
      .map((event: any, index: number) => ({ ...event, index }))
      .filter((event: any) => event.kind === 'layer' && /^actor\/layer[01]$/.test(event.label));
    expect(events.length).toBe(2);
    for (const event of events)
      report.selection.cold.push({
        event: event.label,
        eventId: event.id,
        milliseconds: await eventLatency(page, event.index, event.label),
      });
    for (let i = 0; i < 20; i++) {
      const event = events[i % events.length];
      report.selection.warm.push({
        event: event.label,
        eventId: event.id,
        milliseconds: await eventLatency(page, event.index, event.label),
      });
    }
    report.selection.coldMs = stats(report.selection.cold.map((row: any) => row.milliseconds));
    report.selection.warmMs = stats(report.selection.warm.map((row: any) => row.milliseconds));
    report.selection.warmP95Within100MsTarget = report.selection.warmMs.p95 <= 100;
    report.views.network = await frameWindow(page);
    report.fullscreenViews.network = await fullscreen1080p(page);
    await page.screenshot({ path: evidence + '/network-1920x1080.png', fullPage: false });
    await view(page, '双 Q 曲面', 'q');
    await page.getByLabel('网格分辨率', { exact: true }).fill('21');
    await page.getByRole('button', { name: '计算真实切片', exact: true }).click();
    await expect(page.getByTestId('value-q1')).toBeVisible();
    report.views.q = await frameWindow(page);
    report.fullscreenViews.q = await fullscreen1080p(page);
    await view(page, '局部损失', 'loss');
    await page.getByLabel('网格分辨率', { exact: true }).fill('15');
    await page.getByRole('button', { name: '计算真实切片', exact: true }).click();
    await expect(page.getByTestId('value-loss')).toBeVisible();
    report.views.loss = await frameWindow(page);
    report.fullscreenViews.loss = await fullscreen1080p(page);
    for (let cycle = 0; cycle < 12; cycle++) {
      const current = cycle % 2 ? ['计算网络', 'network'] : ['物理实验', 'arm'];
      await view(page, current[0], current[1]);
      report.repeatedViews.push({ cycle, view: current[1], ...(await frameWindow(page, 500)) });
    }
    report.pageErrors = errors;
    expect(errors).toEqual([]);
    report.status = 'completed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error);
    report.pageErrors = errors;
    throw error;
  } finally {
    await writeFile(evidence + '/browser-runtime.json', JSON.stringify(report, null, 2));
  }
});
