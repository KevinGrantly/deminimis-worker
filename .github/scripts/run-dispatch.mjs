import { spawn } from 'node:child_process';

const callbackUrl = process.env.CALLBACK_URL;
const callbackToken = process.env.CALLBACK_TOKEN;
const jobId = process.env.JOB_ID;
const customerId = process.env.CUSTOMER_ID;
const kvk = process.env.KVK;
const companyName = process.env.COMPANY_NAME || '';

if (!callbackUrl || !callbackToken || !jobId || !customerId || !kvk) {
  throw new Error('Missing required env vars');
}

async function postCallback(payload) {
  const res = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${callbackToken}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Callback failed: ${res.status} ${text}`);
  }
}

async function run() {
  await postCallback({
    job_id: Number(jobId),
    customer_id: Number(customerId),
    status: 'running',
    message: 'GitHub Actions scraper gestart',
  });

  const args = [
    'src/eair_fetch.mjs',
    '--kvk', kvk,
    '--company', companyName,
  ];

  const proc = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', resolve);
  });

  if (exitCode !== 0) {
    await postCallback({
      job_id: Number(jobId),
      customer_id: Number(customerId),
      status: 'error',
      error_message: stderr || `Scraper exited with code ${exitCode}`,
    });
    process.exit(exitCode || 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    await postCallback({
      job_id: Number(jobId),
      customer_id: Number(customerId),
      status: 'error',
      error_message: 'Invalid scraper JSON output',
      raw_output: stdout.slice(0, 5000),
    });
    throw e;
  }

  await postCallback({
    job_id: Number(jobId),
    customer_id: Number(customerId),
    status: 'success',
    result: parsed,
  });
}

run().catch(async (err) => {
  try {
    await postCallback({
      job_id: Number(jobId),
      customer_id: Number(customerId),
      status: 'error',
      error_message: err.message || String(err),
    });
  } catch {}
  process.exit(1);
});