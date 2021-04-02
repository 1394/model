/* eslint-disable max-len */
'use strict'

const prepareArgs = (args) => {
  return {
    table: args[0],
    foreignKey: args[1],
    primaryKey: args[2] || args[1].split('_').pop(),
  }
}

const capitalizeWord = function(string) {
  return string[0].toUpperCase() + string.slice(1)
}

const capitalize = (string) => {
  return string.split('_').map(capitalizeWord).join('')
}

const buildAssoc = (record, assoc) => {
  if (assoc.belongsTo && assoc.belongsTo.length) {
    for (const opts of assoc.belongsTo) {
      buildBelongsToAssoc(record, prepareArgs(opts))
    }
  }
  if (assoc.hasMany && assoc.hasMany.length) {
    for (const opts of assoc.hasMany) {
      buildHasManyAssoc(record, prepareArgs(opts))
    }
  }
}

const buildBelongsToAssoc = (record, opts) => {
  record[`get${capitalize(opts.table)}`] = async function(cfg = {}) {
    if (!record.Model) {
      return
    }
    const data = await (new record.Model(opts.table, {debug: true}).find().where(`${opts.primaryKey} = ?`, record.get(opts.foreignKey)).doFirst())
    return data && new Record(data._data(), {
      processed: true,
      assoc: record.owner && record.owner.assocs.get(opts.table),
      owner: record.owner,
      model: record.Model,
    })
  }
  record[`find${capitalize(opts.table)}`] = function(cfg = {}) {
    if (!record.Model) {
      return Promise.resolve()
    }
    return new record.Model(opts.table, {debug: true}).find().where(`${opts.primaryKey} = ?`, record.get(opts.foreignKey))
  }
}

