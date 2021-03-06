// Copyright Parity Technologies (UK) Ltd., 2017.
// Released under the Apache 2/MIT licenses.

'use strict';

const EthereumUtil = require('ethereumjs-util');

const { buf2add } = require('../utils');
const redis = require('../redis');

// No more than 20 addresses per IP
const RATE_LIMITED_ADDRESSES = 20;

// TTL for an address per IP (in miliseconds)
const RATE_LIMITER_TTL = 24 * 3600 * 1000;

function error (ctx, code = 400, body = 'Invalid request') {
  ctx.status = code;
  ctx.body = body;
}

async function rateLimiter (_address, ip) {
  const address = _address.toLowerCase();
  const hkey = `rate-limiter::${ip}`;
  const now = Date.now();
  let count;

  // Update the key TTL
  await redis.pexpire(hkey, RATE_LIMITER_TTL);

  count = await redis.hlen(hkey);

  if (count >= RATE_LIMITED_ADDRESSES) {
    const all = await redis.hgetall(hkey);

    for (let raddress in all) {
      const updatedAt = parseInt(all[raddress]);

      if (now - updatedAt >= RATE_LIMITER_TTL) {
        await redis.hdel(hkey, raddress);
      }
    }

    count = await redis.hlen(hkey);
  }

  if (count < RATE_LIMITED_ADDRESSES || await redis.hexists(hkey, address)) {
    // Set the address' value
    await redis.hset(hkey, address, now.toString());
    return;
  }

  const error = new Error('you exceeded the number of addresses your IP can use');

  // Too Many Requests
  error.status = 429;
  throw error;
}

function verifySignature (address, message, signature) {
  const { v, r, s } = EthereumUtil.fromRpcSig(signature);

  if (!EthereumUtil.isValidSignature(v, r, s)) {
    throw new Error('Invalid signature');
  }

  const messageBuf = Buffer.from(message);
  const msgHash = EthereumUtil.hashPersonalMessage(messageBuf);
  const publicKey = EthereumUtil.ecrecover(msgHash, v, r, s);
  const signAddress = buf2add(EthereumUtil.pubToAddress(publicKey)).toLowerCase();

  if (signAddress !== address.toLowerCase()) {
    throw new Error('Wrong message signature');
  }
}

module.exports = {
  error,
  rateLimiter,
  verifySignature
};
