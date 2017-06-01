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


class Record {
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
      modified: {},
      keys: Object.keys(rowData)
    }
    this._config = () => config
    this.owner = options.owner
    this.isNew = () => { return newRecord }
    this.Model = options.model
    this.keys = () => config.keys
    this.set = function (key, value) {
      if (newRecord) {
        config.row[key] = value
      } else {
        if (!config.modified.hasOwnProperty(key) && config.row[key] !== value) {
          config.modified[key] = this.has(key) ? config.row[key] : '_newValue'
        }
        config.row[key] = value
      }
    }
    this._data = function () { return config.row }
    this.attr = {}
    for (let k of config.keys) {
      this.attr[k] = this.get(k)
    }
    if (options.assoc) {
      buildAssoc(this, options.assoc)
    }
    return this
  }

  has (key) {
    this.keys().includes(key)
  }

  get (...args) {
    let length = args.length
    if (length) {
      return length === 1 ? this._data()[args[0]] : args.map(el => this._data()[el])
    } else {
      return this._data()
    }
  }

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

  _getModel () {
    return new this.Model(this.owner.table, this.owner.modelConfig, this.owner.dbname)
  }

  find () {
    return this._getModel().find().where(`${this.owner.table}.id = ?`, this.get('id'))
  }
  update () {
    return this._getModel().update().where(`${this.owner.table}.id = ?`, this.get('id'))
  }
  delete () {
    return this._getModel().delete().where(`${this.owner.table}.id = ?`, this.get('id'))
  }
}

module.exports = Record
