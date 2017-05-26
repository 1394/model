'use strict'

class Record {
  constructor (rowData, options) {
    rowData = rowData || {}
    let newRecord = true
    if (options.processed) {
      newRecord = false
    }
    let config = {
      fields: options.fields || [],
      row: rowData,
      modified: {},
      keys: Object.keys(rowData)
    }
    this._config = () => config
    this.isNew = () => { return newRecord }
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
}

module.exports = Record
