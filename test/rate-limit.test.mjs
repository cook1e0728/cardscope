import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../providers/backend-reliability.mjs';

test('rate limiter counts per key and resets after the window',()=>{
  let clock=0;
  const allow=createRateLimiter({limit:2,windowMs:1000,now:()=>clock});
  assert.deepEqual([allow('a'),allow('a'),allow('a'),allow('b')],[true,true,false,true]);
  clock=1000;
  assert.equal(allow('a'),true);
});
