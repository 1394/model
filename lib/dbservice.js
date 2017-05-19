'use strict'

const internals = {
  pools: {},
  driver: require('mysql2')
}

class DBService {
  constructor (cfg, debug) {
    this.cfg = cfg
    this.cfg.connectionLimit = this.cfg.connectionLimit || 20
    this.db = this.cfg.database
    this.debug = debug
    if (!internals.pools[this.cfg.database]) {
      internals.pools[this.cfg.database] = internals.driver.createPool(this.cfg)
    }
    this.pools = internals.pools
    this.connCounter = 0
    return this
  }

  getPool () {
    return this.pools[this.db]
  }

  do (opts) {
    var me = this
    if (opts.debug || this.debug) {
      let info = opts.values ? `DB.${this.cfg.database}.${opts.sql || opts} with values ${opts.values}` : `DB.${this.cfg.database}.${opts.sql || opts}`
      console.time(info)
      return new Promise(function (resolve, reject) {
        me.getPool().getConnection((err, conn) => {
          if (err) {
            console.timeEnd(info)
            conn.release()
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

  exec (opts, callback, scope) {
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
}

module.exports = DBService
