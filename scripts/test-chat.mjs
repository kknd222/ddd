#!/usr/bin/env node
import axios from 'axios';

function parseArgs(argv) {
  const args = { host: 'http://localhost:8000', model: 'jimeng-3.0', message: '一只狗', stream: false };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host' && argv[i + 1]) { args.host = argv[++i]; continue; }
    if (a === '--model' && argv[i + 1]) { args.model = argv[++i]; continue; }
    if (a === '--message' && argv[i + 1]) { args.message = argv[++i]; continue; }
    if (a === '--stream') { args.stream = true; continue; }
    rest.push(a);
  }
  if (rest[0]) args.token = rest[0];
  return args;
}

function usage() {
  console.log('Usage: node scripts/test-chat.mjs <token> [--host http://localhost:8000] [--model jimeng-3.0] [--message "一只狗"] [--stream]');
}

async function main() {
  const { token, host, model, message, stream } = parseArgs(process.argv);
  if (!token) { usage(); process.exit(1); }
  const url = `${host.replace(/\/$/, '')}/v1/chat/completions`;
  const headers = { Authorization: `Bearer ${token}` };
  const body = { model, messages: [{ role: 'user', content: message }], ...(stream ? { stream: true } : {}) };

  try {
    if (stream) {
      const resp = await axios.post(url, body, { headers, responseType: 'stream', timeout: 60000 });
      resp.data.on('data', (chunk) => process.stdout.write(chunk.toString()));
      await new Promise((resolve, reject) => {
        resp.data.on('end', resolve);
        resp.data.on('error', reject);
      });
    } else {
      const resp = await axios.post(url, body, { headers, timeout: 60000 });
      console.log(JSON.stringify(resp.data, null, 2));
    }
  } catch (err) {
    if (err.response) {
      console.error('HTTP Error:', err.response.status, err.response.statusText);
      console.error(JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('Error:', err.message || err);
    }
    process.exit(2);
  }
}

main();

