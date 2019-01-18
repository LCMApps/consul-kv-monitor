# consul-kv-monitor

[![NPM version](https://img.shields.io/npm/v/consul-kv-monitor.svg)](https://www.npmjs.com/package/consul-kv-monitor)
[![Build Status](https://travis-ci.org/LCMApps/consul-kv-monitor.svg?branch=master)](https://travis-ci.org/LCMApps/consul-kv-monitor)
[![Coverage Status](https://coveralls.io/repos/github/LCMApps/consul-kv-monitor/badge.svg?branch=master)](https://coveralls.io/github/LCMApps/consul-kv-monitor?branch=master)

Module monitors consul key-value store and notifies about changes of a value or a set of values. It relies on
blocking queries and detects changes as soon as consul agent receives them. Module uses
[`consul`](https://github.com/silas/node-consul) module that must be installed too.

Please, check the full documentation below.

**Table of Contents**

* [Installation and Usage](#installation)
* [Monitor config](#monitor-config)
* [Listening of changes](#listening-of-changes)
* [Failures](#failures)

# <a name="installation"></a>Installation and Usage

Using npm:
```shell
$ npm install --save consul-kv-monitor consul
```

Using yarn:
```shell
$ yarn add consul-kv-monitor consul
```

After you've installed both `consul` and `consul-kv-monitor`, set it up and start the service in your code.

```js
const consul = require('consul');
const consulClient = consul({
    host: '127.0.0.1',
    port: 8500
});

const {ConsulKvMonitor, Errors} = require('consul-kv-monitor');

const monitorConfig = {
    keysPrefix: 'lcm',
    timeoutMsec: 1000,
    json: false
};

const monitor = new ConsulKvMonitor(monitorConfig, consulClient);

function printData(consulKvData) {
    const keys = consulKvData.getKeys();
    keys.forEach(key => {
        let value = consulKvData.getValue(key);
        if (value === Object(value)) {
            // we received json decoded data, so just stringifying to pretty outpur in this example
            value = JSON.stringify(value);
        }

        const metadata = consulKvData.getMetadata(key);
        console.log(`${key} => ${value}, metadata: ${JSON.stringify(metadata)}`);
    });
}

monitor.on('changed', (kvData) => {
    console.log('Some data has changed');
    console.log('Response headers:', JSON.stringify(monitor.getConsulHeaders()));
    printData(kvData);
    console.log();
});

monitor.on('error', (error) => {
    if (error instanceof Errors.InvalidDataError) {
        console.log(`Oh, key "${error.extra.key}" value can not be decoded as JSON, actual value is "${error.extra.value}"`);
        console.log('And here is a raw error');
        console.log(error);
    } else {
        console.log(`Error occured, class: ${error.name}`);
        console.log('And here is a raw error');
        console.log(error);
    }
});

monitor.start()
    .then(initialData => {
        console.log('Keys discovered on start:');
        console.log('Response headers:', JSON.stringify(monitor.getConsulHeaders()));
        printData(initialData);
        console.log();
    })
    .catch(err => {
        console.log(err instanceof Errors.WatchTimeoutError);
        console.error(err);
        process.exit(1);
    });
```

Lets add some data to kv:

```shell
$ consul kv put lcm/server-1 10.0.0.2
Success! Data written to: lcm/server-1
```

Then start this example. Right after initialization we may discover our key

```shell
$ node index.js
Keys discovered on start:
Response headers: {"x-consul-index":"337151414","x-consul-knownleader":"true","x-consul-lastcontact":"0"}
lcm/server-1 => 10.0.0.2, metadata: {"LockIndex":0,"Key":"lcm/server-1","Flags":0,"Value":"10.0.0.2","CreateIndex":337151414,"ModifyIndex":337151414}
```

Lets add one more key to subpath under monitoring while example is running.

```shell
$ consul kv put lcm/server-2 10.0.0.3
Success! Data written to: lcm/server-2
```

Monitor detects this change:

```shell
Some data has changed
Response headers: {"x-consul-index":"337156828","x-consul-knownleader":"true","x-consul-lastcontact":"0"}
lcm/server-1 => 10.0.0.2, metadata: {"LockIndex":0,"Key":"lcm/server-1","Flags":0,"Value":"10.0.0.2","CreateIndex":337151414,"ModifyIndex":337151414}
lcm/server-2 => 10.0.0.3, metadata: {"LockIndex":0,"Key":"lcm/server-2","Flags":0,"Value":"10.0.0.3","CreateIndex":337156828,"ModifyIndex":337156828}
```

Delete `lcm/server-1` and update `lcm/server-2`:

```shell
$ consul kv delete lcm/server-1
Success! Deleted key: lcm/server-1

$ consul kv put lcm/server-2 10.0.0.4
Success! Data written to: lcm/server-2
```

Monitor detects our changes:

```shell

Some data has changed
Response headers: {"x-consul-index":"337158175","x-consul-knownleader":"true","x-consul-lastcontact":"0"}
lcm/server-2 => 10.0.0.3, metadata: {"LockIndex":0,"Key":"lcm/server-2","Flags":0,"Value":"10.0.0.3","CreateIndex":337156828,"ModifyIndex":337156828}

Some data has changed
Response headers: {"x-consul-index":"337158295","x-consul-knownleader":"true","x-consul-lastcontact":"0"}
lcm/server-2 => 10.0.0.4, metadata: {"LockIndex":0,"Key":"lcm/server-2","Flags":0,"Value":"10.0.0.4","CreateIndex":337156828,"ModifyIndex":337158295}
```

And finally delete all keys:

```shell
$ consul kv delete lcm/server-2
Success! Deleted key: lcm/server-2
```

Monitor emits `change` event with an object without any keys.

```shell
Some data has changed
Response headers: {"x-consul-index":"337159004","x-consul-knownleader":"true","x-consul-lastcontact":"0"}
```

# <a name="monitor-config"></a>Monitor Config

There are few options available for the config object:
* `keysPrefix` (String): a path to specific key or path to set of keys, monitor always use
[`recurse`](https://github.com/silas/node-consul#consulkvgetoptions-callback) option of the `consul` client
* `timeoutMsec` (Number, optional, deafult: 5000): number of milliseconds to wait initial response from consul
* `json` (Boolean, optional, default: false): if `true` tries to decode json object from stringified value from consul,
make sense only if you store values as stringified objects


Example,

```js
const monitorConfig = {
    keysPrefix: 'path/to/key',
    timeoutMsec: 1000,
    json: true
};

const monitor = new ConsulKvMonitor(monitorConfig, consulClient);
```

Constructor throws error `TypeError` if invalid values passes. 

# <a name="start-and-stop"></a>Start and stop

### `ConsulKvMonitor.start()`

To start monitoring just call `start` method of the monitor.

```js
Errors = require('consul-kv-monitor').Errors;

try {
    const initialData = await monitor.start();
} catch (err) {
    console.log(err instanceof Errors.WatchTimeoutError);
}
```

`start` method returns promise that may be resolved with values under monitoring or be rejected.

Promise rejects with one of the following errors (all of them are in `Errors` set):
* `AlreadyInitializedError` if service is already started.
* `WatchTimeoutError` if either initial data nor error received for `timeoutMsec` msec
* `WatchError` on error from `consul` underlying method

Promise resolved only once. Rejection of promise means that watcher was stopped and no retries will be done.
To receive updates you may [add listeners](#listening-of-changes).

After successful start monitor never gives up and tries to reconnect even after failures. Of course, it [notifies
about failures](#failures).

### `ConsulKvMonitor.stop()`

To stop monitor just call `stop` method. It returns monitor object itself.

### `ConsulKvMonitor.isInitialized()`

This method returns `false` in the following scenarios:
* before start of monitoring
* [after failure](#failures) and till recovering from that failure
* after stop of monitor

After successful start it returns `true` till one of the event described above occurs.

# <a name="listening-of-changes"></a>Listening of changes

Monitor emits `changed` event if values in consul or data's metadata changes. It's possible to catch `changed` event
with a data without any modifications comparing to previous catch. It happens because consul's fields like
`ModifyIndex` or `LockIndex` may change without modification of data.

So, it's a good idea to compare actual changes.

Anyway, monitor emits instance of `ConsulKvData` class that has the following methods:
* `ConsulKvData.hasKey(key)`: checks presence of the given key in a set of monitored keys and returns `Boolean`
* `ConsulKvData.getKeys()`: returns an array of keys
* `ConsulKvData.getValue(key)`: returns [decoded json data](#monitor-config) or raw string data, if key is absent
returns `undefined`
* `ConsulKvData.getMetadata(key)`: returns all fields received from consul

Also, you may get `ConsulKvData` object by direct call to monitor at any moment after start:

```js
const keys = monitor.getData().getKeys();
```

`monitor.getData()` returns `ConsulKvData` object even if there are no keys at all.

# <a name="failures"></a>Failures

While monitor listens for changes it can lose connection with consul agent or consul agent can lose connection with a
master server, so keys under monitoring may become inconsistent. Monitor will run normally and will try to recover
as soon as possible using reconnection with backoff. But business logic may require to detect such situations and make
some actions. At [LCMApps](https://github.com/LCMApps) we stop processing requests while kv connection is unhealthy.

So, monitor emits `unhealthy` event if it detects failure. You may still get last seen values from KV or consul headers
but always remember that requested data may be stale.

If a unhealthy state is caused by consul error then monitor emits `error` event with `WatchError` instance right
after `unhealthy` event.

After successful recovery to healthy state monitor emits `healthy` event and may emit `changed` event with updated
keys.  

At any time you may get health status running method explicitly:

```js
monitor.isWatchHealthy();
```

Method returns `true` or `false`.

Also there is special case when monitor emits `error` events. If you pass `json: true` option in constructor monitor
tries to decode string in value field as a JSON. But if value is not JSON monitor can't decode value and emits
`error` event passing object of `InvalidDataError` class. For example, if consul KV stores 3 values not in
stringified JSON format monitor emits 3 errors.

Let's use an example from the start of this readme, but with `json: true` option.


Set invalid JSON value

```shell
$ consul kv put lcm/server-2 '{"a":1,"b"}'
Success! Data written to: lcm/server-2
```

Monitor emits `error`

```shell
Some data has changed
Response headers: {"x-consul-index":"337175801","x-consul-knownleader":"true","x-consul-lastcontact":"0"}

Oh, key "lcm/server-2" value can not be decoded as JSON, actual value is "{"a":1,"b"}"
And here is a raw error
{ InvalidDataError: Invalid JSON of Value field of KV is received from consul, record will be skipped
    at validRecords.forEach.record (/home/vss-services-rel/mt/node_modules/consul-kv-monitor/src/Factory.js:31:31)
    at Array.forEach (<anonymous>)
    at Object.buildConsulKvData (/home/vss-services-rel/mt/node_modules/consul-kv-monitor/src/Factory.js:22:18)
    at ConsulKvMonitor._onWatcherChange (/home/vss-services-rel/mt/node_modules/consul-kv-monitor/src/ConsulKvMonitor.js:274:50)
    at emitTwo (events.js:126:13)
    at Watch.emit (events.js:214:7)
    at /home/vss-services-rel/mt/node_modules/consul/lib/watch.js:179:14
    at Consul.<anonymous> (/home/vss-services-rel/mt/node_modules/consul/lib/kv.js:71:5)
    at next (/home/vss-services-rel/mt/node_modules/papi/lib/client.js:313:25)
    at IncomingMessage.<anonymous> (/home/vss-services-rel/mt/node_modules/papi/lib/client.js:611:7)
  extra: { key: 'lcm/server-2', value: '{"a":1,"b"}' },
  name: 'InvalidDataError' }
```

Set correct JSON

```shell
$ consul kv put lcm/server-2 '{"a":1,"b":[]}'
Success! Data written to: lcm/server-2
```

Monitor sees changes

```shell
Some data has changed
Response headers: {"x-consul-index":"337176075","x-consul-knownleader":"true","x-consul-lastcontact":"0"}
lcm/server-2 => {"a":1,"b":[]}, metadata: {"LockIndex":0,"Key":"lcm/server-2","Flags":0,"Value":"{\"a\":1,\"b\":[]}","CreateIndex":337171339,"ModifyIndex":337176075}
```
