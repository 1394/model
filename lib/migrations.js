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
    options.serviceConn = true
    this.Table = new this.Model(this.tableName(true), options)
    let columns = []
    this.setColumn = function (col) { columns.push(col) }
    this.getColumns = function () { return columns }
    return this
  }

  async createDb (name, options) {
    var me = this
    options = options || {}
    options.charset = options.charset || 'utf8'
    options.collate = options.collate || 'utf8_general_ci'
    if (!name) {
      throw new Error('database name cant be empty')
    }
    let sql = `CREATE DATABASE IF NOT EXISTS \`${name}\` DEFAULT CHARACTER SET ${options.charset} DEFAULT COLLATE ${options.collate}`
    return this.Table.base.serviceConn(sql).catch(e => { me.error(e); throw e })
  }

  async create (options) {
    options = options || {}
    options.columns = options.columns || []
    var me = this
    var cfg = {
      exists: await this.Table.exists(),
      engine: options.engine || 'InnoDB',
      charset: options.charset || 'utf8',
      collate: options.collate || 'utf8_general_ci',
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
    if (!cfg.columns.length) {
      // TODO : need refactoring
      cfg.columns = this.getColumns().map(el => { el = el.split(' '); el.shift(); return el.join(' ') })
    }
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

  addColumns (columns) {
    columns.forEach(col => this.addColumn.apply(this, Array.isArray(col) ? col : [col]))
    return this
  }

  prepareColumn (name, type, options) {
    if (typeof name === 'string' && !type && !options) {
      return name
    }
    if (name === 'id' && type === 'primary') {
      return '`id` int(11) NOT NULL AUTO_INCREMENT,PRIMARY KEY (`id`)'
    }
    options = options || {}
    name = '`' + name + '`'
    options.default = options.default ? `DEFAULT ${options.default}` : ''
    options.update = options.update ? `ON UPDATE ${options.update}` : ''
    if (options.autoincrement) {
      options.notnull = true
    }
    let sql = [
      name,
      type
    ]
    sql.push(options.notnull ? 'NOT NULL' : 'NULL')
    sql.push(options.default)
    sql.push(options.update)
    if (options.autoincrement) {
      sql.push('AUTO_INCREMENT PRIMARY KEY')
    }
    if (options.comment) {
      sql.push(`COMMENT '${options.comment}'`)
    }
    return sql.filter(el => el).join(' ')
  }

  addColumn (name, type, options) {
    this.setColumn('ADD ' + this.prepareColumn(name, type, options))
    return this
  }

  modifyColumns (columns) {
    columns.forEach(col => this.modifyColumn.apply(this, Array.isArray(col) ? col : [col]))
    return this
  }

  modifyColumn (name, type, options) {
    if (name && !type && !options) {
      this.setColumn(this.prepareColumn(name, type, options))
    } else {
      this.setColumn('MODIFY ' + this.prepareColumn(name, type, options))
    }
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
