/* eslint-disable max-len */
const assert = require('assert')

const Model = require('../model')

Model.setConfig({default: true, database: 'test'})

const itemsModel = Model.create('items')

assert.strictEqual(
  itemsModel().find(['id', 'name']).from('protos').query.toString(),
  'SELECT items.id,items.name FROM items, protos'
)

assert.strictEqual(
  itemsModel().find(['id', 'name']).distinct('items.id').from('protos').query.toString(),
  'SELECT items.id,items.name,DISTINCT items.id FROM items, protos'
)

assert.strictEqual(
  itemsModel().insert().setFields({name: 'name', id: 2}).query.toString(),
  'SELECT items.id,items.name,DISTINCT items.id FROM items, protos'
)