const buildHasManyAssoc = (record, opts) => {
  record[`get${capitalize(opts.table)}`] = async function(cfg = {}) {
    if (!record.Model) {
      return
    }
    const data = await (new record.Model(opts.table, {debug: true}).find().where(`${opts.foreignKey} = ?`, record.get(opts.primaryKey)).do())
    return data.map((row) => new Record(row._data(), {
      processed: true,
      assoc: record.owner && record.owner.assocs.get(opts.table),
      owner: record.owner,
      model: record.Model,
    }))
  }
  record[`find${capitalize(opts.table)}`] = function(cfg = {}) {
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
  constructor(rowData, options = {}) {
    rowData = rowData || {}
    const newRecord = !options.processed
    const config = {
      strict: options.strict,
      fields: options.fields || [],
      row: rowData,
      table: options.owner && options.owner.table,
      modified: new Map(),
      keys: new Set(Object.keys(rowData)),
    }
    this._suppressNotExisted = options.suppressNotExisted
    this.owner = options.owner
    this.Model = options.model
    this.attr = Object.assign({}, rowData)

    this._config = () => config
    this.isNew = () => newRecord
    this._data = () => rowData

    if (options.assoc) {
      buildAssoc(this, options.assoc)
    }

    this.toJSON = () => this._data()

    return !config.strict ? this : new Proxy(this, {
      get(rec, field) {
        if (field === 'H' || field === '_H') {
          return rec
        }
        if (rec._config().keys.has(field)) {
          return rec.attr[field]
        } else {
          console.error(' [Model:Record:get:error] model:%s, field "%s" not existed', config.table, field)
        }
      },
      set(rec, field, val) {
        if (rec._config().keys.has(field)) {
          rec.attr[field] = val
          return true
        } else {
          console.error(' [Model:Record:set:error] model:%s, field "%s" not existed', config.table, field)
        }
      },
    })
  }
  /**
 * @param {any} key string or object, when object can be {name: 'name', ref_id: 3604}, for example item.set({name: 'name', ref_id: 3604}) will set name to 'name' and ref_id to 3604
 * @param {any} value value of field
 * @return Record instance
 * @memberof Record
 */
  set(key, value) {
    if (typeof key === 'string') {
      if (!this.has(key)) {
        console.warn(`field : ${key} not found in model, ignore to set!`)
        return this
      }
      this._config().row[key] = value
      if (!this.isNew()) {
        this._config().modified.set(key, value)
        this._config().row[key] = value
      }
      return this
    }
    if (typeof key === 'object' && Object.keys(key).length && !value) {
      for (const k of Object.keys(key)) {
        this.set(k, key[k])
      }
      return this
    }
    console.error('key is must be string or hash {key: value}')
    return this
  }

  /**
 * @return {Array} record fields
 * @memberof Record
 */
  keys() {
    return [...this._config().keys]
  }
  /**
 * @param {String} fieldName may be one field name or array of fields
 * @return {false|String} field if record has field, otherwise false
 * @memberof Record
 */
  has(fieldName) {
    return this._config().keys.has(fieldName) && fieldName
  }
  /**
 * get value or few values or whole record data
 * @param {any} args if args is empty will return whole record as object {field1: value1, field2: value2}
 * @return {any} value or array of values or whole record as object
 * @memberof Record
 * @example
 *    record data {id: 12, name: 'ivan', guid: 'qwed3d123das', archived: false}
 *    rec.get() // return {id: 12, name: 'ivan', guid: 'qwed3d123das', archived: false}
 *    rec.get('id') // return 12
 *    rec.get('id', 'name') // return [12, 'ivan']
 */
  get(...args) {
    if (args.length) {
      if (!this._suppressNotExisted) {
        const notExistedField = args.find((arg) => !this._config().keys.has(arg))
        if (notExistedField) {
          throw new Error(` [Error:get] field[${notExistedField}] does not exist, detected while trying to access table[${this._config().table}] entry!`)
        }
      }
      return args.length === 1 ? this._data()[args[0]] : args.map((el) => this._data()[el])
    } else {
      return this._data()
    }
  }
  /**
 * @param {any} args if args is empty return whole record otherwise return object with only fields in args
 * @return {Object} return always record data as object
 * @memberof Record
 * @example
 *    record data {id: 12, name: 'ivan', guid: 'qwed3d123das', archived: false}
 *    rec.get() // return {id: 12, name: 'ivan', guid: 'qwed3d123das', archived: false}
 *    rec.get('id') // return {id: 12}
 *    rec.get('id', 'name') // return {id: 12, name: 'ivan'}
 */
  getObj(...args) {
    const obj = {}
    if (args.length) {
      args.forEach((el) => {
        obj[el] = this._data()[el]
      })
    } else {
      this.keys().forEach((el) => {
        obj[el] = this._data()[el]
      })
    }
    return obj
  }
  /**
 * @private
 * @return {Model} instance of Model
 * @memberof Record
 */
  modified() {
    if (this._config().modified.size === 0) {
      return false
    }
    const data = {}
    this._config().modified.forEach((i, key) => {
      data[key] = this._config().modified.get(key)
    })
    return data
  }
  /**
 * @private
 * @return {Model} instance of Model
 * @memberof Record
 */
  _getModel() {
    return new this.Model(this.owner.table, this.owner.modelConfig, this.owner.dbname)
  }
  /**
 * @return {Promise} Model instance
 * @memberof Record
 */
  find() {
    return this._getModel().find().where(`${this.owner.table}.id = ?`, this.get('id'))
  }
  /**
 * @return {Promise} Model instance
 * @memberof Record
 */
  update() {
    return this._getModel().update().where(`${this.owner.table}.id = ?`, this.get('id'))
  }
  /**
 * @return {Promise} Model instance
 * @memberof Record
 */
  save() {
    const me = this
    if (this.modified()) {
      return this._getModel().update().where(`${this.owner.table}.id = ?`, this.get('id')).setFields(this.modified()).do()
        .then((res) => {
          me._config().modified.clear()
          return me
        })
    } else {
      return me
    }
  }
  /**
 * @return {Promise} Model instance
 * @memberof Record
 */
  delete() {
    return this._getModel().delete().where(`${this.owner.table}.id = ?`, this.get('id'))
  }
}

module.exports = Record
