'use strict';

const co = require('co')
const util = require('util')

const Field = require('./lib/field')

const internals = {
  db_config: {},
  version: require('./package').version
}

/**
@class Model
обеспечивает интерфейс запросов к БД
used modules :
 [mysql](https://github.com/felixge/node-mysql)  
 [squel](http://hiddentao.github.io/squel)

@example
var model = require('somepath/model')
var Item = new model('items')

@param {String} table - table name
@param {Object} cfg - model config
@param {Array} cfg.fields - array of fields, for example : [{ name: 'webname', hide: true, convert: function(v){return 'site name : '+v} }]

*/
function Model(table, cfg, dbname) {
  if (!internals.db_config) {
    return this
  }
  this.modelConfig = cfg || {}
  this.action = '';
  this.actionData = [];
  this.redis = internals.redis;
  this.table = table;
  this.dbname = dbname || internals.default_db_name;
  if(!this.dbname){
    throw new Error('cant make model w/o database name');
    return
  }
  this.dbConfig = internals.db_config[this.dbname];
  this.squel = require('squel');
  this.df = require('dateformat');
  this.strftime = function(v, format) {
    return this.df(v, format || 'dd-mmmm-yyyy HH:MM')
  }
  this.df.i18n = i18n();
  this.squel.useFlavour('mysql');
  this.dbConn = require('./lib/db');
  this.base = new this.dbConn(this.dbConfig, internals.db_config.debug && internals.db_config.debug.models)

  this.logs = []

  this.showLog = function(e, args) {
    args ? this.logs.push(util.inspect(args), e) : this.showLog(e, arguments)
    console.log('\r\nError : ********************************************************')
    console.log(`model ${this.dbname}.${this.table} error `, this.logs.join(':'))
    console.log('****************************************************************\r\n')
  }.bind(this)

  this.squel.registerValueHandler(Date, function(date) {
    return date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate() + ' ' + date.getHours() + ':' + date.getMinutes() + ':' + date.getSeconds();
  });
  this.query = '';

  return this;
};

