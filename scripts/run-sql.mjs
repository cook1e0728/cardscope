import { readFileSync } from 'node:fs';

const usage = [
  'Usage: node scripts/run-sql.mjs <file.sql | -e "sql"> [--read-only]',
  '',
  'Runs SQL on the CardScope Supabase project through the Management API',
  '(POST /v1/projects/<ref>/database/query). Needs SUPABASE_ACCESS_TOKEN in .env.local',
  '(git-ignored). The whole request is one transaction: an exception rolls all of it back.',
  'Prints the JSON result rows. --read-only refuses statements that are not SELECT/WITH.'
].join('\n');

const PROJECT_REF = 'ubiaftrvmywwmifqzmik';

function loadToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  try {
    const line = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split(/\r?\n/).find(row => row.startsWith('SUPABASE_ACCESS_TOKEN='));
    return line ? line.slice('SUPABASE_ACCESS_TOKEN='.length).trim() : null;
  } catch {
    return null;
  }
}

try {
  const args = process.argv.slice(2);
  const inline = args.indexOf('-e');
  const query = inline !== -1 ? args[inline + 1] : args[0] && !args[0].startsWith('--') ? readFileSync(args[0], 'utf8') : null;
  if (!query) throw new Error('SQL_REQUIRED');
  if (args.includes('--read-only') && !/^\s*(select|with)\b/i.test(query)) throw new Error('READ_ONLY_REFUSED');
  const token = loadToken();
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN_MISSING');

  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`HTTP ${response.status}`);
    console.error(text);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${text}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exitCode = 1;
}
