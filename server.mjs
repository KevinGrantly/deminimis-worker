import express from 'express';
import crypto from 'crypto';
import { spawn } from 'node:child_process';

const app = express();
app.use(express.json({ limit: '5mb' }));

const port = process.env.PORT || 8080;
const workerToken = process.env.WORKER_TOKEN || '';

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function runScraper(payload) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const child = spawn(process.execPath, ['src/eair_fetch.mjs', encoded], {
      cwd: process.cwd(),
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || stdout || `Scraper exited with code ${code}`));
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        if (!parsed.success) {
          return reject(new Error(parsed.message || 'Scraper returned unsuccessful response.'));
        }

        resolve(parsed.records || []);
      } catch (error) {
        reject(new Error(`Invalid scraper output: ${stdout}`));
      }
    });
  });
}

async function postCallback(callbackUrl, callbackToken, body) {
  const response = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${callbackToken}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Callback failed with HTTP ${response.status}: ${text}`);
  }
}

app.get('/health', (req, res) => {
  res.json({ success: true });
});

app.post('/jobs/deminimis', async (req, res) => {
  if (workerToken && bearerToken(req) !== workerToken) {
    return res.status(401).json({ success: false, message: 'Unauthorized worker request.' });
  }

  const payload = req.body || {};
  if (!payload.job_id || !payload.customer_id || !payload.kvk || !payload.callback_url || !payload.callback_token) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  const remoteJobId = crypto.randomUUID();

  res.status(202).json({
    success: true,
    accepted: true,
    remote_job_id: remoteJobId
  });

  (async () => {
    try {
      await postCallback(payload.callback_url, payload.callback_token, {
        job_id: payload.job_id,
        customer_id: payload.customer_id,
        status: 'running',
        message: 'Worker started.'
      });

      const records = await runScraper({
        url: payload.source_url || 'https://aid-register.ec.europa.eu/de-minimis',
        kvk: payload.kvk,
        companyName: payload.company_name || '',
        country: payload.country || 'Netherlands',
        timeout: payload.timeout_ms || 30000,
        userAgent: payload.user_agent || 'Mozilla/5.0 (compatible; Grantly DeMinimis Sync/1.2)'
      });

      await postCallback(payload.callback_url, payload.callback_token, {
        job_id: payload.job_id,
        customer_id: payload.customer_id,
        status: 'success',
        message: `Imported ${records.length} record(s).`,
        records
      });
    } catch (error) {
      try {
        await postCallback(payload.callback_url, payload.callback_token, {
          job_id: payload.job_id,
          customer_id: payload.customer_id,
          status: 'error',
          message: error.message || 'Unknown worker error.',
          records: []
        });
      } catch (callbackError) {
        console.error('Worker callback failed:', callbackError);
      }

      console.error('Worker job failed:', error);
    }
  })().catch((error) => {
    console.error('Detached worker execution failed:', error);
  });
});

app.listen(port, () => {
  console.log(`deminimis-worker listening on ${port}`);
});
