'use strict'

const internals = {
  prepareColumn (column) {
    if (typeof column === 'string' && column === 'id') {
      return '`id` int(11) NOT NULL AUTO_INCREMENT, PRIMARY KEY (`id`)'
    }
    if (typeof column === 'string' && column === 'created_at') {
      return '`created_at` timestamp DEFAULT CURRENT_TIMESTAMP'
    }
    if (typeof column === 'string' && column === 'updated_at') {
      return '`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
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
      field.notnull = field.options.notnull ? 'NOT NULL' : ''
      field.comment = field.comment || ''
      field.default = field.default || ''
      field.op = field.options.op || ''
      return [
        field.op,
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
    this.cfg = {
      tableName: tableName
    }

    if (!(this.cfg.tableName || '').length) {
      throw new Error('tableName cant be empty')
    }
    this.Table = new this.Model(this.cfg.tableName)
    return this
  }

  async create (options) {
    options = options || {}
    options.columns = options.columns || []
    var me = this
    var cfg = {
      exists: await this.Table.exists(),
      engine: options.engine || 'InnoDB',
      charset: options.charset || 'utf8',
      like: ''
    }
    if (options.force && cfg.exists) {
      options.force = await this.Table.base.do(`DROP TABLE ${this.cfg.tableName}`).catch(e => { me.error(e); throw e })
    }
    if (options.like && options.like.length) {
      cfg.like = await this.Table.exists(options.like)
      cfg.like = cfg.like ? `LIKE \`${options.like}\`` : ''
    }
    if (!Array.isArray(options.columns)) {
      options.columns = [options.columns]
    }
    cfg.columns = options.columns.map(internals.prepareColumn)
    cfg.columns = '(' + cfg.columns.join(',') + ')'
    let sql = `CREATE TABLE IF NOT EXISTS \`${this.cfg.tableName}\` ${cfg.like} ${cfg.columns} ENGINE=${cfg.engine} DEFAULT CHARSET=${cfg.charset}`
    if (options.verbose) {
      console.log(sql)
    }
    if (!options.fake) {
      if (!options.verbose) {
        console.log(sql)
      }
      this.result = await this.Table.base.do(sql).catch(e => { me.error(e); throw e }).then((res) => { console.log(`DONE CREATE ${me.cfg.tableName}`); return res })
    }
    return this
  }

  async alter (options) {
    options = options || {}
    options.columns = options.columns || []
    var me = this
    var cfg = {
      exists: await this.Table.exists()
    }
    if (!cfg.exists) {
      throw new Error('error while migration : table ' + this.cfg.tableName + ' not exist')
    }
    if (!Array.isArray(options.columns)) {
      options.columns = [options.columns]
    }
    cfg.columns = options.columns.map(internals.prepareColumn)
    let sql = `ALTER TABLE \`${this.cfg.tableName}\` ${cfg.columns.join(' ')}`
    if (options.verbose) {
      console.log(sql)
    }
    if (!options.fake) {
      if (!options.verbose) {
        console.log(sql)
      }
      this.result = await this.Table.base.do(sql).catch(e => { me.error(e); throw e }).then((res) => { console.log(`DONE ALTER ${me.cfg.tableName}`); return res })
    }
    return this
  }

  async drop (ignoreExistance) {
    var me = this
    var cfg = {
      exists: await this.Table.exists()
    }
    if (cfg.exists) {
      this.result = await this.Table.base.do(`DROP TABLE \`${this.cfg.tableName}\``).catch(e => { me.error(e); throw e }).then((res) => { console.log(`DONE DROP ${me.cfg.tableName}`); return res })
    } else {
      let e = new Error(`table ${this.cfg.tableName} not exist`)
      this.error(e)
      if (!ignoreExistance) {
        throw e
      }
    }
    return this
  }

  error (e) {
    // console.error(`error while migrate ${this.cfg.tableName}`)
    console.error(`error while migrate`)
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
