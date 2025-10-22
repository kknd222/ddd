import axios from 'axios';

function parseArgs(argv) {
  const args = { host: 'http://localhost:8777', prompt: '一只可爱的猫', stream: true, response_format: 'url' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!args.token) { args.token = a; continue; }
    if (a === '--host') { args.host = argv[++i]; continue; }
    if (a === '--prompt') { args.prompt = argv[++i]; continue; }
    if (a === '--b64') { args.response_format = 'b64_json'; continue; }
    if (a === '--no-stream') { args.stream = false; continue; }
  }
  return args;
}

async function main() {
  const { token, host, prompt, stream, response_format } = parseArgs(process.argv);
  if (!token) {
    console.log('Usage: node scripts/test-images.mjs <token> [--host http://localhost:8777] [--prompt "一只可爱的猫"] [--b64] [--no-stream]');
    process.exit(1);
  }
  const url = host.replace(/\/$/, '') + '/v1/images/generations';
  const headers = { Authorization: token };
  const body = { prompt, stream, response_format };

  if (stream) {
    const resp = await axios.post(url, body, { headers, responseType: 'stream', timeout: 60000 });
    resp.data.on('data', (chunk) => process.stdout.write(chunk.toString()));
    resp.data.on('end', () => console.log('\n[stream end]'));
  } else {
    const resp = await axios.post(url, body, { headers, timeout: 60000 });
    console.log(JSON.stringify(resp.data, null, 2));
  }
}

main().catch((e) => { console.error(e?.response?.data || e.message); process.exit(1); });

