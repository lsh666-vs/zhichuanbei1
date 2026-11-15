import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { GraphPlot } from '../src/app/components/TraceCanvas';
import { defaultStrategy, evaluate } from '../src/engine/index';
import type { GraphInstance } from '../src/shared/types';

test('legal overlapping node and edge IDs do not invent selected or active graph objects', () => {
  const instance: GraphInstance = {
    domain: 'graph',
    directed: true,
    source: 'S',
    target: 'T',
    nodes: ['S', 'A', 'T'].map((id, index) => ({ id, label: id, x: index * 100, y: 0 })),
    edges: [
      { id: 'T', from: 'S', to: 'A', weight: 1 },
      { id: 'S', from: 'A', to: 'T', weight: 2 },
    ],
  };
  const execution = evaluate(instance, defaultStrategy('graph')).candidate;
  const html = (step: number) =>
    renderToStaticMarkup(createElement(GraphPlot, { instance, execution, step }));
  const initial = html(0),
    firstChoice = html(1);
  const object = (markup: string, label: string) => {
    const opening = markup.match(new RegExp(`<g[^>]*aria-label="${label}[^"]*"[^>]*>`));
    expect(opening).not.toBeNull();
    return opening![0];
  };
  expect(object(initial, '节点 S')).toMatch(/class="[^"]*active/);
  expect(object(initial, '边 S，')).not.toMatch(/class="[^"]*active/);
  expect(object(firstChoice, '边 T，')).toMatch(/class="[^"]*selected/);
  expect(object(firstChoice, '节点 A')).toMatch(/class="[^"]*selected/);
  expect(object(firstChoice, '节点 T')).not.toMatch(/class="[^"]*selected/);
});
