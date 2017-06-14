'use strict'

const internals = {
  pools: {},
  driver: require('mysql2')
}

const injectConnectOptions = function (instance, sql) {
  instance.justStarted = false
  console.log('SET AUTOCOMMIT=0;')
  if (typeof sql === 'string') {
    sql = 'SET AUTOCOMMIT=0;' + sql
  } else {
    if (typeof sql.sql === 'string') {
      sql.sql = 'SET AUTOCOMMIT=0;' + sql.sql
    }
  }
}

class DBService {
  constructor (cfg, debug, options) {
    this.cfg = cfg
    this.justStarted = true
    options = options || {}
    this.cfg.connectionLimit = this.cfg.connectionLimit || 20
    this.db = this.cfg.database
    this.debug = debug
    if (!internals.pools[this.cfg.database]) {
      internals.pools[this.cfg.database] = internals.driver.createPool(this.cfg)
    }
    this.pools = internals.pools
    if (options.serviceConn) {
      let serviceCfg = Object.assign({}, this.cfg)
      delete serviceCfg.database
      let serviceConn = internals.driver.createConnection(serviceCfg)
      this.serviceConn = (sql) => {
        if (this.justStarted) {
          sql = injectConnectOptions(this, sql)
        }
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

  getPool () {
    return this.pools[this.db]
  }

  // doConn (conn, opts) {
  //   const startTime = Date.now()
  //   const debug = opts.debug || this.debug
  //   let info = opts.values ? `DB.${this.cfg.database}.${opts.sql || opts} with values ${opts.values}` : `DB.${this.cfg.database}.${opts.sql || opts}`
  //   const logTime = () => {
  //     if (!debug) {
  //       return
  //     }
  //     console.log(`${info} : ${(Date.now() - startTime) / 1000.0}ms`)
  //   }
  //   return new Promise(function (resolve, reject) {
  //     conn.query(opts, function (err, results, fields) {
  //       !opts.returnConnection && conn.release()
  //       logTime()
  //       if (err) {
  //         return opts.returnConnection && conn ? reject(err, conn) : reject(err)
  //       }
  //       return opts.returnConnection && conn ? resolve(results, fields, conn) : resolve(results, fields)
  //     })
  //   })
  // }

  do (opts) {
    const me = this
    const startTime = Date.now()
    const debug = opts.debug || this.debug
    let info = opts.values ? `DB.${this.cfg.database}.${opts.sql || opts} with values ${opts.values}` : `DB.${this.cfg.database}.${opts.sql || opts}`
    const logTime = () => {
      if (!debug) {
        return
      }
      console.log(`${info} ::: execute in ${Date.now() - startTime}ms`)
    }
    return new Promise(function (resolve, reject) {
      me.getPool().getConnection((err, conn) => {
        if (err) {
          if (conn && !opts.returnConnection) {
            conn.release()
          } else {
            console.error('connection wasn`t created')
          }
          logTime()
          return opts.returnConnection && conn ? reject(err, conn) : reject(err)
        }
        conn.query(opts, function (err, results, fields) {
          !opts.returnConnection && conn.release()
          logTime()
          if (err) {
            return opts.returnConnection && conn ? reject(err, conn) : reject(err)
          }
          return opts.returnConnection && conn ? resolve(results, fields, conn) : resolve(results, fields)
        })
      })
    })
    // }
  }
}

module.exports = DBService
