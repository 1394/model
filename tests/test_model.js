/* eslint-disable max-len */
const assert = require('assert')

const Model = require('../model')

const getModel = (table) => Model.create(table, {raw: true})()

Model.setConfig({default: true, database: 'test'})

const itemsModel = Model.create('items')
// SELECT
assert.strictEqual(
  itemsModel().find(['id', 'name']).from('protos').query.toString(),
  'SELECT items.id,items.name FROM items, protos'
)
// WHERE IN
assert.strictEqual(
  itemsModel()
    .find(['id', 'name'])
    .where('id IN ?', ['123', '1234fdf'])
    .query.toString(),
  "SELECT items.id,items.name FROM items WHERE id IN ('123','1234fdf')"
)
// ORDER BY
assert.strictEqual(
  itemsModel()
    .find(['id', 'name'])
    .order('items.id')
    .order('items.name', 'DESC')
    .query.toString(),
  'SELECT items.id,items.name FROM items ORDER BY items.id ASC, items.name DESC'
)
// JOIN / FIELD
assert.strictEqual(
  itemsModel()
    .find()
    .join('protos', 'protos.id = items.proto_id')
    .field('protos.id AS protoName, protos.id AS pId')
    .query.toString(),
  'SELECT items.*,protos.id AS protoName, protos.id AS pId FROM items JOIN protos ON protos.id = items.proto_id'
)
// SELECT DISTINCT
assert.strictEqual(
  itemsModel().find(['id', 'name']).distinct('items.id').from('protos').query.toString(),
  'SELECT DISTINCT items.id, items.id,items.name FROM items, protos'
)

assert.strictEqual(
  itemsModel().insert().setFields({name: 'name', id: 2}).query.toString(),
  "INSERT INTO `items` (`name`,`id`) VALUES ('name',2)"
)

assert.strictEqual(
  itemsModel().update().where('id IN ?', [21, 345]).setFields({name: 'name', proto_id: 2}).query.toString(),
  "UPDATE `items` SET `name` = 'name',`proto_id` = 2 WHERE id IN (21,345)"
)

assert.strictEqual(
  getModel('price_limit_tpls')
    .find()
    .leftJoin('brands', 'brands.id = JSON_EXTRACT(price_limit_tpls.template, "$.brand_id")')
    .leftJoin('protos', 'protos.id = JSON_EXTRACT(price_limit_tpls.template, "$.proto_id")')
    .leftJoin('classifiers', 'classifiers.id = JSON_EXTRACT(price_limit_tpls.template, "$.classifier_id")')
    .field('CONCAT_WS("/", brands.name, COALESCE(CONCAT(" группа: ", protos.protoname), CONCAT(" серия: ", classifiers.serie))) AS targetName')
    .query.toString(),
    `SELECT price_limit_tpls.*,CONCAT_WS("/", brands.name, COALESCE(CONCAT(" группа: ", protos.protoname), CONCAT(" серия: ", classifiers.serie))) AS targetName FROM price_limit_tpls LEFT JOIN brands ON brands.id = JSON_EXTRACT(price_limit_tpls.template, "$.brand_id") LEFT JOIN protos ON protos.id = JSON_EXTRACT(price_limit_tpls.template, "$.proto_id") LEFT JOIN classifiers ON classifiers.id = JSON_EXTRACT(price_limit_tpls.template, "$.classifier_id")`
)
