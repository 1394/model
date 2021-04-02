/* eslint-disable max-len */
const assert = require('assert')

const Model = require('../model')

Model.setConfig({default: true, database: 'test'})

const itemsModel = Model.create('items')
// SELECT
assert.strictEqual(
  itemsModel().find(['id', 'name']).from('protos').query.toString(),
  'SELECT items.id,items.name FROM items, protos'
)
// JOIN / FIELD
assert.strictEqual(
  itemsModel()
    .find(['id', 'name'])
    .join('protos', 'protos.id = items.proto_id')
    .field('protos.id AS protoName, protos.id AS pId')
    .query.toString(),
  'SELECT items.id,items.name,protos.id AS protoName, protos.id AS pId FROM items JOIN protos ON protos.id = items.proto_id'
)
// SELECT DISTINCT
assert.strictEqual(
  itemsModel().find(['id', 'name']).distinct('items.id').from('protos').query.toString(),
  'SELECT items.id,items.name,DISTINCT items.id FROM items, protos'
)

assert.strictEqual(
  itemsModel().insert().setFields({name: 'name', id: 2}).query.toString(),
  'INSERT INTO `items` (name,id) VALUES (\'name\',2)'
)

assert.strictEqual(
  itemsModel().update().where('id IN ?', [21, 345]).setFields({name: 'name', proto_id: 2}).query.toString(),
  'UPDATE `items` SET name = \'name\',proto_id = 2 WHERE id IN (21,345)'
)

