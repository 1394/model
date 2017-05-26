'use strict'
const co = require('co')
const util = require('util')
const Record = require('./record')
const internals = {
  db_config: {},
  version: require('./package').version,
  i18n () {
    return {
      dayNames: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
      monthNames: ['янв', 'фев', 'март', 'апр', 'май', 'июнь', 'июль', 'авг', 'сен', 'окт', 'ноя', 'дек', 'январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
    }
  }
}

class Model {
  constructor (table, cfg = {}, dbname) {
    if (!internals.db_config) {
      return this
    }
    this.modelConfig = cfg || {}
    if (!cfg.oldMode) {
      this.setProcessDataCallback(function (rows) {
        return rows.map(row => new Record(row, {processed: true}))
      })
    }
    this.action = ''
    this.actionData = []
    this.redis = internals.redis
    this.table = table
    this.dbname = dbname || internals.default_db_name
    if (!this.dbname) {
      console.log('default_db_name = ', internals.default_db_name)
      console.log('db_config = ')
      console.dir(internals.db_config, {depth: Infinity})
      throw new Error('cant make model w/o database name')
    }
    this.dbConfig = internals.db_config[this.dbname]
    this.squel = require('squel')
    this.df = require('dateformat')
    this.strftime = function (v, format) {
      return this.df(v, format || 'dd-mmmm-yyyy HH:MM')
    }
    this.df.i18n = internals.i18n()
    this.squel.useFlavour('mysql')
    if (this.modelConfig.alternate) {
      this.DbConn = require('./lib/dbservice')
    } else {
      this.DbConn = require('./lib/db')
    }
    internals.db_config.debug = internals.db_config.debug && internals.db_config.debug.models || cfg.debug
    this.base = new this.DbConn(this.dbConfig, internals.db_config.debug, {serviceConn: this.modelConfig.serviceConn})

    this.logs = []

    this.showLog = function (e, args) {
      args ? this.logs.push(util.inspect(args), e) : this.showLog(e, arguments)
      console.log('\r\nError : ********************************************************')
      console.log(`model ${this.dbname}.${this.table} error `, this.logs.join(':'))
      console.log('****************************************************************\r\n')
    }.bind(this)

    this.runCatch = function (func, ...args) {
      try {
        return func.call(this)
      } catch (ex) {
        this.showLog(ex, args)
        throw ex
      }
    }

    this.squel.registerValueHandler(Date, function (date) {
      return date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate() + ' ' + date.getHours() + ':' + date.getMinutes() + ':' + date.getSeconds()
    })
    this.query = ''

    return this
  }

  static setConfig (cfg) {
    if (!Array.isArray(cfg)) {
      cfg = [cfg]
    }
    Object.keys(cfg).forEach(key => {
      if (cfg[key] && cfg[key].database && cfg[key].database.length) {
        internals.db_config[ cfg[key].database ] = cfg[key]
        if (!internals.default_db_name) {
          if (cfg[key].default) {
            internals.default_db_name = cfg[key].database
            console.log('default_db_name = ', internals.default_db_name)
          } else {
            internals.default_db_name = cfg[ Object.keys(cfg)[0] ].database
            console.log('default_db_name = ', internals.default_db_name)
          }
        }
      }
    })
  }

  static getPool () {
    return this.base.getPool()
  }

  static version () {
    return internals.version
  }

  static setRedis (redis) {
    internals.redis = redis
  }

  setProcessDataCallback (processFn) {
    if (typeof processFn === 'function') {
      this._processFn = processFn
    }
  }

  do (opts) {
    opts = opts || {}
    opts.fields = opts.fields || this.modelConfig.fields
    var me = this
    var requestString = ''

    return co(function*() {
      var data
      me._addOpMode('do')
      if (me.paginate) {
        var result = { paginate: true }
        var totalSql = me.query.clone().field('COUNT(*) as count').toString()
        var query = me.query.limit(me.paginate.limit).offset(me.paginate.offset).toString()
        data = yield me.base.do(totalSql)
        result.count = data[0].count
        result.pages = Math.ceil(result.count / me.paginate.limit)
        data = yield me.base.do(query)
        result.rows = data
        return result
      }
      requestString = me.query.toString()
      let params = me.query.toParam()
      data = yield me.base.do({sql: params.text, values: params.values})
      if (me.opMode === 'find') {
// run this._processFn if need
        if (me._processFn) {
          data = me.runCatch(function () {
            return me._processFn(data)
          }, opts)
        }

        if (opts.last) {
          return data.pop()
        }
        if (opts.first) {
          return data.shift()
        }
      }
      return data
    })
    .then(data => {
      return data
    })
    .catch(err => {
      let msg = err + ' : ' + requestString
      throw msg
    })
  }

  doFirst () {
    return this.do({ first: true })
  }

  doLast () {
    return this.do({ last: true })
  }

  _setOpMode (mode) {
    this.paginate = false
    this.actionData = []
    this.opMode = mode
    this.logs = [mode]
  }

  getOpMode () { return this.opMode }

  _addOpMode (mode) {
    this.logs.push(mode)
  }

  find (table, fields) {
    this._setOpMode('find')
    fields = fields || '*'
    return this.runCatch(function () {
      this.query = table ? this.query.from(table).field(table + '.' + fields) : this.squel.select().from(this.table).field(this.table + '.' + fields)
      return this
    }, table, fields)
  }

  update (table) {
    this._setOpMode('update')
    return this.runCatch(function () {
      this.query = this.squel.update().table(table || this.table)
      this.action = 'update'
      this.actionData = []
      return this
    }, table)
  }

  insert (table) {
    this._setOpMode('insert')
    return this.runCatch(function () {
      this.query = this.squel.insert().into(table || this.table)
      this.action = 'insert'
      this.actionData = []
      return this
    }, table)
  }

  delete (table) {
    this._setOpMode('delete')
    return this.runCatch(function () {
      this.query = this.squel.delete().from(table || this.table)
      this.action = 'delete'
      this.actionData = []
      return this
    }, table)
  }

  page (page, limit) {
    let offset
    if (typeof page === 'object') {
      let opts = page
      page = opts.page
      limit = opts.limit
      offset = opts.offset
    }
    this._addOpMode('page')
    if (page < 1) page = 1
    this.paginate = {
      offset: offset || ((page - 1) * limit),
      limit: limit || 20
    }
    return this
  }

  join (table, where, alias) {
    this._addOpMode('join')
    return this.runCatch(function () {
      this.query = this.query.join(table, alias, where)
      this.actionData.push({ join: [table, where, alias] })
      return this
    }, table, where, alias)
  }

  outerJoin (table, where, alias) {
    this._addOpMode('outer_join')
    return this.runCatch(function () {
      this.query = this.query.outer_join(table, alias, where)
      this.actionData.push({ outer_join: [table, where, alias] })
      return this
    }, table, where, alias)
  }

  leftJoin (table, where, alias) {
    this._addOpMode('left_join')
    return this.runCatch(function () {
      this.query = this.query.left_join(table, alias, where)
      this.actionData.push({ left_join: [table, where, alias] })
      return this
    }, table, where, alias)
  }

  distinct () {
    this._addOpMode('distinct')
    this.query = this.query.distinct()
    return this
  }

  field (...args) {
    this._addOpMode('field')
    return this.runCatch(function () {
      this.query = this.query.field.apply(this, args)
      return this
    }, args)
  }

  fields (opts) {
    this.logs.push('fields')
    try {
      this.query = this.query.fields(opts)
    } catch (e) {
      this.showLog(e, arguments)
    }
    return this
  }

  setFields (opts) {
    this._addOpMode('setFields')
    return this.runCatch(function () {
      Object.keys(opts || {}).forEach(k => {
        let escaped = '`' + this.table + '`.`' + k + '`'
        this.query.set(escaped, opts[k])
      })
      return this
    }, opts)
  }

  limit (opts) {
    this._addOpMode('limit')
    return this.runCatch(function () {
      this.query = this.query.limit(opts)
      return this
    }, opts)
  }

  offset (opts) {
    this._addOpMode('offset')
    return this.runCatch(function () {
      this.query = this.query.offset(opts)
      return this
    }, opts)
  }

  order (...args) {
    this._addOpMode('order')
    return this.runCatch(function () {
      this.query = this.query.order.apply(this, args)
      return this
    }, args)
  }

  group (by) {
    this._addOpMode('group')
    return this.runCatch(function () {
      this.query = this.query.group(by)
      return this
    }, by)
  }

  where (...args) {
    this.actionData.push({ where: args })
    this._addOpMode('where')
    return this.runCatch(function () {
      this.query = this.query.where.apply(this, args)
      return this
    }, args)
  }

  set (k, v) {
    k = '`' + this.table + '`.`' + k + '`'
    this.query = this.query.set(k, v)
    return this
  }

/**
## [starter method] - this method must be first at chain because is initialized inner 'squel' var
@method Model.upsert
@param {Object} fieldSet hash keys as field names and values
@param {} whereArguments arguments for where , when find and next update/insert operation
@return {Promise}
@example
  SomeTable.upsert({name: 'somename'}, 'kind = ?', 'car')
    .then(data => {
      console.log(data.insertId || data.affectedRows)
    })
*/
  upsert (...opts) {
    let fieldsData = opts.shift()
    let me = this
    return me.find().where.apply(me, opts).doFirst()
      .then(rec => {
        if (rec) {
          return me.update().where.apply(me, opts).setFields(fieldsData).do()
        } else {
          return me.insert().setFields(fieldsData).do()
        }
      })
  }

  getFields () {
    return this.base.do({
      sql: `SHOW COLUMNS FROM ${this.table}`
    })
  }

  addColumn (fieldSql) {
    return this.base.do({
      sql: `ALTER TABLE \`${this.table}\` ADD ${fieldSql}`
    })
  }

  exists () {
    return this.base.do({
      sql: `SHOW TABLES LIKE '${this.table}'`
    }).then(rows => rows[0])
  }

}


module.exports = Model
