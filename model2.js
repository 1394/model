'use strict'

const EventEmitter = require('events')

class ModelEmitter extends EventEmitter {
  addEventHandler (table, event, handler, scope) {
    let eventName = table + '.' + event
    if (!this.listeners(eventName).length) {
      this.on(eventName, handler.bind(scope))
    }
  }
}

const util = require('util')
const squel = require('squel')
const crypto = require('crypto')
const Record = require('./record')
const internals = {
  withOptions: {},
  db_config: {},
  version: require('./package').version,
  i18n: {
    dayNames: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
    monthNames: ['янв', 'фев', 'март', 'апр', 'май', 'июнь', 'июль', 'авг', 'сен', 'окт', 'ноя', 'дек', 'январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
  },
  cachedModels: {},
  associations: new Map(),
  hashString: (string) => { return crypto.createHash('md5').update(string).digest('hex') },
  eventProxy: new ModelEmitter(),
  events: new Map()
}

const whereConvert = function (args) {
  if (args && args.length === 1 && typeof args[0] === 'object' && Object.keys(args[0]).length) {
    args = args[0]
    let opts = ['']
    opts[0] = Object.keys(args).map(el => { opts.push(args[el]); return `${el} = ?` }).join(' AND ')
    return opts
  } else {
    return args
  }
}

class Model {
  constructor (table, cfg = {}, dbname) {
    if (!internals.db_config) {
      return this
    }

    this.assocs = internals.associations

    this.eventProxy = internals.eventProxy

    this._Model = Model
    this.clone = () => {
      return new Model(table, cfg, dbname)
    }
    this.modelConfig = cfg || {}
    this.redis = internals.redis
    this.table = table
    this.dbname = dbname || cfg.db || internals.default_db_name
    if (!this.dbname) {
      console.log('default_db_name = ', internals.default_db_name)
      console.log('db_config = ')
      console.dir(internals.db_config, {depth: Infinity})
      throw new Error('cant make model w/o database name')
    }
    this._setupGlobalListeners()// must be set table before call!!!
    this.dbConfig = internals.db_config[this.dbname]
    this.squel = squel
    this.df = require('dateformat')
    this.df.i18n = internals.i18n
    this.strftime = function (v, format) {
      return this.df(v, format || 'dd-mmmm-yyyy HH:MM')
    }
    this.squel.useFlavour('mysql')

    if (this.modelConfig.oldMode) {
      this.DbConn = require('./lib/db')
    } else {
      this.DbConn = require('./lib/dbservice')
    }
    this.base = new this.DbConn(this.dbConfig, this.modelConfig.debug, {serviceConn: this.modelConfig.serviceConn})

    this.logs = []

    this._resetModel()

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

    var me = this

    if (cfg.oldMode || cfg.raw) {
      cfg.debug && console.log(this.table, ' DO NOT used data cb callback')
      this.setProcessDataCallback = false
    } else {
      cfg.debug && console.log(this.table, ' used data cb callback, cfg: ', cfg)
      this.setProcessDataCallback(function (rows) {
        return Array.isArray(rows) ? rows.map(row => new Record(row, {processed: true, assoc: me.assocs.get(this.table), owner: me, model: Model})) : new Record(rows, {processed: true, assoc: me.assocs.get(this.table), owner: me, model: Model})
      })
    }

    if (!internals.cachedModels[this.table]) {
      internals.cachedModels[this.table] = me
    }
    return this
  }
  /**
 * helper methods SECTION
 */

  static create (table, cfg = {}, dbname) {
    if (cfg.debug) {
      console.log('*'.repeat(100))
      console.log('create table %s with config:', table)
      console.dir(cfg)
    }
    return () => new this(table, cfg, dbname)
  }

  static util () {
    return {
      // return array of numbered fields, for example fi('cp', 3, 0) will return ['cp0', 'cp1', 'cp2']
      fi: (f, n, st = 1) => {
        let res = []
        for (let i = 0; i < n; i++) {
          res.push(f + (st + i).toString())
        }
        return res
      }
    }
  }

  /**
 * initialize model internals
 * @memberof Model
 */
  _resetModel () {
    this.paginate = false
    this.opMode = 'afterReset'
    this.action = ''
    this.actionData = []
    this.operations = {}
    return this
  }
  /**
 * @param {String} mode start mode : find / insert / update / delete
 * @param {any} args
 * @memberof Model
 */
  _setOpMode (mode, ...args) {
    this._resetModel()
    this.opMode = mode
    args.unshift(mode)
    this._addOpMode.apply(this, args)
  }
  /**
 * @returns {String} model start mode
 * @memberof Model
 */
  getOpMode () { return this.opMode }
  /**
 * @param {String} mode sql builder option
 * @param {any} args
 * @memberof Model
 */
  _addOpMode (mode, ...args) {
    if (args.length === 1) {
      args = args[0]
    }
    let el = {}
    el[mode] = args
    this.logs.push(el)
    this.operations[mode] = this.operations[mode] || []
    if (args) {
      this.operations[mode].push(args)
    }
  }
  /**
 * bind event listeners to instance of model
 * @memberof Model
 */
  _setupGlobalListeners () {
    let _events = internals.events.get(this.table)
    if (typeof _events === 'object' && Object.keys(_events).length) {
      Object.keys(_events).forEach(event => {
        let handler = typeof _events[event] === 'function' ? _events[event] : _events[event].handler
        let scope = _events[event].scope
        if (typeof handler !== 'function') {
          return
        }
        this.eventProxy.addEventHandler(this.table, event, handler, scope || this)
      })
    }
  }
  /**
 * @static
 * @param {String|Object} table table name if String, otherwise object where root keys is table names and values is event listeners config
 * @param {Object} events event listeners config, for example {find: {handler: (params) => {someHandler(params)}, scope: someScope}}
 * @param {Object|Function} events.find event listener or event listener config {handler: fn, scope: scope}
 * @param {Function} events.find.handler
 * @param {Object} events.find.scope
 * @memberof Model
 */
  static setupListeners (table, events) {
    if (!events) {
      Object.keys(table).forEach(key => {
        internals.events.set(key, table[key])
      })
    } else {
      internals.events.set(table, events)
    }
  }
  /**
 * @param {any} args will log to console in debug mode
 * @memberof Model
 */
  consoleDebug (...args) {
    if (this.modelConfig.debug) {
      console.info.apply(this, args)
    }
  }
  /**
 * @static
 * @param {any} table
 * @param {any} assoc
 * @memberof Model
 */
  static setAssoc (table, assoc) {
    if (internals.associations.has(table)) {

    } else {
      internals.associations.set(table, assoc)
    }
  }

  static setConfig (cfg) {
    console.log('actual Model2 version : ', internals.version)
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
    this.redis = redis
  }

  setProcessDataCallback (processFn) {
    if (typeof processFn === 'function') {
      this._processFn = processFn
    }
  }

  async incrTable (request) {
    if (this.redis) {
      let start = Date.now()
      let key = internals.hashString(request)
      try {
        await this.redis.hincrby('sqlTableCounts', this.table, 1)
        await this.redis.hincrby('sqlRequestCounts', key, 1)
        await this.redis.hset('sqlRequestKeys', this.table, key)
        await this.redis.hset('sqlRequests', key, `${this.getOpMode()}:${request}`)
      } catch (ex) {
        console.error(JSON.stringify(ex))
      }
      this.consoleDebug(`redis logTime for key [${key}] : ${Date.now() - start}`)
    }
  }

  /**
 * @param {String} event
 * @param {Function} handler after event handler will call with args : Model instance, request params, returned operation data
 * @param {Object} scope
 * @memberof Model
 */
  on (event, handler, scope) {
    this.eventProxy.addEventHandler(this.table, event, handler, scope || this)
  }

  getListener (event) {
    return this._getEventListeners().get(event)
  }

  async _doRequestUpdate (params) {
    const me = this
    let conn = await this.base.getConn()
    if (!conn) {
      console.error('error get db connection')
      throw new Error('error get db connection')
    }
    await this.base.doConn(conn, 'BEGIN;').then(res => console.log('BEGIN;', res))
    let data = await this.base.doConn(conn, {sql: params.text, values: params.values}).catch(ex => {
      console.error('error _doRequest : %s\n', JSON.stringify(params), JSON.stringify(ex))
      me.base.doConn('ROLLBACK;').then(res => console.log('ROLLBACK;', res))
      conn.release()
      throw ex
    })
    await this.base.doConn(conn, 'COMMIT;').then(res => console.log('COMMIT;', res))
    if (params.bypassEvents) {
      return data
    }
    let event = this.table + '.' + this.getOpMode()
    internals.eventProxy.emit(event, this, params, data)
    return data
  }

  async _doRequest (params) {
    this.consoleDebug(this.getOpMode())
    this.incrTable(JSON.stringify(params))
    // if (this.getOpMode() === 'update') {
    //   return this._doRequestUpdate(params)
    // }
    let data = await this.base.do({sql: params.text, values: params.values}).catch(ex => {
      console.error('error _doRequest : %s\n', JSON.stringify(params), JSON.stringify(ex))
      throw ex
    })
    if (params.bypassEvents) {
      return data
    }
    let event = this.table + '.' + this.getOpMode()
    internals.eventProxy.emit(event, this, params, data)
    return data
  }

  async doPage (opts) {
    this._addOpMode('doPage', opts)
    if (opts.page) {
      this.page(opts.page, opts.limit)
    }
    if (!this.paginate) {
      throw new Error('cant do paginate while paging is not configured, try call .page(number) or .doPage({page: number})!')
    }
    let result = { paginate: true }
    let paramsTotal = this.query.clone().field(`COUNT(${this.table}.id) as count`).toParam()
    paramsTotal.bypassEvents = true
    let paramsQuery = this.query.limit(this.paginate.limit).offset(this.paginate.offset).toParam()
    let data
    data = await this._doRequest(paramsTotal)
    result.count = data[0].count
    result.pages = Math.ceil(result.count / this.paginate.limit)
    data = await this._doRequest(paramsQuery).catch(ex => { console.error(ex); throw ex })
    let opMode = this.opMode
    this._resetModel()
    if (opMode === 'find') {
      if (this._processFn && !opts.raw) {
        data = this.runCatch(function () {
          return this._processFn(data)
        }, opts)
      }
    }
    result.rows = data
    return result
  }

  /**
  *
  * @param {*} opts
  * @param {*} opts.raw - dont process rows
  */
  async do (opts) {
    const me = this
    opts = opts || {}
    opts.fields = opts.fields || this.modelConfig.fields

    var data
    this._addOpMode('do', opts)
    if (this.paginate) {
      return this.doPage()
    }
    let params = this.query.toParam()
    data = await this._doRequest(params)
    let opMode = this.opMode
    me._resetModel()
    // if (this.debug) {
    console.log('operations = ', this.operations)
    // }
    if (this.operations.count) {
      return data[0].count
    }
    if (opMode === 'find') {
      if (this._processFn && !opts.raw) {
        data = this.runCatch(function () {
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
    // return newly created record as Record instance
    if (this.opMode === 'insert' && data.insertId) {
      return this.find().where('id = ?', data.insertId).first()
    }
    return data
  }

  doFirst () {
    return this.first()
  }

  first (...whereArgs) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    if (whereArgs.length) {
      this.where(...whereArgs)
    }
    return this.limit(1).do({ first: true })
  }

  count (field = 'id') {
    this._setOpMode('count', field)
    return this.runCatch(function () {
      if (field.includes('.')) {
        field = `COUNT(${field}) as count`
      } else {
        field = `COUNT(${this.table}.${field}) as count`
      }
      this.query = this.squel.select().from(this.table).field(field)
      return this
    }, field)
  }

  find (table, fields) {
    this._setOpMode('find', table, fields)
    fields = fields || '*'
    return this.runCatch(function () {
      if (typeof table === 'object' && table.fields && table.fields.length) {
        if (Array.isArray(table.fields)) {
          table.fields = table.fields.map(f => this.table + '.' + f).join(',')
        }
        this.query = this.squel.select().from(this.table).field(table.fields)
        return this
      } else {
        this.query = table ? this.query.from(table).field(table + '.' + fields) : this.squel.select().from(this.table).field(this.table + '.' + fields)
        return this
      }
    }, table, fields)
  }

  update (data) {
    this._setOpMode('update', data)
    return this.runCatch(function () {
      this.query = this.squel.update().table(this.table)
      if (data && typeof data === 'object' && Object.keys(data).length) {
        this.setFields(data)
      }
      this.action = 'update'
      this.actionData = data ? [data] : []
      return this
    }, data)
  }

  insert (data) {
    this._setOpMode('insert', data)
    return this.runCatch(function () {
      this.query = this.squel.insert().into(this.table)
      if (data && typeof data === 'object' && Object.keys(data).length) {
        this.setFields(data)
      }
      this.action = 'insert'
      this.actionData = data ? [data] : []
      return this
    }, data)
  }

  delete () {
    this._setOpMode('delete')
    return this.runCatch(function () {
      this.query = this.squel.delete().from(this.table)
      this.action = 'delete'
      this.actionData = []
      return this
    })
  }

  page (page, pageSize) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    pageSize = pageSize || this.modelConfig.pageSize || 20
    let offset
    if (typeof page === 'object') {
      let opts = page
      page = opts.page
      pageSize = opts.limit || this.modelConfig.pageSize || 20
      offset = opts.offset
    }
    this._addOpMode('page', page, pageSize)
    if (page < 1) page = 1
    this.paginate = {
      page: page,
      offset: offset || ((page - 1) * pageSize),
      limit: pageSize
    }
    return this
  }

  // count () {
  //   if (this.getOpMode() === 'afterReset') {
  //     this.find()
  //   }
  //   this._addOpMode('count')
  //   this.query = this.field('COUNT(' + this.table + '.id) AS count')
  //   return this.do().then(data => data.shift().get('count'))
  // }

  join (table, where, alias) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode('join', table, where, alias)
    return this.runCatch(function () {
      this.query = this.query.join(table, alias, where)
      this.actionData.push({ join: [table, where, alias] })
      return this
    }, table, where, alias)
  }

  outerJoin (table, where, alias) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode('outer_join', table, where, alias)
    return this.runCatch(function () {
      this.query = this.query.outer_join(table, alias, where)
      this.actionData.push({ outer_join: [table, where, alias] })
      return this
    }, table, where, alias)
  }

  leftOuterJoin (table, where, alias) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode('left_outer_join', table, where, alias)
    return this.runCatch(function () {
      this.query = this.query.left_outer_join(table, alias, where)
      this.actionData.push({ left_outer_join: [table, where, alias] })
      return this
    }, table, where, alias)
  }

  leftJoin (table, where, alias) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode('left_join', table, where, alias)
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
    this._addOpMode.apply(this, [].concat('field', args))
    return this.runCatch(function () {
      this.query = this.query.field.apply(this, args)
      return this
    }, args)
  }

  fields (opts) {
    this._addOpMode('fields', opts)
    try {
      this.query = this.query.fields(opts)
    } catch (e) {
      this.showLog(e, arguments)
    }
    return this
  }

  setFields (opts) {
    this._addOpMode('setFields', opts)
    return this.runCatch(function () {
      if (typeof opts === 'string') {
        this.query.set(opts)
        return this
      }
      Object.keys(opts || {}).forEach(k => {
        let escaped = '`' + this.table + '`.`' + k + '`'
        this.query.set(escaped, opts[k])
      })
      return this
    }, opts)
  }

  set (opts) {
    return this.setFields(opts)
  }

  limit (opts) {
    this._addOpMode('limit', opts)
    return this.runCatch(function () {
      this.query = this.query.limit(opts)
      return this
    }, opts)
  }

  offset (opts) {
    this._addOpMode('offset', opts)
    return this.runCatch(function () {
      this.query = this.query.offset(opts)
      return this
    }, opts)
  }

  order (...args) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode.apply(this, [].concat('order', args))
    return this.runCatch(function () {
      this.query = this.query.order.apply(this, args)
      return this
    }, args)
  }

  group (by) {
    this._addOpMode('group', by)
    return this.runCatch(function () {
      this.query = this.query.group(by)
      return this
    }, by)
  }

  having (...args) {
    this._addOpMode.apply(this, [].concat('having', args))
    return this.runCatch(function () {
      this.query = this.query.having.apply(this, args)
      return this
    }, args)
  }

  where (...args) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode.apply(this, [].concat('where', args))
    args = whereConvert(args)
    this.actionData.push({ where: args })
    return this.runCatch(function () {
      this.query = this.query.where.apply(this, args)
      return this
    }, args)
  }

  _wrapField (field) {
    return '`' + this.table + '`.`' + field + '`'
  }

  setKV (k, v) {
    this.query = this.query.set(this._wrapField(k), v)
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

  findBy (field, values) {
    this._resetModel().find().where(`${this._wrapField(field)} ${Array.isArray(values) ? 'IN' : '='} ?`, values)
    return this
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

  /**
 * @
 * @description set scope from any Model methods or apply scope methods (all scopes stored globally in Model class and all instances has access to scopes)
 * @param {string} scope scope name
 * @param {function} arg if function then Model.with set scope with name and scope function
 * @param {arguments} arg if arguments and first is not a function then call scope by name with given arguments
 * @example with arrow function : Model.with('active', (model,state) => model.where('active = ?', state)) and for use Model.with('active', 1)
 * @example with usual function : Model.with('active', function(model,state) {return model.where('active = ?', state)}) and for use Model.with('active', 1)
 */
  with (scope, ...arg) {
    if (typeof arg[0] === 'function') {
      internals.withOptions[this.table] = internals.withOptions[this.table] || {}
      internals.withOptions[this.table][scope] = arg[0]
      return this
    }
    let fn = internals.withOptions[this.table] && internals.withOptions[this.table][scope]
    if (fn) {
      arg = arg || []
      arg.unshift(this)
      return fn.apply(this, arg)
    }
    return this
  }
  /**
 * @description get scope from another table
 * @param {string} table table name
 * @param {string} scope scope name
 * @param {arguments} arg if arguments and first is not a function then call scope by name with given arguments
 * @example Item.withOther('protos', 'where:protos:active')
 */

  withOther (table, scope, ...arg) {
    let fn = internals.withOptions[table] && internals.withOptions[table][scope]
    if (fn) {
      arg = arg || []
      arg.unshift(this)
      return fn.apply(this, arg)
    }
    return this
  }
}

module.exports = Model
