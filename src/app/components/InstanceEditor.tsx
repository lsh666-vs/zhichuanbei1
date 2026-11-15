import { Plus, Trash2, ArrowRight, Info } from 'lucide-react';
import type { Instance } from '../../shared/types';
import { clone } from '../api';

const nextId = (existing: string[], prefix = '') => {
  const alphabetic = (index: number) => {
    let value = index + 1,
      label = '';
    while (value > 0) {
      value--;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return `${prefix}${label}`;
  };
  let index = 0;
  while (existing.includes(alphabetic(index))) index++;
  return alphabetic(index);
};
export function InstanceEditor({
  instance,
  onChange,
}: {
  instance: Instance;
  onChange: (value: Instance) => void;
}) {
  const update = (fn: (copy: Instance) => void) => {
    const copy = clone(instance);
    fn(copy);
    onChange(copy);
  };
  const num = (value: string) => Number(value);
  const availablePair =
    instance.domain === 'graph'
      ? instance.nodes.flatMap((from) =>
          instance.nodes
            .filter(
              (to) =>
                to.id !== from.id &&
                !instance.edges.some(
                  (edge) =>
                    (edge.from === from.id && edge.to === to.id) ||
                    (!instance.directed && edge.from === to.id && edge.to === from.id),
                ),
            )
            .map((to) => ({ from: from.id, to: to.id })),
        )[0]
      : undefined;
  if (instance.domain === 'graph')
    return (
      <div className="instance-editor">
        <div className="editor-options">
          <label>
            起点
            <select
              value={instance.source}
              onChange={(e) =>
                update((i) => {
                  if (i.domain === 'graph') i.source = e.target.value;
                })
              }
            >
              {instance.nodes.map((n) => (
                <option key={n.id}>{n.id}</option>
              ))}
            </select>
          </label>
          <ArrowRight size={15} />
          <label>
            终点
            <select
              value={instance.target}
              onChange={(e) =>
                update((i) => {
                  if (i.domain === 'graph') i.target = e.target.value;
                })
              }
            >
              {instance.nodes.map((n) => (
                <option key={n.id}>{n.id}</option>
              ))}
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={instance.directed}
              onChange={(e) =>
                update((i) => {
                  if (i.domain === 'graph') i.directed = e.target.checked;
                })
              }
            />
            有向图
          </label>
        </div>
        <div className="editor-section-title">
          节点{' '}
          <button
            className="text-button"
            disabled={instance.nodes.length >= 12}
            onClick={() =>
              update((i) => {
                if (i.domain === 'graph') {
                  const id = nextId(i.nodes.map((n) => n.id));
                  i.nodes.push({ id, label: id, x: 80 + i.nodes.length * 40, y: 100 });
                }
              })
            }
          >
            <Plus size={13} />
            添加节点
          </button>
        </div>
        <div className="node-editor-list">
          {instance.nodes.map((n) => (
            <span className="node-editor" key={n.id}>
              <b>{n.id}</b>
              <input
                maxLength={80}
                aria-label={`节点 ${n.id} 名称`}
                value={n.label}
                onChange={(e) =>
                  update((i) => {
                    if (i.domain === 'graph') i.nodes.find((x) => x.id === n.id)!.label = e.target.value;
                  })
                }
              />
              <button
                className="icon-button small"
                aria-label={`删除节点 ${n.id}`}
                disabled={instance.nodes.length <= 2}
                onClick={() =>
                  update((i) => {
                    if (i.domain === 'graph') {
                      i.nodes = i.nodes.filter((x) => x.id !== n.id);
                      i.edges = i.edges.filter((x) => x.from !== n.id && x.to !== n.id);
                      if (i.source === n.id) i.source = i.nodes[0].id;
                      if (i.target === n.id) i.target = i.nodes.at(-1)!.id;
                    }
                  })
                }
              >
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="table-scroll">
          <table className="input-table">
            <thead>
              <tr>
                <th>边</th>
                <th>从</th>
                <th>到</th>
                <th>权重</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {instance.edges.map((edge, idx) => (
                <tr key={edge.id}>
                  <td>
                    <span className="object-id">{edge.id}</span>
                  </td>
                  <td>
                    <select
                      aria-label={`边 ${edge.id} 起点`}
                      value={edge.from}
                      onChange={(e) =>
                        update((i) => {
                          if (i.domain === 'graph') i.edges[idx].from = e.target.value;
                        })
                      }
                    >
                      {instance.nodes.map((n) => (
                        <option key={n.id}>{n.id}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`边 ${edge.id} 终点`}
                      value={edge.to}
                      onChange={(e) =>
                        update((i) => {
                          if (i.domain === 'graph') i.edges[idx].to = e.target.value;
                        })
                      }
                    >
                      {instance.nodes.map((n) => (
                        <option key={n.id}>{n.id}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="10000"
                      step="1"
                      aria-label={`边 ${edge.id} 权重`}
                      value={edge.weight}
                      onChange={(e) =>
                        update((i) => {
                          if (i.domain === 'graph') i.edges[idx].weight = num(e.target.value);
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="icon-button small"
                      aria-label={`删除边 ${edge.id}`}
                      onClick={() =>
                        update((i) => {
                          if (i.domain === 'graph') i.edges.splice(idx, 1);
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="add-row"
          disabled={instance.edges.length >= 80 || !availablePair}
          onClick={() =>
            update((i) => {
              if (i.domain === 'graph' && availablePair)
                i.edges.push({
                  id: nextId(
                    i.edges.map((e) => e.id),
                    'e',
                  ),
                  ...availablePair,
                  weight: 1,
                });
            })
          }
        >
          <Plus size={14} />
          添加一条边
        </button>
        <p className="field-note">
          <Info size={13} />
          最多 12 个节点、80 条边；权重为非负整数，不接受自环或重复端点。节点可在场景图中拖动。
        </p>
      </div>
    );
  return (
    <div className="instance-editor">
      <div className="editor-options">
        {instance.domain === 'interval' ? (
          <label>
            优化目标
            <select
              value={instance.objective}
              onChange={(e) =>
                update((i) => {
                  if (i.domain === 'interval') i.objective = e.target.value as 'value' | 'count';
                })
              }
            >
              <option value="value">最大总收益</option>
              <option value="count">最多任务数</option>
            </select>
          </label>
        ) : (
          <label>
            背包容量
            <input
              type="number"
              min="0"
              max="10000"
              step="1"
              aria-label="背包容量"
              value={instance.capacity}
              onChange={(e) =>
                update((i) => {
                  if (i.domain === 'knapsack') i.capacity = num(e.target.value);
                })
              }
            />
          </label>
        )}
        <span className="muted small-copy">{instance.items.length} 个对象</span>
      </div>
      <div className="table-scroll">
        <table className="input-table">
          <thead>
            <tr>
              <th>对象</th>
              {instance.domain === 'interval' ? (
                <>
                  <th>开始</th>
                  <th>结束</th>
                </>
              ) : (
                <th>重量</th>
              )}
              <th>收益</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {instance.items.map((item, index) => (
              <tr key={item.id}>
                <td>
                  <span className="object-id">{item.id}</span>
                  <input
                    maxLength={80}
                    className="item-label"
                    aria-label={`对象 ${item.id} 名称`}
                    value={item.label}
                    onChange={(e) =>
                      update((i) => {
                        if (i.domain !== 'graph') i.items[index].label = e.target.value;
                      })
                    }
                  />
                </td>
                {instance.domain === 'interval' ? (
                  <>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="10000"
                        step="1"
                        aria-label={`对象 ${item.id} 开始`}
                        value={instance.items[index].start}
                        onChange={(e) =>
                          update((i) => {
                            if (i.domain === 'interval') i.items[index].start = num(e.target.value);
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        step="1"
                        aria-label={`对象 ${item.id} 结束`}
                        value={instance.items[index].end}
                        onChange={(e) =>
                          update((i) => {
                            if (i.domain === 'interval') i.items[index].end = num(e.target.value);
                          })
                        }
                      />
                    </td>
                  </>
                ) : (
                  <td>
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      step="1"
                      aria-label={`对象 ${item.id} 重量`}
                      value={instance.items[index].weight}
                      onChange={(e) =>
                        update((i) => {
                          if (i.domain === 'knapsack') i.items[index].weight = num(e.target.value);
                        })
                      }
                    />
                  </td>
                )}
                <td>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    step="1"
                    aria-label={`对象 ${item.id} 收益`}
                    value={item.value}
                    onChange={(e) =>
                      update((i) => {
                        if (i.domain !== 'graph') i.items[index].value = num(e.target.value);
                      })
                    }
                  />
                </td>
                <td>
                  <button
                    className="icon-button small"
                    aria-label={`删除对象 ${item.id}`}
                    disabled={instance.items.length <= 1}
                    onClick={() =>
                      update((i) => {
                        if (i.domain !== 'graph') i.items.splice(index, 1);
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="add-row"
        disabled={instance.items.length >= (instance.domain === 'interval' ? 16 : 18)}
        onClick={() =>
          update((i) => {
            if (i.domain === 'interval') {
              const id = nextId(i.items.map((x) => x.id));
              i.items.push({ id, label: `任务 ${id}`, start: 0, end: 2, value: 1 });
            } else if (i.domain === 'knapsack') {
              const id = nextId(i.items.map((x) => x.id));
              i.items.push({ id, label: `物品 ${id}`, weight: 1, value: 1 });
            }
          })
        }
      >
        <Plus size={14} />
        添加{instance.domain === 'interval' ? '任务' : '物品'}
      </button>
      <p className="field-note">
        <Info size={13} />
        {instance.domain === 'interval'
          ? '区间采用 [开始, 结束)，首尾相接允许。任务不可拆分。'
          : '每件物品最多选一次，物品不可拆分；重量为正整数。'}
      </p>
    </div>
  );
}
