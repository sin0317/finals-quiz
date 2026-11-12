'use strict';

/**
 * Upstash Redis 客户端（基于官方 @upstash/redis SDK）。
 *
 * 从环境变量读取配置：
 *   UPSTASH_REDIS_REST_URL   —— REST 端点
 *   UPSTASH_REDIS_REST_TOKEN —— REST 令牌
 *   FQ_REDIS_PREFIX          —— 可选 key 前缀，默认 `fq:`
 *
 * 环境变量缺失时回落到 data/redis.config.json（托管环境不支持明文注入密钥时用）。
 * 缺任意一个必填项时返回 null，由调用方决定是否退回本地存储。
 */

const fs = require('fs');
const path = require('path');

const { Redis } = require('@upstash/redis');

let instance = null;

/* data/ 目录不会被静态服务暴露，配置文件放这里等于私密 */
let fileErr = '';

function fileConfig() {
  if (process.env.NODE_ENV === 'test') { fileErr = 'skipped(test)'; return {}; }
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'redis.config.json'), 'utf8');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    fileErr = (e && e.code) || (e && e.message) || 'read-failed';
    return {};
  }
}

function createRedisClient(env) {
  const e = env || process.env || {};
  const file = fileConfig();
  const url = String(e.UPSTASH_REDIS_REST_URL || file.url || '').trim().replace(/\/+$/, '');
  const token = String(e.UPSTASH_REDIS_REST_TOKEN || file.token || '').trim();
  if (!url || !token) {
    console.log('[期末刷题] Redis 未启用：环境变量' + (e.UPSTASH_REDIS_REST_URL ? '有 URL' : '无 URL')
      + '，配置文件' + (file.url ? '已读到' : '未读到') + (fileErr ? '（' + fileErr + '）' : ''));
    return null;
  }

  return new Redis({
    url: url,
    token: token
  });
}

function getRedis(env) {
  if (!instance) instance = createRedisClient(env);
  return instance;
}

function resetRedis() {
  instance = null;
}

module.exports = { createRedisClient, getRedis, resetRedis };
