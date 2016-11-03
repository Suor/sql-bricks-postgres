(function() {
"use strict";

var is_common_js = typeof exports != 'undefined';

var _ = is_common_js ? require('underscore') : window._;
var sql = is_common_js ? require('./postgres.js') : window.PostgresBricks();

var assert;
if (is_common_js) {
  assert = require('assert');
}
else {
  assert = function(condition, message) {
    if (!condition)
      throw new Error(message);
  };
  assert.equal = function(actual, expected) {
    if (actual != expected) throw new Error(JSON.stringify(actual) + ' == ' + JSON.stringify(expected));
  };
  assert.deepEqual = function(actual, expected) {
    if (!_.isEqual(actual, expected)) throw new Error(JSON.stringify(actual) + ' == ' + JSON.stringify(expected));
  };
  assert.throws = function(fn) {
    try {
      fn();
    }
    catch(ex) {
      return true;
    }
    throw new Error('The function passed to assert.throws() did not throw');
  }
}

var select = sql.select;
var update = sql.update;
var insert = sql.insert;
var del = sql.delete;

describe('Postgres extension for SQLBricks', function() {
  it('should handle UPDATE ... RETURNING', function() {
    assert.equal(update('user').set({'fname': 'Fred'}).where({'lname': 'Flintstone'}).returning('*').toString(),
      "UPDATE \"user\" SET fname = 'Fred' WHERE lname = 'Flintstone' RETURNING *");
  });

  it('should handle INSERT ... RETURNING', function() {
    assert.equal(insert('user').values({'fname': 'Fred'}).returning('*').toString(),
      "INSERT INTO \"user\" (fname) VALUES ('Fred') RETURNING *");
  });

  it('should handle INSERT ... SELECT ... RETURNING', function() {
    assert.equal(insert('user').select().from('old_user').returning('*').toString(),
      "INSERT INTO \"user\" SELECT * FROM old_user RETURNING *");
  });

  it('should handle DELETE ... RETURNING', function() {
    assert.equal(del('user').where({'lname': 'Flintstone'}).returning('*').toString(),
      "DELETE FROM \"user\" WHERE lname = 'Flintstone' RETURNING *");
  });

  it('should handle DELETE ... USING', function() {
    assert.equal(del('user').using('address').where('user.addr_fk', sql('addr.pk')).toString(),
      "DELETE FROM \"user\" USING address WHERE \"user\".addr_fk = addr.pk");
  });

  it('should handle UPDATE ... FROM', function() {
    assert.equal(update('setting', {value: sql('V.value')})
                  .from('val as V').where({name: sql('V.name')}).toString(),
      'UPDATE setting SET value = V.value FROM val as V WHERE name = V.name')
  })

  it('should handle sql() params', function() {
    var query = select().from('time_limit')
                        .where(sql('tsrange(start, end) @> tsrange($, $)',
                                   '2014-12-06T22:35:00', '2014-12-06T22:36:00'))
    assert.deepEqual(query.toParams(), {
      text: 'SELECT * FROM time_limit WHERE tsrange(start, end) @> tsrange($1, $2)',
      values: ['2014-12-06T22:35:00', '2014-12-06T22:36:00']
    })
  });

  // Fails now, see https://github.com/CSNW/sql-bricks/issues/77
  it.skip('should handle sql() params in tables', function() {
    var query = select().from('place', sql('plainto_tsquery($)', 'burger'))
    assert.equal(query.toString(), "SELECT * FROM time_limit WHERE plainto_tsquery('burger')")
  });

  describe("ilike", function () {

    it("should generate an ilike clause", function () {
      var data = sql.select().from("val")
        .where(sql.ilike("val.name", "foo"));

      assert.equal(data.toString(),
        "SELECT * FROM val WHERE val.name ILIKE 'foo'");
    });

  });

  describe('Values', function () {
    it('should work with select', function() {
      var data = [{name: 'a', value: 1}, {name: 'b', value: 2}]
      assert.equal(select().from(sql.values(data)).toString(),
        "SELECT * FROM (VALUES ('a', 1), ('b', 2))");
    })

    it('should accept single row', function() {
      assert.equal(sql.values({key: 'a', val: 1}).toString(), "VALUES ('a', 1)");
    })

    it('should add alias', function() {
      assert.equal(select().from(sql.values({key: 'a', val: 1}).as('v')).toString(),
        "SELECT * FROM (VALUES ('a', 1)) v");
    })

    it('should add columns', function() {
      assert.equal(select().from(sql.values({key: 'a', val: 1}).as('v').columns()).toString(),
        "SELECT * FROM (VALUES ('a', 1)) v (\"key\", val)");
    })

    it('should play nice with params', function() {
      var data = [{name: 'a', value: 1}, {name: 'b', value: 2}];
      assert.deepEqual(
        update('setting s', {value: sql('v.value')})
          .from(sql.values(data).as('v')).where('s.name', sql('v.name')).toParams(),
        {text: 'UPDATE setting s SET value = v.value '
             + 'FROM (VALUES ($1, $2), ($3, $4)) v WHERE s.name = v.name',
         values: ['a', 1, 'b', 2]})
    })

    it('should add types', function() {
      var data = {i: 1, f: 1.5, b: true, s: 'hi', n: null};
      assert.equal(sql.values(data).types().toParams().text,
                   'VALUES ($1::int, $2::float, $3::bool, $4, $5)')
    })

    it('should add explicit types', function() {
      var data = {n: null};
      assert.equal(sql.values(data).types({n: 'int'}).toParams().text,
                   'VALUES ($1::int)')
    })
  })

  it('should not change base', function() {
    var base = require('sql-bricks');
    assert.equal(base.values, undefined);
    assert.equal(base.insert.returning, undefined);
    assert.equal(base.update.from, undefined);
    assert(sql.insert.prototype.clauses !== base.insert.prototype.clauses)
  })

  it('should save where constructors', function() {
    assert.equal(select().from('user').where(sql.or({'name': 'Fred'}, {'name': 'Bob'})).toString(),
      "SELECT * FROM \"user\" WHERE name = 'Fred' OR name = 'Bob'");
  })
});

describe('LIMIT ... OFFSET', function() {
  describe('.limit()', function() {
    it('should add a LIMIT clause', function() {
      assert.equal(select().from('user').limit(10).toString(),
        'SELECT * FROM "user" LIMIT 10');
    });
  });

  describe('.offset()', function() {
    it('should add an OFFSET clause', function() {
      assert.equal(select().from('user').offset(10).toString(),
        'SELECT * FROM "user" OFFSET 10');
    });
    it('should place OFFSET after LIMIT if both are supplied', function() {
      assert.equal(select().from('user').offset(5).limit(10).toString(),
        'SELECT * FROM "user" LIMIT 10 OFFSET 5');
    });
  });
});

describe('JSON', function() {
  describe('Objects', function() {
    it('should handle UPDATE', function() {
      assert.equal(update('user').set({'address': { state: "CA" }}).where({'lname': 'Flintstone'}).toString(),
        "UPDATE \"user\" SET address = '{\"state\":\"CA\"}' WHERE lname = 'Flintstone'");
    });

    it('should handle INSERT', function() {
      assert.equal(insert('user').values({'address': { state: "CA" }}).toString(),
        "INSERT INTO \"user\" (address) VALUES ('{\"state\":\"CA\"}')");
    });
  });
});

})();
