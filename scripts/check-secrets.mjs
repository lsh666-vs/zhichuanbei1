import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const checks = [
  { name: 'API credential', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'private key', pattern: /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
];
const findings = [];
let checked = 0;
for (const name of new Set(names)) {
  if (/\.(png|jpe?g|webp|ico|zip|pdf)$/i.test(name)) continue;
  const buffer = readFileSync(name);
  if (buffer.includes(0)) continue;
  checked++;
  const content = buffer.toString('utf8');
  for (const check of checks) if (check.pattern.test(content)) findings.push({ file: name, category: check.name });
}
console.log(JSON.stringify({ checked, passed: findings.length === 0, findings, scope: 'Tracked and unignored files; pattern scan is a guard, not an exhaustive secret detector.' }, null, 2));
if (findings.length) process.exitCode = 1;
