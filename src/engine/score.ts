/** A small arithmetic language. No generated source code is ever executed. */
export interface Rational { numerator: bigint; denominator: bigint }
/** A valid arithmetic program may be undefined for a particular input. */
export class ScoreEvaluationError extends Error {}
type Expr = { kind: 'number'; value: Rational } | { kind: 'field'; name: string } |
  { kind: 'unary'; sign: 1 | -1; child: Expr } |
  { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr };
const FIELDS = {
  interval: ['start', 'end', 'duration', 'value'],
  knapsack: ['weight', 'value'],
  graph: ['weight'],
} as const;
export type ScoreDomain = keyof typeof FIELDS;
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b !== 0n) { const r = a % b; a = b; b = r; }
  return a;
}
function fraction(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new ScoreEvaluationError('评分表达式除数为 0；请调整表达式或输入。');
  if (d < 0n) { n = -n; d = -d; }
  const common = gcd(n, d);
  n /= common; d /= common;
  if (n.toString(2).length > 4096 || d.toString(2).length > 4096) throw new ScoreEvaluationError('评分表达式的中间数值过大。');
  return { numerator: n, denominator: d };
}
export function compareRational(a: Rational, b: Rational): number {
  const delta = a.numerator * b.denominator - b.numerator * a.denominator;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
export function compileScore(source: string, domain: ScoreDomain): (fields: Record<string, number>) => Rational {
  if (typeof source !== 'string' || source.trim().length === 0 || source.length > 160) throw new Error('评分表达式必须为 1–160 个字符。');
  let position = 0, nodes = 0;
  function skip() { while (/\s/.test(source[position] ?? '') && position < source.length) position++; }
  function counted<T extends Expr>(node: T): T { if (++nodes > 80) throw new Error('评分表达式最多包含 80 个节点。'); return node; }
  function primary(depth: number): Expr {
    skip();
    if (depth > 16) throw new Error('评分表达式嵌套不能超过 16 层。');
    const char = source[position];
    if (char === '+' || char === '-') { position++; return counted({kind:'unary',sign:char === '+' ? 1 : -1,child:primary(depth + 1)}); }
    if (char === '(') {
      position++; const result = expression(depth + 1); skip();
      if (source[position++] !== ')') throw new Error('评分表达式缺少右括号。');
      return result;
    }
    const remaining = source.slice(position);
    const numeric = /^(?:\d+(?:\.\d{1,6})?|\.\d{1,6})/.exec(remaining);
    if (numeric) {
      position += numeric[0].length;
      const [integer, decimals = ''] = numeric[0].split('.');
      if ((integer || '0').length > 9) throw new Error('评分常数过大；最多 9 位整数。');
      return counted({ kind: 'number', value: fraction(BigInt((integer || '0') + decimals), 10n ** BigInt(decimals.length)) });
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(remaining);
    if (identifier) {
      position += identifier[0].length;
      if (!(FIELDS[domain] as readonly string[]).includes(identifier[0])) throw new Error(`此领域不支持字段 ${identifier[0]}；可用字段：${FIELDS[domain].join('、')}。`);
      return counted({kind:'field',name:identifier[0]});
    }
    throw new Error(`评分表达式第 ${position + 1} 个字符无效；只支持字段、数值、+ - * / 和括号。`);
  }
  function product(depth: number): Expr {
    let result = primary(depth);
    while (true) {
      skip(); const op = source[position];
      if (op !== '*' && op !== '/') break;
      position++; result = counted({kind:'binary',op,left:result,right:primary(depth + 1)});
    }
    return result;
  }
  function expression(depth: number): Expr {
    let result = product(depth);
    while (true) {
      skip(); const op = source[position];
      if (op !== '+' && op !== '-') break;
      position++; result = counted({kind:'binary',op,left:result,right:product(depth + 1)});
    }
    return result;
  }
  const tree = expression(0); skip();
  if (position !== source.length) throw new Error(`评分表达式第 ${position + 1} 个字符无效。`);
  function execute(node: Expr, fields: Record<string, number>): Rational {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'field') {
      if (!Number.isSafeInteger(fields[node.name])) throw new Error(`字段 ${node.name} 必须是安全整数。`);
      return fraction(BigInt(fields[node.name]));
    }
    if (node.kind === 'unary') { const value = execute(node.child, fields); return { ...value, numerator: value.numerator * BigInt(node.sign) }; }
    const a = execute(node.left, fields), b = execute(node.right, fields);
    switch (node.op) {
      case '+': return fraction(a.numerator*b.denominator+b.numerator*a.denominator,a.denominator*b.denominator);
      case '-': return fraction(a.numerator*b.denominator-b.numerator*a.denominator,a.denominator*b.denominator);
      case '*': return fraction(a.numerator*b.numerator,a.denominator*b.denominator);
      case '/': return fraction(a.numerator*b.denominator,a.denominator*b.numerator);
    }
  }
  return (fields) => execute(tree, fields);
}
