'use strict'

const internals = {
  pools: {}
}

function DB (cfg, debug, options) {
  this.cfg = cfg
  this.cfg.connectionLimit = this.cfg.connectionLimit || 20
  this.db = this.cfg.database
  this.debug = debug
  var mysql = require('mysql')
  if (!internals.pools[this.cfg.database]) {
    internals.pools[this.cfg.database] = mysql.createPool(this.cfg)
  }
  this.pools = internals.pools
  if (options.serviceConn) {
    let serviceCfg = Object.assign({}, this.cfg)
    delete serviceCfg.database
    let serviceConn = mysql.createConnection(serviceCfg)
    this.serviceConn = (sql) => {
      return new Promise((resolve, reject) => {
        serviceConn.query(sql, (err, result) => {
          err ? reject(err) : resolve(result)
        })
      })
    }
  }
  this.connCounter = 0
  return this
}

DB.prototype.getPool = function () {
  return this.pools[this.db]
}

DB.prototype.do = function (opts) {
  var me = this

  if (opts.debug || this.debug) {
    let info = opts.values ? `DB.${this.cfg.database}.${opts.sql || opts} with values ${opts.values}` : `DB.${this.cfg.database}.${opts.sql || opts}`
    console.time(info)

    return new Promise(function (resolve, reject) {
      me.getPool().getConnection((err, conn) => {
        if (err) {
          console.timeEnd(info)
          if (conn) {
            conn.release()
          } else {
            console.error('connection wasn`t created')
          }
          reject(err)
          return
        }
        conn.query(opts, function (err, results, fields) {
          console.timeEnd(info)
          conn.release()
          err ? reject(err) : resolve(results, fields)
        })
      })
    })
  } else {
    return new Promise(function (resolve, reject) {
      me.getPool().getConnection((err, conn) => {
        if (err) {
          reject(err)
          return
        }
        conn.query(opts, function (err, results, fields) {
          conn.release()
          err ? reject(err) : resolve(results, fields)
        })
      })

    })
  }
}

DB.prototype.exec = function (opts, callback, scope) {
  var me = this

  if (opts.debug || this.debug)console.log('DB.prototype.exec : sql : %s with values %s', opts.sql, opts.values)

  me.getPool().getConnection((err, conn) => {
    if (err) {
      callback.call(scope, err, [])
      return
    }

    conn.query(opts, (err, results) => {
      callback.call(scope, err, results)
    })
  })
}

module.exports = DB
