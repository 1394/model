/* eslint-disable max-len */
const assert = require('assert')

const Q = require('../lib/query')

const q = () => new Q

// SELECT
assert.strictEqual(
  q().select('items').toString(),
  'SELECT items.* FROM items'
)
// SELECT FIELDS
assert.strictEqual(
  q().select('items', ['id', 'name']).toString(),
  'SELECT id,name FROM items'
)
// SELECT FIELDS
assert.strictEqual(
  q().select('items', 'items.*').toString(),
  'SELECT items.* FROM items'
)
// SELECT
assert.strictEqual(
  q()
    .select('items', ['id', 'name'])
    .extraFrom('protos')
    .toString(),
  'SELECT id,name FROM items, protos'
)
// SELECT JOIN FIELD
assert.strictEqual(
  q()
    .select('items')
    .join('protos', 'protos.id = items.proto_id')
    .field('protos.name AS protoName')
    .toString(),
  'SELECT items.*,protos.name AS protoName FROM items JOIN protos ON protos.id = items.proto_id'
)
// UPDATE
assert.strictEqual(
  q().update('items').updateFields({name: '111'}).toString(),
  'UPDATE `items` SET name = \'111\''
)

// INSERT
assert.strictEqual(
  q().insert('items').insertFields({name: 'qwe', id: 2}).toString(),
  'UPDATE `items` SET name = \'111\''
)

// DELETE
assert.strictEqual(
  q()
    .delete('items')
    .where('items.id IN ? AND items.proto_id = ?', [1, 2, 3], 38)
    .order('items.created_at DESC')
    .limit(5)
    .toString(),
  'DELETE FROM `items` WHERE items.id IN (1,2,3) AND items.proto_id = 38 ORDER BY items.created_at DESC LIMIT 5'
)

assert.throws(
  () => q().insert('items').select('items').extraFrom('protos').toString(),
  new Error('cant run [select] in :insert mode'),
  'unexpected error'
)

assert.throws(
  () => q()
    .insert('items')
    .extraFrom(['protos'])
    .insertFields({name: '111', id: 'protos.id'})
    .where('protos.publicate = 1')
    .toString(),
  new Error('cant run [where] in :insert mode'),
  'unexpected error'
)

assert.throws(
  () => q().update().select('items', ['id', 'name']).extraFrom('protos').toString(),
  new Error('cant run [select] in :update mode'),
  'unexpected error'
)
