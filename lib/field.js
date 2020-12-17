/* eslint-disable require-jsdoc */
'use strict'

const cvt = require('pluralize')

const internals = {
  convert: function(obj) {
    obj = obj || {}
    return Object.keys(obj).map((k) => {
      return [k, obj[k]]
    })
  },
  processFields: function(row, fields) {
    const newRow = {}
    fields.forEach(function(field) {
      if (typeof field === 'string') {
        newRow[field] = row[field]
      }
      if (typeof field.convert === 'function' && field.name) {
        newRow[field.name] = field.convert(row[field.name], row)
      }
    })
    return newRow
  },
}

function escape(str) {
  return '`' + str + '`'
}

function Field(opts) {
  opts = opts || {}
  opts.data = opts.data || {}

  this.model = opts.model
  this._model = opts._model
  this._fields = opts.fields

  this.raw = opts.data

  this.data = new Map(internals.convert(this.raw))

  return this
}

Field.prototype.json = function() {
  const row = internals.processFields(this.raw, this._fields)
}

Field.prototype.values = function() {
  if (this._fields && util.isArray(this._fields)) {
    return internals.processFields(this.raw, this._fields)
  } else {
    return this.raw
  }
}

Field.prototype.find = function() {
  return this.model.find().where(`${escape(this.model.table)}.id = ?`, this.raw.id)
}

Field.prototype.update = function(opts) {
  opts = opts || {}

  return this.model
    .update()
    .where(`${escape(this.model.table)}.id = ?`, this.raw.id)
    .setFields(opts)
    .end()
    .then((data) => {
      Object.keys(opts).forEach((k) => {
        this.data.set(k, opts[k])
        this.raw[k] = opts[k]
      })
      return data
    })
}

Field.prototype.delete = function() {
  return this.model.delete().where(`${escape(this.model.table)}.id = ?`, this.raw.id).end()
}

Field.prototype.belongsTo = function(model, opts) {
  opts = opts || {}
  opts.model = model
  if (!opts.model) {
    return Promise.reject(new Error('cant model be empty'))
  }

  opts.joinModel = this.model.table
  opts.join = `${escape(opts.joinModel)}.${cvt(opts.model, 1)}_id = ${escape(opts.model)}.id`
  console.log('join model : ', opts.join)

  return new this._model(opts.model)
    .find()
    .join(opts.joinModel, opts.join)
    .where(`${escape(opts.joinModel)}.id = ?`, this.raw.id)
    .limit(1)
}

Field.prototype.hasMany = function(model, opts) {
  opts = opts || {}
  opts.model = model
  if (!opts.model) {
    return Promise.reject(new Error('cant model be empty'))
  }

  opts.joinModel = this.model.table
  opts.join = `${escape(opts.joinModel)}.id = ${escape(opts.model)}.${cvt(opts.joinModel, 1)}_id`
  console.log('join model : ', opts.join)

  return new this._model(opts.model)
    .find()
    .join(opts.joinModel, opts.join)
    .where(`${escape(opts.joinModel)}.id = ?`, this.raw.id)
}

module.exports = Field

/**

var model = require('./app/models/model');
var Item = new model('items');
Item.find().where('publicate=1').limit(200).end().then(r=>{items=r})
items[0].belongsTo('protos').then(p=>{console.log(p)}).catch(err=>{console.error(err)})

*/

