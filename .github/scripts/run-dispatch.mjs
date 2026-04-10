import { spawn } from 'node:child_process';

const callbackUrl = process.env.CALLBACK_URL;
const callbackToken = process.env.CALLBACK_TOKEN;
const jobId = process.env.JOB_ID;
const customerId = process.env.CUSTOMER_ID;
const kvk = process.env.KVK;
const companyName = process.env.COMPANY_NAME || '';

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
  console.log('Callback payload status:', payload.status);

  const res = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${callbackToken}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log('Callback response status:', res.status);
  console.log('Callback response body:', text);

  if (!res.ok) {
    throw new Error(`Callback failed: ${res.status} ${text}`);
  }

  return text;
}

async function runScraper() {
  return await new Promise((resolve, reject) => {
    const args = [
      'src/eair_fetch.mjs',
      '--kvk', kvk,
      '--company', companyName,
    ];

    console.log('Starting scraper:', ['node', ...args].join(' '));

    const proc = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(s);
    });

    proc.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function main() {
  await postCallback({
    job_id: Number(jobId),
    customer_id: Number(customerId),
    status: 'running',
    message: 'GitHub Actions scraper gestart',
  });

  const result = await runScraper();

  console.log('Scraper exit code:', result.code);

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
    parsed = JSON.parse(result.stdout);
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

  console.log('Workflow completed successfully');
}

main().catch(async (err) => {
  console.error('FATAL ERROR:', err);

  try {
    await postCallback({
      job_id: Number(jobId || 0),
      customer_id: Number(customerId || 0),
      status: 'error',
      error_message: err.message || String(err),
    });
  } catch (callbackErr) {
    console.error('SECONDARY CALLBACK ERROR:', callbackErr);
  }

  process.exit(1);
});
