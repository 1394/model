simple Model for the easy creation mysql queries.

1. install :  npm i @dmitri.leto/model -S

2. usage : const model = require('@dmitri.leto/model')

for first require need call model.setConfig( config ) where config options :

  connection_name: {
    db: 'db_name',
    user: 
  }