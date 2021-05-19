/* eslint-disable valid-jsdoc */
/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
'use strict'

const EventEmitter = require('events')

class ModelEmitter extends EventEmitter {
  addEventHandler(table, event, handler, scope) {
    const eventName = table + '.' + event
    if (!this.listeners(eventName).length) {
      this.on(eventName, handler.bind(scope))
    }
  }
}

const util = require('util')
const Query = require('./lib/query')
const crypto = require('crypto')
// const cconsole = require('./cconsole')

const Record = require('./record')
const internals = {
  withOptions: {},
  db_config: {},
  version: require('./package').version,
  i18n: {
    dayNames: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
    monthNames: ['янв', 'фев', 'март', 'апр', 'май', 'июнь', 'июль', 'авг', 'сен', 'окт', 'ноя', 'дек', 'январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
  },
  cachedModels: {},
  associations: new Map(),
  hashString: (string) => {
    return crypto.createHash('md5').update(string).digest('hex')
  },
  eventProxy: new ModelEmitter(),
  events: new Map(),
  eventHandlers: new Map(),
}

const whereConvert = function(args, model) {
  if (args && args.length === 1 && typeof args[0] === 'object' && Object.keys(args[0]).length) {
    args = args[0]
    const opts = []
    let s = Object.keys(args).filter((el) => el !== '_sql').map((el) => {
      const val = args[el]
      opts.push(args[el])
      if (!el.includes('.')) {
        el = `${model.table}.${el}`
      }
      return Array.isArray(val) ? `${el} IN ?` : `${el} = ?`
    })
    if (Array.isArray(args._sql) && args._sql[0]) {
      s = s.concat(args._sql)
    }
    opts.unshift(s.join(' AND '))
    return opts
  } else {
    return args
  }
}
/**
 * @param {String} table  table name
 * @param {Object} cfg
 * @param {Boolean} cfg.default set database config as default in multi-db configuration
 * @param {Object} cfg.connection mysql2 connnection config, https://github.com/sidorares/node-mysql2/blob/master/lib/connection_config.js
 * @param {String} dbname database name
 */
class Model {
  constructor(table, cfg = {}, dbname) {
    if (!internals.db_config) {
      return this
    }

    this.debug = cfg.debug || process.env.DEBUG

    this.assocs = internals.associations

    this.eventProxy = internals.eventProxy

    this._Model = Model
    this.clone = () => {
      return new Model(table, cfg, dbname)
    }
    this.modelConfig = cfg || {}
    this.table = table
    this.dbname = dbname || cfg.db || internals.default_db_name
    if (!this.dbname) {
      console.log('default_db_name = ', internals.default_db_name)
      throw new Error('database must be marked as default or must expicitly define in model config')
    }
    this._setupGlobalListeners()// must be set table before call!!!
    this.dbConfig = internals.db_config[this.dbname]
    this.Q = new Query()
    this.df = require('dateformat')
    this.df.i18n = internals.i18n
    this.strftime = function(v, format) {
      return this.df(v, format || 'dd-mmmm-yyyy HH:MM')
    }
    const DbService = require('./lib/dbservice')
    this.base = new DbService(this.dbConfig, this.modelConfig.debug, {serviceConn: this.modelConfig.serviceConn})
    this.logs = []
    this._resetModel()
    this.showLog = function(e, ...args) {
      args.length ? this.logs.push(util.inspect(args), e) : this.showLog(e)
      console.log('\r\nError : ********************************************************')
      console.log(`model ${this.dbname}.${this.table} error `, this.logs.join(':'))
      console.log('****************************************************************\r\n')
    }.bind(this)

    if (cfg.raw) {
      cfg.debug && console.log(this.table, ' DO NOT used data cb callback')
      this.setProcessDataCallback = false
    } else {
      const me = this
      cfg.debug && console.log(this.table, ' used data cb callback, cfg: ', cfg)
      this.setProcessDataCallback(function(rows) {
        if (Array.isArray(rows)) {
          return rows.map((row) => {
            return new Record(
              row,
              {
                strict: cfg.strict,
                processed: true,
                assoc: me.assocs.get(me.table),
                owner: me,
                model: Model,
              }
            )
          })
        } else {
          return new Record(
            rows,
            {
              strict: cfg.strict,
              processed: true,
              assoc: me.assocs.get(me.table),
              owner: me,
              model: Model,
            }
          )
        }
      })
    }

    if (!internals.cachedModels[this.table]) {
      internals.cachedModels[this.table] = this
    }
    return this
  }
  /**
 * helper methods SECTION
 */
  /**
   * @static
   * @param {*} table
   * @param {Object} cfg
   * @param {String} cfg.db set database, if not defined, then the first database or with "default" flag from the configuration passed to the setConfig method is used
   * @param {Boolean} cfg.raw return raw objects or Record instances
   * @param {String} dbname set database. ***database*** name will be used as a key to get the mysql configuration. if only one configuration connection then database is optional parameter
   * @returns {Function} will return new instance of Model
   * @desc Model.create is preferable way to use Model.<br />
   * Method will get a function that always return a new Model instance!<br />
   * it's garanteed what your previous request will not be able to influence the new request
   * @example const itemsModel = Model.create('items')
   * function getItems = (ids) => itemsModel().find().where('id IN ?', ids).do()
   * function getItemsByProto = (proto_id) => itemsModel().find().where('proto_id = ?', proto_id).do()
   */
  static create(table, cfg = {}, dbname) {
    if (cfg.debug) {
      console.log('*'.repeat(100))
      console.log('create table %s with config:', table)
      console.dir(cfg)
    }
    return () => new this(table, cfg, dbname)
  }

  static eventHandler(event, handler) {
    if (['insert', 'update', 'delete'].includes(event)) {
      if (typeof handler === 'function') {
        internals.eventHandlers.set(event, handler)
      } else {
        internals.eventHandlers.delete(event)
      }
    }
  }

  static util() {
    return {
      // return array of numbered fields, for example fi('cp', 3, 0) will return ['cp0', 'cp1', 'cp2']
      fi: (f, n, st = 1) => {
        const res = []
        for (let i = 0; i < n; i++) {
          res.push(f + (st + i).toString())
        }
        return res
      },
    }
  }

  /**
 * initialize model internals
 * @memberof Model
 */
  _resetModel() {
    this.Q = new Query()
    this.query = this.Q.table(this.table)
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
  _setOpMode(mode, ...args) {
    this._resetModel()
    this.opMode = mode
    args.unshift(mode)
    this._addOpMode(mode, ...args)
  }
  /**
 * @return {String} model start mode
 * @memberof Model
 */
  getOpMode() {
    return this.opMode
  }
  /**
 * @param {String} mode sql builder option
 * @param {any} args
 * @memberof Model
 */
  _addOpMode(mode, ...args) {
    if (args.length === 1) {
      args = args[0]
    }
    const el = {}
    el[mode] = args || null
    this.logs.push(el)
    this.operations[mode] = this.operations[mode] || []
    if (args) {
      this.operations[mode].push(args)
    }
    if (this.debug) {
      console.log('\n--------- [addOpMode]')
      console.dir(this.operations, {depth: 4})
      console.log('----- [END addOpMode]\n')
    }
  }
  /**
 * bind event listeners to instance of model
 * @memberof Model
 */
  _setupGlobalListeners() {
    const _events = internals.events.get(this.table)
    if (typeof _events === 'object' && Object.keys(_events).length) {
      Object.keys(_events).forEach((event) => {
        const handler = typeof _events[event] === 'function' ? _events[event] : _events[event].handler
        const scope = _events[event].scope
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
  static setupListeners(table, events) {
    if (!events) {
      Object.keys(table).forEach((key) => {
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
  consoleDebug(...args) {
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
  static setAssoc(table, assoc) {
    if (internals.associations.has(table)) {

    } else {
      internals.associations.set(table, assoc)
    }
  }
  /**
 * @static
 * @param cfg {Object|Array} can be Object or Array of Objects if used multi-db configurations.<br />
 * in multi-db config you should mark one db as default or define database name in each Model instance<br/>
 * elsewhere will be used first config in array mysql2 connnection config, https://github.com/sidorares/node-mysql2/blob/master/lib/connection_config.js<br />
 * config.default {Boolean} set database config as default in multi-db configuration
 * @example
 * Model.setConfig([
 *  {database: 'db1', user: 'user', password: 'pwd', host: '127.0.0.1'},
 *  {database: 'db2', user: 'user', password: 'pwd', host: '127.0.0.1', default: true}
 * ])
 * const tbl1Model = Model.create('table1') // will be use 'db2' database because db2 marked as 'default'
 * const tbl2Model = Model.create('table2', {db: 'db1'}) // database set as 'db1'
 */
  static setConfig(cfg) {
    console.log('actual Model2 version : ', internals.version)

    if (!cfg) {
      throw new Error('Model.setConfig(undefined) will raise error!')
    }

    if (cfg && !Array.isArray(cfg)) {
      cfg = [cfg]
    }

    cfg.forEach((el) => {
      if (el.database) {
        const {database} = el
        internals.db_config[database] = el
        if (!internals.default_db_name && el.default) {
          internals.default_db_name = database
          console.log('set default_db_name to ', internals.default_db_name)
        }
      }
    })
    if (!internals.default_db_name) {
      internals.default_db_name = cfg[0].database
    }
  }

  static getPool() {
    return this.base.getPool()
  }

  static version() {
    return internals.version
  }

  setProcessDataCallback(processFn) {
    if (typeof processFn === 'function') {
      this._processFn = processFn
    }
  }

  /**
 * @param {String} event
 * @param {Function} handler after event handler will call with args : Model instance, request params, returned operation data
 * @param {Object} scope
 */
  on(event, handler, scope) {
    this.eventProxy.addEventHandler(this.table, event, handler, scope || this)
    return this
  }

  getListener(event) {
    return this._getEventListeners().get(event)
  }

  async _doRequestUpdate(params) {
    const debug = this.debug
    const conn = await this.base.getConn()
    if (!conn) {
      console.error('error get db connection')
      throw new Error('error get db connection')
    }
    await this.base.doConn(conn, 'BEGIN;').then((res) => debug && console.log('BEGIN;', res))
    const data = await this.base.doConn(conn, {sql: params.text, values: params.values}).catch((ex) => {
      console.error('error _doRequest : %s\n', JSON.stringify(params), JSON.stringify(ex))
      this.base.doConn('ROLLBACK;').then((res) => debug && console.log('ROLLBACK;', res))
      conn.release()
      throw ex
    })
    await this.base.doConn(conn, 'COMMIT;').then((res) => debug && console.log('COMMIT;', res))
    const handler = internals.eventHandlers.get(this.action)
    if (handler) {
      handler(this)
    }
    if (params.bypassEvents) {
      return data
    }
    const event = this.table + '.' + this.getOpMode()
    internals.eventProxy.emit(event, this, params, data)
    return data
  }

  raw() {
    this._raw = true
    return this
  }

  _needWrap(opts) {
    return this._processFn && !opts.raw && !this._raw
  }

  async _doRequest(params) {
    const sql = params.toString()
    this.debug && console.log('_doRequest params:', sql)
    // params.sql = params.sql || params.text
    const data = await this.base.do(sql).catch((ex) => {
      console.error('error _doRequest : %s\n', sql, JSON.stringify(ex))
      throw ex
    })
    const handler = internals.eventHandlers.get(this.action)
    if (handler) {
      handler(this)
    }
    if (params.bypassEvents) {
      return data
    }
    const event = this.table + '.' + this.getOpMode()
    internals.eventProxy.emit(event, this, params, data)
    // console.dir({data}, {depth: 2})
    return data
  }

  async doPage(opts = {}) {
    this._addOpMode('doPage', opts)
    if (Number.isSafeInteger(opts.offset) && Number.isSafeInteger(opts.limit)) {
      opts.page = Math.round(opts.offset / opts.limit) + 1
    }
    if (opts.page) {
      this.page(opts.page, opts.limit)
    }
    if (!this.paginate) {
      if (this.debug) {
        console.log('context before throw : ', this)
      }
      throw new Error('cant do paginate while paging is not configured, try call .page(number) or .doPage({page: number})!')
    }
    try {
      const result = {paginate: true}
      const countSql = this.query.clone()
      countSql.remove('order')
      countSql._set('fields', `COUNT(${this.table}.id) AS count`)
      const count = await this.base.do(countSql.toString())
        .then((data) => {
          return data[0] && data[0].count
        })
        .catch((error) => {
          console.error('doPage calculate count error: ', error)
          throw error
        })
      const paramsQuery = this.query.limit(this.paginate.limit).offset(this.paginate.offset)// .toParam()
      const sql = paramsQuery.toString()
      const data = await this.base.do(sql).catch((error) => {
        console.info('errorSql:', sql)
        console.error('doPage get rows error: ', error)
        throw error
      })
      result.count = count
      result.pages = Math.ceil(result.count / this.paginate.limit)
      const opMode = this.opMode
      this._resetModel()
      if (opMode === 'find') {
        result.rows = this._needWrap(opts) ? this._processFn(data) : data
      } else {
        result.rows = data
      }
      console.log({result})
      return result
    } catch (ex) {
      console.log('[ERROR] model doPage'+'!'.repeat(50))
      console.error(ex.stack)
      throw ex
    }
  }

  /**
  *
  * @param {*} opts
  * @param {*} opts.raw - dont process rows
  */
  async do(opts) {
    opts = opts || {}
    opts.fields = opts.fields || this.modelConfig.fields

    this._addOpMode('do', opts)
    if (this.paginate) {
      return this.doPage(opts)
    }

    let data
    try {
      const params = this.query
      data = await this._doRequest(params)
      const opMode = this.opMode
      this._resetModel()
      if (opMode === 'count') {
        return data[0].count
      }
      if (opMode === 'find') {
        if (this._needWrap(opts)) {
          data = this._processFn(data)
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
    } catch (ex) {
      console.log('[ERROR] model do'+'*'.repeat(50))
      console.error(ex.stack)
      throw ex
    }
  }

  one(...whereArgs) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    if (whereArgs.length) {
      this.where(...whereArgs)
    }
    return this.limit(1).do({first: true})
  }

  first(...whereArgs) {
    return this.one(...whereArgs)
  }

  count(field = 'id') {
    this._setOpMode('count', field)
    if (field.includes('.')) {
      field = `COUNT(${field}) as count`
    } else {
      field = `COUNT(${this.table}.${field}) as count`
    }
    this.query = this.Q.select().from(this.table).field(field)
    return this
  }

  /**
   *
   * @param {Array} fields table field array. no need to use 'table.field', just field name
   * @return {Model}
   */
  find(...args) {
    let [fields, opts] = args
    if ((!fields || typeof fields === 'string') && Array.isArray(opts)) {
      fields = opts
      console.error('Model.find("tableName", ["field1", "field2"]) is deprecated and will be removed in next releases')
      console.error('use Model.find(["field1", "field2"]) instead!')
    }
    if (typeof fields === 'object' && Array.isArray(fields.fields)) {
      fields = fields.fields
      console.error('Model.find({fields: ["field1", "field2"]}) is deprecated and will be removed in next releases')
      console.error('use Model.find(["field1", "field2"]) instead!')
    }
    this._setOpMode('find', fields)
    if (Array.isArray(fields) && fields.length) {
      fields = fields.map((f) => this.table + '.' + f)
    } else {
      fields = [`${this.table}.*`]
    }
    this.query.select(this.table, fields)
    return this
  }

  /**
   *
   * @param {Array} fields add extra tables in FROM section
   * @return {Model}
   * @example
   * const itemsModel = Model.create('items')
   * itemsModel().from('protos') // SELECT items.* FROM items, protos
   * itemsModel().from('items AS refItems') // SELECT items.* FROM items, items AS refItems
   */
  from(tables) {
    // this._setOpMode('from', tables)
    this.query.extraFrom(tables)
    return this
  }

  update(data) {
    this._setOpMode('update', data)
    this.query = this.Q.update(this.table)
    if (data && typeof data === 'object' && Object.keys(data).length) {
      this.setFields(data)
    }
    this.action = 'update'
    this.actionData = data ? [data] : []
    return this
  }

  insert(data) {
    this._setOpMode('insert', data)
    this.query = this.Q.insert(this.table)
    if (data && typeof data === 'object' && Object.keys(data).length) {
      this.setFields(data)
    }
    this.action = 'insert'
    this.actionData = data ? [data] : []
    return this
  }

  delete() {
    this._setOpMode('delete')
    this.query = this.Q.delete(this.table)
    this.action = 'delete'
    this.actionData = []
    return this
  }

  page(page, pageSize) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    pageSize = pageSize || this.modelConfig.pageSize || 20
    let offset
    if (typeof page === 'object') {
      const opts = page
      page = opts.page
      pageSize = opts.limit || this.modelConfig.pageSize || 20
      offset = opts.offset
    }
    this._addOpMode('page', page, pageSize)
    if (page < 1) page = 1
    this.paginate = {
      page: page,
      offset: offset || ((page - 1) * pageSize),
      limit: pageSize,
    }
    return this
  }

  join(table, where, alias) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode('join', table, where, alias)
    this.query = this.query.join(table, where, '', alias)
    this.actionData.push({join: [table, where, alias]})
    return this
  }

  outerJoin(table, where, alias) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode('outer_join', table, where, alias)
    this.query = this.query.join(table, where, 'OUTER', alias)
    this.actionData.push({outer_join: [table, where, alias]})
    return this
  }

  leftOuterJoin(table, where, alias) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode('left_outer_join', table, where, alias)
    this.query = this.query.join(table, where, 'LEFT OUTER', alias)
    this.actionData.push({left_outer_join: [table, where, alias]})
    return this
  }

  leftJoin(table, where, alias) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode('left_join', table, where, alias)
    this.query = this.query.join(table, where, 'LEFT', alias)
    this.actionData.push({left_join: [table, where, alias]})
    return this
  }

  distinct(field) {
    this._addOpMode('distinct', field)
    this.query = this.query.distinct(field)
    return this
  }

  field(...args) {
    this.query = this.query.field(...args)
    return this
  }

  fields(opts) {
    throw new Error('Model.fields deprecated!')
    // this._addOpMode('fields', opts)
    // try {
    //   this.query = this.query.fields(opts)
    // } catch (e) {
    //   this.showLog(e, opts)
    // }
    // return this
  }

  setFields(fields) {
    this._addOpMode('setFields', fields)
    if (this.getOpMode() === 'update') {
      this.query.updateFields(fields)
      return this
    }
    if (this.getOpMode() === 'insert') {
      this.query.insertFields(fields)
      return this
    }
    throw new Error('setFields used only in :insert OR :update mode')
    // Object.keys(opts || {}).forEach((k) => {
    //   const escaped = '`' + this.table + '`.`' + k + '`'
    //   this.query.set(escaped, opts[k])
    // })
  }

  set(opts) {
    throw new Error('Model.set deprecated!')
    // return this.setFields(opts)
  }

  limit(opts) {
    this._addOpMode('limit', opts)
    this.query = this.query.limit(opts)
    return this
  }

  offset(opts) {
    this._addOpMode('offset', opts)
    this.query = this.query.offset(opts)
    return this
  }

  order(...args) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    // if (args.length === 1) {
    //   const t = args[0].split(' ')
    //   if (t.length === 2) {
    //     args = t
    //   }
    // }
    // if (args[1]) {
    //   if (['asc', 'desc', 'ASC', 'DESC'].includes(args[1])) {
    //     args[1] = !(args[1] === 'desc' || args[1] === 'DESC')
    //   }
    // }

    this._addOpMode(...[].concat('order', args))
    this.query = this.query.order(...args)
    return this
  }

  group(by) {
    this._addOpMode('group', by)
    this.query = this.query.group(by)
    return this
  }

  having(...args) {
    this._addOpMode('having', ...[].concat('having', args))
    this.query = this.query.having(...args)
    return this
  }

  where(...args) {
    if (this.getOpMode() === 'afterReset') {
      this.find()
    }
    this._addOpMode('where', ...[].concat('where', args))
    args = whereConvert(args, this)
    this.actionData.push({where: args})
    this.query = this.query.where(...args)
    return this
  }

  _wrapField(field) {
    return '`' + this.table + '`.`' + field + '`'
  }

  setKV(k, v) {
    throw new Error('Model.set deprecated!')
    // this.query = this.query.set(this._wrapField(k), v)
    // return this
  }

  debugLog(fn) {
    if (!fn) {
      fn = (log) => console.log('\nsql = ', log, '\n')
    }
    const sql = this.query.toString()
    if (typeof fn === 'function') {
      fn.call(this, sql)
    }
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
  upsert(...opts) {
    const fieldsData = opts.shift()
    const model = Model.create(this.table)
    return this.find().where(...opts).one()
      .then((rec) => {
        if (rec) {
          return model().update().where(...opts).setFields(fieldsData).do()
        } else {
          return model().insert().setFields(fieldsData).do()
        }
      })
  }

  findBy(field, values) {
    this.find().where(`${this._wrapField(field)} ${Array.isArray(values) ? 'IN' : '='} ?`, values)
    return this
  }

  getFields() {
    return this.base.do({
      sql: `SHOW COLUMNS FROM ${this.table}`,
    })
  }

  addColumn(fieldSql) {
    return this.base.do({
      sql: `ALTER TABLE \`${this.table}\` ADD ${fieldSql}`,
    })
  }

  exists() {
    return this.base.do({
      sql: `SHOW TABLES LIKE '${this.table}'`,
    }).then((rows) => rows[0])
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
  with(scope, ...arg) {
    if (typeof arg[0] === 'function') {
      internals.withOptions[this.table] = internals.withOptions[this.table] || {}
      internals.withOptions[this.table][scope] = arg[0]
      return this
    }
    const fn = internals.withOptions[this.table] && internals.withOptions[this.table][scope]
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

  withOther(table, scope, ...arg) {
    const fn = internals.withOptions[table] && internals.withOptions[table][scope]
    if (fn) {
      arg = arg || []
      arg.unshift(this)
      return fn.apply(this, arg)
    }
    return this
  }

  if(pred, fn) {
    if (pred) {
      return fn(this)
    }
    return this
  }
}

module.exports = Model
