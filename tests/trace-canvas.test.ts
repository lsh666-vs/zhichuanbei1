import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GraphPlot,
  TraceCanvas,
  graphProjection,
  projectGraphPoint,
  unprojectGraphPoint,
} from '../src/app/components/TraceCanvas';
import { defaultStrategy, evaluate } from '../src/engine/index';
import type { GraphInstance } from '../src/shared/types';

const graph = (): GraphInstance => ({
  domain: 'graph',
  directed: true,
  source: 'S',
  target: 'T',
  nodes: [
    { id: 'S', label: '起点', x: -10000, y: -10000 },
    { id: 'M', label: '中间点', x: -4000, y: -9000 },
    { id: 'T', label: '终点', x: 10000, y: 10000 },
  ],
  edges: [
    { id: 'S', from: 'S', to: 'M', weight: 2 },
    { id: 'MT', from: 'M', to: 'T', weight: 3 },
  ],
});
const canvas = (
  instance: GraphInstance,
  evaluation: ReturnType<typeof evaluate> | null = null,
  hovered: string | null = null,
) =>
  renderToStaticMarkup(
    createElement(TraceCanvas, { instance, evaluation, step: 0, hovered, setHovered: () => {} }),
  );

describe('graph viewport geometry', () => {
  test('negative and extreme legal coordinates all remain within visible bounds', () => {
    const instance = graph(),
      projection = graphProjection(instance);
    for (const node of instance.nodes) {
      const point = projectGraphPoint(node, projection);
      expect(point.x).toBeGreaterThanOrEqual(60);
      expect(point.x).toBeLessThanOrEqual(580);
      expect(point.y).toBeGreaterThanOrEqual(35);
      expect(point.y).toBeLessThanOrEqual(145);
    }
    expect(projectGraphPoint(instance.nodes[0], projection)).toEqual({ x: 60, y: 35 });
    expect(projectGraphPoint(instance.nodes[2], projection)).toEqual({ x: 580, y: 145 });
  });
  test('equal coordinate axes stay centered and pointer inverses never leave allowed data bounds', () => {
    const instance = graph();
    instance.nodes = instance.nodes.map((node) => ({ ...node, x: -500, y: -10000 }));
    const projection = graphProjection(instance);
    expect(projectGraphPoint(instance.nodes[0], projection)).toEqual({ x: 320, y: 90 });
    expect(unprojectGraphPoint({ x: -500, y: -500 }, projection).y).toBe(-10000);
    for (const point of [
      { x: -100000, y: -100000 },
      { x: 100000, y: 100000 },
    ]) {
      const data = unprojectGraphPoint(point, projection);
      expect(Number.isFinite(data.x) && Number.isFinite(data.y)).toBe(true);
      expect(data.x).toBeGreaterThanOrEqual(-10000);
      expect(data.x).toBeLessThanOrEqual(10000);
      expect(data.y).toBeGreaterThanOrEqual(-10000);
      expect(data.y).toBeLessThanOrEqual(10000);
    }
  });
  test('a fixed drag projection roundtrips positions and does not move untouched nodes when an extreme moves', () => {
    const instance = graph(),
      projection = graphProjection(instance),
      middleBefore = projectGraphPoint(instance.nodes[1], projection);
    const point = unprojectGraphPoint({ x: 440, y: 110 }, projection);
    expect(projectGraphPoint(point, projection).x).toBeCloseTo(440);
    expect(projectGraphPoint(point, projection).y).toBeCloseTo(110);
    const changed = {
      ...instance,
      nodes: instance.nodes.map((node) => (node.id === 'T' ? { ...node, ...point } : node)),
    };
    expect(projectGraphPoint(changed.nodes[1], projection)).toEqual(middleBefore);
    expect(projectGraphPoint(changed.nodes[1], graphProjection(changed))).not.toEqual(middleBefore);
  });
});

describe('dual-track rendering and accessible object semantics', () => {
  test('pending, unreachable, verified and failed-verification captions do not overclaim', () => {
    const instance = graph();
    expect(canvas(instance)).toContain('等待计算与独立核验');
    expect(canvas(instance)).not.toContain('独立核验的最优结果');
    const checked = evaluate(instance, defaultStrategy('graph'));
    expect(canvas(instance, checked)).toContain('独立核验的最优结果');
    expect(canvas(instance, { ...checked, witnessVerified: false, verdict: 'invalid' })).toContain(
      '结果未通过独立核验',
    );
    const unreachable = { ...instance, edges: [] },
      evaluation = evaluate(unreachable, defaultStrategy('graph'));
    expect(canvas(unreachable, evaluation)).toContain('独立核验：目标不可达');
    expect(canvas(unreachable, evaluation)).not.toContain('独立核验的最优结果');
  });
  test('same graph object highlights both tracks without confusing overlapping node and edge IDs', () => {
    const nodeHtml = canvas(graph(), null, 'node:S');
    expect(nodeHtml.match(/class="graph-node [^"]*hovered"/g)).toHaveLength(2);
    expect(nodeHtml.match(/class="graph-edge [^"]*hovered"/g)).toBeNull();
    expect(nodeHtml).toContain('对象 节点 S · 双轨联动高亮');
    const edgeHtml = canvas(graph(), null, 'edge:S');
    expect(edgeHtml.match(/class="graph-edge [^"]*hovered"/g)).toHaveLength(2);
    expect(edgeHtml.match(/class="graph-node [^"]*hovered"/g)).toBeNull();
  });
  test('all graph objects are named focusable buttons and multiple plots have distinct SVG markers', () => {
    const html = canvas(graph()),
      markerIds = Array.from(html.matchAll(/<marker id="([^"]+)"/g), (match) => match[1]);
    expect(markerIds).toHaveLength(2);
    expect(new Set(markerIds).size).toBe(2);
    expect(html.match(/tabindex="0" role="button"/g)).toHaveLength(10);
    expect(html).toContain('aria-label="边 S，S 到 M，权重 2"');
    expect(html).toContain('aria-label="节点 S，起点"');
    const editor = renderToStaticMarkup(createElement(GraphPlot, { instance: graph(), onChange: () => {} }));
    expect(editor).toContain('使用方向键移动');
  });
});
