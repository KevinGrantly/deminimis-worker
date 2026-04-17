import { spawn } from 'node:child_process';

const callbackUrl = process.env.CALLBACK_URL;
const callbackToken = process.env.CALLBACK_TOKEN;
const jobId = process.env.JOB_ID;
const customerId = process.env.CUSTOMER_ID;
const kvk = process.env.KVK;
const companyName = process.env.COMPANY_NAME || '';
const sourceUrl = process.env.SOURCE_URL || 'https://aid-register.ec.europa.eu/de-minimis';
const country = process.env.COUNTRY || 'Netherlands';
const timeoutMs = Number(process.env.TIMEOUT_MS || '30000');
const userAgent = process.env.USER_AGENT || 'Mozilla/5.0 (compatible; Grantly DeMinimis Sync/1.2)';

function required(name, value) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

required('CALLBACK_URL', callbackUrl);
required('CALLBACK_TOKEN', callbackToken);
required('JOB_ID', jobId);
required('CUSTOMER_ID', customerId);
required('KVK', kvk);

async function postCallback(payload) {
  console.log('Posting callback to:', callbackUrl);
  console.log('Callback payload:', JSON.stringify(payload));

  const res = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${callbackToken}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  console.log('Callback status:', res.status);
  console.log('Callback response:', text);

  if (!res.ok) {
    throw new Error(`Callback failed: ${res.status} ${text}`);
  }

  return text;
}

async function runScraper() {
  return await new Promise((resolve, reject) => {
    const payload = {
      url: sourceUrl,
      kvk,
      companyName,
      country,
      timeout: timeoutMs,
      userAgent,
    };

    console.log('Scraper payload:', JSON.stringify(payload));

    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const args = ['src/eair_fetch.mjs', encoded];

    console.log('Spawning node with args:', JSON.stringify(args));

    const proc = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('error', reject);

    proc.on('close', (code) => {
      console.log('Scraper exit code:', code);
      console.log('Scraper stdout:', stdout);
      console.log('Scraper stderr:', stderr);
      resolve({ code, stdout, stderr });
    });
  });
}

async function main() {
  console.log('run-dispatch start');

  await postCallback({
    job_id: Number(jobId),
    customer_id: Number(customerId),
    status: 'running',
    message: 'GitHub Actions scraper gestart',
  });

  const result = await runScraper();

  if (result.code !== 0) {
    await postCallback({
      job_id: Number(jobId),
      customer_id: Number(customerId),
      status: 'error',
      error_message: result.stderr || `Scraper exited with code ${result.code}`,
      raw_output: (result.stdout || '').slice(0, 5000),
    });

    throw new Error(result.stderr || `Scraper exited with code ${result.code}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch (err) {
    await postCallback({
      job_id: Number(jobId),
      customer_id: Number(customerId),
      status: 'error',
      error_message: `Invalid scraper JSON output: ${err.message}`,
      raw_output: (result.stdout || '').slice(0, 5000),
    });

    throw err;
  }

  await postCallback({
    job_id: Number(jobId),
    customer_id: Number(customerId),
    status: 'success',
    result: parsed,
  });

  console.log('run-dispatch done');
}

main().catch(async (err) => {
  console.error('run-dispatch failed:', err);
  console.error('message:', err?.message || String(err));
  console.error('stack:', err?.stack || 'no stack');

  try {
    await postCallback({
      job_id: Number(jobId || 0),
      customer_id: Number(customerId || 0),
      status: 'error',
      error_message: err.message || String(err),
    });
  } catch (callbackErr) {
    console.error('error callback failed:', callbackErr);
    console.error('error callback message:', callbackErr?.message || String(callbackErr));
  }

  process.exit(1);
});
