'use strict'

const prepareArgs = (args) => {
  return {
    table: args[0],
    foreignKey: args[1],
    primaryKey: args[2] || args[1].split('_').pop()
  }
}

let capitalizeWord = function (string) {
  return string[0].toUpperCase() + string.slice(1)
}

let capitalize = (string) => {
  return string.split('_').map(capitalizeWord).join('')
}

const buildAssoc = (record, assoc) => {
  if (assoc.belongsTo && assoc.belongsTo.length) {
    for (let opts of assoc.belongsTo) {
      buildBelongsToAssoc(record, prepareArgs(opts))
    }
  }
  if (assoc.hasMany && assoc.hasMany.length) {
    for (let opts of assoc.hasMany) {
      buildHasManyAssoc(record, prepareArgs(opts))
    }
  }
}

const buildBelongsToAssoc = (record, opts) => {
  record[`get${capitalize(opts.table)}`] = async function (cfg = {}) {
    if (!record.Model) {
      return
    }
    var data = await (new record.Model(opts.table, {debug: true}).find().where(`${opts.primaryKey} = ?`, record.get(opts.foreignKey)).doFirst())
    return data && new Record(data._data(), {
      processed: true,
      assoc: record.owner && record.owner.assocs.get(opts.table),
      owner: record.owner,
      model: record.Model
    })
  }
  record[`find${capitalize(opts.table)}`] = function (cfg = {}) {
    if (!record.Model) {
      return Promise.resolve()
    }
    return new record.Model(opts.table, {debug: true}).find().where(`${opts.primaryKey} = ?`, record.get(opts.foreignKey))
  }
}

const buildHasManyAssoc = (record, opts) => {
  record[`get${capitalize(opts.table)}`] = async function (cfg = {}) {
    if (!record.Model) {
      return
    }
    var data = await (new record.Model(opts.table, {debug: true}).find().where(`${opts.foreignKey} = ?`, record.get(opts.primaryKey)).do())
    return data.map(row => new Record(row._data(), {
      processed: true,
      assoc: record.owner && record.owner.assocs.get(opts.table),
      owner: record.owner,
      model: record.Model
    }))
  }
  record[`find${capitalize(opts.table)}`] = function (cfg = {}) {
    if (!record.Model) {
      return Promise.resolve()
    }
    return new record.Model(opts.table, {debug: true}).find().where(`${opts.foreignKey} = ?`, record.get(opts.primaryKey))
  }
}

/**
 * @class Record
 */
class Record {
/**
 * Creates an instance of Record.
 * @param {Object} rowData record data
 * @param {Object} options config
 * @param {Object} options.owner instance of Model
 * @param {Object} options.model Model class
 * @param {Object} options.table name of table in DB
 * @param {Boolean} options.processed flag what record is not new but existed record
 * @param {Object} options.assoc associations data
 * @memberof Record
 */
  constructor (rowData, options) {
    rowData = rowData || {}
    let newRecord = true
    if (options.processed) {
      newRecord = false
    }
    // this.Model = Model
    let config = {
      fields: options.fields || [],
      row: rowData,
      table: options.table,
      modified: new Map(),
      keys: new Set(Object.keys(rowData))
    }
    this.owner = options.owner
    this.Model = options.model
    this.attr = {}

    this._config = () => config
    this.isNew = () => newRecord
    this._data = () => config.row

    for (let k of config.keys) {
      this.attr[k] = this.get(k)
    }
    if (options.assoc) {
      buildAssoc(this, options.assoc)
    }
    return this
  }
/**
 * @param {any} key 
 * @param {any} value 
 * @returns Record instance
 * @memberof Record
 */
  set (key, value) {
    if (typeof key === 'string') {
      this._config().row[key] = value
      if (!this.isNew()) {
        this.has(key) && this._config().modified.set(key, value)
        this._config().row[key] = value
      }
      return this
    }
    if (typeof key === 'object' && Object.keys(key).length && !value) {
      for (let k of Object.keys(key)) {
        this.set(k, key[k])
      }
      return this
    }
    console.error('key is must be string or hash {key: value}')
    return this
  }



/**
 * @returns {Array} record fields
 * @memberof Record
 */
  keys () {
    return [...this._config().keys]
  }
/**
 * @param {String} key may be one field name or array of fields
 * @return {false|String} field if record has field, otherwise false
 * @memberof Record
 */
  has (fieldName) {
    return this._config().keys.has(fieldName) && fieldName
  }
/**
 * get value or few values or whole record data
 * @param {any} args if args is empty will return whole record as object {field1: value1, field2: value2}
 * @returns {any} value or array of values or whole record as object
 * @memberof Record
 * @example
 *    record data {id: 12, name: 'ivan', guid: 'qwed3d123das', archived: false}
 *    rec.get() // return {id: 12, name: 'ivan', guid: 'qwed3d123das', archived: false}
 *    rec.get('id') // return 12
 *    rec.get('id', 'name') // return [12, 'ivan']
 */
  get (...args) {
    let length = args.length
    if (length) {
      return length === 1 ? this._data()[args[0]] : args.map(el => this._data()[el])
    } else {
      return this._data()
    }
  }
/**
 * @param {any} args if args is empty return whole record otherwise return object with only fields in args
 * @returns {Object} return always record data as object
 * @memberof Record
 * @example
 *    record data {id: 12, name: 'ivan', guid: 'qwed3d123das', archived: false}
 *    rec.get() // return {id: 12, name: 'ivan', guid: 'qwed3d123das', archived: false}
 *    rec.get('id') // return {id: 12}
 *    rec.get('id', 'name') // return {id: 12, name: 'ivan'}
 */
  getObj (...args) {
    let obj = {}
    if (args.length) {
      args.forEach(el => {
        obj[el] = this._data()[el]
      })
    } else {
      this.keys().forEach(el => {
        obj[el] = this._data()[el]
      })
    }
    return obj
  }
/**
 * @private
 * @returns {Model} instance of Model
 * @memberof Record
 */
  modified () {
    if (this._config().modified.size === 0) {
      return false
    }
    let data = {}
    this._config().modified.forEach((i, key) => { data[key] = this._config().modified.get(key) })
    return data
  }
/**
 * @private
 * @returns {Model} instance of Model
 * @memberof Record
 */
  _getModel () {
    return new this.Model(this.owner.table, this.owner.modelConfig, this.owner.dbname)
  }
/**
 * @returns {Promise} Model instance
 * @memberof Record
 */
  find () {
    return this._getModel().find().where(`${this.owner.table}.id = ?`, this.get('id'))
  }
/**
 * @returns {Promise} Model instance
 * @memberof Record
 */
  update () {
    return this._getModel().update().where(`${this.owner.table}.id = ?`, this.get('id'))
  }
/**
 * @returns {Promise} Model instance
 * @memberof Record
 */
  save () {
    const me = this
    if (this.modified()) {
      return this._getModel().update().where(`${this.owner.table}.id = ?`, this.get('id')).setFields(this.modified()).do()
        .then((res) => {
          me._config().modified.clear()
          return res
        })
    } else {
      return Promise.resolve(me)
    }
  }
/**
 * @returns {Promise} Model instance
 * @memberof Record
 */
  delete () {
    return this._getModel().delete().where(`${this.owner.table}.id = ?`, this.get('id'))
  }
}

module.exports = Record
