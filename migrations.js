'use strict'

const internals = {
  prepareColumn (column) {
    if (typeof column === 'string' && column === 'id') {
      return '`id` int(11) NOT NULL AUTO_INCREMENT, PRIMARY KEY (`id`)'
    }
    if (typeof column === 'string' && column === 'created_at') {
      return '`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP'
    }
    if (typeof column === 'string' && column === 'updated_at') {
      return '`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
    }
    if (typeof column === 'string' && column.length) {
      return column
    }
    if (Array.isArray(column) && column.length === 3) {
      let field = {
        name: column.shift(),
        type: column.shift(),
        options: column.shift()
      }
      field.autoincrement = field.options.autoincrement ? 'AUTO_INCREMENT' : ''
      field.notnull = field.options.notnull ? 'NOT NULL' : 'NULL'
      field.comment = field.comment || ''
      field.default = field.default || ''
      return [
        '`' + field.name + '`',
        field.type,
        field.notnull,
        field.default,
        field.autoincrement,
        field.comment
      ].join(' ')
    }
    let msg = 'error column definition, must be string such as id,created_at,updated_at or array [fieldName,fieldType,fieldOptions] : '
    console.error(msg, column)
    throw new Error(msg + require('util').inspect(column, {depth: Infinity}))
  }
}

class Migrations {
  constructor (tableName) {
    this.Model = require('./model')
    this.columns = []

    if (!(tableName || '').length) {
      throw new Error('tableName cant be empty')
    }
    this.tableName = tableName
    this.Table = new this.Model(this.tableName)
    return this
  }

  columns (columns) {
    if (!Array.isArray(columns)) {
      columns = [columns]
    }
    this.columns = columns.map(internals.prepareColumn)
  }

  async create (options) {
    var me = this
    let cfg = {
      exists: await this.tableName.exists(),
      engine: options.engine || 'InnoDB',
      charset: options.charset || 'utf8'
    }
    if (options.force && cfg.exists) {
      options.force = await this.Table.base.do(`DROP TABLE ${this.tableName}`).catch(e => { me.error(e); throw e })
    }
    if (options.like && options.like.length) {
      cfg.like = await this.Table.exists(options.like)
    }
    cfg.columns = '(' + this.columns.join(',') + ')'
    let result = await this.Table.base.do(`CREATE IF NOT EXISTS \`${this.tableName}\` ${cfg.columns} ENGINE=${cfg.engine} DEFAULT CHARSET=${cfg.charset}`).catch(e => { me.error(e); throw e })
    return result
  }

  async drop (ignoreExistance) {
    var me = this
    let cfg = {
      exists: await this.tableName.exists()
    }
    if (cfg.exists) {
      let result = await this.Table.base.do(`DROP TABLE \`${this.tableName}\``).catch(e => { me.error(e); throw e })
      return result
    } else {
      let e = new Error(`table ${this.tableName} not exist`)
      this.error(e)
      if (!ignoreExistance) {
        throw e
      }
    }
  }

  error (e) {
    console.error(`error while migrate ${this.tableName}`)
    console.dir(e, {depth: Infinity})
  }
}



module.exports = Migrations

/**
 *
 * const Migrations = require('@dmitri.leto/migrations')
 *
 * const Item = new Migrations('items')
 *
 * async function up () {
 *    await Item.columns([
 *      'id INT AUTO_INCREMENT PRIMARY KEY',
 *      'currency_guid VARCHAR(60)'
 *    ]).create({force: true, like: 'items2'}).catch(Item.error)
 * }
 *
 */
