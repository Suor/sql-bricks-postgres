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

  it('should handle DELETE ... RETURNING', function() {
    assert.equal(del('user').where({'lname': 'Flintstone'}).returning('*').toString(),
      "DELETE FROM \"user\" WHERE lname = 'Flintstone' RETURNING *");
  });

  it('should generate a DELETE with USING', function() {
    assert.equal(del('user').using('address').where('user.addr_fk', sql('addr.pk')).toString(),
      "DELETE FROM \"user\" USING address WHERE \"user\".addr_fk = addr.pk");
  });

  it('should support VALUES', function() {
    var data = [{name: 'a', value: 1}, {name: 'b', value: 2}]
    assert.equal(select().from(sql.values(data)).toParams(),
      "SELECT * FROM (VALUES ('a', 1), ('b', 2))");
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

})();
