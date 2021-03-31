const assert = require('assert')

// const query = require('../lib/query')
const Model = require('../model')

Model.setConfig({default: true, database: 'test'})

const itemsModel = Model.create('items')

let res

res = itemsModel().find(['id', 'name']).from('protos')
// res.Q.toParam()
console.log('itemsModel.find([\'id\', \'name\']).from(\'protos\')', res.Q.toString())
