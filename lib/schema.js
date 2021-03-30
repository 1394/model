const path = require('path')
const fs = require('fs')

const locals = {
  schemaPath: './'
}

const setLocation = (location) => {
  locals.schemaPath = path.join(process.cwd(), location)
}

const updateSchema = async (connection) => {

}