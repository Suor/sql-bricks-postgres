# Postgres dialect SQLBricks

Use:

```javascript
// in node:
var sql = require('sql-bricks-postgres');
// in the browser:
var sql = PostgresBricks;

var statement = sql.select().from('users').where({name: 'Fred Flintstone'});
```

Adds `limit()`, `offset()`, `returning()` and `using()` to the core SQLBricks library. See http://csnw.github.io/sql-bricks for more information.