'use strict';

console.log(`Current directory: ${process.cwd()}`);

process.env.NODE_ENV = process.env.NODE_ENV || 'production'

const Path = require('path');

const internals = {
  root: process.cwd(),
  env:  process.env.NODE_ENV
}

console.log('start with %s env',process.env.NODE_ENV)

module.exports = require(Path.join( internals.root, `./config/${internals.env}.json` ))
