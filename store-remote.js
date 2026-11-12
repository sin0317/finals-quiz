'use strict';

/**
 * 云端持久化：Upstash Redis（基于官方 @upstash/redis SDK）。
 *
 * 配好这两个环境变量就启用，缺任意一个自动退回本地 JSON 文件：
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 * 可选 FQ_REDIS_PREFIX 给 key 加前缀，默认 `fq:`。
 *
 * 数据形态不变：仍是 users / cloud / stats / plaza / feedback 五份 JSON，
 * 只是从"写 data/*.json"换成"整份 SET 到 Redis"。
 * 启动时 MGET 一次全拉到内存，之后读走内存，写的时候整份覆盖。
 */

const { getRedis, resetRedis } = require('./lib/redis');

function createRemoteStore(env) {
  const prefix = String((env && env.FQ_REDIS_PREFIX) || 'fq:');
  const redis = getRedis(env);
  const state = { enabled: !!redis, lastError: '' };
  const cache = {};

  /* 启动时一次 MGET 把五份文档全拉下来，省命令数也避免逐份请求 */
  async function loadAll(names) {
    if (!redis) return cache;
    const keys = names.map(function (n) { return prefix + n; });
    const vals = await redis.mget(...keys);
    names.forEach(function (n, i) {
      const raw = vals && vals[i];
      if (!raw) { cache[n] = null; return; }
      /* SDK 会自动把 JSON 反序列化成对象；手写 fetch 时代拿到的是字符串。
         两种都认，别让版本差异把整库数据读成空 */
      if (typeof raw === 'object') { cache[n] = raw; return; }
      try { cache[n] = JSON.parse(raw); } catch (e) { cache[n] = null; }
    });
    return cache;
  }

  function read(name, fallback) {
    const v = cache[name];
    return (v && typeof v === 'object') ? v : fallback;
  }

  /* 写失败退避重试 2 次；三次都失败就抛给调用方，由上层决定要不要再标记 dirty */
  async function write(name, obj) {
    if (!redis) throw new Error('云端存储未启用');
    const body = JSON.stringify(obj);
    let lastErr = null;
    for (let i = 0; i < 3; i += 1) {
      try {
        await redis.set(prefix + name, body);
        cache[name] = obj;
        state.lastError = '';
        return true;
      } catch (e) {
        lastErr = e;
        await new Promise(function (r) { setTimeout(r, 200 * (i + 1)); });
      }
    }
    state.lastError = (lastErr && lastErr.message) || '未知错误';
    throw lastErr || new Error('云端存储写入失败');
  }

  return {
    state: state,
    loadAll: loadAll,
    read: read,
    write: write,
    get enabled() { return state.enabled; },
    get lastError() { return state.lastError; }
  };
}

module.exports = { createRemoteStore, resetRedis };
