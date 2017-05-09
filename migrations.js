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
  constructor (table, options) {
    let tableName = table || ''
    this.tableName = function (raw) {
      return raw ? tableName : '`' + tableName + '`'
    }
    if (!(this.tableName(true)).length) {
      throw new Error('tableName cant be empty')
    }
    this.Model = require('./model')
    this.Table = new this.Model(this.tableName(true), options)
    let columns = []
    this.setColumn = function (col) { columns.push(col) }
    this.getColumns = function () { return columns }
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
      collate: options.collate || 'utf8_unicode_ci',
      like: ''
    }
    if (options.force && cfg.exists) {
      options.force = await this.Table.base.do(`DROP TABLE ${this.tableName()}`).catch(e => { me.error(e); throw e })
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
    let sql = `CREATE TABLE IF NOT EXISTS ${this.tableName()} ${cfg.like} ${cfg.columns} ENGINE=${cfg.engine} DEFAULT CHARSET=${cfg.charset} COLLATE=${cfg.collate}`
    if (options.verbose) {
      console.log(sql)
    }
    if (!options.fake) {
      if (!options.verbose) {
        console.log(sql)
      }
      this.result = await this.Table.base.do(sql).catch(e => { me.error(e); throw e }).then((res) => { console.log(`DONE CREATE ${me.tableName()}`); return res })
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
      throw new Error('error while migration : table ' + this.tableName(true) + ' not exist')
    }
    if (!Array.isArray(options.columns)) {
      options.columns = [options.columns]
    }
    cfg.columns = this.getColumns().join(',')
    let sql = `ALTER TABLE ${this.tableName()} ${cfg.columns}`
    if (options.verbose) {
      console.log(sql)
    }
    if (!options.fake) {
      if (!options.verbose) {
        console.log(sql)
      }
      this.result = await this.Table.base.do(sql).catch(e => { me.error(e); throw e }).then((res) => { console.log(`DONE ALTER ${me.tableName()}`); return res })
    }
    return this
  }

  async addColumns (columns) {
    columns.forEach(col => this.addColumn.apply(this, col))
    return this
  }

  async addColumn (name, type, options) {
    name = '`' + name + '`'
    if (options.notnull) {
      options.notnull = 'NOT NULL'
    } else {
      options.notnull = 'NULL'
    }
    options.default = options.default || ''
    options.update = options.update ? `ON UPDATE ${options.update}` : ''
    if (options.autoincrement) {
      options.notnull = true
    }
    let sql = [
      'ADD',
      name,
      type
    ]
    sql.push(options.notnull ? 'NOT NULL' : 'NULL')
    sql.push(options.default)
    sql.push(options.update)
    if (options.autoincrement) {
      sql.push('AUTO_INCREMENT, ADD PRIMARY')
    }
    this.setColumn(sql.join(' '))
    return this
  }

  async modifyColumns (columns) {
    columns.forEach(col => this.modifyColumn.apply(this, col)).join(',')
    return this
  }

  async modifyColumn (name, type, options) {
    name = '`' + name + '`'
    if (options.notnull) {
      if (!options.notnullDefault) {
        throw new Error('cant add notnull while notnullDefault is empty')
      }
      let nullFields = await this.Table.find().field(`COUNT(${name}) as count`).field('id').where(`${name} IS NULL`).doFirst()
      if (nullFields.count > 0) {
        let data = {}
        data[name] = options.notnullDefault
        await this.Table.update().where(`${name} IS NULL`).setFields(data).do()
      }
      options.notnull = 'NOT NULL'
    } else {
      options.notnull = 'NULL'
    }
    options.default = options.default || ''
    options.update = options.update ? `ON UPDATE ${options.update}` : ''
    if (options.autoincrement) {
      options.notnull = true
    }
    let sql = [
      'MODIFY',
      name,
      type
    ]
    sql.push(options.notnull ? 'NOT NULL' : 'NULL')
    sql.push(options.default)
    sql.push(options.update)
    if (options.autoincrement) {
      sql.push('AUTO_INCREMENT, ADD PRIMARY')
    }
    this.setColumn(sql.join(' '))
    return this
  }

  async drop (ignoreExistance) {
    var me = this
    var cfg = {
      exists: await this.Table.exists()
    }
    if (cfg.exists) {
      this.result = await this.Table.base.do(`DROP TABLE ${this.tableName()}`).catch(e => { me.error(e); throw e }).then((res) => { console.log(`DONE DROP ${me.tableName()}`); return res })
    } else {
      let e = new Error(`table ${this.tableName()} not exist`)
      this.error(e)
      if (!ignoreExistance) {
        throw e
      }
    }
    return this
  }

  error (e) {
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