function i18n() {
  return {
    dayNames: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
    monthNames: ['янв', 'фев', 'март', 'апр', 'май', 'июнь', 'июль', 'авг', 'сен', 'окт', 'ноя', 'дек', 'январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
  }
}

/**
@method Model.do

@param {Object} opts - options
@param {Boolean} opts.first - true if need return first row but not array, useful where we wait for one row from query
@param {Boolean} opts.last - true if need return last row but not array

@return {Promise} promise
@return {Array|Object} promise.then data
@return {Object} promise.catch error - {@link https://github.com/felixge/node-mysql/#error-handling}
@return promise.catch error.code Either a MySQL server error (e.g. 'ER_ACCESS_DENIED_ERROR'), a node.js error (e.g. 'ECONNREFUSED') or an internal error (e.g. 'PROTOCOL_CONNECTION_LOST')
@return {Boolean} promise.catch error.fatal - indicating if this error is terminal to the connection object.

@example
  Item
    .find()
    .limit(1)
    .do({
      fields: [ { name: 'webname', convert: function(v){ return 'site : '+v } }, 'ref_id' ]
    })

*/


Model.setConfig = function(cfg) {
  Object.keys(cfg).forEach(key=>{
    if( cfg[key] && cfg[key].database && cfg[key].database.length ){
      internals.db_config[ cfg[key].database ] = cfg[key];
      if(cfg[key].default){
        internals.default_db_name = cfg[key].database;
        console.log('default_db_name = ',internals.default_db_name)
      }else{
        internals.default_db_name = cfg[ Object.keys(cfg)[0] ].database;
        console.log('default_db_name = ',internals.default_db_name)
      }
    }
  })
}

Model.getPool = function() {
  return this.base.getPool()
}

Model.version = function() {
  return internals.version
}

Model.setRedis = function(redis) {
  internals.redis = redis;
}

Model.prototype.do = function(opts) {

  opts = opts || {}
  opts.fields = opts.fields || this.modelConfig.fields
  var data;
  var me = this;

  return co(function*() {
      if (me.paginate) {
        var result = { paginate: true }
        var totalSql = me.query.clone().field('COUNT(*) as count').toString()
        var query = me.query.limit(me.paginate.limit).offset(me.paginate.offset).toString()
        var data = yield me.base.do(totalSql)
        result.count = data[0].count
        result.pages = Math.ceil(result.count / me.paginate.limit)
        data = yield me.base.do(query)
        if (opts.fields && typeof opts.fields === 'object' && opts.fields.length) {
          data = me.processFields( data, opts.fields)
        }
        result.rows = data;
        return result;
      }
      data = yield me.base.do(me.query.toString())
      if (opts.fields && typeof opts.fields === 'object' && opts.fields.length && Array.isArray(data)) {
        data = me.processFields( data, opts.fields)
      }
      if (opts.last) return data[data.length - 1]
      if (opts.first && (this.action != 'insert' || this.action != 'update')) return data[0]
      return data

    })
    .then(data => {
      if (this.modelConfig.queueChanges) {
        this.queueChanges(data)
      }
      return data;
    })
    .catch(err => {
      console.error('model.do error : ', err)
    })

}

Model.prototype.export = function(ids) {
  if (Number.isInteger(ids)) ids = [ids];
  if (!Array.isArray(ids)) {
    console.error('cant export w/o id of array of ids');
    return this;
  }
  this.actionData = ids;
  return this;
}

Model.prototype.queueChanges = function queueChanges(data) {
  if (!this.redis) {
    return
  }
  let rec = {
    table: this.table,
    db: this.dbConfig.database,
    dbname: this.dbname,
    action: this.action,
    actionData: this.actionData
  }
  if (this.action == 'insert' && data.insertId > 0 && data.affectedRows > 0) {
    rec.id = data.insertId;
    this.redis.conn.multi()
      .lpush('model.changes', JSON.stringify(rec))
      .ltrim('model.changes', 0, 999)
      .exec((err, res) => {
        err ? console.error('queueChanges error :', err) : this.redis.pub.publish('notify.model.changes', (res[0] || [])[1])
        console.log('multi res = ', res)
      })
  }
  if (this.action == 'update' && data.changedRows > 0 && this.actionData.length) {
    this.redis.conn.multi()
      .lpush('model.changes', JSON.stringify(rec))
      .ltrim('model.changes', 0, 999)
      .exec((err, res) => {
        err ? console.error('queueChanges error :', err) : this.redis.pub.publish('notify.model.changes', (res[0] || [])[1])
      })
  }
}

Model.prototype.doFirst = function() {
  return this.do({ first: true })
}

Model.prototype.doLast = function() {
  return this.do({ last: true })
}

/**
 */
Model.prototype.end = function(opts) {
  opts = opts || {}

  opts.fields = opts.fields || this.modelConfig.fields
  var data;
  var me = this;

  return co(function*() {
      if (me.paginate) {
        var result = { paginate: true }
        var totalSql = me.query.clone().field('COUNT(*) as count').toString()
        var query = me.query.limit(me.paginate.limit).offset(me.paginate.offset).toString()
        var data = yield me.base.do(totalSql)
        result.count = data[0].count
        result.pages = Math.ceil(result.count / me.paginate.limit)
        data = yield me.base.do(query)

        // instance Field
        if (util.isArray(data)) {
          data = data.map(row => {
            return new Field({ model: me, data: row, _model: Model, fields: opts.fields })
          })
        }

        // if(opts.fields && typeof opts.fields === 'object' && opts.fields.length){
        //   data = me.processFields( data, opts.fields)
        // }

        result.rows = data;
        return result;
      }
      data = yield me.base.do(me.query.toString())

      // instance Field
      if (util.isArray(data)) {
        data = data.map(row => {
          return new Field({ model: me, data: row, _model: Model, fields: opts.fields })
        })
      }

      // if(opts.fields && typeof opts.fields === 'object' && opts.fields.length){
      //   data = me.processFields( data, opts.fields)
      // }

      if (opts.last) return data[data.length - 1]
      if (opts.first) return data[0]
      return data

    })
    .catch(err => {
      console.error('model.do error : ', err)
    })

}

Model.prototype.processFields = function processFields(rows, fields) {
  return rows.map(function(row) {
    var newRow = { _raw: row }
    fields.forEach(function(field) {
      if (typeof field === 'string') {
        newRow[field] = row[field]
      }
      if (typeof field.convert === 'function' && field.name) {
        newRow[field.name] = field.convert(row[field.name], row)
      }
    })
    return newRow;
  }, this)
}

/**
@method Model.cached
*/
Model.prototype.cached = function cached(opts, promised) {
  if (typeof opts === 'string') {
    opts = { key: opts, ttl: 60 * 60 }
  }
  const redis = this.redis
  return co(function*() {
    if (!opts.key) {
      console.error('key can`t be empty!')
      throw new Error('key can`t be empty!')
      return
    }

    let cached;
    if (redis.online) {
      cached = yield redis.conn.get(opts.key);
    }

    // return if cached
    if (cached) return JSON.parse(cached);
    // if not set promised than return anyway
    if (!promised) return JSON.parse(cached);

    let new_data = yield promised()

    opts.ttl = opts.ttl || 60 * 60

    let status;
    if (redis.online) {
      status = yield redis.conn.set(opts.key, JSON.stringify(new_data), 'EX', opts.ttl)
      if (status !== 'OK') console.error('redis set op with key %s error!', opts.key)
    }

    return new_data
  })

}

/**
## [starter method] - this method must be first at chain because is initialized inner 'squel' var
@method Model.find
@example
  Model.find().where().do()
@param {String}table [table name]
*/
Model.prototype.find = function(table, fields) {
  this.logs = ['find']
  fields = fields || '*'
  this.query = table ? this.query.from(table).field(table + '.' + fields) : this.squel.select().from(this.table).field(this.table + '.' + fields);
  this.action = 'select'
  this.actionData = [];
  this.paginate = null
  return this;
}

/**
ATTENTION!!! - method {@link Model.do} return Object but not Array
pagination setup
@method Model.page
@param {Number} page=1
@param {Number} [limit=20]
@param {Object} opts
*/
Model.prototype.page = function(page, limit, opts) {
  this.logs.push('page')
  if (page < 1) page = 1
  this.paginate = { offset: (page - 1) * limit, limit: limit || 20 }
  return this;
}

/**
@method Model.from - from
@param {string} table
*/
Model.prototype.findField = function(field) {
  this.logs.push('findField')
  try {
    this.query = this.squel.select().from(this.table).field(field)
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

//////////////// JOINS section : join , left_join, outer_join

/**
@method Model.join - join
@param {string} table
*/
Model.prototype.join = function(table, where, alias) {
  this.logs.push('join')
  try {
    this.query = this.query.join(table, alias, where)
    this.actionData.push({ join: [table, where, alias] })
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.outer_join - outer join
@param {string} table
*/
Model.prototype.outer_join = function(table, where, alias) {
  this.logs.push('outer_join')
  try {
    this.query = this.query.outer_join(table, alias, where)
    this.actionData.push({ outer_join: [table, where, alias] })
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.left_join - left join
@param {string} table
@param {string} where
@param {string} [alias]
*/
Model.prototype.left_join = function(table, where, alias) {
  this.logs.push('left_join')
  try {
    this.query = this.query.left_join(table, alias, where)
    this.actionData.push({ left_join: [table, where, alias] })
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}


/**
@method Model.distinct - distinct
*/
Model.prototype.distinct = function() {
  this.logs.push('distinct')
  try {
    this.query = this.query.distinct()
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.count ## [Starter method]
  this method must be first at chain because is initialized inner 'squel' var
make request in select : COUNT(table_name.id) AS count
*/
Model.prototype.count = function() {
  this.logs.push('count')
  try {
    this.query = this.squel.select().from(this.table).field('COUNT(' + this.table + '.id) AS count');
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.update ## [Starter method]
  this method must be first at chain because is initialized inner 'squel' var
@param {String}table [table name]
*/
Model.prototype.update = function(table) {
  this.logs = ['update']
  try {
    this.query = this.squel.update().table(table || this.table);
    this.action = 'update'
    this.actionData = [];
  } catch (e) {
    this.showLog(e, arguments)
  }
  this.paginate = null
  return this;
}

/**
@method Model.insert ## [Starter method]
  this method must be first at chain because is initialized inner 'squel' var
@param {String}table [table name]
*/
Model.prototype.insert = function(table) {
  this.logs = ['insert']
  try {
    this.query = this.squel.insert().into(table || this.table);
    this.action = 'insert';
    this.actionData = [];
  } catch (e) {
    this.showLog(e, arguments)
  }
  this.paginate = null
  return this;
}

/**
@method Model.delete ## [Starter method]
  this method must be first at chain because is initialized inner 'squel' var
@param {String}table [table name]
*/
Model.prototype.delete = function(table) {
  this.logs = ['delete']
  try {
    this.query = this.squel.delete().from(table || this.table);
    this.action = 'delete';
    this.actionData = [];
  } catch (e) {
    this.showLog(e, arguments)
  }
  this.paginate = null
  return this;
}

/**
@method Model.opt
@param {String}cmd method
run `squel` method with arguments
*/
Model.prototype.opt = function(cmd) {
  this.logs.push('opt')
  try {
    var args = Array.prototype.slice.call(arguments, 1);
    this.query = this.query[cmd].apply(this, args);
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.opts
@param {Object}opts
@param opts.method `squel` methods
run `squel` methods with arguments
*/
Model.prototype.opts = function(opts) {
  this.logs.push('opts')
  try {
    var methods = Object.keys(opts);
    methods.forEach(function(method) {
      var args = opts[method];
      if (Array.isArray(args)) {
        this.query = this.query[method].apply(this, Array.prototype.slice.call(args, 0));
      } else {
        this.query = this.query[method](args);
      }
    }, this);
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.field
*/
Model.prototype.field = function() {
  this.logs.push('field')
  try {
    this.query = this.query.field.apply(this, Array.prototype.slice.call(arguments, 0));
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.fields
*/
Model.prototype.fields = function(opts) {
  this.logs.push('fields')
  try {
    this.query = this.query.fields(opts);
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.setField
*/
Model.prototype.setFields = function(opts) {
  this.logs.push('setFields')
  try {
    Object.keys(opts || {}).forEach(k => {
      let escaped = '`' + this.table + '`.`' + k + '`'
      this.query.set(escaped, opts[k])
    })
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.limit
*/
Model.prototype.limit = function(opts) {
  this.logs.push('limit')
  try {
    this.query = this.query.limit(opts);
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.offset
*/
Model.prototype.offset = function(opts) {
  this.logs.push('offset')
  try {
    this.query = this.query.offset(opts);
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.order
*/
Model.prototype.order = function() {
  this.logs.push('order')
  try {
    this.query = this.query.order.apply(this, Array.prototype.slice.call(arguments, 0));
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.group
*/
Model.prototype.group = function(by) {
  this.logs.push('group')
  try {
    this.query = this.query.group(by);
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.where
*/
Model.prototype.where = function() {
  let argsArr = Array.prototype.slice.call(arguments, 0);
  this.actionData.push({ where: argsArr })
  this.logs.push('where')
  try {
    this.query = this.query.where.apply(this, argsArr);
  } catch (e) {
    this.showLog(e, arguments)
  }
  return this;
}

/**
@method Model.set
*/
Model.prototype.set = function(k, v) {
  k = '`' + this.table + '`.`' + k + '`'
  this.query = this.query.set(k, v)
  return this;
}

/**
@method Model.onDupUpdate
*/
Model.prototype.onDupUpdate = function() {
  this.query = this.query.onDupUpdate.apply(this, Array.prototype.slice.call(arguments, 0));
  return this;
}

/**
high-level functions section
*/
/**
@method Model.findById
*/
Model.prototype.findById = function(id) {
  return this.find().where('id = ?', id).limit(1).do()
}

/**
@method Model.getFields
*/
Model.prototype.getFields = function() {
  return this.base.do({
    sql: `SHOW COLUMNS FROM ${this.table}`
  })
}

module.exports = Model;
