import Redis from 'ioredis';

type CacheRecord = {
  value: string;
  expiresAt: number | null;
};

const memoryCache = new Map<string, CacheRecord>();

const redisUrl = process.env.REDIS_URL || process.env.REPORT_REDIS_URL || '';

let redis: Redis | null = null;
let redisReady = false;
let redisDisabled = false;

async function getRedisClient(): Promise<Redis | null> {
  if (!redisUrl || redisDisabled) {
    return null;
  }

  if (!redis) {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    redis.on('error', () => {
      redisDisabled = true;
      redisReady = false;
      redis?.disconnect();
      redis = null;
    });
  }

  if (!redisReady) {
    try {
      await redis.connect();
      redisReady = true;
    } catch {
      redisDisabled = true;
      redisReady = false;
      redis.disconnect();
      redis = null;
      return null;
    }
  }

  return redis;
}

export async function getCache(key: string): Promise<string | null> {
  const client = await getRedisClient();
  if (client) {
    return client.get(key);
  }

  const record = memoryCache.get(key);
  if (!record) {
    return null;
  }
  if (record.expiresAt !== null && record.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return record.value;
}

export async function setCache(key: string, value: string, ttlSeconds: number): Promise<void> {
  const client = await getRedisClient();
  if (client) {
    await client.set(key, value, 'EX', Math.max(1, ttlSeconds));
    return;
  }

  memoryCache.set(key, {
    value,
    expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
  });
}

export async function deleteCache(key: string): Promise<void> {
  const client = await getRedisClient();
  if (client) {
    await client.del(key);
    return;
  }

  memoryCache.delete(key);
}

export async function deleteCacheByPrefix(prefix: string): Promise<void> {
  const client = await getRedisClient();
  if (client) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } while (cursor !== '0');
    return;
  }

  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}
