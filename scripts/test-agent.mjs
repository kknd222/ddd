#!/usr/bin/env node
import axios from 'axios';
import crypto from 'crypto';
import { createParser } from 'eventsource-parser';

function md5(v) { return crypto.createHash('md5').update(v).digest('hex'); }

function usage() {
  console.log('用法: node scripts/test-agent.mjs <token> [--host http://localhost:8777] [--region US] [--message "讲个20字的笑话"]');
}

function parseArgs(argv) {
  const args = { host: 'http://localhost:8777', region: 'US', message: '讲个20字的笑话' };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host' && argv[i + 1]) { args.host = argv[++i]; continue; }
    if (a === '--region' && argv[i + 1]) { args.region = argv[++i]; continue; }
    if (a === '--message' && argv[i + 1]) { args.message = argv[++i]; continue; }
    rest.push(a);
  }
  if (!rest[0]) return null;
  args.token = rest[0];
  return args;
}

async function testUpstream(token, region, message) {
  const base = region.toUpperCase() === 'US' ? 'https://dreamina-api.us.capcut.com' : `https://mweb-api-sg.capcut.com`;
  const path = '/mweb/v1/creation_agent/v2/conversation';
  const url = `${base}${path}`;
  const deviceTime = Math.floor(Date.now() / 1000);
  const sign = md5(`9e2c|${path.slice(-7)}|7|7.5.0|${deviceTime}||11ac`);
  const body = {
    conversation_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    messages: [{
      author: { role: 'user' },
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      content: { content_parts: [{ text: message }] },
      metadata: { is_visually_hidden_from_conversation: false },
      create_time: Date.now(),
      tools: []
    }],
    version: '3.0.0'
  };
  const headers = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    Origin: 'https://dreamina.capcut.com',
    Referer: 'https://dreamina.capcut.com/',
    Pf: '7',
    Appid: '513641',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Device-Time': deviceTime,
    Sign: sign,
    'Sign-Ver': '1',
    Did: String(Math.floor(Math.random() * 1e16)),
    Cookie: `sessionid=${token}; sessionid_ss=${token}`,
  };
  const params = {
    aid: '513641',
    device_platform: 'web',
    region,
    webId: 'undefined',
    da_version: '3.1.3',
    web_version: '7.5.0',
    web_component_open_flag: 1,
  };

  console.log('—— 上游原始事件 ——');
  try {
    const resp = await axios.post(url, body, { headers, params, responseType: 'stream', timeout: 30000, validateStatus: () => true });
    const parser = createParser((evt) => {
      if (evt.type === 'event') {
        console.log(`event: ${evt.event}\n${evt.data}\n`);
      }
    });
    resp.data.on('data', (chunk) => parser.feed(chunk.toString('utf8')));
    await new Promise((resolve, reject) => { resp.data.on('end', resolve); resp.data.on('error', reject); });
  } catch (err) {
    if (err.response) {
      console.error('上游HTTP错误:', err.response.status, err.response.statusText);
      console.error(JSON.stringify(err.response.data));
    } else {
      console.error('上游错误:', err.message || err);
    }
  }
}

async function testLocal(host, token, message) {
  const url = `${host.replace(/\/$/, '')}/v1/chat/completions`;
  const headers = { Authorization: `Bearer ${token}` };
  const body = { model: 'agent', stream: true, messages: [{ role: 'user', content: message }] };
  console.log('—— 本地代理SSE ——');
  try {
    const resp = await axios.post(url, body, { headers, responseType: 'stream', timeout: 30000 });
    resp.data.on('data', (chunk) => process.stdout.write(chunk.toString()));
    await new Promise((resolve, reject) => { resp.data.on('end', resolve); resp.data.on('error', reject); });
  } catch (err) {
    if (err.response) {
      console.error('本地HTTP错误:', err.response.status, err.response.statusText);
      console.error(JSON.stringify(err.response.data));
    } else {
      console.error('本地错误:', err.message || err);
    }
  }
  console.log('\n—— 本地非流式 ——');
  try {
    const resp = await axios.post(url, { ...body, stream: false }, { headers, timeout: 30000 });
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (err) {
    if (err.response) {
      console.error('本地HTTP错误:', err.response.status, err.response.statusText);
      console.error(JSON.stringify(err.response.data));
    } else {
      console.error('本地错误:', err.message || err);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) { usage(); process.exit(1); }
  const { token, host, region, message } = args;
  await testUpstream(token, region, message);
  await testLocal(host, token, message);
}

main();

